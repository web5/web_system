/** 微信公众号发布器——HTML 富文本 → 草稿箱 → freepublish 发布 */
import { Injectable, Logger } from '@nestjs/common';
import { IPublisher, PublishPayload, PublishResult } from '../publisher.interface';
import { WechatMpClient } from './wechat-mp.client';

/** 微信 CDN 域名前缀，已上传图片不再重复处理 */
const WECHAT_CDN_HOSTS = /mmbiz\.qpic\.cn|mmbiz\.qlogo\.cn/i;

export interface DraftResult {
  success: boolean;
  media_id?: string;
  error?: string;
}

@Injectable()
export class WechatMpPublisher implements IPublisher {
  readonly target = 'wechat_mp';
  private readonly logger = new Logger(WechatMpPublisher.name);
  private client: WechatMpClient | null = null;

  private getClient(): WechatMpClient {
    const appId = process.env.WECHAT_MP_APP_ID ?? '';
    const appSecret = process.env.WECHAT_MP_APP_SECRET ?? '';
    if (!appId || !appSecret) {
      throw new Error('微信公众号凭据未配置（WECHAT_MP_APP_ID/APP_SECRET）');
    }
    if (!this.client) {
      // WECHAT_MP_API_BASE 可选：默认官方 API，测试/私有化可指向代理
      this.client = new WechatMpClient({
        appId,
        appSecret,
        apiBase: process.env.WECHAT_MP_API_BASE || undefined,
      });
    }
    return this.client;
  }

  /** 发布：建草稿 → freepublish 提交发布（对外契约 publish()） */
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const title = payload.title?.trim();
    const html = payload.html?.trim();
    if (!title || !html) {
      return { success: false, error: '公众号发布缺少 title 或 html' };
    }

    let client: WechatMpClient;
    try {
      client = this.getClient();
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }

    try {
      const mediaId = await this.buildDraft(client, { ...payload, title, html });
      const publishId = await client.submitFreepublish(mediaId);
      this.logger.log(`[wechat_mp] 发布成功 media=${mediaId} publish=${publishId} «${title}»`);
      return { success: true, external_id: publishId };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`公众号发布失败: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /** 只建草稿不发布，返回 media_id（供 MCP/后台预览，可在公众号后台确认） */
  async createDraft(payload: PublishPayload): Promise<DraftResult> {
    const title = payload.title?.trim();
    const html = payload.html?.trim();
    if (!title || !html) {
      return { success: false, error: '公众号草稿缺少 title 或 html' };
    }

    let client: WechatMpClient;
    try {
      client = this.getClient();
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }

    try {
      const mediaId = await this.buildDraft(client, { ...payload, title, html });
      this.logger.log(`[wechat_mp] 草稿已建 media=${mediaId} «${title}»`);
      return { success: true, media_id: mediaId };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`公众号建草稿失败: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * 公共建稿步骤：正文外链图转微信 CDN → 封面素材 → draft/add。
   * 返回 media_id（微信图文素材）
   */
  private async buildDraft(
    client: WechatMpClient,
    payload: PublishPayload & { title: string; html: string },
  ): Promise<string> {
    // 1. 正文外链图转微信 CDN（保证公众号内可显示）
    const { content, firstImage } = await this.uploadBodyImages(client, payload.html);

    // 2. 封面：优先显式 thumb_media_id；否则用正文首图（复用已下载的 blob，不再二次下载）
    let thumbMediaId = payload.thumb_media_id?.trim();
    if (!thumbMediaId && firstImage) {
      thumbMediaId = await client.uploadThumbMedia(firstImage.blob, firstImage.filename);
      this.logger.log(`[wechat_mp] 已用正文首图作封面: ${thumbMediaId}`);
    }
    if (!thumbMediaId) {
      throw new Error('缺少封面：请传 thumb_media_id，或正文中放一张图片用作封面');
    }

    // 3. 新增草稿
    return client.addDraft({
      title: payload.title,
      content,
      thumb_media_id: thumbMediaId,
      digest: payload.digest,
      content_source_url: payload.source_url,
    });
  }

  /**
   * 把正文 HTML 中所有非微信 CDN 的图片上传到微信，返回替换后的 HTML 与首图 blob。
   * 本地相对路径不支持（调用方应先转成公网 URL 或 dataURL）。
   */
  private async uploadBodyImages(
    client: WechatMpClient,
    html: string,
  ): Promise<{ content: string; firstImage: { blob: Blob; filename: string } | null }> {
    const srcRe = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
    const urls: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = srcRe.exec(html)) !== null) {
      const src = m[1].trim();
      if (src && !WECHAT_CDN_HOSTS.test(src) && !urls.includes(src)) {
        urls.push(src);
      }
    }
    if (urls.length === 0) {
      return { content: html, firstImage: null };
    }

    let content = html;
    let firstImage: { blob: Blob; filename: string } | null = null;
    for (const src of urls) {
      try {
        const { blob, filename } = await client.downloadImage(src);
        const wechatUrl = await client.uploadContentImage(blob, filename);
        content = content.split(src).join(wechatUrl);
        if (!firstImage) firstImage = { blob, filename };
        this.logger.log(`[wechat_mp] 正文图片 ${src.slice(0, 60)}… → ${wechatUrl}`);
      } catch (e) {
        this.logger.warn(`[wechat_mp] 图片上传失败保留原图: ${src} (${(e as Error).message})`);
      }
    }
    return { content, firstImage };
  }
}
