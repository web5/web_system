/**
 * uploadAvatar 的 HTTP 状态码矩阵 + 服务端错误文案透出单测。
 *
 * 背景（本单核心根因）：`wx.uploadFile` 的成功判定原先写死 `res.statusCode === 200`，
 * 而 upload-service / 网关发生 POST 语义化返回时可能是 201 Created —— 于是「上传成功、
 * 服务端也已落盘」的响应被判为失败，头像换不掉且提示文案是兜底话术。
 * 同仓既有正确范式：services/auth.ts:95 的 `>= 200 && < 300`，本单与之同口径。
 *
 * 另一处既有缺陷：`wx.uploadFile` 的 `res.data` 恒为**字符串**（与 wx.request 不同，
 * 不会按 content-type 自动解析），而公共函数 readMessage（account.ts:226-231）读的是
 * `err.data.message`（对象路径）。不解析就直接 reject，服务端 message 永远取不到 →
 * 恒回落 fallback 文案。故 uploadAvatar 在 reject 前先把 res.data 尝试 JSON.parse 一次。
 *
 * 本文件钉死四类行为：
 *   ① 201 + { code, data: { url } } → resolve 出该 url（当前实现必失败，本单回归点）
 *   ② 200 + 同上 body → resolve（修复不许把原本能用的 200 回退掉）
 *   ③ 2xx 但无 data.url（含 204 空 body）→ reject，不把空 url 当成功
 *   ④ 非 2xx → reject，且 readMessage 能取到服务端 message；非 JSON body 不炸、回落 fallback
 */
import { uploadAvatar, readMessage } from '../services/account';

/** wx.uploadFile 回调参数的最小结构（res.data 按微信真实行为声明为 string） */
interface FakeUploadRes {
  statusCode: number;
  data: string;
}

interface WxUploadFileOpts {
  url?: string;
  filePath?: string;
  name?: string;
  header?: Record<string, string>;
  success?: (res: FakeUploadRes) => void;
  fail?: (err: unknown) => void;
}

/** 捕获最近一次 wx.uploadFile 的入参，便于测试里同步触发 success */
let lastUpload: WxUploadFileOpts | null = null;

const wxMock = {
  getStorageSync: jest.fn((key: string): unknown => {
    if (key === 'api_base') return 'http://example.com';
    if (key === 'access_token') return 'token-123';
    return undefined;
  }),
  setStorageSync: jest.fn(),
  removeStorageSync: jest.fn(),
  showToast: jest.fn(),
  uploadFile: jest.fn((opts: WxUploadFileOpts) => {
    lastUpload = opts;
  }),
};

beforeAll(() => {
  (globalThis as unknown as { wx: unknown }).wx = wxMock;
  (globalThis as unknown as { getApp?: unknown }).getApp = () => ({
    globalData: { apiBase: 'http://example.com' },
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  lastUpload = null;
});

/** 起一次上传（Promise executor 同步执行，返回时 lastUpload 已就绪） */
function startUpload(): Promise<string> {
  return uploadAvatar('wxfile://tmp/avatar-20261110.jpeg');
}

/** 同步触发 uploadFile 的 success 回调 */
function fireUpload(statusCode: number, data: string): void {
  expect(lastUpload).not.toBeNull();
  expect(typeof lastUpload!.success).toBe('function');
  lastUpload!.success!({ statusCode, data });
}

const AVATAR_BODY = JSON.stringify({ code: 200, data: { url: '/api/uploads/avatars/x.jpeg' } });

describe('uploadAvatar 状态码判据（统一 2xx，不只 200）', () => {
  it('201 Created + { code:200, data:{ url } } → resolve 出该 url（本单核心回归）', async () => {
    const p = startUpload();
    fireUpload(201, AVATAR_BODY);
    await expect(p).resolves.toBe('/api/uploads/avatars/x.jpeg');
  });

  it('200 OK + 同上 body → resolve（修复不得回退原本可用的 200）', async () => {
    const p = startUpload();
    fireUpload(200, AVATAR_BODY);
    await expect(p).resolves.toBe('/api/uploads/avatars/x.jpeg');
  });

  it('204 No Content（2xx 但 body 空）→ reject，不把空 url 当成功', async () => {
    const p = startUpload().catch((e: unknown) => e);
    fireUpload(204, '');
    const err = await p;
    expect(err).toBeDefined();
    expect(err).not.toBe('/api/uploads/avatars/x.jpeg');
  });

  it('201 但 body 无 data.url → reject（不许把空 url 当成功）', async () => {
    const p = startUpload().catch((e: unknown) => e);
    fireUpload(201, JSON.stringify({ code: 200, data: {} }));
    const err = await p;
    expect(err).toBeDefined();
    expect(err).not.toBe('');
  });

  it('201 且 data.url 非字符串 → reject（类型不合规不当成功）', async () => {
    const p = startUpload().catch((e: unknown) => e);
    fireUpload(201, JSON.stringify({ code: 200, data: { url: 123 } }));
    await expect(p).resolves.toBeDefined();
  });
});

describe('uploadAvatar 失败时的服务端文案透出（res.data 是字符串，须解析一次）', () => {
  it('400 + JSON body → reject，且 readMessage 取到服务端 message（不再恒回落 fallback）', async () => {
    const p = startUpload().catch((e: unknown) => e);
    fireUpload(400, JSON.stringify({ code: 400, message: '图片超过 2MB，请压缩后重试' }));
    const err = await p;
    expect(err).toBeDefined();
    expect(readMessage(err, '上传失败，请稍后重试')).toBe('图片超过 2MB，请压缩后重试');
  });

  it('400 + message 为数组（参数校验）→ readMessage 取首条', async () => {
    const p = startUpload().catch((e: unknown) => e);
    fireUpload(400, JSON.stringify({ message: ['文件类型不支持', '仅支持 jpg/png'] }));
    const err = await p;
    expect(readMessage(err, '上传失败')).toBe('文件类型不支持');
  });

  it('400 + 非 JSON body（网关异常页）→ reject 不抛，readMessage 回落 fallback', async () => {
    const p = startUpload().catch((e: unknown) => e);
    fireUpload(400, '<html><body>502 Bad Gateway</body></html>');
    const err = await p;
    expect(err).toBeDefined();
    expect(readMessage(err, '上传失败，请稍后重试')).toBe('上传失败，请稍后重试');
  });

  it('200 + 非 JSON body → reject（非 JSON 按上传失败处理，不 resolve）', async () => {
    const p = startUpload().catch((e: unknown) => e);
    fireUpload(200, 'not-json');
    const err = await p;
    expect(err).toBeDefined();
  });

  it('reject 出来的对象仍保留 statusCode（供上层区分状态）', async () => {
    const p = startUpload().catch((e: unknown) => e);
    fireUpload(413, JSON.stringify({ message: '文件过大' }));
    const err = (await p) as { statusCode?: number };
    expect(err.statusCode).toBe(413);
  });
});

describe('uploadAvatar 请求装配（不该被本次改动影响）', () => {
  it('POST 到 /api/upload/avatar，字段名 file，带 Bearer token', async () => {
    const p = startUpload();
    expect(lastUpload!.url).toBe('http://example.com/api/upload/avatar');
    expect(lastUpload!.name).toBe('file');
    expect(lastUpload!.filePath).toBe('wxfile://tmp/avatar-20261110.jpeg');
    expect(lastUpload!.header?.Authorization).toBe('Bearer token-123');
    fireUpload(200, AVATAR_BODY);
    await p;
  });
});
