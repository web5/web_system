/**
 * 首页 loadRecent 的「硬超时兜底」与并发轮次（seq）防覆盖单测 —— 台账 #8687。
 *
 * 缺陷事实（诊断 §2.1）：loadRecent 有 6 个出口，其中 5 个都 setData({recentLoading:false})，
 * 也就是说 loading 的关闭 **100% 依赖两个 await 返回**。只要有一个 await 永不 settle
 * （最可能是 request() 里 await loginEnsurer() 因 wx.login 不回调而永久 pending），
 * 骨架屏就永久驻留：不报错、无 toast、连「加载失败，点此重试」都等不到。
 *
 * 本用例集钉死两条契约：
 *   1. 无论请求为何不返回，12s 内必须退出骨架屏并转异常态；
 *   2. 多轮并发时，过期轮次的计时器 / 迟到回调不得覆盖当前轮次的状态。
 *
 * ⚠️ RECENT_LOAD_TIMEOUT 与 pages/home/index/index.ts 的常量必须一致（此处是契约值）。
 */
jest.mock('../services/auth', () => ({ isLoggedIn: jest.fn() }));
jest.mock('../services/agent-stream', () => ({ createAgentApi: jest.fn() }));

import { isLoggedIn } from '../services/auth';
import { createAgentApi } from '../services/agent-stream';

const isLoggedInMock = isLoggedIn as unknown as jest.Mock;
const createAgentApiMock = createAgentApi as unknown as jest.Mock;

/** 硬超时阈值（契约值，须与页面常量 RECENT_LOAD_TIMEOUT 一致） */
const RECENT_LOAD_TIMEOUT = 12_000;

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

/** 永不 settle 的 Promise —— 模拟「await 永不返回」 */
function hang<T = never>(): Promise<T> {
  return new Promise<T>(() => {
    /* 故意既不 resolve 也不 reject */
  });
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

afterEach(() => {
  jest.useRealTimers();
});

describe('loadRecent 硬超时兜底（骨架屏必在 12s 内退出）', () => {
  it('两路请求永不返回 → 12s 超时后 recentLoading=false + recentError=true', async () => {
    jest.useFakeTimers();
    agentApiMock.listConversations.mockImplementation(() => hang());

    const ctx = makeThis();
    // 注意：不能 await —— 该轮 Promise 永不 settle（这正是缺陷本身）
    void pageConfig!.loadRecent.call(ctx);

    // 12s 之前仍在 loading（保持原有「静默加载」体验，不提前闪错误态）
    await jest.advanceTimersByTimeAsync(RECENT_LOAD_TIMEOUT - 1);
    expect(ctx.data.recentLoading).toBe(true);
    expect(ctx.data.recentError).toBe(false);

    // 到点必须退出骨架屏，转「加载失败，点此重试」
    await jest.advanceTimersByTimeAsync(1);
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recentError).toBe(true);
    expect(ctx.data.recent).toBeNull();
  });

  it('详情接口永不返回（列表已成功）→ 同样 12s 内退出骨架屏', async () => {
    jest.useFakeTimers();
    agentApiMock.listConversations.mockResolvedValue({
      list: [{ id: 'conv-1', title: '标题在', updatedAt: '2026-01-15T10:00:00' }],
      total: 1,
    });
    agentApiMock.getConversation.mockImplementation(() => hang());

    const ctx = makeThis();
    void pageConfig!.loadRecent.call(ctx);

    await jest.advanceTimersByTimeAsync(RECENT_LOAD_TIMEOUT);
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recentError).toBe(true);
  });

  it('有缓存 + 两路永不返回 → 12s 后保留缓存卡片，只关 loading 不置错误态', async () => {
    jest.useFakeTimers();
    const cached = { id: 'cached-1', title: '缓存标题', preview: '缓存预览', timeText: '09:00' };
    wxMock.getStorageSync.mockImplementation((k: string) =>
      k === 'feature_chat' ? '1' : k === 'welcome_recent_cache' ? cached : undefined,
    );
    agentApiMock.listConversations.mockImplementation(() => hang());

    const ctx = makeThis();
    void pageConfig!.loadRecent.call(ctx);
    // 缓存秒显：进来时就已经没有骨架屏了
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recent?.id).toBe('cached-1');

    await jest.advanceTimersByTimeAsync(RECENT_LOAD_TIMEOUT);

    // 超时不得把用户已经看到的内容拿掉（那比不兜底更差）
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recent?.id).toBe('cached-1');
    expect(ctx.data.recent?.title).toBe('缓存标题');
    expect(ctx.data.recentError).toBe(false);
  });
});

describe('loadRecent 并发轮次（seq）防覆盖', () => {
  it('两轮都悬挂：第一轮计时器到点不得关掉第二轮的 loading', async () => {
    jest.useFakeTimers();
    agentApiMock.listConversations.mockImplementation(() => hang());

    const ctx = makeThis();
    void pageConfig!.loadRecent.call(ctx); // 第 1 轮（seq=1）
    await jest.advanceTimersByTimeAsync(RECENT_LOAD_TIMEOUT - 1_000);
    expect(ctx.data.recentLoading).toBe(true);

    void pageConfig!.loadRecent.call(ctx); // 第 2 轮（seq=2），起点 t=11s
    // t=12s：第 1 轮的计时器到点 —— 它是过期轮次，不得关闭第 2 轮的 loading
    await jest.advanceTimersByTimeAsync(1_000);
    expect(ctx.data.recentLoading).toBe(true);
    expect(ctx.data.recentError).toBe(false);

    // t=23s：第 2 轮自己的 12s 到点 → 由第 2 轮决定状态
    await jest.advanceTimersByTimeAsync(RECENT_LOAD_TIMEOUT);
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recentError).toBe(true);
  });

  it('第一轮迟到返回：不得覆盖第二轮已渲染的结果', async () => {
    jest.useFakeTimers();
    /** 第 1 轮两路的 settle 句柄（模拟迟到返回） */
    const deferred: Array<(v: unknown) => void> = [];
    const hangCaptured = () =>
      new Promise<unknown>((resolve) => {
        deferred.push(resolve as (v: unknown) => void);
      });

    agentApiMock.listConversations
      // 第 1 轮：chat / tool 都悬挂
      .mockImplementationOnce(hangCaptured)
      .mockImplementationOnce(hangCaptured)
      // 第 2 轮：chat 有新会话，tool 空
      .mockImplementationOnce(() =>
        Promise.resolve({
          list: [{ id: 'conv-2', title: '新一轮', updatedAt: '2026-01-15T12:00:00' }],
          total: 1,
        }),
      )
      .mockImplementationOnce(() => Promise.resolve({ list: [], total: 0 }));

    const ctx = makeThis();
    void pageConfig!.loadRecent.call(ctx); // 第 1 轮：卡在 Promise.all
    await pageConfig!.loadRecent.call(ctx); // 第 2 轮：正常完成
    expect(ctx.data.recent?.id).toBe('conv-2');
    expect(ctx.data.recentLoading).toBe(false);

    // 第 1 轮迟到 settle（旧数据）→ 必须被 seq 守卫丢弃
    deferred.forEach((resolve) =>
      resolve({ list: [{ id: 'conv-1', title: '旧一轮', updatedAt: '2026-01-15T08:00:00' }], total: 1 }),
    );
    await jest.advanceTimersByTimeAsync(10);

    expect(ctx.data.recent?.id).toBe('conv-2');
    expect(ctx.data.recent?.title).toBe('新一轮');
    expect(ctx.data.recentLoading).toBe(false);
    expect(ctx.data.recentError).toBe(false);
  });
});
