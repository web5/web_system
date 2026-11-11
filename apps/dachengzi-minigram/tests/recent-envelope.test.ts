/**
 * 首页 loadRecent 对「列表接口返回结构」的敏感度单测（直返 vs 空列表 vs 信封/结构异常）。
 *
 * 背景（根因核对结论）：
 * - 后端 /api/ai-agent/agent/conversations 列表**成功时直返 { list, total }**，
 *   没有 { code, data } 信封（servers/ai-agent/.../agent-conversation-query.service.ts:58）。
 * - 但 ai-agent 全局异常过滤器 UnifiedExceptionFilter 会把**一切异常**统一转成
 *   HTTP 200 + { code, message, data: null }（unified-exception.filter.ts:55-59）。
 * - 前端 utils/request.ts 已识别该错误信封并 reject（见 request-envelope.test.ts），
 *   本测试钉死 loadRecent 对「res.list 非数组」的防御：结构异常 → 异常态（recentError=true），
 *   而非误判成「暂无记录」空态（recentError=false）。
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

/** 与 pages/home/index/index.ts 的 Recent 接口对齐（测试内最小声明，避免 any） */
interface RecentShape {
  id: string;
  title: string;
  preview: string;
  timeText: string;
}

interface HomeData {
  recent: RecentShape | null;
  recentLoading: boolean;
  recentError: boolean;
  [key: string]: unknown;
}

interface PageCtx {
  data: HomeData;
  setData(patch: Record<string, unknown>): void;
}

/** 只声明本测试用到的页面配置成员，避免把整个 Page 配置类型 any 化 */
interface HomePageConfig {
  data: HomeData;
  loadRecent(this: PageCtx): Promise<void>;
}

let pageConfig: HomePageConfig | null = null;

beforeAll(() => {
  (globalThis as unknown as { wx: unknown }).wx = wxMock;
  (globalThis as unknown as { Page: unknown }).Page = jest.fn((cfg: HomePageConfig) => {
    pageConfig = cfg;
  });
  // 模块加载即执行 Page({...})，捕获配置
  require('../pages/home/index/index');
});

function makeThis(): PageCtx {
  const data: HomeData = { recent: null, recentLoading: true, recentError: false };
  return {
    data,
    setData(patch) {
      Object.assign(data, patch);
    },
  };
}

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
});

describe('loadRecent 对列表返回形态的敏感度（直返 vs 空列表 vs 信封/结构异常）', () => {
  it('直返 { list, total }：能渲染最近卡片，且非异常态', async () => {
    agentApiMock.listConversations.mockResolvedValue({
      list: [{ id: 'conv-1', title: '直返标题', updatedAt: '2026-01-15T10:30:00' }],
      total: 1,
    });
    agentApiMock.getConversation.mockResolvedValue({ messages: [] });

    const ctx = makeThis();
    await pageConfig!.loadRecent.call(ctx);

    expect(ctx.data.recent?.id).toBe('conv-1');
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recentError).toBe(false);
  });

  it('空列表 { list: [], total: 0 }：真·空态（recentError=false）', async () => {
    agentApiMock.listConversations.mockResolvedValue({ list: [], total: 0 });

    const ctx = makeThis();
    await pageConfig!.loadRecent.call(ctx);

    expect(ctx.data.recent).toBeNull();
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recentError).toBe(false);
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('welcome_recent_cache');
  });

  it('错误信封 { code: 4010, message, data: null }：结构异常 → recentError=true，不显示空态', async () => {
    agentApiMock.listConversations.mockResolvedValue({
      code: 4010,
      message: 'Authorization header missing',
      data: null,
    });

    const ctx = makeThis();
    await pageConfig!.loadRecent.call(ctx);

    expect(ctx.data.recent).toBeNull();
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recentError).toBe(true);
    // 异常态不清空本地缓存（不误删上次的成功缓存）
    expect(wxMock.removeStorageSync).not.toHaveBeenCalledWith('welcome_recent_cache');
  });

  it('结构异常（res.list 非数组）：recentError=true', async () => {
    agentApiMock.listConversations.mockResolvedValue({ code: 0, data: { list: [], total: 0 } });

    const ctx = makeThis();
    await pageConfig!.loadRecent.call(ctx);

    expect(ctx.data.recent).toBeNull();
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recentError).toBe(true);
  });
});
