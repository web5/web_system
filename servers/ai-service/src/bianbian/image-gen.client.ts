import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';

export interface ImageGenOptions {
  /** 原始画作图片的公开访问 URL（非 base64），作为 hy-image-v3.0 图生图参考图 */
  imageUrl?: string;
  /** 孩子口头/文字描述的画作内容 */
  description: string;
  /** 风格 key，如 pixar-3d */
  style?: string;
  /** 输出尺寸，如 1024x1024 */
  outputSize?: string;
}

export interface ImageGenResult {
  /** 生成结果图片 URL */
  image: string;
  /** MaaS 任务 ID */
  requestId: string;
  /** 服务侧处理耗时（毫秒） */
  processingTimeMs: number;
}

/**
 * 变变图片生成客户端。
 *
 * 腾讯云 MaaS 文生图（hy-image-v3.0）为「提交任务 -> 轮询结果」的异步接口：
 *   1. POST {baseUrl}/v1/api/image/submit  -> 返回任务 id
 *   2. 轮询 POST {baseUrl}/v1/api/image/query (携带 id) -> status=completed 时返回 data[0].url
 *
 * 原实现错误地把 MaaS 当成 OpenAI 风格的同步接口直接 POST 到 baseUrl，
 * 永远拿不到图片 -> 变变结果接口始终失败。这里改为正确的任务式流程。
 */
@Injectable()
export class ImageGenClient {
  private readonly logger = new Logger(ImageGenClient.name);

  /** 默认文生图模型 */
  private readonly model = 'hy-image-v3.0';
  /** 轮询总超时（毫秒），需小于网关/代理 120s 超时 */
  private readonly maxPollMs = 100_000;
  /** 轮询间隔（毫秒） */
  private readonly pollIntervalMs = 2_500;

  constructor(private readonly httpService: HttpService) {}

  async generate(opts: ImageGenOptions): Promise<ImageGenResult> {
    const apiKey = process.env.IMAGE_GEN_API_KEY;
    if (!apiKey) {
      throw new Error('图片生成服务未配置 (IMAGE_GEN_API_KEY)');
    }
    const baseUrl =
      process.env.IMAGE_GEN_API_URL?.replace(/\/$/, '') ||
      'https://tokenhub.tencentmaas.com';

    const hasImage = !!opts.imageUrl;
    const prompt = this.buildPrompt(opts.description, opts.style, hasImage);
    const referenceImages = hasImage ? [opts.imageUrl!] : undefined;
    const startedAt = Date.now();

    this.logger.log(
      `构造 MaaS 提示词: hasImage=${hasImage}, imageUrl=${opts.imageUrl || '无'}, prompt=${prompt.slice(0, 200)}...`,
    );

    // 1. 提交生成任务（MaaS 偶发不返回任务 ID，自动重试一次；带图失败时回退到纯文生图）
    const submitUrl = `${baseUrl}/v1/api/image/submit`;
    const submitOnce = async (withImages = false): Promise<AxiosResponse> => {
      const payload: { model: string; prompt: string; images?: string[] } = {
        model: this.model,
        prompt,
      };
      if (withImages && referenceImages?.length) {
        payload.images = referenceImages;
      }
      return firstValueFrom(
        this.httpService.post(
          submitUrl,
          payload,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 30_000,
          },
        ),
      );
    };

    let submitRes: AxiosResponse | null = null;
    let lastSubmitError = '';
    let usedImages = !!referenceImages?.length;
    for (let attempt = 0; attempt < 2 && !submitRes?.data?.id; attempt++) {
      if (attempt > 0) {
        this.logger.warn(`图片生成任务提交重试第 ${attempt} 次...`);
        await this.sleep(1500);
      }
      try {
        submitRes = await submitOnce(usedImages);
      } catch (error) {
        lastSubmitError = error?.response?.data?.message || error?.message || '未知错误';
        this.logger.error(`图片生成任务提交失败(第${attempt + 1}次): ${lastSubmitError}`);
        // 若带图提交失败，第二轮尝试不带图回退
        if (usedImages && attempt === 0) {
          usedImages = false;
          this.logger.warn('参考图提交失败，将回退到纯文本生图');
        }
      }
    }

