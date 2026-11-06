import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { WecomConfigService } from './wecom.config';
import { WECOM_FETCHER } from './wecom-api.client';

/**
 * 跨服务身份解析客户端（卡② T2-c / V14）。
 *
 * 唯一身份来源是卡① 的 `POST /internal/identities/resolve`（契约见
 * `docs/development/wecom-approval-identity-contract.md`）。console **不直连 users 表**。
 *
 * 🔴 **fail-closed 是这个文件存在的全部理由**：
 * 既有 `ApproverService` 在 user-service 不可达时是「降级放行」，
 * 但企微通道里 user-service 是唯一身份来源，放行 = 谁都能批 prod。
 * 所以任何超时 / 非 2xx / 结构异常 / data:null 一律返回拒绝原因，绝不返回身份。
 */

export interface ResolvedIdentity {
  userId: string;
  username: string;
  nickname?: string;
  roles: string[];
  systems: string[];
  mergedFrom?: { userId: string; username: string };
}

export type ResolveFailureReason = 'unavailable' | 'not_found' | 'bad_response' | 'disabled';

export type ResolveResult =
  | { ok: true; identity: ResolvedIdentity }
  | { ok: false; reason: ResolveFailureReason };

type Fetcher = typeof globalThis.fetch;
interface ResolveResponse {
  code?: number;
  data?: ResolvedIdentity | null;
}

@Injectable()
export class WecomIdentityClient {
  private readonly logger = new Logger(WecomIdentityClient.name);

  constructor(
    private readonly config: WecomConfigService,
    @Optional() @Inject(WECOM_FETCHER) private readonly fetcher?: Fetcher,
  ) {}

  private get fetch(): Fetcher {
    return this.fetcher ?? globalThis.fetch;
  }

  async resolve(externalId: string): Promise<ResolveResult> {
    if (!this.config.enabled) return { ok: false, reason: 'disabled' };
    if (!externalId || !externalId.trim()) return { ok: false, reason: 'not_found' };

    const { userServiceUrl, internalApiKey } = this.config.config;
    if (!internalApiKey) {
      // 没带 internal key 就不该发请求：带了也是 401，且会把「未配置」误判成「服务挂了」
      this.logger.error('未配置 INTERNAL_API_KEY，企微通道按 fail-closed 拒绝');
      return { ok: false, reason: 'unavailable' };
    }

    try {
      const res = await this.fetch(`${userServiceUrl}/internal/identities/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalApiKey },
        body: JSON.stringify({ channel: 'wecom', externalId }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.logger.warn(`身份解析不可用: user-service HTTP ${res.status}`);
        return { ok: false, reason: 'unavailable' };
      }
      const body = (await res.json()) as ResolveResponse;
      if (!body || typeof body !== 'object') return { ok: false, reason: 'bad_response' };
      if (body.data === null || body.data === undefined) {
        return { ok: false, reason: 'not_found' };
      }
      const data = body.data;
      if (typeof data?.userId !== 'string' || typeof data?.username !== 'string') {
        return { ok: false, reason: 'bad_response' };
      }
      return {
        ok: true,
        identity: {
          userId: data.userId,
          username: data.username,
          nickname: data.nickname,
          roles: Array.isArray(data.roles) ? data.roles : [],
          systems: Array.isArray(data.systems) ? data.systems : [],
          mergedFrom: data.mergedFrom,
        },
      };
    } catch (e) {
      this.logger.warn(`身份解析不可用（fail-closed）: ${(e as Error).message}`);
      return { ok: false, reason: 'unavailable' };
    }
  }
}
