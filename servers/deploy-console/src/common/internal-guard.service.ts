import { Injectable, Logger, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { assertInternalKey } from './internal-key';
import { SlidingWindowLimiter } from './rate-limit';
import { redactSecrets } from './redact';

/**
 * 内部接口守卫（诊断 #7）：**鉴权 + 限流 + 来源白名单 + 审计**四件套。
 *
 * 背景：`/api/internal/release/*` 与 `/api/config/internal/*` 是 `@Public()` +
 * 单一静态 `x-internal-key`：持有这一个 key，就能把 **prod 任意模块切成任意版本**，
 * 且**此前无任何留痕**（审计只在 JWT 的 UI 接口上做）。流水线脚本、运维脚本、
 * 任何拿到 key 的人都能改线上，事后无从追查「谁在什么时候把 prod 切成了什么」。
 *
 * 四件事：
 * 1. 鉴权：沿用 `assertInternalKey`（与 UI 同一实现，不另起炉灶）
 * 2. 限流：按「来源 IP × 动作」滑动窗口，默认 120 次/分钟；超过 → 429 并给出重试秒数
 * 3. 来源白名单：`INTERNAL_IP_ALLOWLIST` 配了才启用（空 = 不限制，向后兼容）
 * 4. 审计：成功/失败**都留痕**，含来源 IP 与前后版本 —— 审计写失败只 error 不阻断
 *    （审计库挂掉不该让发布发不出去，但必须有日志可查）
 *
 * 全部可配且缺省零变化：`INTERNAL_RATE_LIMIT_PER_MIN=0` 即关闭限流。
 */

/** 缺省：每分钟每 IP 每动作 120 次（发布脚本一次流水线约几次调用，足够宽松） */
export const DEFAULT_RATE_LIMIT_PER_MIN = 120;

export interface InternalAuditMeta {
  action: string;
  env?: string;
  component?: string;
  /** 操作人：脚本传的 operator，缺省 pipeline-script */
  user?: string;
}

interface ReqLike {
  headers?: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
}

/** IPv6 回环与 IPv4-mapped 归一，避免白名单配置对不上 */
export function normalizeIp(raw: string | undefined | null): string {
  const ip = String(raw ?? '').trim();
  if (!ip) return 'unknown';
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return '127.0.0.1';
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  return mapped ? mapped[1] : ip;
}

/** 取来源 IP：优先 x-forwarded-for 首段（nginx 反代），再用 socket */
export function clientIpOf(req: ReqLike | undefined): string {
  const xff = req?.headers?.['x-forwarded-for'];
  const fromHeader = Array.isArray(xff) ? xff[0] : xff;
  const raw = String(fromHeader ?? '').split(',')[0] || req?.ip || req?.socket?.remoteAddress || req?.connection?.remoteAddress;
  return normalizeIp(raw);
}

@Injectable()
export class InternalGuardService {
  private readonly logger = new Logger(InternalGuardService.name);
  private readonly limiter: SlidingWindowLimiter;
  private readonly allowlist: string[];

  constructor(
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    const perMin = Number(this.config.get<string>('INTERNAL_RATE_LIMIT_PER_MIN'));
    this.limiter = new SlidingWindowLimiter(
      Number.isFinite(perMin) && perMin >= 0 ? perMin : DEFAULT_RATE_LIMIT_PER_MIN,
    );
    // 空串必须先短路：`''.split(',')` 得到 `['']`，而 normalizeIp('') 返回 'unknown'（审计用的
    // 占位值），若直接进入 filter(Boolean) 会被当成合法条目保留 —— 白名单就会**默认启用**
    // 且只允许 'unknown'，等于把所有内部接口调用全部拒掉（实测踩到，勿删此短路）。
    const rawAllow = String(this.config.get<string>('INTERNAL_IP_ALLOWLIST') || '').trim();
    this.allowlist = rawAllow
      ? rawAllow
          .split(',')
          .map((s) => normalizeIp(s))
          .filter((ip) => ip && ip !== 'unknown')
      : [];
  }

  /** 白名单是否启用（空 = 不限制来源） */
  get allowlistEnabled(): boolean {
    return this.allowlist.length > 0;
  }

  /**
   * 校验：鉴权 → 来源白名单 → 限流。任一不过直接抛（401 / 403 / 429）。
   * @returns 来源 IP（供审计留痕）
   */
  check(req: ReqLike | undefined, action: string): string {
    assertInternalKey(req as never);

    const ip = clientIpOf(req);

    if (this.allowlistEnabled && !this.allowlist.includes(ip)) {
      throw new ForbiddenException(
        `来源 IP 不在内部接口白名单内：${ip}（INTERNAL_IP_ALLOWLIST 已启用）`,
      );
    }

    const v = this.limiter.hit(`${action}:${ip}`);
    if (!v.allowed) {
      throw new HttpException(
        {
          error: 'Too Many Requests',
          message: `内部接口调用过于频繁（${action}，窗口内已达 ${v.count} 次），请 ${Math.ceil(
            v.retryAfterMs / 1000,
          )}s 后重试`,
          retryAfterSec: Math.ceil(v.retryAfterMs / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return ip;
  }

  /**
   * 执行 + 审计：成功失败都留痕，异常原样上抛（不改变既有错误语义）。
   *
   * @param detail 成功后用于生成审计详情（能看到 from → to，事后可还原）
   */
  async run<T>(
    req: ReqLike | undefined,
    meta: InternalAuditMeta,
    fn: () => Promise<T>,
    detail?: (result: T) => string,
  ): Promise<T> {
    const ip = this.check(req, meta.action);
    try {
      const result = await fn();
      await this.write({
        ...meta,
        status: 'success',
        detail: detail?.(result) ?? '',
        ip,
      });
      return result;
    } catch (e) {
      const msg = redactSecrets((e as Error).message);
      await this.write({ ...meta, status: 'failed', detail: msg, ip });
      throw e;
    }
  }

  /**
   * 写审计。**失败不阻断主流程**：审计是留痕设施，它挂了不该让发布发不出去，
   * 但必须打 error（pm2 日志可查），避免「审计静默失效」变成新的盲区。
   */
  private async write(e: InternalAuditMeta & { status: string; detail: string; ip: string }): Promise<void> {
    try {
      await this.audit.log({
        user: e.user || 'pipeline-script',
        action: e.action,
        env: e.env,
        component: e.component,
        status: e.status,
        detail: e.detail ? `${e.detail}（来源 ${e.ip}）` : `来源 ${e.ip}`,
      });
    } catch (err) {
      this.logger.error(
        `内部接口审计写入失败（不阻断，但需立即排查 audit_logs）：${e.action} ${e.env ?? '-'}/${
          e.component ?? '-'
        } ${(err as Error).message}`,
      );
    }
  }
}
