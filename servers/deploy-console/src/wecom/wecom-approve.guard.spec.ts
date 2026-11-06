import { ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { WecomApproveGuard, WecomRequestLike } from './wecom-approve.guard';
import { WecomConfigService } from './wecom.config';
import { WecomTicketService } from './wecom-ticket.service';

const enabledEnv = {
  WECOM_APPROVE_ENABLED: '1',
  CONSOLE_PUBLIC_BASE_URL: 'https://dev.kedouai.com/console',
  WECOM_CORP_ID: 'corp-id',
  WECOM_AGENT_ID: '1000002',
  WECOM_SECRET: 'secret',
  JWT_SECRET: 'jwt',
};
const ticketSvc = new WecomTicketService('jwt');

function context(req: WecomRequestLike): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

function request(token: string, id = 'A1'): WecomRequestLike {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    params: { id },
    query: {},
    ip: '1.2.3.4',
  };
}

describe('WecomApproveGuard（S4 / V9：短令牌只批这一单）', () => {
  const config = WecomConfigService.forTest(enabledEnv);
  const guard = new WecomApproveGuard(ticketSvc, config);

  it('有效票据 → 放行并挂上 actor', () => {
    const token = ticketSvc.issueApproveTicket({ sub: 'bob', ext: 'wenzhui', approvalId: 'A1' }, Date.now());
    const req = request(token);
    expect(guard.canActivate(context(req))).toBe(true);
    expect(req.wecomActor).toEqual({ username: 'bob', ext: 'wenzhui', approvalId: 'A1' });
  });

  it('票据过期 → 401「重新从企业微信进入」', () => {
    // 用「签发于 15 分钟前」模拟过期，不去 mock 全局时钟（避免污染其它用例）
    const token = ticketSvc.issueApproveTicket(
      { sub: 'bob', ext: 'wenzhui', approvalId: 'A1' },
      Date.now() - 901_000,
    );
    expect(() => guard.canActivate(context(request(token)))).toThrow(UnauthorizedException);
  });

  it('缺少票据 → 401', () => {
    expect(() => guard.canActivate(context(request('')))).toThrow(UnauthorizedException);
  });

  it('票据绑定 A1 却访问 A2 → 403', () => {
    const token = ticketSvc.issueApproveTicket({ sub: 'bob', ext: 'wenzhui', approvalId: 'A1' }, Date.now());
    expect(() => guard.canActivate(context(request(token, 'A2')))).toThrow(ForbiddenException);
  });

  it('用 A 模式签名链接当短令牌 → 401', () => {
    const link = ticketSvc.issueSignedLink('A1', Date.now());
    expect(() => guard.canActivate(context(request(link)))).toThrow(UnauthorizedException);
  });

  it('通道关闭 → 404，即便带着有效票据也不放行', () => {
    const off = new WecomApproveGuard(ticketSvc, WecomConfigService.forTest({ WECOM_APPROVE_ENABLED: '0' }));
    const token = ticketSvc.issueApproveTicket({ sub: 'bob', ext: 'wenzhui', approvalId: 'A1' }, Date.now());
    expect(() => off.canActivate(context(request(token)))).toThrow(NotFoundException);
  });
});
