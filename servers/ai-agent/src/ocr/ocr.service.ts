import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';
import { ClientRegistry } from '@kedouai/agent-core';
import { BusinessException } from '../common/exceptions/business.exception';

const OcrClient = tencentcloud.ocr.v20181119.Client;

/** OCR 识别结果（含清洗标记） */
export interface OcrResult {
  /** 清洗后的合同正文（用户在小程序看到的、用于分析的文本） */
  text: string;
  /** 清洗后有效文本块数量 */
  blockCount: number;
  /** 图片方向（0 表示正） */
  angle?: number;
  /** OCR 原始识别的文本块数量（用于显示"识别到 N 段文字"） */
  originalBlockCount: number;
  /** 是否经过 AI 清洗 */
  cleaned: boolean;
}

/** 合同文本清洗 prompt（OCR 一体化清洗时复用） */
const CLEANER_SYSTEM_PROMPT =
  '你是一个专业的合同文本清洗助手。给定一份 OCR 识别出的合同原始文本，请清洗后输出"纯净的合同条款"。\n' +
  '清洗规则：\n' +
  '1. 删除页眉/页脚噪声：手机时间、状态栏（如"13:30"、"5G @24"）、页脚、页码、导航文字。\n' +
  '2. 删除与合同条款无关的内容：表格行（重复的套餐/权益记录）、按钮文字、"合同列表"等界面元素。\n' +
  '3. 保留合同正文条款，按逻辑顺序重排；若条款有编号，保留编号。\n' +
  '4. 输出纯文本，不要添加任何解释、前言、markdown 标题或代码块。\n' +
  '5. 若某段文字既有噪声又有合同内容，保留合同内容部分。\n' +
  '只输出清洗后的合同文本，不要输出任何其他内容。';

/**
 * OCR 服务 — 用腾讯云通用印刷体识别（GeneralBasicOCR）识别合同图片，
 * 并自动用 LLM 清洗噪声（页眉页脚/表格/状态栏），返回的 text 已是纯净合同正文。
 *
 * 这样用户在 textarea 看到的就是干净的合同文本，体验更好。
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private client: InstanceType<typeof OcrClient> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly clientRegistry: ClientRegistry,
  ) {
    this.initClient();
  }

  private initClient(): void {
    const secretId = this.configService.get<string>('TENCENT_SECRET_ID');
    const secretKey = this.configService.get<string>('TENCENT_SECRET_KEY');

    if (!secretId || !secretKey) {
      this.logger.warn('OCR 未配置：缺少 TENCENT_SECRET_ID / TENCENT_SECRET_KEY，图片识别不可用');
      return;
    }

    this.client = new OcrClient({
      credential: { secretId, secretKey },
      region: 'ap-guangzhou',
      profile: {
        httpProfile: { endpoint: 'ocr.tencentcloudapi.com' },
      },
    });

    this.logger.log('腾讯云 OCR 客户端初始化成功');
  }

  /**
   * 识别图片中的合同文字并自动清洗。
   * @param imageBase64 图片的 base64 编码（不含 data: 前缀）
   */
  async recognize(imageBase64: string): Promise<OcrResult> {
    if (!this.client) {
      throw new BusinessException(
        'OCR 未配置（缺少 TENCENT_SECRET_ID / TENCENT_SECRET_KEY），请改为粘贴合同文本',
        4002,
      );
    }

    if (!imageBase64) {
      throw new BusinessException('图片内容为空', 4001);
    }

    // 1. 腾讯云 OCR 识别
    let rawText: string;
    let originalBlockCount: number;
    let angle: number | undefined;
    try {
      const response = await this.client.GeneralBasicOCR({
        ImageBase64: imageBase64,
        IsPdf: false,
      });
      const textDetections = response.TextDetections || [];
      const blocks = textDetections
        .filter((d: any) => d.DetectedText)
        .map((d: any) => d.DetectedText as string);
      rawText = blocks.join('\n');
      originalBlockCount = blocks.length;
      angle = response.Angle;
    } catch (error: any) {
      const errMsg = error?.message || String(error);
      const errCode = error?.code || error?.response?.data?.Error?.Code || '';
      const reqId = error?.requestId || error?.response?.headers?.['x-tc-requestid'] || '';
      this.logger.error(
        `OCR 识别失败: code=${errCode} msg=${errMsg} requestId=${reqId}`,
        error?.stack,
      );
      throw new BusinessException(
        `OCR 识别失败（${errCode || '腾讯云'}）: ${errMsg}。可重试或改粘贴文本`,
        5002,
      );
    }

    // 2. LLM 清洗噪声（页眉页脚/状态栏/表格/导航文字）
    const cleanedText = await this.cleanText(rawText);

    return {
      text: cleanedText,
      blockCount: cleanedText ? cleanedText.split('\n').filter((l) => l.trim()).length : 0,
      angle,
      originalBlockCount,
      cleaned: cleanedText !== rawText,
    };
  }

  /** 用 LLM 清洗 OCR 文本中的噪声，失败时回退原始文本 */
  private async cleanText(rawText: string): Promise<string> {
    if (!rawText.trim()) return rawText;

    try {
      const model = this.clientRegistry.getOrFallback('deepseek-chat');
      const cleaned = await model.chat(
        [
          { role: 'system', content: CLEANER_SYSTEM_PROMPT },
          { role: 'user', content: `请清洗以下合同 OCR 文本：\n\n${rawText}` },
        ],
        { temperature: 0.2, maxTokens: 3000 },
      );
      const result = cleaned.trim();
      if (!result) return rawText;
      this.logger.log(`OCR 清洗完成：原始 ${rawText.length} 字符 → 清洗后 ${result.length} 字符`);
      return result;
    } catch (error) {
      this.logger.warn(`OCR 文本清洗失败，回退原始文本: ${(error as Error).message}`);
      return rawText;
    }
  }
}