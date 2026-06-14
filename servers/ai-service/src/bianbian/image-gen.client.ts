import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';

export interface ImageGenOptions {
  /** 输入图片（base64 data URL） */
  image: string;
  /** 用户描述 */
  description?: string;
  /** 目标风格 */
  style: string;
  /** 输出尺寸 */
  outputSize: string;
}

export interface ImageGenResult {
  /** 生成的图片（base64 data URL） */
  image: string;
  /** AI 平台请求 ID */
  requestId: string;
  /** 处理耗时 */
  processingTimeMs: number;
}

/** 变变 AI 图生图提示词模板 */
function buildPrompt(description?: string): string {
  const base = `任务：将儿童拼接画转换为3D卡通角色。

风格要求：
- 皮克斯 3D 卡通风格（Pixar-style 3D character）
- 圆润可爱，毛绒质感
- 大眼睛，友好表情，适合6-10岁儿童审美

姿态控制：
- 全身站立，双手自然垂于身体两侧
- 面朝正前方，平视角度
- 双脚并拢，稳稳站在地面上

背景与构图：
- 纯白色背景（#FFFFFF），无阴影
- 角色居中构图，占画面70-80%
- 正方形画幅

色彩要求：
- 70% 保留原画的配色方案
- 30% 提升色彩饱和度和质感
- 不改变原画的整体色调感觉

禁止事项：
- 不添加原画中没有的显著元素（翅膀、武器、配饰等）
- 不改变角色的物种/品类
- 不做过度拟人化处理
- 不添加文字、水印、边框`;

  if (description) {
    return `${base}\n\n用户描述：${description}\n\n请根据描述帮助 AI 更好地理解画面意图。`;
  }

  return `${base}\n\n这是一幅用 emoji/素材拼接的作品，请理解这幅画的「意图」而不是「形态」。保留它的「孩子气」。`;
}

/**
 * AI 图生图客户端
 * 支持 OpenAI 兼容格式（DALL-E / Stability AI / 通义万相等）
 */
@Injectable()
export class ImageGenClient implements OnModuleInit {
  private readonly logger = new Logger(ImageGenClient.name);
  /** AI 图生图 API URL */
  private readonly apiUrl: string;
  /** API Key */
  private readonly apiKey: string;
  /** 使用的模型 */
  private readonly model: string;

  constructor(private readonly httpService: HttpService) {
    this.apiUrl = process.env.IMAGE_GEN_API_URL || '';
    this.apiKey = process.env.IMAGE_GEN_API_KEY || '';
    this.model = process.env.IMAGE_GEN_MODEL || 'stable-diffusion-xl';
  }

  onModuleInit() {
    if (!this.apiKey) {
      this.logger.warn('IMAGE_GEN_API_KEY 未配置，AI 图生图功能将在运行时失败');
    }
    if (!this.apiUrl) {
      this.logger.warn('IMAGE_GEN_API_URL 未配置，AI 图生图功能将在运行时失败');
    }
    this.logger.log(`ImageGenClient initialized: model=${this.model}, url=${this.apiUrl || '(not set)'}`);
  }

  /**
   * 图生图：输入拼接画 → 输出 3D 角色
   */
  async generate(options: ImageGenOptions): Promise<ImageGenResult> {
    const startTime = Date.now();

    if (!this.apiKey) {
      throw new Error('IMAGE_GEN_API_KEY is not configured');
    }

    const prompt = buildPrompt(options.description);

    try {
      const payload = {
        model: this.model,
        prompt,
        image: options.image,
        n: 1,
        size: options.outputSize,
        response_format: 'b64_json',
      };

      this.logger.log(`Calling image gen API: ${this.apiUrl}, model: ${this.model}`);

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.post(this.apiUrl, payload, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }),
      );

      const resultImage = response.data?.data?.[0]?.b64_json || response.data?.data?.[0]?.url;
      const requestId =
        response.data?.id || response.data?.request_id || `api_${Date.now()}`;

      if (!resultImage) {
        this.logger.error(`Invalid response from image gen API: ${JSON.stringify(response.data)}`);
        throw new Error('AI 图生图 API 返回数据异常');
      }

      const processingTimeMs = Date.now() - startTime;
      this.logger.log(`Remote image gen complete in ${processingTimeMs}ms, requestId: ${requestId}`);

      const image =
        typeof resultImage === 'string' && resultImage.startsWith('data:')
          ? resultImage
          : `data:image/png;base64,${resultImage}`;

      return {
        image,
        requestId,
        processingTimeMs,
      };
    } catch (error) {
      this.logger.error(`Image gen API error: ${error.message}`, error.stack);

      if (error.response) {
        this.logger.error(`API response: ${JSON.stringify(error.response.data)}`);
        throw new Error(
          `AI 图生图服务调用失败: ${error.response.data?.error?.message || error.message}`,
        );
      }

      throw new Error(`AI 图生图服务调用失败: ${error.message}`);
    }
  }
}
