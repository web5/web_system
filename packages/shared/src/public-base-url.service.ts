import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizePublicBaseUrl } from './public-url';

interface CacheEntry {
  value: string;
  fetchedAt: number;
}

/** 拉取 system-service 内部接口的超时（ms）—— system-service 慢/挂了不能拖住头像返回 */
const FETCH_TIMEOUT_MS = 5000;

/**
 * 公网根地址读取客户端（服务间调用 system-service `/internal/settings/public-base-url`）。
 *
 * 约定（与 ai-agent 的 DictClientService 一致）：
 * - 主源：system-service `system_configs` 表 key=`public_base_url`；
 * - 60s 内存缓存（`PUBLIC_BASE_URL_CACHE_MS` 可调）：公网根地址变更容忍分钟级生效，
 *   避免每次返回头像都打网络；
 * - 任何失败/空值回落 `PUBLIC_BASE_URL` env 兜底，最终可能返回空串（= 保持相对路径，
 *   与历史行为一致）；失败只 `logger.warn`，**绝不 throw 中断业务**。
 */
@Injectable()
export class PublicBaseUrlService {
  private readonly logger = new Logger(PublicBaseUrlService.name);
  private readonly systemServiceUrl: string;
  private readonly internalKey: string;
  private readonly envBaseUrl: string;
  private readonly cacheMs: number;
  private cache: CacheEntry | null = null;

  constructor(private readonly configService: ConfigService) {
    this.systemServiceUrl = (
      this.configService.get<string>('SYSTEM_SERVICE_URL', 'http://127.0.0.1:6004') || ''
    ).replace(/\/+$/, '');
    this.internalKey = this.configService.get<string>('INTERNAL_API_KEY', '') || '';
    this.envBaseUrl = this.configService.get<string>('PUBLIC_BASE_URL', '') || '';
    this.cacheMs = Number(this.configService.get('PUBLIC_BASE_URL_CACHE_MS', '60000')) || 60000;
  }

  /** 取规范化后的公网根地址（带缓存 + env 兜底）；可能返回空串（保持相对路径），绝不抛错 */
  async resolve(): Promise<string> {
    if (this.cache && Date.now() - this.cache.fetchedAt < this.cacheMs) {
      return this.cache.value;
    }

    const value = await this.fetchValue();
    if (value) {
      this.cache = { value, fetchedAt: Date.now() };
      return value;
    }

    const fallback = normalizePublicBaseUrl(this.envBaseUrl);
    this.logger.warn(
      fallback
        ? `public_base_url 拉取失败/为空，回落 env 兜底：${fallback}`
        : 'public_base_url 拉取失败/为空，且 env 兜底未配置，保持相对路径',
    );
    return fallback;
  }

  /** 从 system-service 读权威值；失败/空返回空串（由 resolve 兜底） */
  private async fetchValue(): Promise<string> {
    if (!this.internalKey) {
      this.logger.warn('INTERNAL_API_KEY 未配置，跳过 system-service 公网根地址查询');
      return '';
    }
    try {
      const res = await fetch(`${this.systemServiceUrl}/internal/settings/public-base-url`, {
        headers: { 'x-internal-key': this.internalKey },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`拉取 public_base_url 失败：system-service 返回 ${res.status}`);
        return '';
      }
      const body = (await res.json()) as { data?: unknown };
      return normalizePublicBaseUrl(String(body?.data ?? ''));
    } catch (e) {
      const err = e as Error;
      this.logger.warn(
        `拉取 public_base_url 失败：${
          err.name === 'TimeoutError' || err.name === 'AbortError'
            ? `超时（>${FETCH_TIMEOUT_MS}ms）`
            : err.message
        }`,
      );
      return '';
    }
  }
}
