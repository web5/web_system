/**
 * 账号绑定与合并
 *
 * - 绑定手机号：微信「手机号快速验证」code → 真实号码 → 落库（services/auth 不信任前端传号码）
 * - 绑定邮箱：验证码由 user-service 校验（持有验证码表与邮件通道），本服务只负责落库与合并
 * - 合并（Q15 = c）：把当前匿名账号（A）的数据并入目标账号（B），A 软删并记 merged_to
 *   迁移表清单见下方 MERGE_TABLES（方案 §5.7.3）；**不为邮箱写第二套合并**
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  BadGatewayException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { RedisService, DEFAULT_REDIS } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import axios from 'axios';
import * as crypto from 'crypto';
import { WechatMpService } from './wechat-mp.service';
import { AuthService } from '../auth/auth.service';

/** 冲突后暂存的待确认号码/邮箱（避免用户二次授权：微信 code 一次性） */
const PENDING_TTL_SECONDS = 600;

interface MergeColumn {
  table: string;
  column: string;
  /** varchar 类型的外键存的是 users.id 的字符串形式 */
  varchar?: boolean;
  /** 存在 (user_id, ...) 唯一键的表：迁移前需先丢弃与 B 重复的行 */
  uniqueWith?: string[];
}

/** 迁移清单：全仓无物理外键，漏一张表不会报错、只会静默丢数据，故集中维护 */
const MERGE_TABLES: MergeColumn[] = [
  { table: 'agent_conversations', column: 'user_id', varchar: true },
  { table: 'agent_runs', column: 'user_id', varchar: true },
  { table: 'conversations', column: 'user_id' },
  { table: 'glossary_entries', column: 'user_id', varchar: true, uniqueWith: ['content_hash'] },
  { table: 'user_memories', column: 'user_id', varchar: true, uniqueWith: ['category', 'content_hash'] },
  { table: 'user_taste_profiles', column: 'user_id', varchar: true, uniqueWith: ['namespace'] },
  { table: 'upload_files', column: 'user_id' },
  { table: 'mcp_api_keys', column: 'owner_id' },
  { table: 'artworks', column: 'user_id' },
  { table: 'bianbian_records', column: 'user_id' },
  { table: 'todo_tasks', column: 'user_id' },
  { table: 'finnews_subscriptions', column: 'user_id' },
  { table: 'gateway_access_logs', column: 'user_id', varchar: true },
];

export type BindSource = 'phone' | 'email';

