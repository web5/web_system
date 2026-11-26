/**
 * 首页 hero / 「我的」页「接线契约」单测。
 *
 * 覆盖「页面层把纯函数层 utils/greeting.ts 与 services/account.ts 正确接线」：
 *  ① greetingText 用 formatGreeting(昵称, 本地小时) 生成，页面不自己拼逗号 / 不写死时区；
 *     昵称三态：本地秒显 → fetchProfile → isNicknameUnset 兜底；
 *     未登录零业务请求：fetchProfile 绝不在未登录时、也绝不在 Page({data}) 初始化时调用；
 *     profile:updated 订阅 + onUnload 退订。
 *  ② 每日一句 { cn, en } 中英配对展示 + 注入能力保持。
 *  ③「我的」页按原型 114 / S9 边界移除「课文学习进度」，保留四行与昵称范式。
 *  ④ 四个已知缺陷的回归锁（A 跨时段 / B 卸载后 setData / C 并发竞态 / D 双写闪变）。
 *
 * 🔴 本文件零真实 NCE 句子、零句池数据、不接 services/nce.ts（版权 P0 未解锁）。
 */
import { isLoggedIn } from '../services/auth';
import { fetchProfile, readLocalNickname, isNicknameUnset } from '../services/account';
import { formatGreeting, getLocalHour } from '../utils/greeting';

// 本测试需读 wxml / ts 源文本做「接线契约」静态断言。工程 tsconfig 的 types 白名单
// 仅含 wechat-miniprogram / jest（无 @types/node），故对运行时全局做最小类型声明，
// 用与既有测试相同的 require 方式取 fs / path 模块，不触碰工程 tsconfig（越界面）。
declare const __dirname: string;
const fs = require('fs') as { readFileSync(p: string, enc: string): string };
const path = require('path') as { join(...parts: string[]): string };

// 登录态初值持有者：data 初值在 require 页面模块时只求值一次，两态用例必须分别
// resetModules + 重新 require。而 mock 工厂在重新 require 时会重建 jest.fn，
// 旧引用上的 mockReturnValue 对新实例无效 —— 故工厂统一读这个持有者（名字须以 mock 开头，
// 否则 babel-plugin-jest-hoist 禁止工厂引用外部变量）。
const mockAuthState = { loggedIn: true };
jest.mock('../services/auth', () => ({ isLoggedIn: jest.fn(() => mockAuthState.loggedIn) }));
jest.mock('../services/account', () => ({
  readLocalNickname: jest.fn(),
  fetchProfile: jest.fn(),
  isNicknameUnset: jest.fn(),
}));
jest.mock('../utils/greeting', () => ({
  // 可观测桩：把 hour 编进返回值，用来断言「页面用 getLocalHour() 的本地小时、不写死偏移」
  formatGreeting: jest.fn((nick: string, hour: number) => `${nick || '同学'}，H${hour}`),
  getLocalHour: jest.fn(() => 10),
}));
// 首页 data 还依赖 utils/daily 的册别角标（getDailyQuoteMeta / BOOK_LABEL，A3 方案①），
// mock 必须把这些一并给出，否则页面模块加载即 TypeError。
jest.mock('../utils/daily', () => ({
  getDailyQuote: jest.fn(() => ({ cn: 'CN', en: 'EN' })),
  getDailyQuoteMeta: jest.fn(() => ({})),
  BOOK_LABEL: {},
  FALLBACK_QUOTES: [{ cn: 'CN', en: 'EN' }],
  pickNceLine: jest.fn(),
}));
jest.mock('../utils/tabbar', () => ({
  setTabBarSelected: jest.fn(),
  TAB_INDEX: { home: 0, discover: 1, mine: 2 },
}));
jest.mock('../utils/features', () => ({
  FEATURES: [],
  getPinned: jest.fn(() => []),
  FEATURES_UPDATED_EVENT: 'features:updated',
}));

