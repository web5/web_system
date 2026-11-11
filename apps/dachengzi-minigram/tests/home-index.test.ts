/**
 * 首页 index.ts 页面方法单测（loadRecent / openConv / formatTime）。
 *
 * 说明：formatTime / loadRecent / openConv 都在 pages/home/index/index.ts 内部，
 * 未导出（formatTime 是模块级私有函数，loadRecent/openConv 是 Page 配置的方法），
 * 这里通过 mock 全局 Page 捕获配置对象、mock wx / services 依赖来直接驱动方法，
 * 不改业务代码。
 */
jest.mock('../services/auth', () => ({ isLoggedIn: jest.fn() }));
jest.mock('../services/agent-stream', () => ({ createAgentApi: jest.fn() }));

import { isLoggedIn } from '../services/auth';
import { createAgentApi } from '../services/agent-stream';

const isLoggedInMock = isLoggedIn as unknown as jest.Mock;
const createAgentApiMock = createAgentApi as unknown as jest.Mock;

const wxMock = {
  getStorageSync: jest.fn(),
  setStorageSync: jest.fn(),
  removeStorageSync: jest.fn(),
  navigateTo: jest.fn(),
  showToast: jest.fn(),
  switchTab: jest.fn(),
};

const agentApiMock = {
  listConversations: jest.fn(),
  getConversation: jest.fn(),
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
  createAgentApiMock.mockReturnValue(agentApiMock);
  agentApiMock.listConversations.mockReset();
  agentApiMock.getConversation.mockReset();
  wxMock.getStorageSync.mockReset();
  wxMock.getStorageSync.mockReturnValue(undefined);
  wxMock.setStorageSync.mockReset();
  wxMock.removeStorageSync.mockReset();
  wxMock.navigateTo.mockReset();
});

/** 构造一个带 setData 的页面上下文（this） */
function makeThis() {
  const data = { ...pageConfig.data, recent: null, recentLoading: true };
  return {
    data,
    setData: jest.fn(function (this: any, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    }),
  };
}

describe('loadRecent（最近对话 stale-while-revalidate）', () => {
  it('未登录：不发请求，直接空态', async () => {
    isLoggedInMock.mockReturnValue(false);
    const ctx = makeThis();
    await pageConfig.loadRecent.call(ctx);
    expect(ctx.data.recent).toBeNull();
    expect(ctx.data.recentLoading).toBe(false);
    expect(createAgentApiMock).not.toHaveBeenCalled();
    expect(agentApiMock.listConversations).not.toHaveBeenCalled();
  });

  it('有缓存：先秒显缓存（recentLoading=false），再后台刷新', async () => {
    wxMock.getStorageSync.mockReturnValue({
      id: 'cached-1',
      title: '缓存标题',
      preview: '缓存预览',
      timeText: '09:00',
    });
    agentApiMock.listConversations.mockResolvedValue({ list: [], total: 0 });
    const ctx = makeThis();
    await pageConfig.loadRecent.call(ctx);
    // 最终因后台刷新返回空会话，缓存被清、回空态
    expect(agentApiMock.listConversations).toHaveBeenCalledWith(1, 1, 'chat');
    expect(agentApiMock.listConversations).toHaveBeenCalledWith(1, 1, 'tool');
    expect(ctx.data.recent).toBeNull();
    expect(ctx.data.recentLoading).toBe(false);
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('welcome_recent_cache');
  });

  it('空会话（无记录）：清缓存 + 空态', async () => {
    agentApiMock.listConversations.mockResolvedValue({ list: [], total: 0 });
    const ctx = makeThis();
    await pageConfig.loadRecent.call(ctx);
    expect(ctx.data.recent).toBeNull();
    expect(ctx.data.recentLoading).toBe(false);
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('welcome_recent_cache');
  });

  it('有会话：渲染卡片（标题 + 预览 + 时间）+ 写回缓存', async () => {
    agentApiMock.listConversations.mockResolvedValue({
      list: [{ id: 'conv-9', title: '翻译练习', updatedAt: '2026-01-15T10:30:00' }],
      total: 1,
    });
    agentApiMock.getConversation.mockResolvedValue({
      messages: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '  你好呀，\n有什么可以帮你？  ' },
      ],
    });
    const ctx = makeThis();
    await pageConfig.loadRecent.call(ctx);
    expect(ctx.data.recent.id).toBe('conv-9');
    expect(ctx.data.recent.title).toBe('翻译练习');
    // 预览取最后一条 assistant 内容，空白折叠 + 截断
    expect(ctx.data.recent.preview).toBe('你好呀， 有什么可以帮你？');
    expect(ctx.data.recentLoading).toBe(false);
    expect(wxMock.setStorageSync).toHaveBeenCalledWith(
      'welcome_recent_cache',
      expect.objectContaining({ id: 'conv-9' }),
    );
  });

  it('title 为空 → 兜底「（无标题）」', async () => {
    agentApiMock.listConversations.mockResolvedValue({
      list: [{ id: 'conv-0', title: null, updatedAt: '2026-01-15T10:30:00' }],
      total: 1,
    });
    agentApiMock.getConversation.mockResolvedValue({ messages: [] });
    const ctx = makeThis();
    await pageConfig.loadRecent.call(ctx);
    expect(ctx.data.recent.title).toBe('（无标题）');
    expect(ctx.data.recent.preview).toBe('');
  });

  it('详情拉取失败：退回只显示标题，不整体失败', async () => {
    agentApiMock.listConversations.mockResolvedValue({
      list: [{ id: 'conv-1', title: '标题在', updatedAt: '2026-01-15T10:30:00' }],
      total: 1,
    });
    agentApiMock.getConversation.mockRejectedValue(new Error('boom'));
    const ctx = makeThis();
    await pageConfig.loadRecent.call(ctx);
    expect(ctx.data.recent.id).toBe('conv-1');
    expect(ctx.data.recent.title).toBe('标题在');
    expect(ctx.data.recent.preview).toBe('');
    expect(ctx.data.recentLoading).toBe(false);
  });

  it('列表接口失败：整块隐藏（recent=null + 骨架关），不误读为空态文案', async () => {
    agentApiMock.listConversations.mockRejectedValue(new Error('network'));
    const ctx = makeThis();
    await pageConfig.loadRecent.call(ctx);
    expect(ctx.data.recent).toBeNull();
    expect(ctx.data.recentLoading).toBe(false);
    expect(wxMock.setStorageSync).not.toHaveBeenCalled();
  });
});

