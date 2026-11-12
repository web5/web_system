/**
 * 自定义 tabBar「双击发现 tab」暗门单测（PRD v0.2 §4）。
 *
 * 钉死五条行为：
 *   ① 双击（间隔 ≤500ms）未解锁 → 震动 + 写 labs_unlocked（入口卡常驻），不直接跳设置页；
 *   ② 单击 → 正常 switchTab，不触发解锁；
 *   ③ 两次点击间隔 >500ms → 重置计数，不解锁；
 *   ④ 已解锁 + 再次双击 → 直接 navigateTo 功能设置页（快捷方式），不重复写存储；
 *   ⑤ 双击非「发现」tab → 完全不参与判定。
 *
 * mock 方式与 tabbar-highlight.test.ts 同源：mock 全局 Component 捕获配置，构造最小实例驱动。
 * 注意：双击判定的时间戳是模块级单例（跨组件实例续判），各用例通过推进 mock 时间隔离。
 */
export {};

const store = new Map<string, string>();

let now = 1_000_000;

const wxMock = {
  switchTab: jest.fn(),
  navigateTo: jest.fn(),
  vibrateShort: jest.fn(),
  getStorageSync: jest.fn((k: string) => (store.has(k) ? store.get(k) : '')),
  setStorageSync: jest.fn((k: string, v: string) => {
    store.set(k, v);
  }),
};

let tabbarCfg: Record<string, any> = null as any;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).getApp = () => ({ eventBus: { on: jest.fn(), off: jest.fn(), emit: jest.fn() } });
  (globalThis as any).Component = (cfg: Record<string, any>) => {
    tabbarCfg = cfg;
  };
  require('../custom-tab-bar/index');
});

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  // 推进时间，确保与上一用例的点击间隔 > 500ms（模块级时间戳归位）
  now += 10_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  (Date.now as jest.Mock).mockRestore?.();
});

/** 构造最小 tabBar 组件实例（methods bind 到实例，内部 this.xxx 自调用可跑通） */
function makeTabBar(): Record<string, any> {
  const instance: Record<string, any> = {
    data: JSON.parse(JSON.stringify(tabbarCfg.data || {})),
    setData(this: Record<string, any>, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    },
  };
  Object.keys(tabbarCfg.methods || {}).forEach((k) => {
    instance[k] = tabbarCfg.methods[k].bind(instance);
  });
  return instance;
}

/** 模拟一次 tab 点击（默认「发现」tab） */
function tap(bar: Record<string, any>, key = 'discover') {
  bar.onSwitch({
    currentTarget: {
      dataset: { path: '/pages/discover/index/index', index: '1', istab: '1', key },
    },
  });
}

describe('双击发现 tab 暗门', () => {
  it('① 双击未解锁 → 震动 + 写 labs_unlocked，不直接跳设置页', () => {
    const bar = makeTabBar();
    tap(bar); // 单击：仅计时
    expect(store.has('labs_unlocked')).toBe(false);
    now += 300;
    tap(bar); // 300ms 后第二击：双击成立
    expect(wxMock.vibrateShort).toHaveBeenCalledWith({ type: 'light' });
    expect(store.get('labs_unlocked')).toBe('1');
    expect(wxMock.navigateTo).not.toHaveBeenCalled();
    // 单击行为不受影响：两次都正常 switchTab
    expect(wxMock.switchTab).toHaveBeenCalledTimes(2);
  });

  it('② 单击 → 仅 switchTab，不解锁', () => {
    const bar = makeTabBar();
    tap(bar);
    expect(wxMock.switchTab).toHaveBeenCalledWith({ url: '/pages/discover/index/index' });
    expect(store.has('labs_unlocked')).toBe(false);
    expect(wxMock.vibrateShort).not.toHaveBeenCalled();
  });

  it('③ 间隔 >500ms → 重置计数，不解锁', () => {
    const bar = makeTabBar();
    tap(bar);
    now += 600;
    tap(bar);
    expect(store.has('labs_unlocked')).toBe(false);
    expect(wxMock.vibrateShort).not.toHaveBeenCalled();
    // 第三击与第二击间隔 300ms：此时才构成双击
    now += 300;
    tap(bar);
    expect(store.get('labs_unlocked')).toBe('1');
  });

  it('④ 已解锁 + 再次双击 → 直接进功能设置页，不重复写存储', () => {
    store.set('labs_unlocked', '1');
    const bar = makeTabBar();
    tap(bar);
    now += 200;
    tap(bar);
    expect(wxMock.vibrateShort).toHaveBeenCalledWith({ type: 'light' });
    expect(wxMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/discover/settings/settings' });
    expect(wxMock.setStorageSync).not.toHaveBeenCalled();
  });

  it('⑤ 双击非「发现」tab → 不参与判定', () => {
    const bar = makeTabBar();
    tap(bar, 'home');
    now += 100;
    tap(bar, 'home');
    expect(store.has('labs_unlocked')).toBe(false);
    expect(wxMock.vibrateShort).not.toHaveBeenCalled();
    expect(wxMock.navigateTo).not.toHaveBeenCalled();
  });
});
