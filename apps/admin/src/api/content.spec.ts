/**
 * 回归守卫：republish 的 POST 体不能是 null / undefined（#428）。
 *
 * 事故链条：`request.post(url, null, ...)` → axios 实例默认
 * `Content-Type: application/json` → transformRequest 走
 * `stringifySafely(null)` = `JSON.stringify(null)` → 请求体是裸 `null`（4 字节）
 * → 网关 body-parser（默认 `strict: true`）只接受顶层对象/数组，`firstchar='n'`
 * → 400 `Unexpected token 'n', "null" is not valid JSON`。
 * 表现为「建草稿」按钮 100% 失败，且请求根本进不到 content-hub。
 *
 * 本用例只锁一件事：body 必须是对象。不去断言 axios 内部序列化行为，
 * 因为那属于第三方实现细节；只要 body 是 {}，序列化结果必然是 `{}`。
 */
jest.mock('./request', () => ({
  __esModule: true,
  default: { post: jest.fn(() => Promise.resolve({ ok: true })), get: jest.fn() },
}));

import request from './request';
import { rebuildPublication, republishPublication } from './content';

const mockedPost = request.post as unknown as jest.Mock;

describe('republishPublication（#428 body 不能是 null）', () => {
  beforeEach(() => mockedPost.mockClear());

  it('mode=draft 走 query 参数，请求体是空对象', async () => {
    await republishPublication(17, 'draft');

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockedPost.mock.calls[0];

    expect(url).toBe('/content-admin/content/publications/17/republish');
    expect(config).toEqual({ params: { mode: 'draft' } });

    // 核心断言：null / undefined 会被 axios 发成 "null" 或空串以外的非法体
    expect(body).not.toBeNull();
    expect(body).not.toBeUndefined();
    expect(typeof body).toBe('object');
    expect(body).toEqual({});
  });

  it('mode=publish 同样带空对象体', async () => {
    await republishPublication(16, 'publish');

    const [, body, config] = mockedPost.mock.calls[0];
    expect(config).toEqual({ params: { mode: 'publish' } });
    expect(body).toEqual({});
  });
});

/**
 * 重建接口（#431）——同一个 body-parser 陷阱，换了个新接口很容易再踩一次。
 */
describe('rebuildPublication（#431）', () => {
  beforeEach(() => mockedPost.mockClear());

  it('打到 rebuild 路由且请求体是空对象（不是 null）', async () => {
    await rebuildPublication(17);

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockedPost.mock.calls[0];

    expect(url).toBe('/content-admin/content/publications/17/rebuild');
    // 没有 query 参数 —— 传 undefined 与不传等价，这里只防「传了别的东西」
    expect(config).toBeUndefined();

    expect(body).not.toBeNull();
    expect(body).not.toBeUndefined();
    expect(body).toEqual({});
  });
});
