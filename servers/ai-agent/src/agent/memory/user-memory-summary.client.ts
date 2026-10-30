import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SERVICE_URL_DEFAULTS } from '@web-system/shared';

/** internal summary/get 的返回投影 */
export interface UserMemorySummaryDto {
  namespace: string;
  summary: string | null;
  version: number | null;
  itemCount: number;
}

/**
 * user-service「用户记忆摘要」internal 客户端（#8229 批次1 卡1.6/1.7 共用）。
 *
 * - getSummary：loadProfile 注入时读摘要（GET /internal/user-memory/summary/get）；
 * - refreshSummary：明细写入成功后触发重算（POST /internal/user-memory/summary/refresh）。
 *
 * 鉴权与 MusicService / UserMemoryUpdateHook 的 upsert 同款：x-service-key
 * （USER_SERVICE_KEY，与 user-service 两端一致，未配置时 user-service fail-closed 401）。
 * 本类方法只做 HTTP 与解包，错误向上抛，由调用方决定降级策略（注入跳过 / 触发静默）。
 */
@Injectable()
export class UserMemorySummaryClient {
  private readonly logger = new Logger(UserMemorySummaryClient.name);

  private readonly userServiceUrl: string;
  private readonly serviceKey: string;

  constructor(private readonly configService: ConfigService) {
    this.userServiceUrl = this.configService.get<string>('USER_SERVICE_URL', SERVICE_URL_DEFAULTS.user);
    this.serviceKey = this.configService.get<string>('USER_SERVICE_KEY', '');
  }

  /** 读摘要行；user-service 无摘要（null）时返回 null */
  async getSummary(userId: string, namespace = 'general'): Promise<UserMemorySummaryDto | null> {
    const data = await this.callInternal<UserMemorySummaryDto>(
      `/internal/user-memory/summary/get?userId=${encodeURIComponent(userId)}&namespace=${encodeURIComponent(namespace)}`,
    );
    // 兼容 { code, data } 包装与裸返回
    const dto = (data ?? null) as UserMemorySummaryDto | null;
    if (!dto || dto.summary == null) return null;
    return dto;
  }

  /** 触发摘要全量重算（user-service 侧幂等：同一明细集指纹不产生新版本） */
  async refreshSummary(userId: string, namespace = 'general'): Promise<void> {
    const url = `${this.userServiceUrl.replace(/\/$/, '')}/internal/user-memory/summary/refresh`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-key': this.serviceKey,
      },
      body: JSON.stringify({ userId, namespace }),
      signal: AbortSignal.timeout(65_000),
    });
    if (!res.ok) {
      throw new Error(`user-service internal summary/refresh 返回 ${res.status}`);
    }
  }

  /** 统一调 user-service internal GET，解 TransformInterceptor 的 { code, data } 包装 */
  private async callInternal<T>(path: string): Promise<T> {
    const url = `${this.userServiceUrl.replace(/\/$/, '')}${path}`;
    const res = await fetch(url, {
      headers: {
        'x-service-key': this.serviceKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`user-service internal ${path} 返回 ${res.status}`);
    }
    const body = (await res.json()) as { code?: number; data?: unknown };
    return (body?.data ?? body) as T;
  }
}
