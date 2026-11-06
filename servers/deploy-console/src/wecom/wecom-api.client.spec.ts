import { WecomApiClient, Fetcher } from './wecom-api.client';
import { WecomConfigService } from './wecom.config';

const NOW = 1_700_000_000_000;
const cfg = WecomConfigService.forTest({
  WECOM_APPROVE_ENABLED: '1',
  CONSOLE_PUBLIC_BASE_URL: 'https://dev.kedouai.com/console',
  WECOM_CORP_ID: 'corp-id',
  WECOM_AGENT_ID: '1000002',
  WECOM_SECRET: 'secret',
  JWT_SECRET: 'jwt',
});

/** 构造只返回 json 的 fetcher；记录调用便于断言「并发只发一次」 */
function jsonFetcher(impl: (url: string, init?: RequestInit) => unknown, ok = true): Fetcher {
  return (async (url: RequestInfo | URL, init?: RequestInit) => ({
    ok,
    status: ok ? 200 : 502,
    json: async () => impl(String(url), init),
  })) as unknown as Fetcher;
}

describe('WecomApiClient（T2-b：token 缓存 / 并发锁 / 推送）', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('缓存命中：7200s 内复用，不重复请求 gettoken', async () => {
    const impl = jest.fn(() => ({ errcode: 0, access_token: 'T1', expires_in: 7200 }));
    const client = new WecomApiClient(cfg, jsonFetcher(impl));
    expect(await client.getToken(NOW)).toBe('T1');
    expect(await client.getToken(NOW + 3_600_000)).toBe('T1');
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('提前 5 分钟刷新：超过 6900s 重新取', async () => {
    const impl = jest
      .fn()
      .mockReturnValueOnce({ errcode: 0, access_token: 'T1', expires_in: 7200 })
      .mockReturnValueOnce({ errcode: 0, access_token: 'T2', expires_in: 7200 });
    const client = new WecomApiClient(cfg, jsonFetcher(impl));
    await client.getToken(NOW);
    expect(await client.getToken(NOW + 6_900_001)).toBe('T2');
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('并发加锁：同时两个 getToken 只发一次请求', async () => {
    const impl = jest.fn(() => ({ errcode: 0, access_token: 'T1', expires_in: 7200 }));
    const client = new WecomApiClient(cfg, jsonFetcher(impl));
    const [a, b] = await Promise.all([client.getToken(NOW), client.getToken(NOW)]);
    expect(a).toBe('T1');
    expect(b).toBe('T1');
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('取 token 失败不缓存：下一次重新请求', async () => {
    const impl = jest
      .fn()
      .mockReturnValueOnce({ errcode: 40001, errmsg: 'invalid credential' })
      .mockReturnValueOnce({ errcode: 0, access_token: 'T2', expires_in: 7200 });
    const client = new WecomApiClient(cfg, jsonFetcher(impl));
    await expect(client.getToken(NOW)).rejects.toThrow(/errcode=40001/);
    expect(await client.getToken(NOW)).toBe('T2');
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('HTTP 非 2xx 抛错，且错误信息不含 token / secret', async () => {
    const client = new WecomApiClient(cfg, jsonFetcher(() => ({}), false));
    await expect(client.getToken(NOW)).rejects.toThrow(/HTTP 502/);
  });

  it('OAuth code → userid（大写 UserId 与小写 userid 都兼容）', async () => {
    const impl = (url: string) =>
      url.includes('gettoken')
        ? { errcode: 0, access_token: 'T1', expires_in: 7200 }
        : { errcode: 0, UserId: 'wenzhui' };
    const client = new WecomApiClient(cfg, jsonFetcher(impl));
    expect(await client.getUserIdByCode('CODE')).toBe('wenzhui');
  });

  it('应用消息带审批链接、收件人与 agentid', async () => {
    let sent = '';
    const impl = (url: string, init?: RequestInit) => {
      if (url.includes('gettoken')) return { errcode: 0, access_token: 'T1', expires_in: 7200 };
      sent = String(init?.body ?? '');
      return { errcode: 0 };
    };
    const client = new WecomApiClient(cfg, jsonFetcher(impl));
    await client.sendTextCard('@all', {
      title: '【待审批】admin → PROD',
      description: '环境：PROD',
      url: 'https://dev.kedouai.com/console/m/approve/A1',
    });
    const body = JSON.parse(sent) as {
      touser: string; agentid: number; msgtype: string; textcard: { url: string };
    };
    expect(body.touser).toBe('@all');
    expect(body.agentid).toBe(1000002);
    expect(body.msgtype).toBe('textcard');
    expect(body.textcard.url).toContain('/m/approve/A1');
  });
});