export type BindResult =
  | { conflict: false; bound: true; phone?: string; email?: string; boundAt: string; source: BindSource }
  | { conflict: true; canMerge: boolean; maskedValue: string; hint: string; source: BindSource }
  | {
      conflict: false;
      merged: true;
      phone?: string;
      email?: string;
      source: BindSource;
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    };

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly authService: AuthService,
    private readonly wechatMp: WechatMpService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow(DEFAULT_REDIS);
  }

  // ---------------------------------------------------------------- 手机号

  /**
   * 绑定手机号。
   * - 首次调用带 code：换号 → 无冲突直接落库；冲突则暂存并返回 conflict
   * - 冲突确认后调用带 confirmMerge：复用暂存的号码执行合并
   */
  async bindPhone(userId: number, code: string | undefined, confirmMerge: boolean): Promise<BindResult> {
    if (confirmMerge) {
      const pending = await this.takePending(userId);
      if (!pending || pending.source !== 'phone') {
        throw new BadRequestException('授权已失效，请重试');
      }
      return this.bindByValue(userId, 'phone', pending.value);
    }

    if (!code) throw new BadRequestException('缺少手机号授权 code');
    const phone = await this.wechatMp.getPhoneNumber(code);
    return this.bindByValue(userId, 'phone', phone, true);
  }

  // ---------------------------------------------------------------- 邮箱

  /**
   * 绑定邮箱：验证码由 user-service 校验（它持有 email_verification_codes 与邮件通道）。
   * 冲突与合并走与手机号完全相同的路径。
   */
  async bindEmail(userId: number, email: string, code: string, confirmMerge: boolean): Promise<BindResult> {
    if (!email || !code) throw new BadRequestException('缺少邮箱或验证码');
    const value = String(email).trim().toLowerCase();

    if (confirmMerge) {
      const pending = await this.takePending(userId);
      if (!pending || pending.source !== 'email') {
        throw new BadRequestException('验证码已失效，请重新验证');
      }
      return this.bindByValue(userId, 'email', pending.value);
    }

    await this.verifyEmailCodeWithUserService(userId, value, code);
    return this.bindByValue(userId, 'email', value, true);
  }

  private async verifyEmailCodeWithUserService(userId: number, email: string, code: string): Promise<void> {
    const base = this.configService.get<string>('USER_SERVICE_URL') || 'http://127.0.0.1:6002';
    const key = this.configService.get<string>('INTERNAL_API_KEY') || '';
    try {
      const { data } = await axios.post(
        `${base}/internal/users/email/verify`,
        { email, code, userId },
        // InternalGuard 读 x-internal-key 头（与 mcp-gateway 调用 /internal/* 的口径一致）
        { headers: { 'x-internal-key': key }, timeout: 8000 },
      );
      if (!data?.ok) throw new BadRequestException(data?.message || '验证码错误或已过期');
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      if (err?.response?.status === 400) {
        throw new BadRequestException(err.response.data?.message || '验证码错误或已过期');
      }
      this.logger.warn(`邮箱验证码校验失败: ${err?.message || err}`);
      throw new BadGatewayException('验证码校验服务不可用');
    }
  }

  // ---------------------------------------------------------------- 公共落库 / 合并

  private async bindByValue(
    userId: number,
    source: BindSource,
    value: string,
    allowPending = false,
  ): Promise<BindResult> {
    const column = source === 'phone' ? 'phone' : 'email';
    const existing = await this.dataSource.query(
      `SELECT id, status FROM users WHERE ${column} = ? AND id <> ? AND deleted_at IS NULL LIMIT 1`,
      [value, userId],
    );

    if (existing?.length) {
      const target = existing[0] as { id: number; status: string };
      if (target.status !== 'active') {
        throw new ConflictException({ canMerge: false, message: '该账号状态异常，请联系客服' });
      }
      if (allowPending) await this.savePending(userId, source, value);
      return {
        conflict: true,
        canMerge: true,
        maskedValue: source === 'phone' ? maskPhone(value) : maskEmail(value),
        hint: `该${source === 'phone' ? '手机号' : '邮箱'}已注册科豆账号，绑定后将把当前小程序的数据合并到该账号，合并不可撤销`,
        source,
      };
    }

    const merged = allowPending ? false : true;
    if (!merged) {
      // 首次绑定（无冲突）
      await this.dataSource.query(`UPDATE users SET ${column} = ? WHERE id = ?`, [value, userId]);
      this.logger.log(`绑定${source}成功: userId=${userId}`);
      return {
        conflict: false,
        bound: true,
        [source]: source === 'phone' ? maskPhone(value) : maskEmail(value),
        boundAt: new Date().toISOString(),
        source,
      } as BindResult;
    }

    return this.mergeInto(userId, source, value);
  }

  /**
   * 合并：A（当前匿名账号）→ B（手机号/邮箱所属账号）
   * 事务内完成：三张唯一键表去重 → 13 张表迁移 → A 软删 + merged_to → mp_openid 转到 B → 重签凭证
   */
  private async mergeInto(userId: number, source: BindSource, value: string): Promise<BindResult> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    let moved = 0;
    try {
      const targets = await runner.query(
        `SELECT id, status, mp_openid FROM users WHERE ${source === 'phone' ? 'phone' : 'email'} = ? AND id <> ? AND deleted_at IS NULL LIMIT 1`,
        [value, userId],
      );
      const target = targets?.[0];
      if (!target) throw new BadRequestException('未找到待合并的目标账号');
      if (target.status !== 'active') throw new ConflictException({ canMerge: false, message: '目标账号状态异常' });

      const sources = await runner.query(
        `SELECT id, mp_openid, merged_to FROM users WHERE id = ? LIMIT 1`,
        [userId],
      );
      const from = sources?.[0];
      if (!from) throw new BadRequestException('当前账号不存在');
      if (from.merged_to) {
        // 幂等：已合并过直接返回目标账号的新凭证
        const tokens = await this.authService.generateTokenForUser(target.id);
        return this.mergedResult(source, value, tokens);
      }
      // 同一 openid 只能属于一个账号：目标已有 openid 说明数据异常，中止
      if (target.mp_openid) {
        throw new ConflictException({ canMerge: false, code: 'MERGE_ABORTED', message: '目标账号已绑定其他微信，请联系客服' });
      }

      const fromIdStr = String(userId);
      const toId = Number(target.id);

      for (const item of MERGE_TABLES) {
        // 1) 先丢弃与 B 重复的行（三张有 (user_id, ...) 唯一键的表）
        if (item.uniqueWith?.length) {
          const cond = item.uniqueWith.map((c) => `b.${c} = a.${c}`).join(' AND ');
          const del = await runner.query(
            `DELETE a FROM \`${item.table}\` a WHERE a.\`${item.column}\` = ? AND EXISTS (SELECT 1 FROM \`${item.table}\` b WHERE b.\`${item.column}\` = ? AND ${cond})`,
            [item.varchar ? fromIdStr : userId, item.varchar ? String(toId) : toId],
          );
          if (del?.affectedRows) {
            this.logger.debug(`合并去重 ${item.table}: 丢弃 ${del.affectedRows} 行`);
          }
        }
        // 2) 迁移
        const upd = await runner.query(
          `UPDATE \`${item.table}\` SET \`${item.column}\` = ? WHERE \`${item.column}\` = ?`,
          [item.varchar ? String(toId) : toId, item.varchar ? fromIdStr : userId],
        );
        moved += upd?.affectedRows || 0;
      }

      // 3) A 弃用 + 留痕；openid 转到 B
      await runner.query(
        `UPDATE users SET merged_to = ?, status = 'inactive', mp_openid = NULL, deleted_at = NOW() WHERE id = ?`,
        [toId, userId],
      );
      await runner.query(`UPDATE users SET mp_openid = ? WHERE id = ?`, [from.mp_openid, toId]);

      await runner.commitTransaction();

      this.logger.log(
        `账号合并完成: from=${userId} → to=${toId} source=${source} 迁移行数=${moved}`,
      );

      // 4) 凭证重签：旧 token 的 sub 仍是 A，不换会让用户「看不到自己的数据」
      const tokens = await this.authService.generateTokenForUser(toId);
      return this.mergedResult(source, value, tokens);
    } catch (err) {
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }
  }

  private mergedResult(
    source: BindSource,
    value: string,
    tokens: { accessToken: string; refreshToken: string; expiresIn: number },
  ): BindResult {
    return {
      conflict: false,
      merged: true,
      [source]: source === 'phone' ? maskPhone(value) : maskEmail(value),
      source,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    } as BindResult;
  }

  // ---------------------------------------------------------------- pending 暂存

  private pendingKey(userId: number): string {
    return `bind_pending:${userId}`;
  }

  private async savePending(userId: number, source: BindSource, value: string): Promise<void> {
    await this.redis.set(
      this.pendingKey(userId),
      JSON.stringify({ source, value }),
      'EX',
      PENDING_TTL_SECONDS,
    );
  }

  /** 取出并保留（失败可重试）；只有合并成功后才由调用方清理 */
  private async takePending(userId: number): Promise<{ source: BindSource; value: string } | null> {
    const raw = await this.redis.get(this.pendingKey(userId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { source: BindSource; value: string };
    } catch {
      return null;
    }
  }

  async clearPending(userId: number): Promise<void> {
    await this.redis.del(this.pendingKey(userId)).catch(() => null);
  }
}

/** 脱敏：138****6688 */
export function maskPhone(phone: string): string {
  const p = String(phone || '');
  if (p.length < 7) return p;
  return `${p.slice(0, 3)}****${p.slice(7)}`;
}

/** 脱敏：a***@example.com */
export function maskEmail(email: string): string {
  const e = String(email || '');
  const at = e.indexOf('@');
  if (at <= 0) return e;
  return `${e.slice(0, 1)}***${e.slice(at)}`;
}

/** 验证码哈希（保留给调用方复用口径） */
export function hashCode(code: string): string {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}
