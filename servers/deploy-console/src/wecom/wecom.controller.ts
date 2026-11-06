import { Controller, Get, Logger, Post, Body, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { WecomApiClient } from './wecom-api.client';
import { WecomApprovalService, WecomDecisionBody } from './wecom-approval.service';
import {
  requireActor,
  sourceIpOf,
  WecomApproveGuard,
  WecomRequestLike,
} from './wecom-approve.guard';
import { WecomConfigService } from './wecom.config';
import { WecomIdentityClient } from './wecom-identity.client';
import { WecomSessionService } from './wecom-session.service';
import { WecomTicketService } from './wecom-ticket.service';

/**
 * 企微审批 HTTP 入口（卡② T2-c/T2-d）。
 *
 * 全部 `@Public()` 绕过全局 `JwtAuthGuard`；3 个审批端点另挂
 * `WecomApproveGuard` 只认 scope=approve 短令牌。
 * 身份失败一律返回**冷提示 HTML 403**（S5），绝不创建/修改任何审批单。
 */

const OAUTH_AUTHORIZE = 'https://open.weixin.qq.com/connect/oauth2/authorize';

/** S5 冷提示页：浅色白底，不给「可能已生效」的模糊表述 */
function coldPage(title: string, message: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
  body{margin:0;background:#FFFFFF;color:#1A1A1F;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:32px 20px}
  .card{max-width:520px;margin:0 auto;border:1px solid rgba(0,0,0,.08);box-shadow:0 1px 3px rgba(0,0,0,.06);border-radius:16px;padding:28px}
  h1{font-size:20px;margin:0 0 12px;color:#B91C1C}p{font-size:15px;line-height:1.7;color:#6B7280;margin:0 0 18px}
  .tip{border-top:1px solid rgba(0,0,0,.06);padding-top:16px;font-size:14px;color:#1A1A1F}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#F97316;margin-right:8px}
  </style></head><body><div class="card"><h1>${esc(title)}</h1><p>${esc(message)}</p><div class="tip"><span class="dot"></span>本次操作未生效，审批单仍为待处理。请从企业微信重新进入，或到发布控制台处理。</div></div></body></html>`;
}

@Public()
@Controller('wecom')
export class WecomController {
  private readonly logger = new Logger(WecomController.name);

  constructor(
    private readonly config: WecomConfigService,
    private readonly ticket: WecomTicketService,
    private readonly api: WecomApiClient,
    private readonly identity: WecomIdentityClient,
    private readonly approvals: WecomApprovalService,
    private readonly session: WecomSessionService,
  ) {}

  private get reqBase(): string {
    return this.config.config.publicBaseUrl;
  }

  private disabled(res: Response): void {
    res.status(404).type('html').send(coldPage('通道未启用', '企微审批通道当前未启用。'));
  }

  /** 302 到企微授权页，state 带 HMAC + 时间戳 */
  @Get('oauth/authorize')
  authorize(@Query('approvalId') approvalId: string, @Res() res: Response): void {
    if (!this.config.enabled) return this.disabled(res);
    const id = (approvalId || '').trim();
    if (!id) {
      res.status(400).type('html').send(coldPage('链接无效', '缺少审批单编号。'));
      return;
    }
    const { corpId } = this.config.config;
    const state = this.ticket.signState(id);
    const redirectUri = `${this.reqBase}/api/wecom/oauth/callback`;
    const url =
      `${OAUTH_AUTHORIZE}?appid=${encodeURIComponent(corpId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code&scope=snsapi_base&state=${encodeURIComponent(state)}#wechat_redirect`;
    res.redirect(302, url);
  }

  /**
   * 免登回调：code→userid→身份解析→白名单→短令牌→H5。
   * 任何一步失败都是 403 冷提示，不改状态（V3 / V14 / S2b）。
   */
  @Get('oauth/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.config.enabled) return this.disabled(res);

    const verified = this.ticket.verifyState(state || '');
    if (!verified) {
      res.status(403).type('html').send(coldPage('链接已过期', '授权状态无效或已超过 10 分钟。'));
      return;
    }
    try {
      if (!code) throw new Error('缺少授权 code');
      const userid = await this.api.getUserIdByCode(code);
      if (!userid) throw new Error('非企业成员，无法取得企微 userid');

      const resolved = await this.identity.resolve(userid);
      if (!resolved.ok) {
        const msg =
          resolved.reason === 'unavailable'
            ? '身份服务不可用，请去控制台处理'
            : resolved.reason === 'not_found'
              ? '该企微账号尚未绑定系统用户'
              : '身份解析结果异常';
        res.status(403).type('html').send(coldPage('无访问权限', msg));
        return;
      }

      const actor = {
        username: resolved.identity.username,
        ext: userid,
        approvalId: verified.approvalId,
      };
      // detail 内部复用既有白名单校验且 fail-closed（degraded 视为拒绝）
      await this.approvals.detail(verified.approvalId, actor, this.ipFrom(res));

      const ticket = this.ticket.issueApproveTicket({
        sub: actor.username,
        ext: actor.ext,
        approvalId: actor.approvalId,
      });
      const target = `${this.reqBase}/m/approve/${encodeURIComponent(actor.approvalId)}?ticket=${encodeURIComponent(ticket)}`;
      res.redirect(302, target);
    } catch (e) {
      this.logger.warn(`企微免登失败 approvalId=${verified.approvalId}: ${(e as Error).message}`);
      res.status(403).type('html').send(
        coldPage('无访问权限', `${(e as Error).message}。请到发布控制台处理。`),
      );
    }
  }

  /** express Response 拿不到原始 IP 时留空；主链路用 x-forwarded-for */
  private ipFrom(res: Response): string {
    const xff = res.req?.headers?.['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff[0] : xff;
    return (typeof raw === 'string' ? raw.split(',')[0] : res.req?.ip || '').trim().slice(0, 64);
  }

  @UseGuards(WecomApproveGuard)
  @Get('approvals/:id')
  async detail(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const req = res.req as unknown as WecomRequestLike;
    const data = await this.approvals.detail(id, requireActor(req), sourceIpOf(req));
    res.json({ code: 0, data });
  }

  @UseGuards(WecomApproveGuard)
  @Post('approvals/:id/approve')
  async approve(
    @Param('id') id: string,
    @Body() body: WecomDecisionBody,
    @Res() res: Response,
  ): Promise<void> {
    const req = res.req as unknown as WecomRequestLike;
    const data = await this.approvals.approve(id, requireActor(req), body || {}, sourceIpOf(req));
    res.json({ code: 0, data });
  }

  @UseGuards(WecomApproveGuard)
  @Post('approvals/:id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: WecomDecisionBody,
    @Res() res: Response,
  ): Promise<void> {
    const req = res.req as unknown as WecomRequestLike;
    const data = await this.approvals.reject(id, requireActor(req), body || {}, sourceIpOf(req));
    res.json({ code: 0, data });
  }

  /**
   * S4「查看流水线详情」：用审批票据换**一次性、30 分钟**的平台会话。
   *
   * 前端拿到 token 写进 localStorage 的 pinia 持久化键（`auth`）后再跳
   * `/console/pipelines/:id`，否则必然被路由守卫踢去登录页（见 wecom-session.service.ts 注释）。
   * 仍需 `WecomApproveGuard`：票据 + 单号强绑定，泄漏面不变。
   */
  @UseGuards(WecomApproveGuard)
  @Post('approvals/:id/session')
  async exchangeSession(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const req = res.req as unknown as WecomRequestLike;
    const data = await this.session.exchange(id, requireActor(req), sourceIpOf(req));
    res.json({ code: 0, data });
  }
}
