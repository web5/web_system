import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 可审批人：拥有 `deploy:pipeline:approve` 权限的系统用户（方案 B，弱绑定）。
 *
 * 背景：审批原先是「手填用户名」，`approvers` 只是记录、不做任何校验 ——
 * 谁登进控制台都能点通过。接权限体系后，审批人来自 user-service：
 * 权限码由 `packages/types` 声明、随发布自动 seed，与 admin 系统共用一套真相源。
 *
 * **弱绑定（B1）的含义**：deploy-console 的登录仍是 `.env` 单一管理员，
 * 这里按**用户名字符串**与 user-service 的用户比对。所以
 * 「console 登录名」必须能在 user-service 里找到同名用户，否则校验放行并告警。
 *
 * **降级策略（重要）**：user-service 不可达时**放行 + 告警**，绝不阻断审批 ——
 * 权限服务挂了不该让一次紧急回滚也批不了，但要留下痕迹（degraded=true 回传前端）。
 */

export const APPROVE_PERMISSION = 'deploy:pipeline:approve';

export interface ApproverUser {
  id: string;
  username: string;
  nickname?: string;
  roles: string[];
}

export interface ApproversResult {
  users: ApproverUser[];
  /** true=权限服务不可用，本次未做校验（前端需提示） */
  degraded: boolean;
  reason?: string;
}

/** 缓存时长：可审批人变动不频繁，避免每次审批都打一次跨服务调用 */
const CACHE_TTL_MS = 60_000;

@Injectable()
export class ApproverService {
  private readonly logger = new Logger(ApproverService.name);
  private cache?: { at: number; users: ApproverUser[] };

  constructor(private readonly configService: ConfigService) {}

  private get base(): string {
    return (this.configService.get<string>('USER_SERVICE_URL') || 'http://127.0.0.1:6002').replace(
      /\/+$/,
      '',
    );
  }

  private get internalKey(): string {
    return this.configService.get<string>('INTERNAL_API_KEY') || '';
  }

  /** 拉可审批人（带 60s 缓存；失败返回 degraded=true 而非抛错） */
  async list(): Promise<ApproversResult> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return { users: this.cache.users, degraded: false };
    }
    const key = this.internalKey;
    if (!key) {
      return { users: [], degraded: true, reason: '未配置 INTERNAL_API_KEY' };
    }
    try {
      const res = await fetch(`${this.base}/internal/users/by-permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({ codes: [APPROVE_PERMISSION] }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return { users: [], degraded: true, reason: `user-service 返回 ${res.status}` };
      }
      const body = (await res.json()) as {
        data?: { users?: Array<{ id: string; username: string; nickname?: string; roles: string[] }> };
      };
      const users: ApproverUser[] = (body?.data?.users ?? []).map((u) => ({
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        roles: Array.isArray(u.roles) ? u.roles : [],
      }));
      this.cache = { at: Date.now(), users };
      return { users, degraded: false };
    } catch (e) {
      this.logger.warn(`拉取可审批人失败（降级为不校验）: ${(e as Error).message}`);
      return { users: [], degraded: true, reason: (e as Error).message };
    }
  }

  /**
   * 校验某人是否可以审批。
   * @returns { ok, degraded } —— degraded=true 表示没查到可审批人清单，按放行处理
   */
  async canApprove(username?: string): Promise<{ ok: boolean; degraded: boolean; reason?: string }> {
    const who = (username || '').trim();
    if (!who) return { ok: false, degraded: false, reason: '操作人为空' };
    const { users, degraded, reason } = await this.list();
    if (degraded) return { ok: true, degraded: true, reason }; // 降级放行
    if (!users.length) {
      // 清单为空：权限点还没 seed 或没人被授权 —— 放行但告警，避免把人锁死在门外
      this.logger.warn(`可审批人清单为空（权限点 ${APPROVE_PERMISSION} 可能未同步），本次放行`);
      return { ok: true, degraded: true, reason: '可审批人清单为空' };
    }
    return {
      ok: users.some((u) => u.username === who),
      degraded: false,
    };
  }

  /** 清缓存（手工同步权限后立即生效） */
  clearCache(): void {
    this.cache = undefined;
  }
}