const isLoggedInMock = isLoggedIn as jest.Mock;
const fetchProfileMock = fetchProfile as jest.Mock;
const readLocalNicknameMock = readLocalNickname as jest.Mock;
const isNicknameUnsetMock = isNicknameUnset as jest.Mock;
const formatGreetingMock = formatGreeting as jest.Mock;
const getLocalHourMock = getLocalHour as jest.Mock;

type Handler = (p?: unknown) => void;
const handlers: Record<string, Handler[]> = {};
const bus = {
  on: jest.fn((e: string, h: Handler) => { (handlers[e] || (handlers[e] = [])).push(h); }),
  off: jest.fn((e: string, h: Handler) => { handlers[e] = (handlers[e] || []).filter((x) => x !== h); }),
};

const wxMock = {
  getStorageSync: jest.fn(() => ''),
  setStorageSync: jest.fn(),
  removeStorageSync: jest.fn(),
  navigateTo: jest.fn(),
  showToast: jest.fn(),
  switchTab: jest.fn(),
};

const homeWxml = fs.readFileSync(path.join(__dirname, '../pages/home/index/index.wxml'), 'utf8');
const mineWxml = fs.readFileSync(path.join(__dirname, '../pages/mine/index/index.wxml'), 'utf8');
const mineTs = fs.readFileSync(path.join(__dirname, '../pages/mine/index/index.ts'), 'utf8');

let pageConfig: any = null;
let initFetchCalls = -1;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).getApp = () => ({ eventBus: bus, radiusClassOf: () => '' });
  (globalThis as any).Page = jest.fn((cfg: any) => { pageConfig = cfg; });
  require('../pages/home/index/index');
  // 记录「Page({data}) 初始化阶段」是否误发 fetchProfile（未登录零业务请求）
  initFetchCalls = fetchProfileMock.mock.calls.length;
});

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(handlers).forEach((k) => { handlers[k] = []; });
  isLoggedInMock.mockReturnValue(true);
  readLocalNicknameMock.mockReturnValue('');
  fetchProfileMock.mockResolvedValue({ id: 1, username: 'u', nickname: '小橙' });
  isNicknameUnsetMock.mockImplementation((n?: string) => !n || !n.trim() || n.trim().startsWith('wx_'));
  formatGreetingMock.mockImplementation((nick: string, hour: number) => `${nick || '同学'}，H${hour}`);
  getLocalHourMock.mockReturnValue(10);
});

/** 本 describe 创建过的所有页面上下文：afterEach 统一 onUnload，避免 60s 心跳泄漏 */
const created: any[] = [];
afterEach(() => {
  while (created.length) {
    const ctx = created.pop();
    try { ctx.onUnload(); } catch { /* 已是销毁态，忽略 */ }
  }
});

/** 构造一个带 setData、方法已 bind 的页面上下文（this） */
function makePage(): any {
  const ctx: any = {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(this: any, patch: Record<string, unknown>) { Object.assign(this.data, patch); },
  };
  Object.keys(pageConfig).forEach((k) => {
    if (k === 'data') return;
    if (typeof pageConfig[k] === 'function') ctx[k] = pageConfig[k].bind(ctx);
    else ctx[k] = pageConfig[k];
  });
  created.push(ctx);
  return ctx;
}

/** 冲一遍微任务 / 宏任务，让 fetchProfile 的 promise 链落地 */
function flush(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }

