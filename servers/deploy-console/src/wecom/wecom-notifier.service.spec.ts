import { WecomApiClient } from './wecom-api.client';
import { WecomConfigService } from './wecom.config';
import { ApprovalAwaitingEvent, WECOM_APPROVAL_AWAITING, wecomEvents } from './wecom.events';
import { WecomNotifierService } from './wecom-notifier.service';

const enabledEnv = {
  WECOM_APPROVE_ENABLED: '1',
  CONSOLE_PUBLIC_BASE_URL: 'https://dev.kedouai.com/console',
  WECOM_CORP_ID: 'corp-id',
  WECOM_AGENT_ID: '1000002',
  WECOM_SECRET: 'secret',
  JWT_SECRET: 'jwt',
};

const event: ApprovalAwaitingEvent = {
  approvalId: 'A1', pipelineId: 'P1', env: 'prod', moduleKey: 'admin',
  versionTag: 'v1.2.3', nodeKey: 'approve-1', nodeLabel: '发布确认',
  operator: 'alice', createdAt: 1_700_000_000_000,
};

function build(enabled: boolean, send: jest.Mock) {
  const api = { sendTextCard: send } as unknown as WecomApiClient;
  const svc = new WecomNotifierService(
    WecomConfigService.forTest(enabled ? enabledEnv : { WECOM_APPROVE_ENABLED: '0' }),
    api,
  );
  return svc;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('WecomNotifierService（V1 / V11 / V12）', () => {
  afterEach(() => {
    wecomEvents.removeAllListeners(WECOM_APPROVAL_AWAITING);
  });

  it('V12 总开关关闭：不订阅、emit 零企微调用', async () => {
    const send = jest.fn();
    const svc = build(false, send);
    svc.onModuleInit();
    expect(svc.isSubscribed).toBe(false);
    wecomEvents.emit(WECOM_APPROVAL_AWAITING, event);
    await tick();
    expect(send).not.toHaveBeenCalled();
  });

  it('开关开启：挂起事件触发应用消息，链接指向 H5', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const svc = build(true, send);
    svc.onModuleInit();
    expect(svc.isSubscribed).toBe(true);
    wecomEvents.emit(WECOM_APPROVAL_AWAITING, event);
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
    const [, card] = send.mock.calls[0] as [string, { url: string; description: string }];
    /**
     * 2026-11-06 联调修正断言：原断言是 `…/console/m/approve/A1`（直连 H5）。
     * 那条链接在真机上必然失败 —— H5 只认 `?ticket=`，而票据只能由 OAuth 回调签发，
     * 所以「直连 H5」等于「从企微点进来 100% 显示链接已失效」。
     * 断言跟着改成免登入口，并保留一条负向断言防止有人改回直连。
     */
    expect(card.url).toBe(
      'https://dev.kedouai.com/console/api/wecom/oauth/authorize?approvalId=A1',
    );
    expect(card.url).not.toMatch(/\/m\/approve\//);
    expect(card.description).toContain('admin');
    expect(card.description).toContain('发布确认');
    svc.onModuleDestroy();
  });

  it('V11 企微不可用：失败吞掉，返回 false，不抛、不阻塞', async () => {
    const send = jest.fn().mockRejectedValue(new Error('errcode=40001'));
    const svc = build(true, send);
    await expect(svc.push(event)).resolves.toBe(false);
  });

  it('关闭态 push 直接返回 false', async () => {
    const send = jest.fn();
    const svc = build(false, send);
    await expect(svc.push(event)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('onModuleDestroy 取消订阅，后续 emit 不再推送', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const svc = build(true, send);
    svc.onModuleInit();
    svc.onModuleDestroy();
    expect(svc.isSubscribed).toBe(false);
    wecomEvents.emit(WECOM_APPROVAL_AWAITING, event);
    await tick();
    expect(send).not.toHaveBeenCalled();
  });
});
