/**
 * 自定义 tabBar 高亮「跨实例共享」单测（切 tab 半拍闪跳修复）
 *
 * 断点：自定义 tabBar 组件在每个 tab 页是独立实例（非全局单例），切 tab 后新页面里的
 * 新实例 `data.selected` 回到初始值 0，只能等目标页 onShow 里 setTabBarSelected 登记才恢复
 * —— 中间闪「高亮停在上一项」（半拍）。修复落了一份跨实例共享值 `globalData.tabIndex`：
 *   - utils/tabbar.ts 的 setTabBarSelected 登记时写 globalData.tabIndex；
 *   - custom-tab-bar/index.ts 的 onSwitch 切页前也写 globalData.tabIndex；
 *   - custom-tab-bar/index.ts 的 attached 先读 globalData.tabIndex 立即 setData，命中即恢复。
 *
 * 本文件钉死五条行为（改前对应项必红）：
 *   ① setTabBarSelected 会把 idx 写入 globalData.tabIndex（getApp 不可用时不崩、仍登记当前实例）；
 *   ② attached 命中 globalData.tabIndex 立即高亮，且**不被陈旧页面栈覆盖**（否则半拍复现）；
 *   ③ pageLifetimes.show 命中 globalData 时同样不走 syncFromRoute（官方顺序里 show 在 onShow 之前）；
 *   ④ 首启 globalData.tabIndex 为 undefined 时，syncFromRoute 兜底仍生效；
 *   ⑤ onSwitch 切页前写 globalData.tabIndex 并 switchTab。
 *
 * mock 方式与 mine-profile-sync.test.ts 同源：mock 全局 Component/getApp/wx/getCurrentPages，
 * require 模块捕获配置，再构造最小实例直接驱动生命周期方法。
 */
import { setTabBarSelected } from '../utils/tabbar';

type ComponentCfg = Record<string, any>;
let tabbarCfg: ComponentCfg | null = null;

/** 可变的 app.globalData，便于断言 tabIndex 写入 */
let globalData: Record<string, unknown>;

beforeAll(() => {
  // custom-tab-bar/index.ts 模块加载即执行 Component({...})，先捕获配置
  (globalThis as any).Component = (cfg: ComponentCfg) => {
    tabbarCfg = cfg;
  };
  require('../custom-tab-bar/index');
});

beforeEach(() => {
  jest.clearAllMocks();
  globalData = {
    userInfo: null,
    token: '',
    refreshToken: '',
    apiBase: 'https://dev.example.com',
  };
  (globalThis as any).getApp = () => ({ globalData });
  (globalThis as any).wx = { switchTab: jest.fn() };
  // 默认给一个「旧栈顶 = 首页」的页面栈，用于证明命中 globalData 时不被它覆盖
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: 'pages/home/index/index' }]);
});

/**
 * 构造最小 tabBar 组件实例：data 深拷贝 + setData 合并写回 + methods / lifetimes /
 * pageLifetimes 里的方法全部 bind 到实例（`this.xxx()` 内部自调用要能跑通）。
 */
function makeTabBar(): Record<string, any> {
  const cfg = tabbarCfg as ComponentCfg;
  const instance: Record<string, any> = {
    data: JSON.parse(JSON.stringify(cfg.data || {})),
    setData(this: Record<string, any>, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    },
  };
  const bind = (obj: Record<string, any> | undefined) => {
    Object.keys(obj || {}).forEach((k) => {
      if (typeof obj![k] === 'function') instance[k] = (obj![k] as (...a: unknown[]) => unknown).bind(instance);
    });
  };
  bind(cfg.methods);
  bind(cfg.lifetimes);
  bind(cfg.pageLifetimes);
  return instance;
}

