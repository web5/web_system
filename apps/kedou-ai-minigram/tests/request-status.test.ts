/**
 * kedou-ai-minigram utils/request.ts 的 HTTP 成功判据单测。
 *
 * 背景：判据原为 `res.statusCode === 200`，把 201 Created / 204 No Content 这类
 * 合法成功也判为失败（toast「请求失败 (201)」+ reject），与同仓 services/auth.ts:95
 * 的 `>= 200 && < 300` 口径不一致。本文件钉死统一为 2xx。
 *
 * ⚠️ 同时钉住 304 仍失败：304 是条件请求「未变更」，业务 body 拿不到，
 * 不得把判据放宽成「所有 3xx」。
 */
import { request } from '../utils/request';

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

describe('kedou request.ts 的 HTTP 成功判据统一为 2xx（不只 200）', () => {
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

  it('401 仍走未授权分支（清 token + 广播 auth:expired）', async () => {
    const p = request({ url: '/api/anything' });
    fireSuccess({ statusCode: 401, data: { message: 'Unauthorized' } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('access_token');
    expect(busMock.emit).toHaveBeenCalledWith('auth:expired');
  });
});
