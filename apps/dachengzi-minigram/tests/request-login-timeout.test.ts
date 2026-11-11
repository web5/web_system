/**
 * request() 在「无 token」时 await loginEnsurer() 的硬超时单测 —— 台账 #8687。
 *
 * 缺陷事实（诊断 §2.2）：request() 里除 `await loginEnsurer()` 外，每条路径都收敛
 * （throw / reject / resolve）。而 loginEnsurer → ensureLogin → login() → wx.login
 * **没有超时**，且 loginPromise 是全局单例：一次悬挂会让本次及此后**所有**无 token
 * 请求永久 pending —— 不发请求、不报错、页面永久骨架屏。
 *
 * 本用例集钉死：超时即抛 NOT_LOGGED_IN（与「本来就没有 token」同口径），
 * 让上层 .catch(() => null) 能正常接住，而不是变成未捕获 rejection 或永久 pending。
 */
import { request, setLoginEnsurer } from '../utils/request';

/** 登录等待上限（契约值，须与 utils/request.ts 的 LOGIN_ENSURE_TIMEOUT 一致） */
const LOGIN_ENSURE_TIMEOUT = 5_000;

let storage: Record<string, string>;

const busMock = {
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};

const wxMock = {
  getStorageSync: jest.fn((key: string): string => storage[key] || ''),
  setStorageSync: jest.fn((key: string, value: string) => {
    storage[key] = value;
  }),
  removeStorageSync: jest.fn((key: string) => {
    delete storage[key];
  }),
  showToast: jest.fn(),
  request: jest.fn(),
};

beforeAll(() => {
  (globalThis as unknown as { wx: unknown }).wx = wxMock;
  (globalThis as unknown as { getApp?: unknown }).getApp = () => ({ eventBus: busMock });
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  // 只有 api_base，没有 access_token → 走 loginEnsurer 分支
  storage = { api_base: 'http://example.com' };
});

afterEach(() => {
  jest.useRealTimers();
});

describe('request() 的自动登录不得永久 pending', () => {
  it('loginEnsurer 永不 settle → 5s 后 reject NOT_LOGGED_IN（而不是 pending）', async () => {
    jest.useFakeTimers();
    setLoginEnsurer(() => new Promise<boolean>(() => {}));

    const p = request({ url: '/api/ai-agent/agent/conversations' });
    // 先把 reject 断言挂上，避免断言前出现 unhandled rejection
    const assertion = expect(p).rejects.toThrow('NOT_LOGGED_IN');

    // 5s 之前：还没到结论（不提前误判）
    await jest.advanceTimersByTimeAsync(LOGIN_ENSURE_TIMEOUT - 1);
    // 到点必须收敛为 reject
    await jest.advanceTimersByTimeAsync(1);
    await assertion;

    // 超时后不得发出无 token 请求
    expect(wxMock.request).not.toHaveBeenCalled();
    // V6：A2 自身不产生任何 toast（页面自己决定怎么呈现）
    expect(wxMock.showToast).not.toHaveBeenCalled();
  });

  it('loginEnsurer 自己 reject → 同样落 NOT_LOGGED_IN（口径一致）', async () => {
    setLoginEnsurer(() => Promise.reject(new Error('wx.login 超时')));

    await expect(request({ url: '/api/ai-agent/agent/conversations' })).rejects.toThrow('NOT_LOGGED_IN');
    expect(wxMock.request).not.toHaveBeenCalled();
    expect(wxMock.showToast).not.toHaveBeenCalled();
  });

  it('超时兜底不影响正常路径：登录成功并写入 token 后请求照常发出', async () => {
    setLoginEnsurer(async () => {
      wxMock.setStorageSync('access_token', 'tk-1');
      return true;
    });
    wxMock.request.mockImplementation(
      (opts: { header?: Record<string, string>; success?: (r: unknown) => void }) => {
        opts.success?.({ statusCode: 200, data: { list: [], total: 0 } });
      },
    );

    await expect(request({ url: '/api/ai-agent/agent/conversations' })).resolves.toEqual({
      list: [],
      total: 0,
    });
    expect(wxMock.request).toHaveBeenCalledTimes(1);
    const opts = wxMock.request.mock.calls[0][0] as { header?: Record<string, string> };
    expect(opts.header?.Authorization).toBe('Bearer tk-1');
  });

  it('登录成功但 token 仍为空 → 立即 reject NOT_LOGGED_IN，不多等 5s', async () => {
    jest.useFakeTimers();
    setLoginEnsurer(() => Promise.resolve(true));

    await expect(request({ url: '/api/ai-agent/agent/conversations' })).rejects.toThrow('NOT_LOGGED_IN');
    expect(wxMock.request).not.toHaveBeenCalled();
  });
});

/**
 * V6 门（8688 复核提出的连带风险）：A2 的改动**不得**给「页面级数据拉取」新增任何 toast。
 *
 * 事实核对：`fetchProfile()`（services/account.ts:69）= `get('/api/auth/verify')`，
 * 调用点 pages/mine/index/index.ts:115、pages/mine/profile/profile.ts:37 都没传 silent。
 * 若 A2 让这类请求从「挂起」变成「reject + toast」，就是「换了一种坏」。
 *
 * 结论（由下面 3 条用例钉死）：
 *  1. 有 token 时根本进不了 A2 分支（loginEnsurer 一次都不会被调）；
 *  2. 有 token 的失败路径与改动前完全一致：仍是 wx.request 的 timeout → fail → 恰一条 toast；
 *  3. 无 token 时 A2 超时**一条 toast 都不弹**（在发请求前就 throw NOT_LOGGED_IN）。
 */
describe('V6：A2 不得新增页面级 toast', () => {
  it('有 token：完全不进入 A2 分支（loginEnsurer 不被调用），请求直接发出', async () => {
    storage.access_token = 'tk-existing';
    const ensurer = jest.fn(() => new Promise<boolean>(() => {}));
    setLoginEnsurer(ensurer);
    wxMock.request.mockImplementation(() => {
      /* 悬挂：模拟 10s 内还没回来 */
    });

    void request({ url: '/api/auth/verify' });

    expect(ensurer).not.toHaveBeenCalled();
    expect(wxMock.request).toHaveBeenCalledTimes(1);
  });

  it('有 token + 请求超时（fail 回调）：仍是 1 条「网络请求失败」，与改动前一致', async () => {
    storage.access_token = 'tk-existing';
    const ensurer = jest.fn(() => Promise.resolve(false));
    setLoginEnsurer(ensurer);
    // 复刻 wx.request 10s timeout 的行为：只调 fail，不调 success
    wxMock.request.mockImplementation((opts: { fail?: (err: unknown) => void }) => {
      opts.fail?.({ errMsg: 'request:fail timeout' });
    });

    await expect(request({ url: '/api/auth/verify' })).rejects.toBeDefined();

    expect(ensurer).not.toHaveBeenCalled();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '网络请求失败', icon: 'none' });
  });

  it('无 token + A2 超时：一条 toast 都不弹（在发请求前就 reject）', async () => {
    jest.useFakeTimers();
    setLoginEnsurer(() => new Promise<boolean>(() => {}));

    const p = request({ url: '/api/auth/verify' });
    const assertion = expect(p).rejects.toThrow('NOT_LOGGED_IN');
    await jest.advanceTimersByTimeAsync(LOGIN_ENSURE_TIMEOUT);
    await assertion;

    expect(wxMock.showToast).not.toHaveBeenCalled();
    expect(wxMock.request).not.toHaveBeenCalled();
  });
});
