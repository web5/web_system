import { createHmac, timingSafeEqual } from 'crypto';

/**
 * 签名串与短令牌（卡② T2-c / S3 / S4 / V9）。
 *
 * 形态：`base64url(payloadJson) + "." + hex(hmacSha256(payloadJson))`
 * 刻意**不是**主 JWT：短令牌只能用在本通道的审批端点（detail / approve / reject / run
 * / session），且与 approvalId 绑定，泄漏面被限制在「只能碰这一单」。
 *
 * 读写两个窗口见 `ApproveTicketPayload.viewExp` 注释。
 *
 * 纯 crypto 类（不注入 Nest），密钥由 WecomModule factory 传入，便于单测。
 */

export type TicketScope = 'approve' | 'signed-link';

export interface ApproveTicketPayload {
  scope: TicketScope;
  /** 系统用户名（审批人） */
  sub: string;
  /** 外部身份 ID（企微 userid） */
  ext: string;
  /** 绑定的审批单 ID —— Guard 会与 URL :id 强比对 */
  approvalId: string;
  iat: number;
  /** **写**窗口：approve / reject / 换会话。15min，不做延长 */
  exp: number;
  /**
   * **读**窗口：GET detail / run。默认 2h。
   *
   * 为什么读写分开：审批决断要在近实时内完成（写窗口必须短），
   * 但「批完去开会、回来再看一眼发布结果」是真实场景（读窗口要够长）。
   * 只延长读窗口，写权限一厘米不放。
   *
   * 历史票据（部署前签发）没有这个字段，验证时回落到 `exp`，保证在途卡片不失效。
   */
  viewExp?: number;
}

/** 票据使用模式：写（默认）/ 只读 */
export type TicketMode = 'write' | 'read';

export interface StatePayload {
  approvalId: string;
  ts: number;
  /** 随机串，防同毫秒重放 */
  nonce: string;
}

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function unb64url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export class WecomTicketService {
  /** 短令牌写窗口：15min（spec S4） */
  static readonly APPROVE_TTL_SEC = 900;
  /**
   * 短令牌读窗口：2h。
   * 覆盖「审批完去看发布结果 / 开会回来再看一眼」；超时重新从企微进入即可重签。
   */
  static readonly APPROVE_READ_TTL_SEC = 7200;
  /** OAuth state TTL：10min（spec S3） */
  static readonly STATE_TTL_SEC = 600;

  constructor(private readonly secret: string) {}

  private sign(payloadJson: string): string {
    return createHmac('sha256', this.secret).update(payloadJson).digest('hex');
  }

  private seal<T extends object>(payload: T): string {
    const json = JSON.stringify(payload);
    return `${b64url(json)}.${this.sign(json)}`;
  }

  private unseal<T extends object>(token: string): T | null {
    if (!token || typeof token !== 'string') return null;
    const [body, sig, ...rest] = token.split('.');
    if (!body || !sig || rest.length) return null;
    let json: string;
    try {
      json = unb64url(body);
    } catch {
      return null;
    }
    const expected = this.sign(json);
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      return JSON.parse(json) as T;
    } catch {
      return null;
    }
  }

  /** OAuth state：含时间戳 + nonce，防 CSRF / 重放 */
  signState(approvalId: string, nowMs: number = Date.now()): string {
    const payload: StatePayload = {
      approvalId,
      ts: nowMs,
      nonce: createHmac('sha256', this.secret).update(`${approvalId}:${nowMs}`).digest('hex').slice(0, 16),
    };
    return this.seal(payload);
  }

  /** 验 state：签名不对 / 超 10min / 结构不符 → null */
  verifyState(
    state: string,
    nowMs: number = Date.now(),
    maxAgeSec: number = WecomTicketService.STATE_TTL_SEC,
  ): StatePayload | null {
    const payload = this.unseal<StatePayload>(state);
    if (!payload || typeof payload.approvalId !== 'string' || typeof payload.ts !== 'number') {
      return null;
    }
    if (payload.ts > nowMs + 60_000) return null; // 未来时间戳（时钟漂移上限 1min）
    if (nowMs - payload.ts > maxAgeSec * 1000) return null;
    return payload;
  }

  /** 签短令牌（scope=approve，绑定单号）；同时写入写/读两个到期时刻 */
  issueApproveTicket(
    args: { sub: string; ext: string; approvalId: string },
    nowMs: number = Date.now(),
    ttlSec: number = WecomTicketService.APPROVE_TTL_SEC,
    readTtlSec: number = WecomTicketService.APPROVE_READ_TTL_SEC,
  ): string {
    const payload: ApproveTicketPayload = {
      scope: 'approve',
      sub: args.sub,
      ext: args.ext,
      approvalId: args.approvalId,
      iat: nowMs,
      exp: nowMs + ttlSec * 1000,
      viewExp: nowMs + Math.max(ttlSec, readTtlSec) * 1000,
    };
    return this.seal(payload);
  }

  /**
   * 验短令牌：过期 / scope 不符 → null（V9）。
   *
   * `mode='write'`（默认）看 `exp`；`mode='read'` 看 `viewExp`。
   * 🔴 默认必须是 write —— 否则调用方漏传 mode 就等于悄悄放宽写权限。
   */
  verifyApproveTicket(
    token: string,
    nowMs: number = Date.now(),
    mode: TicketMode = 'write',
  ): ApproveTicketPayload | null {
    const payload = this.unseal<ApproveTicketPayload>(token);
    if (!payload || payload.scope !== 'approve') return null;
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.approvalId !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    // 旧票无 viewExp → 回落 exp（部署瞬间在途卡片继续可用，不会集体失效）
    const deadline =
      mode === 'read' ? (typeof payload.viewExp === 'number' ? payload.viewExp : payload.exp) : payload.exp;
    if (nowMs >= deadline) return null;
    return payload;
  }

  /** A 模式（signed-link）签名链接 token；scope 与短令牌区分 */
  issueSignedLink(
    approvalId: string,
    nowMs: number = Date.now(),
    ttlSec: number = WecomTicketService.APPROVE_TTL_SEC,
  ): string {
    return this.seal({
      scope: 'signed-link',
      sub: '',
      ext: '',
      approvalId,
      iat: nowMs,
      exp: nowMs + ttlSec * 1000,
    });
  }

  /** 验 A 模式链接：过期返回 'expired'，签名错返回 'invalid'（V9 冷提示要区分） */
  verifySignedLink(
    token: string,
    nowMs: number = Date.now(),
  ): { ok: true; approvalId: string } | { ok: false; reason: 'invalid' | 'expired' } {
    const payload = this.unseal<ApproveTicketPayload>(token);
    if (!payload || payload.scope !== 'signed-link' || typeof payload.approvalId !== 'string') {
      return { ok: false, reason: 'invalid' };
    }
    if (typeof payload.exp !== 'number' || nowMs >= payload.exp) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, approvalId: payload.approvalId };
  }
}