describe('① 首页 hero 动态问候接线（昵称三态 / 本地时区 / 零业务请求）', () => {
  it('data.greetingText 初值不含昵称、不含中文逗号（不编造昵称、不在页面拼逗号）', () => {
    expect(typeof pageConfig.data.greetingText).toBe('string');
    expect(pageConfig.data.greetingText).not.toContain('，');
    expect(pageConfig.data.greetingText).not.toMatch(/小橙|同学/);
  });

  it('fetchProfile 绝不出现在 Page({data}) 初始化（守未登录零请求）', () => {
    expect(initFetchCalls).toBe(0);
  });

  it('wxml hero 绑 {{greetingText}}，移除写死「下午好」，页面不自行拼中文逗号', () => {
    expect(homeWxml).toContain('{{greetingText}}');
    expect(homeWxml).not.toContain('>下午好</view>');
    expect(homeWxml).not.toMatch(/\}\}\s*，\s*\{\{/);
  });

  it('已登录 onShow：本地昵称秒显，formatGreeting 收到 getLocalHour() 的本地小时', async () => {
    readLocalNicknameMock.mockReturnValue('小橙');
    const ctx = makePage();
    ctx.onShow();
    expect(formatGreetingMock).toHaveBeenCalledWith('小橙', 10);
    expect(ctx.data.greetingText).toBe('小橙，H10');
    await flush();
  });

  // 回归锁：时区只认设备本地时区、禁写死 hour。
  // 把唯一读时钟入口 getLocalHour() 的 mock 改为非默认 18，锁住「页面确实调用它、
  // 且把它的返回值（不是字面量常量）交给 formatGreeting 并落到展示串」。
  it('M2b 回归锁：时区只认设备本地时区、禁写死 hour —— getLocalHour() 返回 18 时展示串随之变', async () => {
    getLocalHourMock.mockReturnValue(18);
    readLocalNicknameMock.mockReturnValue('小橙');
    const ctx = makePage();
    ctx.onShow();
    expect(getLocalHourMock).toHaveBeenCalled();
    expect(formatGreetingMock).toHaveBeenCalledWith('小橙', 18);
    expect(ctx.data.greetingText).toBe('小橙，H18');
    await flush();
  });

  it('未登录 onShow：整页 login-gate，fetchProfile 零调用，greetingText 置空串（不留「…」占位）', async () => {
    isLoggedInMock.mockReturnValue(false);
    const ctx = makePage();
    ctx.onShow();
    expect(fetchProfileMock).not.toHaveBeenCalled();
    // P2-3：未登录是「确定的空态」，不是「加载中」。文本留空由 wxml 的 wx:if="{{loggedIn}}" 兜住，
    // 不再靠「…」占位硬撑——否则登录态切换那一瞬会闪一个「…」。
    expect(ctx.data.greetingText).toBe('');
    await flush();
  });

  it('P2-3 未登录 → onLogged 转换：空串收敛为真名，且 fetchProfile 只在 onLogged 之后才发', async () => {
    isLoggedInMock.mockReturnValue(false);
    const ctx = makePage();
    ctx.onShow();
    expect(ctx.data.greetingText).toBe('');
    expect(fetchProfileMock).not.toHaveBeenCalled();

    // 登录卡登录成功：登录态翻转后才有业务请求
    isLoggedInMock.mockReturnValue(true);
    readLocalNicknameMock.mockReturnValue('小橙');
    fetchProfileMock.mockResolvedValue({ id: 1, username: 'u', nickname: '阿橙' });
    ctx.onLogged();
    expect(fetchProfileMock).toHaveBeenCalledTimes(1);
    expect(ctx.data.greetingText).toBe('小橙，H10'); // 本地缓存秒显，不再是空串
    await flush();
    expect(ctx.data.greetingText).toBe('阿橙，H10'); // profile 收敛为真名
  });

  it('fetchProfile 收敛真昵称：isNicknameUnset 判非 unset → 用 info.nickname', async () => {
    fetchProfileMock.mockResolvedValue({ id: 1, username: 'u', nickname: '阿橙' });
    const ctx = makePage();
    ctx.onShow();
    await flush();
    expect(isNicknameUnsetMock).toHaveBeenCalledWith('阿橙');
    expect(formatGreetingMock).toHaveBeenCalledWith('阿橙', 10);
    expect(ctx.data.greetingText).toBe('阿橙，H10');
  });

  it('昵称 unset（wx_ 占位）：回退 readLocalNickname，空则由 formatGreeting 兜底「同学」', async () => {
    readLocalNicknameMock.mockReturnValue('');
    fetchProfileMock.mockResolvedValue({ id: 1, username: 'u', nickname: 'wx_openid123' });
    const ctx = makePage();
    ctx.onShow();
    await flush();
    expect(isNicknameUnsetMock).toHaveBeenCalledWith('wx_openid123');
    expect(formatGreetingMock).toHaveBeenCalledWith('', 10);
    expect(ctx.data.greetingText).toContain('同学');
  });

  it('fetchProfile reject：不抛异常、不编造昵称，收敛为本地缓存/兜底', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchProfileMock.mockRejectedValue(new Error('verify 401'));
    const ctx = makePage();
    ctx.onShow();
    await flush();
    expect(ctx.data.greetingText).toContain('同学');
    warnSpy.mockRestore();
  });

  it('profile:updated 订阅 → 新昵称重算 greetingText；onUnload 退订', () => {
    const ctx = makePage();
    ctx.onLoad();
    expect(bus.on).toHaveBeenCalledWith('profile:updated', expect.any(Function));
    const handler = (handlers['profile:updated'] || [])[0];
    expect(handler).toBeDefined();
    handler!({ nickname: '新昵称' });
    expect(ctx.data.greetingText).toBe('新昵称，H10');
    ctx.onUnload();
    expect(bus.off).toHaveBeenCalledWith('profile:updated', expect.any(Function));
    expect((handlers['profile:updated'] || []).length).toBe(0);
  });
});

