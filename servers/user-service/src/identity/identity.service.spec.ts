import { ConflictException } from '@nestjs/common';
import { IdentityService } from './identity.service';

/**
 * 统一外部身份层（卡①）单测。
 * 判据来源：docs/development/wecom-approval-identity-contract.md §四 / §六（spec V13、V16）。
 *
 * 刻意用「直接 new Service(mockRepo)」而非 TestingModule：本轮验的是解析规则，
 * 不是 Nest 装配；装配由 identity.module + app.module 的类型检查保证。
 */
type Row = Record<string, unknown>;

function makeRepo(rows: Row[]) {
  const store = rows.map((r) => ({ ...r }));
  const findOne = jest.fn(async ({ where }: { where: Row }) => {
    const hit = store.find((r) =>
      Object.entries(where).every(([k, v]) => String(r[k]) === String(v)),
    );
    return hit ?? null;
  });
  const save = jest.fn(async (u: Row) => {
    Object.assign(store.find((r) => String(r.id) === String(u.id)) ?? {}, u);
    return u;
  });
  return { findOne, save };
}

const active = (over: Row = {}): Row => ({
  id: 1,
  username: 'chase',
  nickname: '橙子哥哥',
  status: 'active',
  roles: ['admin'],
  systems: ['deploy'],
  mergedTo: null,
  wecomUserid: 'WenZhui',
  mpOpenid: null,
  oaOpenid: null,
  unionid: null,
  ...over,
});

const svcOf = (repo: ReturnType<typeof makeRepo>) => new IdentityService(repo as never);

describe('IdentityService.resolve · V13 四类边界', () => {
  it('① 正常企微 id → 返回 userId/username/roles/systems', async () => {
    const data = await svcOf(makeRepo([active()])).resolve({
      channel: 'wecom',
      externalId: 'WenZhui',
    });
    expect(data).toMatchObject({ userId: '1', username: 'chase', roles: ['admin'], systems: ['deploy'] });
  });

  it('② 停用/封禁账号 → null（不 500、不 404）', async () => {
    const data = await svcOf(makeRepo([active({ status: 'banned' })])).resolve({
      channel: 'wecom',
      externalId: 'WenZhui',
    });
    expect(data).toBeNull();
  });

  it('③ 未绑定 id → null（不 500、不 404）', async () => {
    const data = await svcOf(makeRepo([active({ wecomUserid: null })])).resolve({
      channel: 'wecom',
      externalId: 'nobody',
    });
    expect(data).toBeNull();
  });

  it('④ 已合并账号 → 返回存活账号且带 mergedFrom', async () => {
    const repo = makeRepo([
      active({ id: 7, username: 'old', wecomUserid: 'WenZhui', mergedTo: 1 }),
      active({ wecomUserid: null }),
    ]);
    const data = await svcOf(repo).resolve({ channel: 'wecom', externalId: 'WenZhui' });
    expect(data?.userId).toBe('1');
    expect(data?.username).toBe('chase');
    expect(data?.mergedFrom).toEqual({ userId: '7', username: 'old' });
  });
});

describe('IdentityService.resolve · 硬规则与渠道复用', () => {
  it('R-c：externalId 命中即返回，unionId 不得覆盖精确命中（命中停用账号也不回退）', async () => {
    const repo = makeRepo([
      active({ id: 7, status: 'banned', wecomUserid: 'WenZhui' }),
      active({ unionid: 'UNION-X', wecomUserid: null }),
    ]);
    const data = await svcOf(repo).resolve({
      channel: 'wecom',
      externalId: 'WenZhui',
      unionId: 'UNION-X',
    });
    expect(data).toBeNull();
    expect(repo.findOne).toHaveBeenCalledTimes(1);
  });

  it('unionId 只在 externalId 未命中时兜底', async () => {
    const repo = makeRepo([active({ unionid: 'UNION-X', wecomUserid: null })]);
    const data = await svcOf(repo).resolve({
      channel: 'wecom',
      externalId: 'not-exist',
      unionId: 'UNION-X',
    });
    expect(data?.userId).toBe('1');
  });

  it('V16：mp / oa 渠道用既有列直接解析（未来微信端不必再动身份层）', async () => {
    const repo = makeRepo([active({ mpOpenid: 'MP-1', oaOpenid: 'OA-1', wecomUserid: null })]);
    expect((await svcOf(repo).resolve({ channel: 'mp', externalId: 'MP-1' }))?.username).toBe('chase');
    expect((await svcOf(repo).resolve({ channel: 'oa', externalId: 'OA-1' }))?.username).toBe('chase');
  });

  it('合并链成环 / 目标账号不存在 → null，不死循环不抛异常', async () => {
    const cycle = makeRepo([
      active({ id: 1, mergedTo: 2 }),
      active({ id: 2, mergedTo: 1 }),
    ]);
    expect(await svcOf(cycle).resolve({ channel: 'wecom', externalId: 'WenZhui' })).toBeNull();

    const broken = makeRepo([active({ mergedTo: 999 })]);
    expect(await svcOf(broken).resolve({ channel: 'wecom', externalId: 'WenZhui' })).toBeNull();
  });

  it('历史 roles/systems 逗号串形态归一化', async () => {
    const data = await svcOf(makeRepo([active({ roles: 'admin,deploy', systems: null })])).resolve({
      channel: 'wecom',
      externalId: 'WenZhui',
    });
    expect(data?.roles).toEqual(['admin', 'deploy']);
    expect(data?.systems).toEqual([]);
  });
});

describe('IdentityService.bind / unbind', () => {
  it('bind：同渠道 id 已绑他人 → 409', async () => {
    const repo = makeRepo([
      active({ id: 1, wecomUserid: 'TAKEN' }),
      active({ id: 2, username: 'other', wecomUserid: null }),
    ]);
    await expect(
      svcOf(repo).bind({ userId: 2, channel: 'wecom', externalId: 'TAKEN' }),
    ).rejects.toThrow(ConflictException);
  });

  it('bind：写入渠道列 + unionid，返回 bound:true', async () => {
    const repo = makeRepo([active({ wecomUserid: null, unionid: null })]);
    const data = await svcOf(repo).bind({
      userId: 1,
      channel: 'wecom',
      externalId: 'NEW-ID',
      unionId: 'UNION-Z',
      operator: 'chase',
    });
    expect(data).toEqual({ bound: true });
    const saved = repo.save.mock.calls[0][0] as Row;
    expect(saved.wecomUserid).toBe('NEW-ID');
    expect(saved.unionid).toBe('UNION-Z');
  });

  it('unbind：把渠道列置空；未绑定时静默返回', async () => {
    const repo = makeRepo([active()]);
    await svcOf(repo).unbind({ channel: 'wecom', externalId: 'WenZhui', operator: 'chase' });
    expect((repo.save.mock.calls[0][0] as Row).wecomUserid).toBeNull();

    const empty = makeRepo([active({ wecomUserid: null })]);
    await svcOf(empty).unbind({ channel: 'wecom', externalId: 'nobody' });
    expect(empty.save).not.toHaveBeenCalled();
  });
});
