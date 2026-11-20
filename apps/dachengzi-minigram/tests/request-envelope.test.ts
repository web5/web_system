/**
 * utils/request.ts 对 ai-agent「HTTP 200 + 错误信封」的识别单测。
 *
 * 背景：ai-agent 全局异常过滤器 UnifiedExceptionFilter 把一切业务异常统一转成
 *   HTTP 200 + { code, message, data: null }；而旧 request.ts 只按 statusCode===200
 *   就 resolve(res.data)，导致错误信封被当成成功返回（首页「最近对话拉不出来」根因）。
 *
 * 本测试钉死三类行为：
 *   1. code===4010（未授权/缺 token）→ 清 token + 广播 auth:expired + reject；
 *   2. 其他 code → toast + reject（不清 token）；
 *   3. 正常直返 / code===0 成功信封 → resolve（不误判为错误）。
 */
import { request } from '../utils/request';

/** 只声明 request success 回调用到的最小响应结构，避免 any */
interface FakeSuccessRes {
  statusCode: number;
  data: unknown;
}

interface WxRequestOpts {
  url?: string;
  success?: (res: FakeSuccessRes) => void;
  fail?: (err: unknown) => void;
}

let capturedSuccess: ((res: FakeSuccessRes) => void) | null = null;

const busMock = {
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};

let storage: Record<string, string>;

const wxMock = {
  getStorageSync: jest.fn((key: string): unknown => {
    if (key === 'api_base') return storage.api_base;
    if (key === 'access_token') return storage.access_token;
    return undefined;
  }),
  setStorageSync: jest.fn(),
  removeStorageSync: jest.fn(),
  showToast: jest.fn(),
  request: jest.fn((opts: WxRequestOpts) => {
    capturedSuccess = opts.success || null;
  }),
};

beforeAll(() => {
  (globalThis as unknown as { wx: unknown }).wx = wxMock;
  (globalThis as unknown as { getApp?: unknown }).getApp = () => ({ eventBus: busMock });
});

beforeEach(() => {
  jest.clearAllMocks();
  capturedSuccess = null;
  // 默认已初始化、已登录；新增「本地错误边界」用例通过改写 storage 触发对应分支
  storage = { api_base: 'http://example.com', access_token: 'token-123' };
});

function fireSuccess(res: FakeSuccessRes): void {
  expect(capturedSuccess).not.toBeNull();
  capturedSuccess!(res);
}