describe('①-b 首帧即 data 初值：登录/未登录两态互斥锁（台账 9045「任何一帧不出现「…」或缺昵称文案」）', () => {
  /**
   * 重新加载首页模块，返回「这一次 require 时求值出来的 data 初值」。
   * 为什么必须重新加载：data 初值在 require 页面模块时**只求值一次**，
   * 同一次加载无法同时观测两态；两态必须各自 resetModules + 重新 require，
   * 不许糊成一条对静态字面量的断言。
   * 用临时 Page 捕获，避免覆盖本文件其余用例共用的 pageConfig。
   */
  function initDataFor(loginState: boolean): any {
    let captured: any = null;
    const prevPage = (globalThis as any).Page;
    mockAuthState.loggedIn = loginState;
    isLoggedInMock.mockReturnValue(loginState); // 兼容 resetModules 未重建 mock 的情形
    (globalThis as any).Page = jest.fn((cfg: any) => { captured = cfg; });
    jest.resetModules();
    try {
      require('../pages/home/index/index');
    } finally {
      (globalThis as any).Page = prevPage;
      mockAuthState.loggedIn = true;
    }
    expect(captured).not.toBeNull();
    return captured.data;
  }

  it('未登录：data 初值即 loggedIn=false 且 greetingText="" —— 首帧既不闪 hero 也不闪「…」', () => {
    const data = initDataFor(false);
    expect(data.loggedIn).toBe(false);
    expect(data.greetingText).toBe('');
  });

  it('已登录：data 初值 loggedIn=true 且 greetingText 保留「…」中性占位（拉取中不编造昵称）', () => {
    const data = initDataFor(true);
    expect(data.loggedIn).toBe(true);
    expect(data.greetingText).toBe('…');
  });
});

