import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MediaService, type MediaVO } from './media.service';

/** 与 ai-service 的变变一致：腾讯云 MaaS 文生图模型 */
const IMAGE_MODEL = 'hy-image-v3.0';
/** 轮询总上限：超过就放弃（网关侧是 120s，这里留足余量） */
const MAX_POLL_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

export interface GenerateCoverInput {
  /** 文章标题（必填）—— 画面的主要语义来源 */
  title: string;
  /** 摘要/正文片段，可选，用来补充画面细节 */
  summary?: string;
  /** 额外的风格追加词（如「国风」「赛博朋克」），可选 */
  styleExtra?: string;
  /** 素材命名，默认用标题 */
  name?: string;
  tags?: string[];
}

/**
 * 按文章标题生成公众号封面。
 *
 * 为什么放在 content-hub 而不是 ai-service：生成完要**直接落进素材库**
 * （存 upload-service + 写 content_media），跨服务跑一趟再传回来只会多一次失败点。
 * 这里复用的是同一套 MaaS 协议（submit + query 异步任务）。
 *
 * 🔴 prompt 里明确「画面不要出现任何文字」：文生图模型写中文必糊，
 *    而封面上的标题微信会自己渲染在头图上，模型再画一遍纯属噪音。
 */
@Injectable()
export class CoverAiService {
  private readonly logger = new Logger(CoverAiService.name);

  constructor(private readonly mediaService: MediaService) {}

  private get apiKey(): string {
    return process.env.IMAGE_GEN_API_KEY ?? '';
  }

  private get baseUrl(): string {
    return (process.env.IMAGE_GEN_API_URL || 'https://tokenhub.tencentmaas.com').replace(/\/$/, '');
  }

  async generate(input: GenerateCoverInput): Promise<MediaVO> {
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('缺少标题：封面需要按标题生成');
    if (!this.apiKey) {
      throw new BadRequestException(
        '未配置 IMAGE_GEN_API_KEY，AI 生成封面不可用（可先用手动上传）',
      );
    }

    const prompt = this.buildPrompt(title, input.summary, input.styleExtra);
    const imageUrl = await this.runTask(prompt);
    const buffer = await this.download(imageUrl, title);
    return this.mediaService.createFromBuffer({
      buffer,
      filename: `ai-cover-${Date.now()}.png`,
      mime: 'image/png',
      name: input.name?.trim() || title.slice(0, 60),
      tags: input.tags?.length ? input.tags : ['AI生成'],
      prompt,
    });
  }

  /** 提交任务并轮询到出图，返回图片 URL */
  private async runTask(prompt: string): Promise<string> {
    const submitResp = await this.postJson(`${this.baseUrl}/v1/api/image/submit`, {
      model: IMAGE_MODEL,
      prompt,
    });
    const taskId = submitResp?.id;
    if (!taskId) {
      const reason = submitResp?.error?.message || submitResp?.message || '未返回任务 ID';
      throw new BadRequestException(`封面生成任务创建失败：${reason}`);
    }
    this.logger.log(`封面生成任务已提交 taskId=${taskId}`);

    const deadline = Date.now() + MAX_POLL_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const queryResp = await this.postJson(`${this.baseUrl}/v1/api/image/query`, {
        model: IMAGE_MODEL,
        id: taskId,
      });
      const status = queryResp?.status;
      if (status === 'completed' || status === 'succeeded') {
        const url = queryResp?.data?.[0]?.url;
        if (!url) throw new BadRequestException('封面生成完成但没有返回图片地址');
        return String(url);
      }
      if (status === 'failed') {
        const reason = queryResp?.error?.message || JSON.stringify(queryResp?.error ?? {});
        throw new BadRequestException(`封面生成失败：${reason}`);
      }
      // pending / in_progress：继续等
    }
    throw new BadRequestException('封面生成超时（90s），请重试或改用手动上传');
  }

  private async postJson(url: string, body: Record<string, unknown>): Promise<any> {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new BadRequestException(`生图服务返回 HTTP ${resp.status}：${text.slice(0, 160)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new BadRequestException(`生图服务返回非 JSON：${text.slice(0, 160)}`);
    }
  }

  private async download(url: string, title: string): Promise<Buffer> {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new BadRequestException(`下载生成结果失败 HTTP ${resp.status}（${title.slice(0, 20)}…）`);
    }
    return Buffer.from(await resp.arrayBuffer());
  }

  /**
   * 封面提示词。
   *
   * 结构固定为「画面主体 + 构图 + 风格 + 硬性禁止」四段：
   * 少任何一段，模型就容易给出居中大标题、满屏元素、或干脆把字画上去。
   */
  private buildPrompt(title: string, summary?: string, styleExtra?: string): string {
    const scene = summary?.trim() ? `${title}。背景信息：${summary.trim().slice(0, 200)}` : title;
    return [
      `为科技媒体文章生成一张横版封面配图。文章主题：${scene}`,
      '构图：横幅 2.35:1，主体偏右，左侧大面积干净留白（标题会叠在留白处），视觉重心明确，细节克制。',
      '风格：现代科技媒体视觉，简洁几何构成 + 柔和渐变光影，冷色为基调，点缀一处暖色高光；景深干净，无杂乱元素。',
      styleExtra?.trim() ? `额外风格要求：${styleExtra.trim()}。` : '',
      '硬性要求：画面中不要出现任何文字、字母、数字、水印、logo；不要拼贴多张图；不要人物正脸特写。',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
