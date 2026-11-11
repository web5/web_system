/**
 * 「我的」页资料回显同步单测（台账 #8688）
 *
 * 断点（诊断 02-我的页不回显诊断.md §⑩-3）：`pages/mine/index/index.ts:115-125` 的
 * nickname / avatar 来自**同一次** `fetchProfile()`（GET /auth/verify）的**同一个** setData，
 * 而 `:125` 是 `.catch(() => undefined)` —— 失败被完全吞掉。
 * 于是「拿不到数据」与「数据就是旧值」在界面上不可区分，且没有任何跨页通知通道：
 * 保存成功后详情页只写 storage（profile.ts:132 / :162），已挂载的「我的」页不会更新，
 * 只能指望它 onShow 重跑并且 fetchProfile 成功。
 *
 * 修法口径（§⑩-5，主次两条）：
 *   ① 保存成功即跨页广播 `profile:updated`（profile.ts → app.eventBus → mine/index）
 *      —— 不依赖 onShow 是否重跑，是根治项；
 *   ② `:125` 失败不再静默：console.warn + 置 profileStale，供可观测与下次重试。
 *
 * 同时钉死两条**不许动**的既有行为：
 *   ③ onShow 的 storage 秒显（:105-112）必须保留（本文件最后一条防改坏）；
 *   ④ profileStale 只是标记，**不许**拿它做「跳过请求」的守卫（onShow 每次必重拉）。
 *
 * 本文件用「真 eventBus 语义 + 真 resolveAvatarUrl」的组合：account 模块只 mock 掉
 * fetchProfile / updateProfile / uploadAvatar 与 storage 读写，其余走 requireActual，
 * 这样「相对路径 → 绝对 URL」的拼接口径与生产完全一致（否则断言会假绿）。
 */
import {
  fetchProfile,
  updateProfile,
  uploadAvatar,
  readLocalAvatar,
  readLocalNickname,
} from '../services/account';

jest.mock('../services/account', () => {
  const actual = jest.requireActual('../services/account') as Record<string, unknown>;
  return {
    ...actual,
    fetchProfile: jest.fn(),
    updateProfile: jest.fn(),
    uploadAvatar: jest.fn(),
    readLocalNickname: jest.fn(() => ''),
    readLocalAvatar: jest.fn(() => ''),
    writeLocalNickname: jest.fn(),
    writeLocalAvatar: jest.fn(),
  };
});

jest.mock('../services/auth', () => ({ isLoggedIn: jest.fn(() => true) }));
jest.mock('../services/glossary', () => ({ listGlossary: jest.fn(() => Promise.resolve({ total: 0 })) }));

const fetchProfileMock = fetchProfile as jest.Mock;
const updateProfileMock = updateProfile as jest.Mock;
const uploadAvatarMock = uploadAvatar as jest.Mock;
const readLocalNicknameMock = readLocalNickname as jest.Mock;
const readLocalAvatarMock = readLocalAvatar as jest.Mock;

/** 测试里真正会用到的 apiBase（resolveAvatarUrl 经 wx.getStorageSync('api_base') 取） */
const API_BASE = 'https://dev.kedouai.com';

// ---------------------------------------------------------------------------
// 事件总线：与 app.ts 的 eventBus 同语义（on / off / emit，emit 时快照遍历）
// ---------------------------------------------------------------------------
type Handler = (payload?: unknown) => void;
const handlers: Record<string, Handler[]> = {};
const bus = {
  on: jest.fn((event: string, handler: Handler) => {
    (handlers[event] || (handlers[event] = [])).push(handler);
  }),
  off: jest.fn((event: string, handler: Handler) => {
    handlers[event] = (handlers[event] || []).filter((h) => h !== handler);
  }),
  emit: jest.fn((event: string, payload?: unknown) => {
    (handlers[event] || []).slice().forEach((h) => h(payload));
  }),
};

