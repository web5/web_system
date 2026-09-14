import {
  resolveUserSystems,
  normalizeSystems,
  normalizeAppSystem,
  hasSystem,
  isAppSystem,
  SYSTEMS,
  SYSTEM_LABELS,
  DEFAULT_APP_SYSTEM,
} from './user-systems';

/**
 * 系统归属判定的防回归测试。
 *
 * 核心要锁住的两条（需求 V1/V7）：
 *  ① C 端用户**永远**只能拿到 portal，不能进 admin / deploy；
 *  ② 兜底必须落在 portal（最小权限），不能因为字段缺失把 C 端账号放进后台。
 */
describe('resolveUserSystems（系统归属判定）', () => {
  it('有微信/小程序 openid ⇒ 只归 portal（C 端隔离）', () => {
    expect(resolveUserSystems({ mpOpenid: 'oNLC84r2K0' })).toEqual(['portal']);
    expect(resolveUserSystems({ oaOpenid: 'oNLC84r2K0' })).toEqual(['portal']);
  });

  it('存量运维账号 ⇒ admin + deploy（迁移期不能把自己锁在门外）', () => {
    expect(resolveUserSystems({ username: 'admin' })).toEqual(['admin', 'deploy']);
  });

  it('运营角色（含只读）⇒ admin，不给 deploy', () => {
    expect(resolveUserSystems({ username: 'test', roles: ['viewer'] })).toEqual(['admin']);
    expect(resolveUserSystems({ username: 'ed', roles: ['editor'] })).toEqual(['admin']);
    expect(resolveUserSystems({ username: 'x', roles: ['admin'] })).toEqual(['admin']);
  });

  it('普通 C 端角色（user）⇒ portal', () => {
    expect(resolveUserSystems({ username: 'u1', roles: ['user'] })).toEqual(['portal']);
  });

  it('字段全空的兜底 ⇒ portal（最小权限，绝不落到 admin）', () => {
    expect(resolveUserSystems({})).toEqual(['portal']);
    expect(resolveUserSystems({ username: 'who', roles: null })).toEqual(['portal']);
  });

  it('已归类的用户原样返回（幂等，脚本可重复跑）', () => {
    expect(resolveUserSystems({ systems: ['deploy'], mpOpenid: 'o1' })).toEqual(['deploy']);
    expect(resolveUserSystems({ systems: ['admin', 'deploy'] })).toEqual(['admin', 'deploy']);
  });
});

describe('normalizeSystems（归一化）', () => {
  it('去空、去重、丢弃非法值', () => {
    expect(normalizeSystems(['admin', ' admin ', '', 'nope', 'deploy', 'admin'])).toEqual([
      'admin',
      'deploy',
    ]);
    expect(normalizeSystems(null)).toEqual([]);
    expect(normalizeSystems('admin')).toEqual([]);
  });
});

describe('normalizeAppSystem（登录时的系统参数）', () => {
  it('未传 / 非法值 ⇒ 默认 portal（对 C 端零影响）', () => {
    expect(normalizeAppSystem()).toBe('portal');
    expect(normalizeAppSystem('')).toBe('portal');
    expect(normalizeAppSystem('ops')).toBe('portal');
    expect(normalizeAppSystem(123)).toBe('portal');
    expect(DEFAULT_APP_SYSTEM).toBe('portal');
  });

  it('合法值原样返回', () => {
    expect(normalizeAppSystem('deploy')).toBe('deploy');
    expect(normalizeAppSystem(' admin ')).toBe('admin');
  });

  it('每个系统都有中文名（报错文案用）', () => {
    for (const s of SYSTEMS) expect(SYSTEM_LABELS[s]).toBeTruthy();
  });
});

describe('hasSystem / isAppSystem', () => {
  it('按系统判定归属', () => {
    expect(hasSystem({ systems: ['admin', 'deploy'] }, 'deploy')).toBe(true);
    expect(hasSystem({ systems: ['portal'] }, 'deploy')).toBe(false);
    expect(hasSystem({}, 'portal')).toBe(false);
  });

  it('系统清单 = portal / admin / deploy', () => {
    expect(SYSTEMS).toEqual(['portal', 'admin', 'deploy']);
    expect(isAppSystem('deploy')).toBe(true);
    expect(isAppSystem('ops')).toBe(false);
  });
});
