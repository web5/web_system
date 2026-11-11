/**
 * services/auth.ts 的两处「悬挂 / 遮罩」单测 —— 台账 #8687。
 *
 * 缺陷事实（诊断 §2.2 / §3.3）：
 *  1. `login()` 里的 `wx.login` 是回调式 API，**没有超时参数**。真机偶发不回调时
 *     `loginPromise` 永不 settle（单例，:131-146），一次悬挂拖死所有无 token 请求；
 *     `ensureLogin()` 也因此永不 resolve。
 *  2. `loginFromGate()` 只在 success/catch 里 `hideLoading()`；若 `login()` 悬挂，
 *     `wx.showLoading({ mask: true })` 的全屏遮罩就永不消失。
 *
 * 本用例集钉死：wx.login 超时后必须收敛（返回 false + 重置单例可重试），
 * 且遮罩必须在任何路径收起。
 */
import { ensureLogin, loginFromGate } from '../services/auth';

/** wx.login 等待上限（契约值，须与 services/auth.ts 的 WX_LOGIN_TIMEOUT 一致） */
const WX_LOGIN_TIMEOUT = 8_000;

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
  login: jest.fn(),
  request: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
  showToast: jest.fn(),
  getAccountInfoSync: jest.fn(() => ({ miniProgram: { appId: 'wxtest' } })),
};

beforeAll(() => {
  (globalThis as unknown as { wx: unknown }).wx = wxMock;
  (globalThis as unknown as { getApp?: unknown }).getApp = () => ({
    globalData: { apiBase: 'http://example.com' },
    eventBus: busMock,
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  // 无 token + 未主动退出 → ensureLogin 会真正发起登录
  storage = { api_base: 'http://example.com' };
  // 默认：wx.login 永不回调（模拟真机悬挂），由各用例按需覆盖
  wxMock.login.mockReset();
  wxMock.request.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** 静音 login() 内的 console.error（失败路径会打日志，避免污染测试输出） */
function silenceConsoleError(): void {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
}

describe('wx.login 不回调 → login 必须超时收敛（不再是永久 pending）', () => {
  it('8s 后 ensureLogin() resolve false', async () => {
    jest.useFakeTimers();
    silenceConsoleError();
    wxMock.login.mockImplementation(() => {
      /* 永不回调 */
    });

    const p = ensureLogin();
    await jest.advanceTimersByTimeAsync(WX_LOGIN_TIMEOUT);
    await expect(p).resolves.toBe(false);
  });

  it('超时后 loginPromise 已重置：第二次 ensureLogin() 会重新发起 wx.login', async () => {
    jest.useFakeTimers();
    silenceConsoleError();
    wxMock.login.mockImplementation(() => {
      /* 永不回调 */
    });

    const first = ensureLogin();
    await jest.advanceTimersByTimeAsync(WX_LOGIN_TIMEOUT);
    await expect(first).resolves.toBe(false);
    expect(wxMock.login).toHaveBeenCalledTimes(1);

    // 关键：单例没被死锁 —— 第二次调用必须真的再发起一次 wx.login
    const second = ensureLogin();
    expect(wxMock.login).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(WX_LOGIN_TIMEOUT);
    await expect(second).resolves.toBe(false);
  });

  /**
   * V6 门补问：A3 是否会给「首次冷启动自动登录」新增一条用户可见提示？
   * 结论：不会 —— ensureLogin 路径只有 console.error（[auth] 登录失败），无 toast；
   * 用户可见的「登录失败，请重试」只存在于 loginFromGate（用户点了登录引导卡才会走）。
   */
  it('ensureLogin 超时不上报 toast（自动登录静默，不新增用户可见提示）', async () => {
    jest.useFakeTimers();
    silenceConsoleError();
    wxMock.login.mockImplementation(() => {
      /* 永不回调 */
    });

    const p = ensureLogin();
    await jest.advanceTimersByTimeAsync(WX_LOGIN_TIMEOUT);
    await expect(p).resolves.toBe(false);

    expect(wxMock.showToast).not.toHaveBeenCalled();
    expect(wxMock.showLoading).not.toHaveBeenCalled();
    expect(wxMock.hideLoading).not.toHaveBeenCalled();
  });
});

describe('loginFromGate 的 loading 遮罩必收起', () => {
  it('登录悬挂（wx.login 不回调）→ 遮罩最终 hideLoading，且提示登录失败', async () => {
    jest.useFakeTimers();
    silenceConsoleError();
    wxMock.login.mockImplementation(() => {
      /* 永不回调 */
    });

    const p = loginFromGate();
    expect(wxMock.showLoading).toHaveBeenCalledWith({ title: '登录中…', mask: true });
    expect(wxMock.hideLoading).not.toHaveBeenCalled();

    // 8s：wx.login 超时 → 走失败路径 → 遮罩必须收起
    await jest.advanceTimersByTimeAsync(WX_LOGIN_TIMEOUT);
    await expect(p).resolves.toBe(false);

    expect(wxMock.hideLoading).toHaveBeenCalled();
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '登录失败，请重试', icon: 'none' });
  });

  it('登录成功 → 遮罩收起且返回 true（正常路径不回归）', async () => {
    wxMock.login.mockImplementation((opts: { success?: (r: unknown) => void }) => {
      opts.success?.({ code: 'code-1' });
    });
    wxMock.request.mockImplementation((opts: { success?: (r: unknown) => void }) => {
      opts.success?.({
        statusCode: 200,
        data: {
          accessToken: 'tk-1',
          refreshToken: 'rt-1',
          user: { id: 1, username: 'u-1', roles: ['user'] },
        },
      });
    });

    await expect(loginFromGate()).resolves.toBe(true);
    expect(wxMock.hideLoading).toHaveBeenCalledTimes(1);
    expect(wxMock.setStorageSync).toHaveBeenCalledWith('access_token', 'tk-1');
  });
});