describe('④ 四个已知缺陷的回归锁（A 跨时段 / B 卸载后 setData / C 并发竞态 / D 双写闪变）', () => {
  // A：tabBar 页常驻，11:50 停到 12:10 仍显示「早上好」——必须自己重算。
  it('A 跨时段：停留跨过整点后心跳重算问候语，且不重拉 profile / 小时没变不重绘', async () => {
    jest.useFakeTimers();
    try {
      readLocalNicknameMock.mockReturnValue('小橙');
      getLocalHourMock.mockReturnValue(11);
      const ctx = makePage();
      ctx.onShow();
      expect(ctx.data.greetingText).toBe('小橙，H11');
      await Promise.resolve();
      const fetchCallsAfterShow = fetchProfileMock.mock.calls.length;

      // 停留跨过 12:00 → 下一次 tick 换成「中午好」，且没有新增 profile 请求
      getLocalHourMock.mockReturnValue(12);
      jest.advanceTimersByTime(60 * 1000);
      expect(ctx.data.greetingText).toBe('小橙，H12');
      expect(fetchProfileMock.mock.calls.length).toBe(fetchCallsAfterShow);

      // 同一小时内再 tick：不重算、不 setData
      const setDataSpy = jest.fn();
      const originSetData = ctx.setData;
      ctx.setData = setDataSpy;
      jest.advanceTimersByTime(60 * 1000);
      expect(setDataSpy).not.toHaveBeenCalled();
      ctx.setData = originSetData;

      // onHide 停表：切走后不再重算
      ctx.onHide();
      getLocalHourMock.mockReturnValue(14);
      jest.advanceTimersByTime(60 * 1000);
      expect(ctx.data.greetingText).toBe('小橙，H12');
    } finally {
      jest.useRealTimers();
    }
  });

  // B：fetchProfile 无守卫 → 页面已销毁仍 setData。
  it('B 卸载后响应：onUnload 之后 fetchProfile 才 resolve，不得再 setData', async () => {
    let resolveProfile: (v: unknown) => void = () => undefined;
    fetchProfileMock.mockImplementation(() => new Promise((r) => { resolveProfile = r; }));
    readLocalNicknameMock.mockReturnValue('小橙');
    const ctx = makePage();
    ctx.onShow(); // 请求发出但未回
    ctx.onUnload(); // 页面销毁

    const afterUnloadSetData = jest.fn();
    ctx.setData = afterUnloadSetData;
    resolveProfile({ id: 1, username: 'u', nickname: '阿橙' });
    await flush();
    expect(afterUnloadSetData).not.toHaveBeenCalled();
  });

  // C：onShow 连触发，旧响应后到会把新昵称刷回去。
  it('C 并发竞态：先发的旧响应后到，不得覆盖后发的新昵称', async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    fetchProfileMock.mockImplementation(() => new Promise((r) => { resolvers.push(r); }));
    const ctx = makePage();
    ctx.onShow(); // 第 1 次
    ctx.onShow(); // 第 2 次
    expect(resolvers.length).toBe(2);

    resolvers[1]({ id: 1, username: 'u', nickname: '新昵称' }); // 后发的先回
    await flush();
    expect(ctx.data.greetingText).toBe('新昵称，H10');

    resolvers[0]({ id: 1, username: 'u', nickname: '旧昵称' }); // 先发的后到 → 必须丢弃
    await flush();
    expect(ctx.data.greetingText).toBe('新昵称，H10');
  });

  // D：本地昵称写一次、profile 回来再写一次，同文案不必重绘（闪变）。
  it('D 双写闪变：profile 收敛出的文案与本地秒显一致时，不再 setData', async () => {
    readLocalNicknameMock.mockReturnValue('小橙');
    fetchProfileMock.mockResolvedValue({ id: 1, username: 'u', nickname: '小橙' });
    const ctx = makePage();
    ctx.onShow();
    expect(ctx.data.greetingText).toBe('小橙，H10');

    const setDataSpy = jest.fn(ctx.setData);
    ctx.setData = setDataSpy;
    await flush();
    expect(ctx.data.greetingText).toBe('小橙，H10');
    expect(setDataSpy).not.toHaveBeenCalled();
  });
});

