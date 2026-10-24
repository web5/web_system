/** 账号连通性检测（probe）单测——只验结论与落库，不碰真实微信接口 */
import { BadRequestException } from '@nestjs/common';
import { ContentAccountService } from './content-account.service';
import type { ContentAccountEntity } from '../entities/content-account.entity';

/** 构造一个可注入的假 repo + 假凭据服务 */
function makeDeps(row: Partial<ContentAccountEntity> | null) {
  const saved: ContentAccountEntity[] = [];
  const repo = {
    findOne: jest.fn().mockResolvedValue(row),
    save: jest.fn().mockImplementation(async (r) => {
      saved.push(r);
      return r;
    }),
  };
  const credential = {
    decrypt: jest.fn().mockReturnValue({ app_id: 'wx123', app_secret: 'sec' }),
  };
  const service = new ContentAccountService(
    repo as never,
    credential as never,
  );
  return { service, repo, credential, saved };
}

/** stub 全局 fetch：按序返回响应 */
function stubFetch(responses: unknown[]) {
  const fn = jest.fn();
  for (const r of responses) fn.mockResolvedValueOnce({ json: async () => r });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function row(over: Partial<ContentAccountEntity> = {}): Partial<ContentAccountEntity> {
  return {
    id: 1,
    platform: 'wechat_mp',
    code: 'default',
    name: '大橙子社区',
    credentials_enc: 'AAAA',
    identity: null,
    last_check_status: null,
    last_checked_at: null,
    ...over,
  };
}

describe('ContentAccountService.probe', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('token 换取成功 → ok，落库 last_check_status=ok，并回填昵称', async () => {
    const { service, saved } = makeDeps(row());
    stubFetch([
      { access_token: 'TOKEN' }, // stable_token
      { nick_name: '大橙子社区', errcode: 0 }, // basicinfo
    ]);
    const r = await service.probe(1);

    expect(r.status).toBe('ok');
    expect(r.message).toContain('凭据有效');
    expect(saved).toHaveLength(1);
    expect(saved[0].last_check_status).toBe('ok');
    expect(saved[0].identity).toBe('大橙子社区');
    expect(saved[0].last_checked_at).toBeInstanceOf(Date);
  });

  it('40125 AppSecret 无效 → err，落库 err，不回填昵称', async () => {
    const { service, saved } = makeDeps(row());
    stubFetch([{ errcode: 40125, errmsg: 'invalid appsecret' }]);
    const r = await service.probe(1);

    expect(r.status).toBe('err');
    expect(r.message).toContain('AppSecret');
    expect(saved[0].last_check_status).toBe('err');
    expect(saved[0].identity).toBeNull();
  });

  it('40164 IP 白名单 → warn（凭据对、机器被拒）', async () => {
    const { service, saved } = makeDeps(row());
    stubFetch([{ errcode: 40164, errmsg: 'invalid ip' }]);
    const r = await service.probe(1);

    expect(r.status).toBe('warn');
    expect(r.message).toContain('IP 白名单');
    expect(saved[0].last_check_status).toBe('warn');
  });

  it('无凭据密文 → err 且不发起任何 HTTP 请求', async () => {
    const { service, saved } = makeDeps(row({ credentials_enc: null }));
    const fetchFn = stubFetch([]);
    const r = await service.probe(1);

    expect(r.status).toBe('err');
    expect(r.message).toContain('未录入凭据');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(saved[0].last_check_status).toBe('err');
  });

  it('非公众号平台 → err 且不发起请求', async () => {
    const { service, saved } = makeDeps(row({ platform: 'xiaohongshu' }));
    const fetchFn = stubFetch([]);
    const r = await service.probe(1);

    expect(r.status).toBe('err');
    expect(r.message).toContain('暂不支持');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('解密失败（密钥未配置等）→ err 且不泄露密文', async () => {
    const { service, credential, saved } = makeDeps(row());
    credential.decrypt.mockImplementation(() => {
      throw new Error('未配置 ACCOUNT_CRED_KEY_FILE');
    });
    stubFetch([]);
    const r = await service.probe(1);

    expect(r.status).toBe('err');
    expect(r.message).toContain('ACCOUNT_CRED_KEY_FILE');
    expect(r.message).not.toContain('AAAA');
    expect(saved[0].last_check_status).toBe('err');
  });

  it('账号不存在 → 400', async () => {
    const { service } = makeDeps(null);
    await expect(service.probe(99)).rejects.toThrow(BadRequestException);
  });

  it('basicinfo 挂了不影响 ok 结论（昵称尽力而为）', async () => {
    const { service, saved } = makeDeps(row());
    const fetchFn = stubFetch([{ access_token: 'TOKEN' }]);
    fetchFn.mockRejectedValueOnce(new Error('network down'));
    const r = await service.probe(1);

    expect(r.status).toBe('ok');
    expect(saved[0].last_check_status).toBe('ok');
    expect(saved[0].identity).toBeNull();
  });
});
