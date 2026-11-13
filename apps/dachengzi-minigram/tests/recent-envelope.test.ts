/**
 * 首页 loadRecent 的「最近会话」两路合并语义单测：并发查 chat + tool 再按 updatedAt 取最新。
 *
 * 背景（根因核对结论）：
 * - 后端 /api/ai-agent/agent/conversations 列表**成功时直返 { list, total }**，
 *   没有 { code, data } 信封（servers/ai-agent/.../agent-conversation-query.service.ts:58）。
 * - 但 ai-agent 全局异常过滤器 UnifiedExceptionFilter 会把**一切异常**统一转成
 *   HTTP 200 + { code, message, data: null }（unified-exception.filter.ts:55-59）。
 * - 前端 utils/request.ts 已识别该错误信封并 reject（见 request-envelope.test.ts）。
 * - 列表接口按 source 过滤且默认只查 source='chat'，会漏掉 source='tool' 的翻译会话。
 *   首页因此改为并发查 chat + tool 两路，再按 updatedAt 倒序合并取最新一条。
 * - 本测试钉死两路合并语义：谁有取谁、都有取更新者、都空真空态、都 reject 异常态。
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

/** 列表项最小结构（与 ConversationSummary 对齐，测试内声明避免 any） */
interface SummaryItem {
  id: string;
  title: string | null;
  updatedAt: string;
}

interface ListResult {
  list: SummaryItem[];
  total: number;
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

/**
 * 按 source 指定两路返回：chat/tool 传 ListResult 表示该路成功；传 null 表示该路 reject。
 */
function mockBySource(chat: ListResult | null, tool: ListResult | null): void {
  agentApiMock.listConversations.mockImplementation(
    (_page: number, _pageSize: number, source: 'chat' | 'tool') => {
      const result = source === 'chat' ? chat : tool;
      if (result === null) return Promise.reject(new Error(`reject:${source}`));
      return Promise.resolve(result);
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  isLoggedInMock.mockReturnValue(true);
  createAgentApiMock.mockReturnValue(agentApiMock);
  agentApiMock.listConversations.mockReset();
  agentApiMock.getConversation.mockReset();
  agentApiMock.getConversation.mockResolvedValue({ messages: [] });
  wxMock.getStorageSync.mockReset();
  // 钉「对话练习」开关开启后的链路：feature_chat 恒为 '1'，其余 key 按无缓存处理
  wxMock.getStorageSync.mockImplementation((k: string) => (k === 'feature_chat' ? '1' : undefined));
  wxMock.setStorageSync.mockReset();
  wxMock.removeStorageSync.mockReset();
});

describe('loadRecent 两路（chat/tool）合并语义', () => {
  it('chat 有 + tool 空：取 chat 会话', async () => {
    mockBySource(
      { list: [{ id: 'chat-1', title: '主对话', updatedAt: '2026-01-15T10:00:00' }], total: 1 },
      { list: [], total: 0 },
    );

    const ctx = makeThis();
    await pageConfig!.loadRecent.call(ctx);

    expect(ctx.data.recent?.id).toBe('chat-1');
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recentError).toBe(false);
  });

  it('chat 空 + tool 有：取 tool 会话（翻译会话不再被漏掉）', async () => {
    mockBySource(
      { list: [], total: 0 },
      { list: [{ id: 'tool-1', title: '翻译会话', updatedAt: '2026-01-15T10:00:00' }], total: 1 },
    );

    const ctx = makeThis();
    await pageConfig!.loadRecent.call(ctx);

    expect(ctx.data.recent?.id).toBe('tool-1');
    expect(ctx.data.recentError).toBe(false);
  });

  it('两路都有：取 updatedAt 更新者（tool 更新）', async () => {
    mockBySource(
      { list: [{ id: 'chat-old', title: '旧主对话', updatedAt: '2026-01-15T08:00:00' }], total: 1 },
      { list: [{ id: 'tool-new', title: '新翻译', updatedAt: '2026-01-15T12:00:00' }], total: 1 },
    );

    const ctx = makeThis();
    await pageConfig!.loadRecent.call(ctx);

    expect(ctx.data.recent?.id).toBe('tool-new');
  });

  it('两路都有：取 updatedAt 更新者（chat 更新）', async () => {
    mockBySource(
      { list: [{ id: 'chat-new', title: '新主对话', updatedAt: '2026-01-15T12:00:00' }], total: 1 },
      { list: [{ id: 'tool-old', title: '旧翻译', updatedAt: '2026-01-15T08:00:00' }], total: 1 },
    );

    const ctx = makeThis();
    await pageConfig!.loadRecent.call(ctx);

    expect(ctx.data.recent?.id).toBe('chat-new');
  });

  it('两路都空：真·空态（recentError=false，清缓存）', async () => {
    mockBySource({ list: [], total: 0 }, { list: [], total: 0 });

    const ctx = makeThis();
    await pageConfig!.loadRecent.call(ctx);

    expect(ctx.data.recent).toBeNull();
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recentError).toBe(false);
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('welcome_recent_cache');
  });

  it('两路都 reject：异常态（recentError=true，不清缓存）', async () => {
    mockBySource(null, null);

    const ctx = makeThis();
    await pageConfig!.loadRecent.call(ctx);

    expect(ctx.data.recent).toBeNull();
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recentError).toBe(true);
    expect(wxMock.removeStorageSync).not.toHaveBeenCalledWith('welcome_recent_cache');
  });

  it('一路 reject + 一路有：容忍部分失败，取成功那路', async () => {
    mockBySource(
      { list: [{ id: 'chat-1', title: '主对话', updatedAt: '2026-01-15T10:00:00' }], total: 1 },
      null,
    );

    const ctx = makeThis();
    await pageConfig!.loadRecent.call(ctx);

    expect(ctx.data.recent?.id).toBe('chat-1');
    expect(ctx.data.recentError).toBe(false);
  });
});
