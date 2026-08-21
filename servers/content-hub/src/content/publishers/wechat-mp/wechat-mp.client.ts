/** 微信公众号 API 客户端——access_token / 图片上传 / 草稿箱 / 发布 */
import { Logger } from '@nestjs/common';

export interface WechatMpOptions {
  appId: string;
  appSecret: string;
  /** 微信 API 基址（默认官方；测试可指向 mock 服务） */
  apiBase?: string;
}

/** 图文草稿（对应 draft/add 的 articles 项） */
export interface WechatDraftArticle {
  title: string;
  content: string; // HTML 富文本
  thumb_media_id: string; // 封面素材 media_id
  author?: string;
  digest?: string;
  content_source_url?: string;
  need_open_comment?: number; // 是否打开评论 0/1
  only_fans_can_comment?: number; // 是否仅粉丝可评论 0/1
}

const DEFAULT_API_BASE = 'https://api.weixin.qq.com';

/** 微信返回体统一判定：errcode 为 0 或缺失即成功 */
export interface WechatResponse {
  errcode?: number;
  errmsg?: string;
  [k: string]: unknown;
}

export class WechatMpClient {
  private readonly logger = new Logger(WechatMpClient.name);
  private readonly apiBase: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly opts: WechatMpOptions) {
    this.apiBase = opts.apiBase ?? DEFAULT_API_BASE;
  }

  /** 获取 access_token（缓存，提前 5 分钟刷新） */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }
    const url = new URL('/cgi-bin/token', this.apiBase);
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', this.opts.appId);
    url.searchParams.set('secret', this.opts.appSecret);

    const resp = await fetch(url.toString());
    const data = (await resp.json()) as WechatResponse & { access_token?: string; expires_in?: number };
    this.throwIfError(data, '获取 access_token');
    if (!data.access_token) {
      throw new Error('微信 access_token 返回为空');
    }
    this.accessToken = data.access_token;
    // 提前 300s 刷新，避免边界过期
    this.tokenExpiresAt = Date.now() + (Number(data.expires_in ?? 7200) - 300) * 1000;
    return this.accessToken;
  }

  /** 上传正文图片（media/uploadimg），返回可直接用于 HTML img src 的微信 URL */
  async uploadContentImage(image: Blob, filename = 'image.png'): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${this.apiBase}/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(token)}`;
    const data = await this.uploadMultipart(url, image, filename);
    this.throwIfError(data, '上传正文图片');
    if (!data.url) throw new Error('微信 uploadimg 未返回 url');
    return String(data.url);
  }

  /** 上传封面/永久图片素材（material/add_material type=image），返回 thumb_media_id */
  async uploadThumbMedia(image: Blob, filename = 'thumb.png'): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${this.apiBase}/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=image`;
    const data = await this.uploadMultipart(url, image, filename);
    this.throwIfError(data, '上传封面素材');
    if (!data.media_id) throw new Error('微信 add_material 未返回 media_id');
    return String(data.media_id);
  }

  /** 新增图文草稿（draft/add），返回 media_id */
  async addDraft(article: WechatDraftArticle): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${this.apiBase}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`;
    const data = (await this.postJson(url, { articles: [article] })) as WechatResponse & {
      media_id?: string;
    };
    this.throwIfError(data, '新增草稿');
    if (!data.media_id) throw new Error('微信 draft/add 未返回 media_id');
    return String(data.media_id);
  }

  /** 发布草稿（freepublish/submit），返回 publish_id（非 media_id） */
  async submitFreepublish(mediaId: string): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${this.apiBase}/cgi-bin/freepublish/submit?access_token=${encodeURIComponent(token)}`;
    const data = (await this.postJson(url, { media_id: mediaId })) as WechatResponse & {
      publish_id?: string;
    };
    this.throwIfError(data, '发布草稿');
    if (!data.publish_id) throw new Error('微信 freepublish/submit 未返回 publish_id');
    return String(data.publish_id);
  }

  /** 查询发布结果（freepublish/get），发布状态 0=成功 1=发布中 2=原始失败 3=平台审核不通过 */
  async getFreepublish(publishId: string): Promise<Record<string, unknown>> {
    const token = await this.getAccessToken();
    const url = `${this.apiBase}/cgi-bin/freepublish/get?access_token=${encodeURIComponent(token)}`;
    const data = (await this.postJson(url, { publish_id: publishId })) as WechatResponse & {
      publish_status?: number;
      article_detail?: unknown;
    };
    this.throwIfError(data, '查询发布状态');
    return data as Record<string, unknown>;
  }

  // ── 内部工具 ──

  /** 微信统一错误判定：errcode 非 0 抛错 */
  private throwIfError(data: WechatResponse, action: string): void {
    if (data.errcode && Number(data.errcode) !== 0) {
      throw new Error(`微信 ${action}失败[${data.errcode}] ${data.errmsg ?? ''}`);
    }
  }

  private async postJson(url: string, body: Record<string, unknown>): Promise<WechatResponse> {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new Error(`微信请求失败: HTTP ${resp.status}`);
    }
    return (await resp.json()) as WechatResponse;
  }

  /** multipart 上传（Node 原生 FormData + Blob） */
  private async uploadMultipart(
    url: string,
    image: Blob,
    filename: string,
  ): Promise<WechatResponse> {
    const form = new FormData();
    form.append('media', image, filename);
    const resp = await fetch(url, { method: 'POST', body: form });
    if (!resp.ok) {
      throw new Error(`微信上传失败: HTTP ${resp.status}`);
    }
    return (await resp.json()) as WechatResponse;
  }

  /** 下载远程图片为 Blob（供上传微信用），返回 { blob, filename } */
  async downloadImage(
    imageUrl: string,
  ): Promise<{ blob: Blob; filename: string }> {
    const resp = await fetch(imageUrl);
    if (!resp.ok) {
      throw new Error(`下载图片失败: HTTP ${resp.status} ${imageUrl}`);
    }
    const blob = await resp.blob();
    const mime = blob.type || 'image/png';
    const ext = mime.split('/')[1] ?? 'png';
    const name = `image_${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`;
    return { blob, filename: name };
  }
}
