import { Injectable, Logger } from '@nestjs/common';
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
 * 可插拔的 AI 图生图客户端
 * 默认使用开发模式 mock，生产环境接入真实 API（通义万相 / 即梦 / DALL-E 等）
 */
@Injectable()
export class ImageGenClient {
  private readonly logger = new Logger(ImageGenClient.name);

  /** 是否开发模式（mock） */
  private readonly isMockMode: boolean;
  /** AI 图生图 API URL（用于生产环境） */
  private readonly apiUrl: string;
  /** API Key */
  private readonly apiKey: string;
  /** 使用的模型 */
  private readonly model: string;

  constructor(private readonly httpService: HttpService) {
    this.isMockMode = process.env.IMAGE_GEN_MODE !== 'production';
    this.apiUrl = process.env.IMAGE_GEN_API_URL || '';
    this.apiKey = process.env.IMAGE_GEN_API_KEY || '';
    this.model = process.env.IMAGE_GEN_MODEL || 'stable-diffusion-xl';
  }

  /**
   * 图生图：输入拼接画 → 输出 3D 角色
   */
  async generate(options: ImageGenOptions): Promise<ImageGenResult> {
    const startTime = Date.now();

    if (this.isMockMode) {
      return this.mockGenerate(options, startTime);
    }

    return this.remoteGenerate(options, startTime);
  }

  /**
   * 开发模式：返回带处理的输入图（模拟 AI 处理延迟）
   */
  private async mockGenerate(
    options: ImageGenOptions,
    startTime: number,
  ): Promise<ImageGenResult> {
    this.logger.log('[Mock] Starting image generation...');

    // 模拟 AI 处理时间 1.5~4 秒（随机波动，更真实）
    const delay = 1500 + Math.random() * 2500;
    await new Promise((resolve) => setTimeout(resolve, delay));

    const processingTimeMs = Date.now() - startTime;

    this.logger.log(
      `[Mock] Generation complete in ${processingTimeMs}ms, prompt: ${buildPrompt(options.description).substring(0, 80)}...`,
    );

    // 开发模式：直接返回输入图（实际生产环境会替换为真实 AI 结果）
    return {
      image: options.image,
      requestId: `mock_${Date.now()}`,
      processingTimeMs,
    };
  }

  /**
   * 生产模式：调用远程 AI 图生图 API
   * 支持 OpenAI 兼容格式（DALL-E / Stability AI / 通义万相等）
   */
  private async remoteGenerate(
    options: ImageGenOptions,
    startTime: number,
  ): Promise<ImageGenResult> {
    if (!this.apiKey) {
      throw new Error('IMAGE_GEN_API_KEY is not configured');
    }

    const prompt = buildPrompt(options.description);

    try {
      // 尝试 OpenAI DALL-E 兼容格式
      const payload = {
        model: this.model,
        prompt,
        image: options.image, // base64 input image
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
          timeout: 60000, // 图生图可能需要更长时间
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

      // 如果返回的是 URL，需要进一步处理（或直接返回 URL）
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
