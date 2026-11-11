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

const wxMock = {
  getStorageSync: jest.fn((key: string): unknown => {
    if (key === 'api_base') return 'http://example.com';
    if (key === 'access_token') return 'token-123';
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
