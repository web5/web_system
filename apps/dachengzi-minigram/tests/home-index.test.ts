/**
 * 首页 index.ts 页面方法单测（整改后）。
 *
 * 覆盖：常用功能渲染（refreshPinned 读 utils/features 的 getPinned 默认回退）、
 * 点卡跳转（goFeature 按 path navigateTo + needLogin 未登录引导）、
 * 「更多功能」跳发现、分享标题中性化。
 *
 * 说明：refreshPinned / goFeature / goMore 都在 pages/home/index/index.ts 内部
 * （Page 配置方法），这里通过 mock 全局 Page 捕获配置对象、mock wx / auth 依赖来直接
 * 驱动方法，不改业务代码。utils/features 用真模块（仅依赖 wx.getStorageSync）。
 */
jest.mock('../services/auth', () => ({ isLoggedIn: jest.fn() }));
jest.mock('../utils/tabbar', () => ({
  setTabBarSelected: jest.fn(),
  TAB_INDEX: { home: 0, discover: 1, mine: 2 },
}));

import { isLoggedIn } from '../services/auth';

const isLoggedInMock = isLoggedIn as unknown as jest.Mock;

const wxMock = {
  getStorageSync: jest.fn(),
  setStorageSync: jest.fn(),
  removeStorageSync: jest.fn(),
  navigateTo: jest.fn(),
  showToast: jest.fn(),
  switchTab: jest.fn(),
};

let pageConfig: any = null;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).Page = jest.fn((cfg: any) => {
    pageConfig = cfg;
  });
  // 模块加载即执行 Page({...})，捕获配置
  require('../pages/home/index/index');
});

beforeEach(() => {
  jest.clearAllMocks();
  isLoggedInMock.mockReturnValue(true);
  // 无 feature_pinned 存储 → getPinned 回退 defaultPinned 集合（仅 nce）
  wxMock.getStorageSync.mockImplementation(() => '');
  wxMock.navigateTo.mockReset();
  wxMock.switchTab.mockReset();
  wxMock.showToast.mockReset();
});

/** 构造一个带 setData 的页面上下文（this） */
function makeThis() {
  const data = { ...pageConfig.data, features: [] };
  return {
    data,
    setData: jest.fn(function (this: any, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    }),
  };
}

describe('refreshPinned（常用功能渲染）', () => {
  it('默认 pin nce：常用功能只渲染新概念英语', () => {
    const ctx = makeThis();
    pageConfig.refreshPinned.call(ctx);
    expect(ctx.data.features).toHaveLength(1);
    expect(ctx.data.features[0].id).toBe('nce');
    expect(ctx.data.features[0].path).toBe('/pages/nce/index/index');
  });

  it('storage 有 pinned 时按 storage 渲染（含收藏）', () => {
    wxMock.getStorageSync.mockImplementation((k: string) =>
      k === 'feature_pinned' ? ['glossary', 'nce'] : '',
    );
    const ctx = makeThis();
    pageConfig.refreshPinned.call(ctx);
    expect(ctx.data.features.map((f: { id: string }) => f.id)).toEqual(['nce', 'glossary']);
  });
});

describe('goFeature（点常用功能卡跳转）', () => {
  it('按 path navigateTo', () => {
    pageConfig.goFeature.call(null, {
      currentTarget: { dataset: { path: '/pages/nce/index/index' } },
    });
    expect(wxMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/nce/index/index' });
  });

  it('needLogin 功能未登录 → toast + 引导到「我的」，不跳转', () => {
    isLoggedInMock.mockReturnValue(false);
    pageConfig.goFeature.call(null, {
      currentTarget: { dataset: { path: '/pages/mine/glossary/index' } },
    });
    expect(wxMock.showToast).toHaveBeenCalled();
    expect(wxMock.switchTab).toHaveBeenCalledWith({ url: '/pages/mine/index/index' });
    expect(wxMock.navigateTo).not.toHaveBeenCalled();
  });

  it('path 不存在 → 不跳转', () => {
    pageConfig.goFeature.call(null, { currentTarget: { dataset: { path: '/nope' } } });
    expect(wxMock.navigateTo).not.toHaveBeenCalled();
  });
});

describe('goMore / onShareAppMessage', () => {
  it('更多功能 → switchTab 发现', () => {
    pageConfig.goMore.call(null);
    expect(wxMock.switchTab).toHaveBeenCalledWith({ url: '/pages/discover/index/index' });
  });

  it('分享标题中性化 = 大橙子英语', () => {
    expect(pageConfig.onShareAppMessage.call(null)).toEqual({
      title: '大橙子英语',
      path: '/pages/home/index/index',
    });
  });
});