// ---------------------------------------------------------------------------
// ① setTabBarSelected：写 globalData.tabIndex + 登记当前实例
// ---------------------------------------------------------------------------
describe('setTabBarSelected 跨实例共享登记', () => {
  it('把 idx 写入 globalData.tabIndex，并 setData 当前 tabBar 实例', () => {
    const bar: any = { setData: jest.fn() };
    const page: any = { getTabBar: () => bar };

    setTabBarSelected(page, 1);

    expect(globalData.tabIndex).toBe(1);
    expect(bar.setData).toHaveBeenCalledWith({ selected: 1, _registered: true });
  });

  it('getApp 不可用时（抛错）不崩，仍登记当前实例', () => {
    (globalThis as any).getApp = () => {
      throw new Error('app not ready');
    };
    const bar: any = { setData: jest.fn() };
    const page: any = { getTabBar: () => bar };

    expect(() => setTabBarSelected(page, 2)).not.toThrow();
    expect(bar.setData).toHaveBeenCalledWith({ selected: 2, _registered: true });
  });
});

// ---------------------------------------------------------------------------
// ② attached：命中 globalData.tabIndex 立即高亮，不被陈旧栈覆盖
// ---------------------------------------------------------------------------
describe('attached 命中 globalData.tabIndex 立即高亮', () => {
  it('globalData.tabIndex=1 时 attached 直接亮「发现」，即使 getCurrentPages 仍是旧栈顶（首页）', () => {
    globalData.tabIndex = 1; // 刚切到「发现」
    // getCurrentPages 仍返回首页（idx=0）—— 旧逻辑会被 syncFromRoute 覆盖回 0
    (globalThis as any).getCurrentPages = jest.fn(() => [{ route: 'pages/home/index/index' }]);

    const tab = makeTabBar();
    tab.attached();

    expect(tab.data.selected).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ③ pageLifetimes.show：命中 globalData 时不走 syncFromRoute（官方顺序里 show 在 onShow 之前）
// ---------------------------------------------------------------------------
describe('pageLifetimes.show 命中 globalData 时不走 syncFromRoute', () => {
  it('未登记(_registered=false)且 globalData.tabIndex=2 时，show 直接亮「我的」，不被陈旧栈覆盖', () => {
    globalData.tabIndex = 2;
    (globalThis as any).getCurrentPages = jest.fn(() => [{ route: 'pages/home/index/index' }]);

    const tab = makeTabBar();
    tab.show();

    expect(tab.data.selected).toBe(2);
  });

  it('已登记(_registered=true)时 show 不再覆盖', () => {
    globalData.tabIndex = 0; // 陈旧值：已登记时也不应被读
    const tab = makeTabBar();
    tab.data._registered = true;
    tab.data.selected = 1;

    tab.show();

    expect(tab.data.selected).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ④ 首启兜底：globalData.tabIndex 为 undefined 时 syncFromRoute 仍生效
// ---------------------------------------------------------------------------
describe('首启 globalData.tabIndex 未登记时 syncFromRoute 兜底', () => {
  it('globalData.tabIndex 为 undefined 时，从页面栈推导出「发现」=1', () => {
    // 首启：globalData 里没有 tabIndex
    (globalThis as any).getCurrentPages = jest.fn(() => [{ route: 'pages/discover/index/index' }]);

    const tab = makeTabBar();
    tab.attached();

    expect(tab.data.selected).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ⑤ onSwitch：切页前写 globalData + 乐观高亮 + switchTab
// ---------------------------------------------------------------------------
describe('onSwitch 切 tab 前写 globalData', () => {
  it('点「发现」时把 idx=1 写入 globalData 并 switchTab', () => {
    globalData.tabIndex = 0;
    const tab = makeTabBar();

    tab.onSwitch({
      currentTarget: { dataset: { path: '/pages/discover/index/index', index: '1', istab: '1' } },
    });

    expect(globalData.tabIndex).toBe(1);
    expect(tab.data.selected).toBe(1);
    expect((globalThis as any).wx.switchTab).toHaveBeenCalledWith({
      url: '/pages/discover/index/index',
    });
  });
});
