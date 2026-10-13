import { Injectable, Logger, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { assertInternalKey, InternalIdentity } from './internal-key';
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
  /**
   * 调用方身份（2026-10-13）：run 短期令牌会带 runId/env/moduleKey，
   * 审计据此把「某次内部接口调用」归因到**某一次发布**。
   * 静态 key 调用时为 `{ kind:'static-key' }`（与改造前行为一致）。
   */
  identity?: InternalIdentity;
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

/** 幂等记录默认保留时长（诊断 #20）：脚本重试通常发生在几分钟内 */
export const DEFAULT_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
/** 幂等记录上限：防止长时间运行把内存撑大（超出即淘汰最旧） */
export const MAX_IDEMPOTENCY_ENTRIES = 2000;

/** 取幂等键（请求头 `idempotency-key`，大小写不敏感；缺省空串 = 不启用） */
export function idempotencyKeyOf(req: ReqLike | undefined): string {
  const raw = req?.headers?.['idempotency-key'] ?? req?.headers?.['Idempotency-Key'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return String(v ?? '').trim();
}

@Injectable()
export class InternalGuardService {
  private readonly logger = new Logger(InternalGuardService.name);
  private readonly limiter: SlidingWindowLimiter;
  private readonly allowlist: string[];
  /**
   * 幂等记录（诊断 #20）：`action:key` → Promise。
   *
   * 存 Promise 而不是结果：脚本重试可能是**并发**的（同一条流水线重跑 + 手动补刀），
   * 存结果会让第二个请求穿透下去重复切指针。
   * 只缓存**成功**结果：失败必须可重试，否则一次网络抖动就把发布永久卡住。
   */
  private readonly idem = new Map<string, { at: number; promise: Promise<unknown> }>();

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
    return this.checkWithIdentity(req, action).ip;
  }

  /**
   * 同上，但**额外返回调用方身份**（run 令牌的 runId/env/moduleKey）。
   *
   * 单独开一个方法而不是改 `check` 的返回值：`check` 返回 IP 字符串是既有契约
   * （被本服务的守卫与单测广泛使用），改返回类型属于静默破坏。
   */
  checkWithIdentity(
    req: ReqLike | undefined,
    action: string,
  ): { ip: string; identity: InternalIdentity } {
    const identity = assertInternalKey(req as never);

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
    return { ip, identity };
  }

  /**
   * 执行 + 审计：成功失败都留痕，异常原样上抛（不改变既有错误语义）。
   *
   * **幂等（诊断 #20）**：请求带 `Idempotency-Key` 时，同一 `action + key` 的重复调用
   * 直接复用第一次的结果，不再重复执行。
   *
   * 为什么需要：流水线脚本失败重试 / 手动补跑时，「写版本」会多插一条记录、
   * 「切指针」会把 `previous_version` 覆盖成当前值（PR #259 的同值幂等只挡住后者）。
   * 没有幂等键，重试就不是幂等的 —— 而发布链路里重试是常态。
   *
   * 缺省零变化：**不带该请求头就完全不启用**，既有脚本不受影响。
   *
   * @param detail 成功后用于生成审计详情（能看到 from → to，事后可还原）
   */
  async run<T>(
    req: ReqLike | undefined,
    meta: InternalAuditMeta,
    fn: () => Promise<T>,
    detail?: (result: T) => string,
  ): Promise<T> {
    // 带身份：run 令牌的 runId 会一起进审计，事后可把「切了 prod 指针」归因到具体某次发布
    const { ip, identity } = this.checkWithIdentity(req, meta.action);
    const metaWithId: InternalAuditMeta = { ...meta, identity };

    const idemKey = idempotencyKeyOf(req);
    const cacheKey = idemKey ? `${meta.action}:${idemKey}` : '';
    if (cacheKey) {
      const hit = this.idem.get(cacheKey);
      if (hit && Date.now() - hit.at < this.idemTtlMs) {
        this.logger.log(`幂等命中，跳过重复执行：${cacheKey}`);
        const result = (await hit.promise) as T;
        await this.write({
          ...metaWithId,
          status: 'success',
          detail: `${detail?.(result) ?? ''}（幂等命中：Idempotency-Key=${idemKey}，未重复执行）`.trim(),
          ip,
        });
        return result;
      }
      if (hit) this.idem.delete(cacheKey); // 过期
    }

    const exec = (async () => {
      try {
        const result = await fn();
        await this.write({
          ...metaWithId,
          status: 'success',
          detail: detail?.(result) ?? '',
          ip,
        });
        return result;
      } catch (e) {
        const msg = redactSecrets((e as Error).message);
        await this.write({ ...metaWithId, status: 'failed', detail: msg, ip });
        // 失败不留幂等记录：必须可重试，否则一次抖动就永久卡住
        if (cacheKey) this.idem.delete(cacheKey);
        throw e;
      }
    })();

    // TTL=0 = 关闭幂等：连记录都不写，避免白占内存
    if (cacheKey && this.idemTtlMs > 0) {
      this.idem.set(cacheKey, { at: Date.now(), promise: exec });
      if (this.idem.size > MAX_IDEMPOTENCY_ENTRIES) {
        const oldest = this.idem.keys().next().value as string | undefined;
        if (oldest) this.idem.delete(oldest);
      }
    }
    return exec;
  }

  /** 幂等记录保留时长（可配 `INTERNAL_IDEMPOTENCY_TTL_MS`，0 = 关闭幂等） */
  private get idemTtlMs(): number {
    const raw = Number(this.config.get<string>('INTERNAL_IDEMPOTENCY_TTL_MS'));
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_IDEMPOTENCY_TTL_MS;
  }

  /**
   * 写审计。**失败不阻断主流程**：审计是留痕设施，它挂了不该让发布发不出去，
   * 但必须打 error（pm2 日志可查），避免「审计静默失效」变成新的盲区。
   */
  private async write(e: InternalAuditMeta & { status: string; detail: string; ip: string }): Promise<void> {
    // 身份归因：run 令牌能让「谁切的指针」精确到某一次发布（此前一律记 pipeline-script）
    const ident = e.identity;
    const run = ident && ident.kind === 'run-token' ? ident : null;
    const who = run ? `pipeline:run:${run.runId}` : e.user || 'pipeline-script';
    const runTag = run ? `（run ${run.runId} · ${run.moduleKey || '-'} @ ${run.env || '-'}）` : '';
    // 静态 key 路径必须**逐字保持**改造前的格式（`detail（来源 ip）`）：既有排障脚本与
    // 单测都按这个格式断言，run 标签只作为 detail 的后缀追加。
    const head = `${e.detail}${runTag}`.trim();
    try {
      await this.audit.log({
        user: who,
        action: e.action,
        env: e.env,
        component: e.component,
        status: e.status,
        detail: head ? `${head}（来源 ${e.ip}）` : `来源 ${e.ip}`,
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