const wxMock = {
  // 只给 api_base，其余 key 返回空（readTrCount 等读到空即留空，不编造数字）
  getStorageSync: jest.fn((key: string): unknown => (key === 'api_base' ? API_BASE : '')),
  setStorageSync: jest.fn(),
  showToast: jest.fn(),
  navigateTo: jest.fn(),
  navigateBack: jest.fn(),
};

const appMock = {
  eventBus: bus,
  globalData: {
    userInfo: {} as Record<string, unknown>,
    token: '',
    refreshToken: '',
    apiBase: API_BASE,
  },
  radiusClassOf: () => '',
};

// ---------------------------------------------------------------------------
// 页面捕获：profile.ts 先 require，mine/index/index.ts 后 require
// ---------------------------------------------------------------------------
type PageConfig = Record<string, any>;
const pageRegistry: PageConfig[] = [];
let profileCfg: PageConfig;
let mineCfg: PageConfig;

beforeAll(() => {
  (globalThis as { Page?: unknown }).Page = (cfg: PageConfig) => {
    pageRegistry.push(cfg);
  };
  (globalThis as { getApp?: unknown }).getApp = () => appMock;
  (globalThis as { wx?: unknown }).wx = wxMock;

  require('../pages/mine/profile/profile');
  require('../pages/mine/index/index');

  // 顺序即捕获顺序：profile → mine
  profileCfg = pageRegistry[0];
  mineCfg = pageRegistry[1];
});

/**
 * 构造一个最小 page 实例：data 深拷贝一份（避免跨用例串值）、配置对象里的方法
 * 全部 bind 到实例（`this.onShow()` 这类内部自调用要能跑通）、
 * 非方法字段（_offAuthExpired / _syncedNickname 等运行时字段）按值拷到实例。
 */
function makePage(cfg: PageConfig): PageConfig {
  const ctx: PageConfig = {
    data: JSON.parse(JSON.stringify(cfg.data || {})) as Record<string, unknown>,
    setData(this: PageConfig, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    },
  };
  Object.keys(cfg).forEach((key) => {
    if (key === 'data') return;
    if (typeof cfg[key] === 'function') ctx[key] = (cfg[key] as (...a: unknown[]) => unknown).bind(ctx);
    else ctx[key] = cfg[key];
  });
  return ctx;
}