describe('⑤ P2-1 广播与在途响应竞态（profile:updated 先到 → 旧 fetchProfile 后到不得回跳）', () => {
  // 现场：用户在「我的」页刚改完昵称 → 收「资料已更新」广播（新名字）→
  // 之前 onShow 发出的 fetchProfile（携旧昵称）此刻才 resolve。
  // 只清页面级 _greetSeq 不够：广播 handler 必须自己也推进序号，把在途响应判为过期，
  // 否则文案会被旧响应刷回旧名（真 bug）。
  it('广播(新昵称) → 旧 fetchProfile 后到(旧昵称)：最终必须停留在新昵称，不回跳', async () => {
    let resolveProfile: (v: unknown) => void = () => undefined;
    fetchProfileMock.mockImplementation(() => new Promise((r) => { resolveProfile = r; }));
    const ctx = makePage();
    ctx.onLoad();
    ctx.onShow(); // 发起 fetchProfile（其响应携带的是旧昵称）
    expect(fetchProfileMock).toHaveBeenCalledTimes(1);

    const handler = (handlers['profile:updated'] || [])[0];
    expect(handler).toBeDefined();
    handler!({ nickname: '新昵称' });
    expect(ctx.data.greetingText).toBe('新昵称，H10');

    resolveProfile({ id: 1, username: 'u', nickname: '旧昵称' }); // 在途旧响应后到
    await flush();
    expect(ctx.data.greetingText).toBe('新昵称，H10'); // 必须是新名字，不得回跳
  });
});

describe('② 每日一句：中英配对展示 + 注入能力保持', () => {
  it('data.quote 仍是 { cn, en } 中英配对', () => {
    expect(Object.keys(pageConfig.data.quote).sort()).toEqual(['cn', 'en']);
    expect(pageConfig.data.quote.cn).toBeTruthy();
    expect(pageConfig.data.quote.en).toBeTruthy();
  });

  it('wxml 保留 {{quote.cn}} / {{quote.en}} 双行，真实 UI 无「NCE 课文句」误导文案', () => {
    expect(homeWxml).toContain('{{quote.cn}}');
    expect(homeWxml).toContain('{{quote.en}}');
    expect(homeWxml).not.toMatch(/来自 ?NCE|NCE 课文句/);
  });

  it('册别角标（master 既有能力）不被问候移植挤掉：wxml 仍绑 bookBadge', () => {
    expect(homeWxml).toContain('{{bookBadge}}');
    expect(typeof pageConfig.data.bookBadge).toBe('string');
    expect(pageConfig.data.showBookBadge).toBe(true);
  });
});

describe('③「我的」页移除学习进度（原型 114 / S9 边界）', () => {
  it('wxml 无「课文学习进度」行 / 无 goNce 绑定 / 无 nceSummary', () => {
    expect(mineWxml).not.toContain('课文学习进度');
    expect(mineWxml).not.toContain('goNce');
    expect(mineWxml).not.toContain('nceSummary');
  });

  it('保留收藏/设置/协议/关于四行 + login-gate desc', () => {
    expect(mineWxml).toContain('收藏');
    expect(mineWxml).toContain('设置');
    expect(mineWxml).toContain('用户协议与隐私政策');
    expect(mineWxml).toContain('关于与免责');
    expect(mineWxml).toContain('login-gate');
    expect(mineWxml).toContain('学习进度与收藏都跟着账号走');
  });

  it('mine/index.ts 无 nceSummary 字段 / goNce 方法 / 文件头「课文学习进度」措辞', () => {
    expect(mineTs).not.toMatch(/\bnceSummary\b/);
    expect(mineTs).not.toMatch(/\bgoNce\b/);
    expect(mineTs).not.toContain('课文学习进度');
  });

  it('mine/index.ts 保留刻意注释 / 昵称范式 / profile:updated 订阅退订 import', () => {
    expect(mineTs).toContain('数字一律读真数据');
    expect(mineTs).toContain('readLocalNickname');
    expect(mineTs).toContain('fetchProfile');
    expect(mineTs).toContain('isNicknameUnset');
    expect(mineTs).toContain("'profile:updated'");
  });
});
