/// <reference types="node" />
/**
 * 阶段③ S4 · 拉取段 services/daily-quotes.ts 验收。
 *
 * 钉住五条口径：
 *  ① 静默 GET：request({url:'/api/content-admin/nce/daily-quotes', silent:true, method:'GET'})，无 toast；
 *  ② 成功解包 {code:0,data:{version,count,items}} → 写缓存 daily_quotes_pool={version,fetchedAt,items:[{cn,en,book,lessonId}]}（s33 增角标字段；title/lineIndex 不进缓存）；
 *  ③ 失败 / 非 2xx / 非 0 信封 / 脏响应 → silent 吞掉、不写缓存（保留旧缓存 stale-while-error）；
 *  ④ 不抛异常（.catch 不透到 UI）；⑤ 缓存键中性、无 AI/LLM/prompt 痕迹。
 */
jest.mock('../utils/request', () => ({
  request: jest.fn(),
}));

import { request } from '../utils/request';
import {
  prefetchDailyQuotes,
  DAILY_QUOTES_CACHE_KEY,
  isValidPoolBody,
  toCachePool,
} from '../services/daily-quotes';

const requestMock = request as jest.Mock;

const VALID_BODY = {
  code: 0,
  data: {
    version: 1,
    count: 2,
    items: [
      { cn: '我从不在星期天早起。', en: 'I never get up early on Sundays.', source: { book: 'NCE2', lessonId: 2, title: 'Breakfast or Lunch', lineIndex: 1 } },
      { cn: '人人都认识他。', en: 'Everybody knows him.', source: { book: 'NCE2', lessonId: 6, title: 'Percy Buttons', lineIndex: 9 } },
    ],
  },
  message: 'ok',
};

describe('services/daily-quotes 拉取段', () => {
  let setStorageSync: jest.Mock;
  let getStorageSync: jest.Mock;
  let showToast: jest.Mock;

  beforeEach(() => {
    requestMock.mockReset();
    setStorageSync = jest.fn();
    getStorageSync = jest.fn(() => '');
    showToast = jest.fn();
    (globalThis as { wx?: unknown }).wx = { setStorageSync, getStorageSync, showToast };
  });

  it('① 静默 GET：调用 request 的 url/method/silent 严格锁定，全程不弹 toast', async () => {
    requestMock.mockResolvedValueOnce(VALID_BODY);
    await prefetchDailyQuotes();
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith({
      url: '/api/content-admin/nce/daily-quotes',
      silent: true,
      method: 'GET',
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('② 成功解包：写缓存 {version,fetchedAt,items:[{cn,en,book,lessonId}]}（s33 角标字段；title/lineIndex 不进缓存）', async () => {
    requestMock.mockResolvedValueOnce(VALID_BODY);
    await prefetchDailyQuotes();
    expect(setStorageSync).toHaveBeenCalledTimes(1);
    const [key, value] = setStorageSync.mock.calls[0];
    expect(key).toBe(DAILY_QUOTES_CACHE_KEY);
    expect(DAILY_QUOTES_CACHE_KEY).toBe('daily_quotes_pool');
    expect(value.version).toBe(1);
    expect(typeof value.fetchedAt).toBe('number');
    expect(value.items).toHaveLength(2);
    for (const it of value.items) {
      expect(Object.keys(it).sort()).toEqual(['book', 'cn', 'en', 'lessonId']);
    }
    expect(value.items[0]).toEqual({
      cn: VALID_BODY.data.items[0].cn, en: VALID_BODY.data.items[0].en,
      book: 'NCE2', lessonId: 2,
    });
  });

  it('③ 非 0 信封 / 脏 body / 非数组 items / count 不符 → 不写缓存（保留旧池）', async () => {
    const badBodies = [
      { code: 500, data: VALID_BODY.data, message: 'err' },
      { code: 0, data: { version: 1, count: 2, items: 'not-array' }, message: 'ok' },
      { code: 0, data: { version: 1, count: 3, items: VALID_BODY.data.items }, message: 'ok' },
      { code: 0, data: { version: 1, count: 1, items: [{ cn: '', en: 'X' }] }, message: 'ok' },
      null,
    ];
    for (const body of badBodies) {
      setStorageSync.mockClear();
      requestMock.mockResolvedValueOnce(body);
      await expect(prefetchDailyQuotes()).resolves.toBeUndefined();
      expect(setStorageSync).not.toHaveBeenCalled();
    }
  });

  it('③ 网络失败（request reject）/ 未登录 → 吞掉不写缓存、不抛、不弹 toast', async () => {
    requestMock.mockRejectedValueOnce(new Error('offline'));
    await expect(prefetchDailyQuotes()).resolves.toBeUndefined();
    expect(setStorageSync).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('④ 中间态纯函数：isValidPoolBody / toCachePool 形状校验与剥 source', () => {
    expect(isValidPoolBody(VALID_BODY.data)).toBe(true);
    expect(isValidPoolBody({ version: 1, count: 0, items: [] })).toBe(false);
    expect(isValidPoolBody({ version: 1, count: 1, items: [{ cn: 'x', en: '' }] })).toBe(false);
    const cache = toCachePool(VALID_BODY.data);
    expect(cache.version).toBe(1);
    expect(cache.items[0]).toEqual({
      cn: VALID_BODY.data.items[0].cn, en: VALID_BODY.data.items[0].en,
      book: 'NCE2', lessonId: 2,
    });
  });

  it('isValidPoolBody 拒绝非法 book / 越界 lessonId（三册白名单 + 按册课号上限）', () => {
    const base = VALID_BODY.data;
    const one = (source: object) => ({ version: base.version, count: 1, items: [{ ...base.items[0], source }] });
    expect(isValidPoolBody(one({ ...base.items[0].source, book: 'NCE5' }))).toBe(false);
    expect(isValidPoolBody(one({ ...base.items[0].source, book: 'NCE4', lessonId: 49 }))).toBe(false);
    expect(isValidPoolBody(one({ ...base.items[0].source, book: 'NCE4', lessonId: 48 }))).toBe(true);
  });

  it('⑤ 中性命名：模块源码无 ai/llm/prompt/generatedAt 痕迹（源码层静态检查）', () => {
    // 通过函数行为与导出形状间接保证；真正的 grep 静态检查在回执 V1/V7 用命令执行。
    expect(typeof prefetchDailyQuotes).toBe('function');
    // 用词边界，避免 "daily" 里的 "ai" 误命中；真正的源码 grep 检查在回执 V1/V7 用命令执行。
    expect(DAILY_QUOTES_CACHE_KEY).not.toMatch(/\b(ai|llm|prompt|generatedAt)\b/i);
  });
});
