import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalService } from '../approval/approval.service';
import { AuditService } from '../audit/audit.service';
import { DeployApprovalEntity } from '../entities/deploy-approval.entity';
import { WecomActor } from './wecom-approval.service';
import { WecomConfigService } from './wecom.config';
import { WecomIdentityClient } from './wecom-identity.client';

/**
 * 企微审批票据 → 平台会话（移动端「查看流水线详情」免登）。
 *
 * 🔴 **为什么需要它**：S4 结果态给的是 `/console/pipelines/:id`，那是
 * `requiresAuth: true` 的 SPA 路由，守卫只认 `authStore.token`；而审批短令牌
 * 按卡② 的设计只能打 `/wecom/approvals/:id*`，天生进不了 SPA。于是手机上
 * 点一下就必然被踢去登录页 —— 这不是 bug，是两套凭据没接上。
 *
 * 🔴 **这是对卡②「泄漏面只限这一单」边界的一次**受控**扩大，必须同时满足**：
 *  1. 只由**已通过企微 OAuth + 白名单校验**的审批本人触发（身份再 resolve 一次，fail-closed）；
 *  2. **一次性**：靠 DB 原子更新 `WHERE wecom_session_issued_at IS NULL` 判定，不先查后写；
 *  3. **短 TTL**：30 分钟（远短于平台登录的 24h），过期必须重新从企微进入；
 *  4. **必须留审计**：`wecom.session`，含 approvalId / 外部身份 / 来源 IP。
 *
 * ⚠️ 已知妥协：token 由 console 自己用 `JWT_SECRET` 签（与 auth-service 同源密钥），
 * 严格说 IAM 一期期望「唯一签发者是 auth-service」。auth-service 目前没有内部代签端点，
 * 补齐之前这里是第二签发者；payload 带 `via: 'wecom'` 便于事后区分与收紧。
 * **不要**把这条路径当作通用登录用 —— 它只为「审批后看一眼流水线」存在。
 */
export interface WecomSessionResult {
  token: string;
  user: { username: string; role: string };
  /** 会话有效期（秒） */
  expiresInSec: number;
}

@Injectable()
export class WecomSessionService {
  private readonly logger = new Logger(WecomSessionService.name);

  /** 会话 TTL：30 分钟。刻意远短于平台登录的 24h */
  static readonly TTL_SEC = 1800;

  constructor(
    private readonly config: WecomConfigService,
    private readonly approvals: ApprovalService,
    private readonly identity: WecomIdentityClient,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    @InjectRepository(DeployApprovalEntity)
    private readonly repo: Repository<DeployApprovalEntity>,
  ) {}

  async exchange(
    approvalId: string,
    actor: WecomActor,
    sourceIp: string,
    nowMs: number = Date.now(),
  ): Promise<WecomSessionResult> {
    if (!this.config.enabled) throw new NotFoundException('企微审批通道未启用');
    if (actor.approvalId !== approvalId) throw new ForbiddenException('短令牌与审批单不匹配');

    const approval = await this.approvals.get(approvalId);

    // ── 1) 先验身份，再占位：无效请求不该消耗掉这张单唯一的一次兑换机会 ──
    const resolved = await this.identity.resolve(actor.ext);
    if (!resolved.ok) {
      this.logger.warn(
        `换会话拒绝（身份不可用） approvalId=${approvalId} ext=${actor.ext} reason=${resolved.reason}`,
      );
      throw new ForbiddenException(`身份服务不可用（${resolved.reason}），请到控制台处理`);
    }
    const identity = resolved.identity;
    if (identity.username !== actor.username) {
      // 票据 sub 与企微身份解析结果不一致：要么票据被挪用，要么绑定关系刚被改动
      this.logger.warn(
        `换会话拒绝（身份不一致） approvalId=${approvalId} ticket=${actor.username} resolved=${identity.username}`,
      );
      throw new ForbiddenException('票据身份与企微身份不一致');
    }
    const systems: string[] = Array.isArray(identity.systems) ? identity.systems : [];
    if (!systems.includes('deploy')) {
      // 早失败：否则签出的 token 会在 JwtStrategy 里 403，用户只看到白屏
      throw new ForbiddenException('该账号不属于运维控制台（deploy）');
    }

    // ── 2) 一次性占位（原子）──
    const claimed = await this.repo.query(
      'UPDATE deploy_approvals SET wecom_session_issued_at = ? WHERE id = ? AND wecom_session_issued_at IS NULL',
      [nowMs, approvalId],
    );
    const affected = Number(
      (claimed as { affectedRows?: number })?.affectedRows ??
        (Array.isArray(claimed) ? (claimed[0] as { affectedRows?: number })?.affectedRows : 0) ??
        0,
    );
    if (affected !== 1) {
      throw new ConflictException('该审批单的会话已换取过，请重新从企业微信进入');
    }

    // ── 3) 签平台会话；失败必须回滚占位，否则这张单永远换不到 ──
    const roles: string[] = Array.isArray(identity.roles) ? identity.roles : [];
    const role = roles.includes('super_admin') ? 'super_admin' : 'admin';
    let token: string;
    try {
      token = await this.jwt.signAsync(
        {
          sub: identity.userId,
          username: identity.username,
          roles,
          systems,
          type: 'access',
          via: 'wecom',
          approvalId,
        },
        { expiresIn: WecomSessionService.TTL_SEC },
      );
    } catch (e) {
      await this.repo
        .query('UPDATE deploy_approvals SET wecom_session_issued_at = NULL WHERE id = ?', [approvalId])
        .catch(() => undefined);
      this.logger.error(`签发平台会话失败 approvalId=${approvalId}: ${(e as Error).message}`);
      throw new InternalServerErrorException('签发平台会话失败，请到控制台处理');
    }

    // ── 4) 审计（失败不阻塞，与 approve/reject 一致）──
    await this.audit.log({
      user: identity.username,
      action: 'wecom.session',
      env: approval.env,
      component: approval.moduleKey,
      status: 'issued',
      detail:
        `用企微审批票据换取平台会话；channel=wecom；identityExternalId=${actor.ext || '-'}；` +
        `sourceIp=${sourceIp || '-'}；approvalId=${approval.id}；ttlSec=${WecomSessionService.TTL_SEC}`,
    });

    return { token, user: { username: identity.username, role }, expiresInSec: WecomSessionService.TTL_SEC };
  }
}
