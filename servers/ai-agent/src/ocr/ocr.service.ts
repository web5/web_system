import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';
import { BusinessException } from '../common/exceptions/business.exception';

const OcrClient = tencentcloud.ocr.v20181119.Client;

/** OCR 识别结果 */
export interface OcrResult {
  text: string;
  /** 检测到的文本块数量 */
  blockCount: number;
  /** 图片方向（0 表示正） */
  angle?: number;
}

/**
 * OCR 服务 — 用腾讯云通用印刷体识别（GeneralBasicOCR）识别合同图片/PDF。
 *
 * 需要配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY（与 ai-service TTS 共用）。
 * 未配置时抛业务异常，前端可引导用户改为粘贴文本。
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private client: InstanceType<typeof OcrClient> | null = null;

  constructor(private readonly configService: ConfigService) {
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
   * 识别图片中的印刷体文字。
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

    try {
      const response = await this.client.GeneralBasicOCR({
        ImageBase64: imageBase64,
        IsPdf: false,
      });

      const textDetections = response.TextDetections || [];
      const blocks = textDetections
        .filter((d: any) => d.DetectedText)
        .map((d: any) => d.DetectedText as string);

      return {
        text: blocks.join('\n'),
        blockCount: blocks.length,
        angle: response.Angle,
      };
    } catch (error: any) {
      this.logger.error(`OCR 识别失败: ${error.message}`, error.stack);
      throw new BusinessException('OCR 识别失败，请重试或改为粘贴文本', 5002);
    }
  }
}