/** 冲一遍微任务 + 宏任务，让 onShow / saveNickname 里的 promise 链落地 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const PROFILE_INFO = {
  id: 1,
  username: 'u1',
  nickname: '大橙子',
  avatar: '',
  phone: '',
  email: '',
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(handlers).forEach((k) => {
    handlers[k] = [];
  });
  readLocalNicknameMock.mockReturnValue('');
  readLocalAvatarMock.mockReturnValue('');
  fetchProfileMock.mockResolvedValue({ ...PROFILE_INFO });
  updateProfileMock.mockImplementation(async (p: { nickname?: string; avatar?: string }) => ({
    ...PROFILE_INFO,
    ...p,
  }));
  uploadAvatarMock.mockResolvedValue('/api/uploads/avatars/x.jpeg');
});

// ---------------------------------------------------------------------------
// ① 保存昵称成功 → 广播 → 「我的」页立即更新（改前必红：无人 emit / 无人订阅）
// ---------------------------------------------------------------------------
describe('B1+B2 昵称：保存成功即跨页广播，「我的」页无需等 onShow 即回显', () => {
  it('详情页保存昵称成功后，「我的」页 data.nickname 立即变为新值', async () => {
    const mine = makePage(mineCfg);
    mine.onLoad();
    mine.data.nickname = '旧昵称';

    const profile = makePage(profileCfg);
    await profile.saveNickname('大橙子');

    expect(bus.emit).toHaveBeenCalledWith('profile:updated', expect.objectContaining({ nickname: '大橙子' }));
    expect(mine.data.nickname).toBe('大橙子');
  });
});

// ---------------------------------------------------------------------------
// ② 头像：广播值必须过 resolveAvatarUrl（与 mine/index.ts:122 同口径）
// ---------------------------------------------------------------------------
describe('B1+B2 头像：广播的相对路径在「我的」页被拼成绝对 URL', () => {
  it('chooseAvatar 上传落库成功后，「我的」页 avatar 是带 apiBase 的绝对 URL', async () => {
    const mine = makePage(mineCfg);
    mine.onLoad();

    const profile = makePage(profileCfg);
    profile.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/avatar-20261111.jpeg' } });
    await flush();

    // 裸相对路径会被小程序按包内路径解析 → 必须已拼上 apiBase
    expect(mine.data.avatar).toBe(`${API_BASE}/api/uploads/avatars/x.jpeg`);
    expect(mine.data.avatar).not.toBe('/api/uploads/avatars/x.jpeg');
  });
});

// ---------------------------------------------------------------------------
// ③ 生命周期：onUnload 退订后不得再打到已销毁实例
// ---------------------------------------------------------------------------
describe('B2 订阅生命周期：onUnload 退订生效', () => {
  it('卸载后 emit 不再调用 setData（订阅确实注册过 → 退订确实生效）', () => {
    const mine = makePage(mineCfg);
    mine.onLoad();
    const setDataSpy = jest.spyOn(mine, 'setData');

    // 卸载前：订阅生效，收得到广播
    bus.emit('profile:updated', { nickname: '卸载前' });
    expect(setDataSpy).toHaveBeenCalled();
    expect(mine.data.nickname).toBe('卸载前');

    setDataSpy.mockClear();
    mine.onUnload();

    // 卸载后：handler 已退订，不再对已销毁实例 setData
    expect(() => bus.emit('profile:updated', { nickname: '卸载后' })).not.toThrow();
    expect(setDataSpy).not.toHaveBeenCalled();
    expect(mine.data.nickname).toBe('卸载前');
  });
});

// ---------------------------------------------------------------------------
// ④ :125 失败不再静默（可观测 + 脏标记）
// ---------------------------------------------------------------------------
describe('B3 fetchProfile 失败可见（不再 .catch(() => undefined)）', () => {
  it('reject 时 console.warn 被调用，且置 profileStale = true', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchProfileMock.mockRejectedValueOnce(new Error('verify 401'));

    const mine = makePage(mineCfg);
    mine.onShow();
    await flush();

    expect(warnSpy).toHaveBeenCalled();
    expect(mine.profileStale).toBe(true);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// ⑤ profileStale 只是标记，不许当「跳过请求」的守卫
// ---------------------------------------------------------------------------
describe('B3 profileStale 不阻止下次 onShow 重拉（⛔ 禁止 loaded 守卫）', () => {
  it('置 stale 后再 onShow，fetchProfile 必须又被调用一次', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchProfileMock.mockRejectedValueOnce(new Error('verify 401'));

    const mine = makePage(mineCfg);
    mine.onShow();
    await flush();
    expect(mine.profileStale).toBe(true);

    const before = fetchProfileMock.mock.calls.length;
    fetchProfileMock.mockResolvedValueOnce({ ...PROFILE_INFO, nickname: '重试成功' });
    mine.onShow();
    await flush();

    expect(fetchProfileMock.mock.calls.length).toBe(before + 1);
    expect(mine.data.nickname).toBe('重试成功');
    expect(mine.profileStale).toBe(false);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// ⑥ 既有行为不许改坏：onShow 的 storage 秒显（:105-112）+ 双路读兜底
// ---------------------------------------------------------------------------
describe('B4 onShow 双路读兜底保留', () => {
  it('onShow 秒显 storage 里的昵称/头像（不依赖 fetchProfile 返回）', () => {
    readLocalNicknameMock.mockReturnValue('本地昵称');
    readLocalAvatarMock.mockReturnValue('/api/uploads/avatars/local.jpeg');
    // 永不 resolve：本条只看秒显，不看收敛
    fetchProfileMock.mockReturnValue(new Promise(() => undefined));

    const mine = makePage(mineCfg);
    mine.onShow();

    expect(mine.data.nickname).toBe('本地昵称');
    expect(mine.data.avatar).toBe(`${API_BASE}/api/uploads/avatars/local.jpeg`);
  });
});
