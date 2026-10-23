/** 微信公众号发布器——HTML 富文本 → 草稿箱 → freepublish 发布 */
import { Injectable, Logger } from '@nestjs/common';
import { IPublisher, PublishPayload, PublishResult } from '../publisher.interface';
import { WechatMpClient } from './wechat-mp.client';

/** 微信 CDN 域名前缀，已上传图片不再重复处理 */
const WECHAT_CDN_HOSTS = /mmbiz\.qpic\.cn|mmbiz\.qlogo\.cn/i;

/**
 * 正文无图时的兜底封面（thumb_media_id，公众号永久素材）。
 *
 * 背景：日报类成文是纯文本 HTML（只有 h2/h3/p，没有 <img>），
 * 取不到正文首图 → 建草稿必然抛「缺少封面」→ 每天定时发布全失败。
 * 该素材为「大橙子社区」通用封面，2026-10-23 上传到公众号永久素材库；
 * dev / prod 共用同一公众号（WECHAT_MP_APP_ID 一致），media_id 两边通用。
 *
 * 换封面：设环境变量 WECHAT_MP_DEFAULT_THUMB_MEDIA_ID 覆盖，无需改代码。
 */
const FALLBACK_THUMB_MEDIA_ID =
  'BUSabtk9juW90vSVH4g1KvRzUZWAHmPFAFslvaKJIwuQ_CyNhFapHJA7CIRSUTTI';

export interface DraftResult {
  success: boolean;
  media_id?: string;
  error?: string;
}

@Injectable()
export class WechatMpPublisher implements IPublisher {
  readonly target = 'wechat_mp';
  private readonly logger = new Logger(WechatMpPublisher.name);
  /** 多公众号：account → client 缓存（默认号 key 为 default） */
  private readonly clients = new Map<string, WechatMpClient>();

  /**
   * 按账号取 client。
   * - 不传 / default：读 WECHAT_MP_APP_ID / WECHAT_MP_APP_SECRET
   * - 传 kedouai：读 WECHAT_MP_KEDOUAI_APP_ID / WECHAT_MP_KEDOUAI_APP_SECRET
   * 若配置了 WECHAT_MP_ACCOUNTS，则只放行名单内的账号，防止拼错变量名静默落到空凭据。
   */
  private getClient(account?: string): WechatMpClient {
    const key = (account || 'default').trim().toLowerCase();

    const allowList = (process.env.WECHAT_MP_ACCOUNTS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowList.length > 0 && !allowList.includes(key)) {
      throw new Error(
        `公众号账号「${key}」未注册，可用账号：${allowList.join(' / ')}`,
      );
    }

    const cached = this.clients.get(key);
    if (cached) return cached;

    const suffix = key === 'default' ? '' : `_${key.toUpperCase()}`;
    const appId = process.env[`WECHAT_MP${suffix}_APP_ID`] ?? '';
    const appSecret = process.env[`WECHAT_MP${suffix}_APP_SECRET`] ?? '';
    if (!appId || !appSecret) {
      throw new Error(
        `公众号账号「${key}」凭据未配置（WECHAT_MP${suffix}_APP_ID/APP_SECRET）`,
      );
    }

    // WECHAT_MP_API_BASE 可选：默认官方 API，测试/私有化可指向代理
    const client = new WechatMpClient({
      appId,
      appSecret,
      apiBase: process.env.WECHAT_MP_API_BASE || undefined,
    });
    this.clients.set(key, client);
    this.logger.log(`[wechat_mp] 使用公众号账号: ${key}`);
    return client;
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
      client = this.getClient(payload.account);
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
      client = this.getClient(payload.account);
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
      // 2'. 兜底：正文一张图都没有时用默认封面（env 优先，其次内置常量）。
      // 日报类成文普遍无图，没有这层兜底就会每天定时发布失败。
      thumbMediaId =
        process.env.WECHAT_MP_DEFAULT_THUMB_MEDIA_ID?.trim() || FALLBACK_THUMB_MEDIA_ID;
      if (thumbMediaId) {
        this.logger.warn(`[wechat_mp] 正文无图，已用默认封面兜底: ${thumbMediaId}`);
      }
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
