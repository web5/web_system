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
 *  2. **有限次（≤3）**：靠 DB 原子更新 `WHERE wecom_session_count < 3` 判定，不先查后写；
 *  3. **短 TTL**：30 分钟（远短于平台登录的 24h），过期必须重新从企微进入；
 *  4. **必须留审计**：`wecom.session`，含第几次 / approvalId / 外部身份 / 来源 IP。
 *
 * 为什么不是「一次性」（2026-11-06 调整）：一次性把「手滑关页面 / 换台设备再看」
 * 全变成死路，而这些都不是安全事件。风险的真实边界是「票据能否被反复兑换成长会话」，
 * 3 次 + 30min TTL 已经把滥用面钉死在与「人正常重试」同量级。
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

  /**
   * 同一张审批单最多能换几次平台会话。
   *
   * 3 = 正常人重试的合理上限（关错页 / 换设备 / token 过期再点一次）。
   * 改这个数字等于改凭据面的暴露上限，**不是**可以随手调的体验参数。
   */
  static readonly MAX_EXCHANGES = 3;

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

    // ── 2) 占位（原子，≤MAX_EXCHANGES 次）──
    // 次数条件写进 WHERE：并发两个请求只有一个能把 n 加成 n+1，不先查后写。
    const claimed = await this.repo.query(
      'UPDATE deploy_approvals SET wecom_session_count = wecom_session_count + 1, ' +
        'wecom_session_issued_at = ? WHERE id = ? AND wecom_session_count < ?',
      [nowMs, approvalId, WecomSessionService.MAX_EXCHANGES],
    );
    const affected = Number(
      (claimed as { affectedRows?: number })?.affectedRows ??
        (Array.isArray(claimed) ? (claimed[0] as { affectedRows?: number })?.affectedRows : 0) ??
        0,
    );
    if (affected !== 1) {
      // 回读只为把「次数用尽」和「单不存在」说清楚；判定已在 DB 侧完成
      const used = await this.currentCount(approvalId);
      // 🔴 文案不能写「请重新从企业微信进入」：重新点卡片走 OAuth 签的是**新票据**，
      //    但次数是按 approvalId 记的，同一张单重进还是 3/3 —— 那等于把用户引回同一个死路。
      throw new ConflictException(
        `该审批单的会话次数已用尽（${used}/${WecomSessionService.MAX_EXCHANGES}），请到发布控制台直接登录`,
      );
    }
    const usedCount = await this.currentCount(approvalId);

    // ── 3) 签平台会话；失败必须回滚占位，否则这张单会被白扣一次配额 ──
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
        .query(
          'UPDATE deploy_approvals SET wecom_session_count = wecom_session_count - 1 ' +
            'WHERE id = ? AND wecom_session_count > 0',
          [approvalId],
        )
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
        `用企微审批票据换取平台会话（第 ${usedCount}/${WecomSessionService.MAX_EXCHANGES} 次）；channel=wecom；` +
        `identityExternalId=${actor.ext || '-'}；sourceIp=${sourceIp || '-'}；` +
        `approvalId=${approval.id}；ttlSec=${WecomSessionService.TTL_SEC}`,
    });

    return { token, user: { username: identity.username, role }, expiresInSec: WecomSessionService.TTL_SEC };
  }

  /** 当前已用次数（只用于文案/审计；判定不依赖它） */
  private async currentCount(approvalId: string): Promise<number> {
    try {
      const rows = await this.repo.query(
        'SELECT wecom_session_count AS n FROM deploy_approvals WHERE id = ?',
        [approvalId],
      );
      const row = (Array.isArray(rows) ? rows[0] : undefined) as { n?: unknown } | undefined;
      const n = Number(row?.n);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  }
}