describe('openConv（点最近对话卡片恢复会话）', () => {
  it('携带 conversationId 进对话页', () => {
    const ctx = makeThis();
    pageConfig.openConv.call(ctx, { currentTarget: { dataset: { id: 'conv-123' } } });
    expect(wxMock.navigateTo).toHaveBeenCalledWith({
      url: '/pages/chat/index/index?conversationId=conv-123',
    });
  });

  it('id 含特殊字符 → encodeURIComponent 编码', () => {
    pageConfig.openConv.call(null, { currentTarget: { dataset: { id: 'a/b?c=1&d' } } });
    expect(wxMock.navigateTo).toHaveBeenCalledWith({
      url: '/pages/chat/index/index?conversationId=' + encodeURIComponent('a/b?c=1&d'),
    });
  });

  it('id 为空 → 不跳转', () => {
    pageConfig.openConv.call(null, { currentTarget: { dataset: { id: '' } } });
    expect(wxMock.navigateTo).not.toHaveBeenCalled();
  });

  it('event 结构缺失 → 不跳转', () => {
    pageConfig.openConv.call(null, {});
    expect(wxMock.navigateTo).not.toHaveBeenCalled();
  });
});

describe('formatTime（经 loadRecent 的 timeText 输出验证）', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('今天 → HH:mm', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 15, 18, 0, 0));
    agentApiMock.listConversations.mockResolvedValue({
      list: [{ id: 'c', title: 't', updatedAt: '2026-01-15T10:30:00' }],
      total: 1,
    });
    agentApiMock.getConversation.mockResolvedValue({ messages: [] });
    const ctx = makeThis();
    await pageConfig.loadRecent.call(ctx);
    expect(ctx.data.recent.timeText).toBe('10:30');
  });

  it('昨天 → 昨天', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 15, 18, 0, 0));
    agentApiMock.listConversations.mockResolvedValue({
      list: [{ id: 'c', title: 't', updatedAt: '2026-01-14T22:00:00' }],
      total: 1,
    });
    agentApiMock.getConversation.mockResolvedValue({ messages: [] });
    const ctx = makeThis();
    await pageConfig.loadRecent.call(ctx);
    expect(ctx.data.recent.timeText).toBe('昨天');
  });

  it('跨年更早 → YYYY/M/D', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 15, 18, 0, 0));
    agentApiMock.listConversations.mockResolvedValue({
      list: [{ id: 'c', title: 't', updatedAt: '2025-12-31T08:00:00' }],
      total: 1,
    });
    agentApiMock.getConversation.mockResolvedValue({ messages: [] });
    const ctx = makeThis();
    await pageConfig.loadRecent.call(ctx);
    expect(ctx.data.recent.timeText).toBe('2025/12/31');
  });
});

describe('auth:logged 订阅（首启静默登录后重拉 loadRecent）', () => {
  afterEach(() => {
    delete (globalThis as { getApp?: unknown }).getApp;
  });

  it('onLoad 订阅 auth:logged，收到广播后重拉 loadRecent', () => {
    const handlers: Record<string, Array<() => void>> = {};
    const bus = {
      on: jest.fn((e: string, h: () => void) => {
        (handlers[e] || (handlers[e] = [])).push(h);
      }),
      off: jest.fn(),
      emit: jest.fn((e: string) => {
        (handlers[e] || []).forEach((h) => h());
      }),
    };
    (globalThis as { getApp?: unknown }).getApp = () => ({ eventBus: bus });

    const loadRecentSpy = jest.fn(async () => undefined);
    const ctx = { ...makeThis(), loadRecent: loadRecentSpy };

    pageConfig.onLoad.call(ctx);

    expect(bus.on).toHaveBeenCalledWith('auth:logged', expect.any(Function));

    // 模拟登录成功广播：应触发 loadRecent 重拉
    bus.emit('auth:logged');
    expect(loadRecentSpy).toHaveBeenCalledTimes(1);
  });
});
