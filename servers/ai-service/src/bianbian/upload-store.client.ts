import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { API_TIMEOUT, SERVICE_URL_DEFAULTS } from '@web-system/shared';
import { firstValueFrom } from 'rxjs';

/** 内部落盘返回的统一结构（与 upload-service `internal/uploads/store` 一致） */
export interface StoredUpload {
  url: string;
  filename: string;
  originalName: string;
  size: number;
  category: string;
  mimetype: string;
}

export interface StoreImageInput {
  /** 目录分类（upload-service 的 CATEGORIES 键，如 `bianbian`） */
  category: string;
  /** 落盘文件名，**必须带合法图片扩展名**（决定存储名后缀） */
  filename: string;
  buffer: Buffer;
  mimeType?: string;
}

/** 内部落盘走 multipart；图片体积较大，超时比普通内部调用（3s）放宽 */
const STORE_TIMEOUT_MS = Math.max(API_TIMEOUT.UPSTREAM.INTERNAL ?? 3000, 10_000);

/**
 * 内部上传落盘客户端（A8）
 *
 * ai-service 不再自己写盘：生成图统一调 upload-service 的
 * `POST /internal/uploads/store`（A3 提供的唯一写入点），拿到与其它上传一致的
 * `/api/uploads/<category>/<file>` URL。路径解析仍只存在于 upload-service，不扩散到本服务。
 *
 * 契约要点（改前先看 `servers/upload-service/src/upload/internal-uploads.controller.ts`）：
 * - 鉴权：header `x-internal-key`（未配置或不对 → 401）
 * - 字段：`file`(binary) + `category` + `filename`；DTO 开了 whitelist + forbidNonWhitelisted → **禁止多传字段**
 * - 上限 12MB；category 只能是 avatars/drawing/bianbian/general
 */
@Injectable()
export class UploadStoreClient {
  private readonly logger = new Logger(UploadStoreClient.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private get uploadServiceUrl(): string {
    return (
      this.configService.get<string>('UPLOAD_SERVICE_URL') || SERVICE_URL_DEFAULTS.upload
    ).replace(/\/$/, '');
  }

  private get internalKey(): string {
    return this.configService.get<string>('INTERNAL_API_KEY') || '';
  }

  /** 落盘一张图片，返回统一 URL（失败抛错，由调用方决定降级） */
  async storeImage(input: StoreImageInput): Promise<string> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(input.buffer)], {
      type: input.mimeType || 'application/octet-stream',
    });
    // 字段名必须是 `file`（FileInterceptor），且不得多传 DTO 未声明的字段
    form.append('file', blob, input.filename);
    form.append('category', input.category);
    form.append('filename', input.filename);

    const url = `${this.uploadServiceUrl}/internal/uploads/store`;
    const res = await firstValueFrom(
      this.httpService.post(url, form, {
        headers: { 'x-internal-key': this.internalKey },
        timeout: STORE_TIMEOUT_MS,
        // multipart 由 FormData 自动带 boundary；显式覆盖会破坏 boundary
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }),
    );

    const body = res.data as { code?: number; data?: StoredUpload; message?: string };
    if (res.status >= 400 || body?.code !== 0 || !body?.data?.url) {
      throw new Error(
        `内部落盘失败: HTTP ${res.status} code=${body?.code ?? '-'} ${body?.message ?? ''}`.trim(),
      );
    }

    this.logger.log(`生成图已落盘: ${body.data.url}`);
    return body.data.url;
  }
}
