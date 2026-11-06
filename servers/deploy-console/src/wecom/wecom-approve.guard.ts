import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { WecomActor } from './wecom-approval.service';
import { WecomConfigService } from './wecom.config';
import { WecomTicketService } from './wecom-ticket.service';

/**
 * scope=approve 短令牌守卫（卡② T2-c / S4 / V9）。
 *
 * 🔴 只挂在 3 个 `/wecom/approvals/:id*` 端点上 —— 令牌天然无法用于
 * `/pipelines/*` 等主接口。且与 URL 中的审批单 ID 强比对，
 * 泄漏面被限制在「只能批这一单」。
 */

export interface WecomRequestLike {
  headers: { authorization?: string };
  params: { id?: string };
  query: Record<string, unknown>;
  ip?: string;
  wecomActor?: WecomActor;
}

@Injectable()
export class WecomApproveGuard implements CanActivate {
  constructor(
    private readonly ticket: WecomTicketService,
    private readonly config: WecomConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.enabled) throw new NotFoundException('企微审批通道未启用');

    const req = context.switchToHttp().getRequest<WecomRequestLike>();
    const auth = req.headers.authorization || '';
    const fromQuery = typeof req.query.ticket === 'string' ? req.query.ticket : '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : fromQuery;
    if (!token) throw new UnauthorizedException('缺少审批票据，请重新从企业微信进入');

    const payload = this.ticket.verifyApproveTicket(token);
    if (!payload) throw new UnauthorizedException('链接已过期，请重新从企业微信进入');

    const urlId = req.params.id;
    if (!urlId || payload.approvalId !== urlId) {
      throw new ForbiddenException('票据与审批单不匹配');
    }

    req.wecomActor = {
      username: payload.sub,
      ext: payload.ext,
      approvalId: payload.approvalId,
    };
    return true;
  }
}

/** 供 controller 从请求里取 actor，避免重复断言 */
export function requireActor(req: WecomRequestLike): WecomActor {
  if (!req.wecomActor) throw new UnauthorizedException('缺少审批身份');
  return req.wecomActor;
}

/** 来源 IP：优先网关注入的 X-Forwarded-For 首段 */
export function sourceIpOf(req: WecomRequestLike): string {
  const raw = req.headers as Record<string, unknown>;
  const xff = typeof raw['x-forwarded-for'] === 'string' ? (raw['x-forwarded-for'] as string) : '';
  return (xff.split(',')[0] || req.ip || '').trim().slice(0, 64);
}

