import { Injectable, Logger } from '@nestjs/common';
import { SERVICE_URL_DEFAULTS } from '@web-system/shared';

/** 与 upload-service `internal/uploads/store` 返回一致 */
export interface StoredUpload {
  /** 对外访问 URL：`/api/uploads/<category>/<filename>` */
  url: string;
  filename: string;
  originalName: string;
  size: number;
  category: string;
  mimetype: string | null;
}

/** 图片转存超时：封面 5MB 上限，内网直传，给 15s 足够；比普通内部调用（3s）放宽 */
const STORE_TIMEOUT_MS = 15_000;

/**
 * 转存图片到 upload-service。
 *
 * 🔴 为什么 content-hub 不自己写盘：upload-service 是**唯一写入点**（design §1.6），
 *    路径解析、命名规约、分类限制、元数据落库只有一份实现。
 *    这里的角色跟 ai-service 的 `UploadStoreClient` 一致，只是用全局 `fetch`
 *    （本服务没装 @nestjs/axios，为一个 multipart 请求引入 axios 不划算）。
 *
 * 契约（改前先看 `servers/upload-service/src/upload/internal-uploads.controller.ts`）：
 * - 鉴权：header `x-internal-key`
 * - 字段：`file`(binary) + `category` + `filename`；DTO 开了 forbidNonWhitelisted → **禁止多传字段**
 * - 上限 12MB；category 需在 upload-service 的 CATEGORIES 里
 */
@Injectable()
export class UploadStoreClient {
  private readonly logger = new Logger(UploadStoreClient.name);

  private get baseUrl(): string {
    return (process.env.UPLOAD_SERVICE_URL || SERVICE_URL_DEFAULTS.upload).replace(/\/$/, '');
  }

  private get internalKey(): string {
    return process.env.INTERNAL_API_KEY ?? '';
  }

  /**
   * 落盘一张图片，返回统一 URL。
   *
   * 失败一律抛错 —— 素材入库与落盘必须同生共死：存了 URL 却拿不到图，
   * 后面发布时才发现，比当场报错难查得多。
   */
  async storeImage(input: {
    buffer: Buffer;
    filename: string;
    mimeType?: string | null;
    category?: string;
  }): Promise<StoredUpload> {
    const key = this.internalKey;
    if (!key) {
      throw new Error('INTERNAL_API_KEY 未配置，无法转存图片到 upload-service');
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.buffer)], { type: input.mimeType || 'application/octet-stream' }),
      input.filename,
    );
    form.append('category', input.category || 'covers');
    form.append('filename', input.filename);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STORE_TIMEOUT_MS);
    try {
      const resp = await fetch(`${this.baseUrl}/internal/uploads/store`, {
        method: 'POST',
        headers: { 'x-internal-key': key },
        body: form,
        signal: controller.signal,
      });
      const text = await resp.text();
      if (!resp.ok) {
        throw new Error(`转存失败 HTTP ${resp.status} ${text.slice(0, 200)}`);
      }
      const body = JSON.parse(text) as { code?: number; data?: StoredUpload };
      const data = body.data;
      if (!data?.url) {
        throw new Error(`转存返回异常：${text.slice(0, 200)}`);
      }
      this.logger.log(`图片已转存 upload-service: ${data.url} (${data.size} 字节)`);
      return data;
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? '转存超时（15s）' : (e as Error).message;
      this.logger.error(`图片转存失败: ${msg}`);
      throw new Error(msg);
    } finally {
      clearTimeout(timer);
    }
  }
}