    const taskId = submitRes?.data?.id;
    if (!taskId) {
      if (submitRes) {
        this.logger.error(`图片生成未返回任务 ID: ${JSON.stringify(submitRes.data)}`);
      }
      throw new Error(
        lastSubmitError
          ? `图片生成任务提交失败: ${lastSubmitError}`
          : '图片生成任务创建失败：未返回任务 ID',
      );
    }
    this.logger.log(`图片生成任务已提交, taskId=${taskId}, usedImages=${usedImages}`);

    // 2. 轮询任务结果
    const queryUrl = `${baseUrl}/v1/api/image/query`;
    const deadline = Date.now() + this.maxPollMs;
    while (Date.now() < deadline) {
      await this.sleep(this.pollIntervalMs);

      let queryRes: AxiosResponse;
      try {
        queryRes = await firstValueFrom(
          this.httpService.post(
            queryUrl,
            { model: this.model, id: taskId },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              timeout: 30_000,
            },
          ),
        );
      } catch (error) {
        const msg = error?.response?.data?.message || error?.message || '未知错误';
        this.logger.error(`图片生成任务查询失败: ${msg}`);
        throw new Error(`图片生成任务查询失败: ${msg}`);
      }

      const raw = queryRes.data;
      const status = raw?.status;

      if (status === 'completed' || status === 'succeeded') {
        const item = raw?.data?.[0];
        const url = item?.url;
        if (url) {
          return {
            image: url,
            requestId: taskId,
            processingTimeMs: Date.now() - startedAt,
          };
        }
        throw new Error('图片生成完成，但未返回图片地址');
      }

      if (status === 'failed') {
        const errMsg = raw?.error?.message || JSON.stringify(raw?.error) || '未知错误';
        throw new Error(`图片生成失败: ${errMsg}`);
      }
      // 其它状态（pending / in_progress）：继续轮询
    }

    throw new Error('图片生成超时，请稍后重试');
  }

  /** 根据孩子的描述与参考图构造高质量的变身提示词（MaaS 图生图模型） */
  private buildPrompt(description: string, style?: string, hasImage?: boolean): string {
    const styleName = style?.includes('pixar')
      ? '皮克斯/迪士尼风格 3D'
      : style?.includes('clay')
        ? '黏土材质 3D'
        : style?.includes('watercolor')
          ? '水彩风格'
          : style || '3D 卡通';

    const desc = (description && description.trim()) || '一个充满想象力的可爱卡通角色';

    const commonRules =
      '要求：正面或 3/4 侧面视角，半身或全身，表情生动，纯色或简洁渐变背景，' +
      '画面明亮温暖，适合 6-12 岁儿童，不要大面积留白。';

    const styleNote =
      style?.includes('pixar')
        ? '风格参考皮克斯/迪士尼：圆润、萌系、色彩鲜明、有质感的三维渲染。'
        : '风格：圆润可爱、色彩鲜明、萌系三维渲染。';

    if (hasImage) {
      return (
        `你是一个儿童创造力 AI 助手。请严格按以下规则创作一个${styleName}角色：\n` +
        `1. 必须仔细观察并识别参考图片（孩子的原画）中所有可见元素：形状、颜色、姿态、构图、数量和相对位置。\n` +
        `2. 必须同时阅读并理解文字描述："${desc}"。\n` +
        `3. 【强制合并】最终画面必须同时包含原画里出现的所有元素 AND 文字描述里提到的关键元素，不能把两者割裂或只选其一。\n` +
        `   例如：如果原画里画了鱼，文字描述提到猫，就必须画出猫和鱼在一起（如猫抱着鱼、猫看着鱼、猫和鱼一起玩耍），不能只画猫。\n` +
        `4. 保持儿童涂鸦的天真、稚拙、童趣感，角色造型可爱、圆润、色彩明快。\n` +
        `${commonRules}\n${styleNote}`
      );
    }

    return (
      `你是一个儿童创造力 AI 助手。请根据文字描述创作一个${styleName}角色。\n` +
      `文字描述："${desc}"\n${commonRules}\n${styleNote}`
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