describe('request.ts 对 ai-agent 错误信封的识别（HTTP 200 + { code, message }）', () => {
  it('正常直返（无信封）：resolve(res.data)', async () => {
    const p = request<{ list: string[]; total: number }>({ url: '/api/ai-agent/agent/conversations' });
    fireSuccess({ statusCode: 200, data: { list: ['a'], total: 1 } });
    await expect(p).resolves.toEqual({ list: ['a'], total: 1 });
  });

  it('code===4010 信封：清 token + 广播 auth:expired + reject', async () => {
    const p = request({ url: '/api/ai-agent/agent/conversations' });
    fireSuccess({ statusCode: 200, data: { code: 4010, message: 'Authorization header missing', data: null } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('access_token');
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('refresh_token');
    expect(busMock.emit).toHaveBeenCalledWith('auth:expired');
  });

  it('其他 code 信封：toast + reject，不清 token', async () => {
    const p = request({ url: '/api/ai-agent/agent/run' });
    fireSuccess({ statusCode: 200, data: { code: 5000, message: '内部错误', data: null } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '内部错误', icon: 'none' });
    expect(wxMock.removeStorageSync).not.toHaveBeenCalled();
  });

  it('code===0 成功信封（带 message）：不视为错误，resolve', async () => {
    const p = request<{ code: number; message: string; data: unknown }>({
      url: '/api/ai-agent/agent/conversations',
    });
    fireSuccess({ statusCode: 200, data: { code: 0, message: 'ok', data: { list: [] } } });
    await expect(p).resolves.toEqual({ code: 0, message: 'ok', data: { list: [] } });
  });
});

/**
 * HTTP 判据统一为 2xx —— 原先只认 200，把 201/204 这类合法成功也判失败。
 * 口径与 services/auth.ts:95 的 `>= 200 && < 300` 一致。
 *
 * ⚠️ 特意钉住 304：304 Not Modified 是「条件请求未变更」的重定向语义，
 * 对小程序请求封装而言拿不到业务 body，必须走失败分支——判据不得放宽成「所有 3xx」。
 */
describe('request.ts 的 HTTP 成功判据统一为 2xx（不只 200）', () => {
  it('200 OK → resolve', async () => {
    const p = request<{ ok: boolean }>({ url: '/api/anything' });
    fireSuccess({ statusCode: 200, data: { ok: true } });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it('201 Created → resolve（原先被判失败，本次修复点）', async () => {
    const p = request<{ id: number }>({ url: '/api/anything', method: 'POST', data: {} });
    fireSuccess({ statusCode: 201, data: { id: 7 } });
    await expect(p).resolves.toEqual({ id: 7 });
    expect(wxMock.showToast).not.toHaveBeenCalled();
  });

  it('204 No Content（body 为空）→ resolve，不 toast', async () => {
    const p = request({ url: '/api/anything', method: 'DELETE' });
    fireSuccess({ statusCode: 204, data: '' });
    await expect(p).resolves.toBe('');
    expect(wxMock.showToast).not.toHaveBeenCalled();
  });

  it('304 Not Modified → reject（304 不是成功，判据不得放宽到所有 3xx）', async () => {
    const p = request({ url: '/api/anything' });
    fireSuccess({ statusCode: 304, data: '' });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '请求失败 (304)', icon: 'none' });
  });

  it('401 仍走未授权分支（2xx 判据改动不得影响 401 语义）', async () => {
    const p = request({ url: '/api/anything' });
    fireSuccess({ statusCode: 401, data: { message: 'Unauthorized' } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('access_token');
  });
});

/**
 * 本地错误统一兜底边界（2026-11-20 治本 · 49 §5 方案 B / lead 选项 2 裁决 / V6 门）。
 * 非 silent 且失败 ⇒ 有且仅有一条 string toast；判据原则是「是否有其它 UI 通道承接」：
 *   - url 非法 / 应用未初始化：无任何 UI 承接 ⇒ 必弹且 string（走 utils/error-message.ts
 *     归一化，rawMessage 为 undefined 时回落「网络异常，请重试」）；
 *   - !token → NOT_LOGGED_IN：登录态信号，由 login-gate / modal-login 承接，按 V6 门
 *     （tests/request-login-timeout.test.ts:111-122，8688 复核）保持静默，页面层与请求层都不弹。
 * 台账 #8947：把「HTTP 400 必须有提示」与「本地错误边界」一并钉进判据，不跑全量。
 */
describe('本地错误统一兜底边界（url 非法 / 未初始化 必弹；NOT_LOGGED_IN 静默）', () => {
  it('url 非 /api/ 前缀 → 必弹 1 条中文 string（无 UI 承接）', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(request({ url: 'users/me' })).rejects.toThrow(/必须以 \/api\/ 开头/);
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    const title = (wxMock.showToast.mock.calls[0][0] as { title: unknown }).title;
    expect(typeof title).toBe('string');
    expect(title).toBe('网络异常，请重试');
    spy.mockRestore();
  });

  it('应用未初始化（无 baseUrl）→ 必弹 1 条中文 string（无 UI 承接）', async () => {
    storage.api_base = '';
    await expect(request({ url: '/api/glossary' })).rejects.toThrow(/应用未初始化/);
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    const title = (wxMock.showToast.mock.calls[0][0] as { title: unknown }).title;
    expect(typeof title).toBe('string');
    expect(title).toBe('网络异常，请重试');
  });

  it('!token → NOT_LOGGED_IN：登录态信号，页面层与请求层都不弹（V6 门 :111-122）', async () => {
    storage.access_token = '';
    await expect(request({ url: '/api/glossary' })).rejects.toThrow('NOT_LOGGED_IN');
    expect(wxMock.showToast).not.toHaveBeenCalled();
  });
});
