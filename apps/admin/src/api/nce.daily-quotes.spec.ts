/**
 * 每日美句只读接口契约守卫（s28 / 157 稿 §二·2.2、§六·2）。
 *
 * 锁四件事：
 *  1. 走 GET，路径是 /content-admin/nce/daily-quotes（baseURL '/api' 由 request 补）；
 *  2. 不带任何 config —— 服务端整池返回，禁止伪造 page/pageSize/keyword/version；
 *  3. 不走 POST、不带 service key；
 *  4. 返回类型就是 data 本体 DailyQuotesPool（拦截器已拆信封）。
 */
jest.mock('./request', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

import request from './request';
import { getDailyQuotes, type DailyQuotesPool } from './nce';

const mockedGet = request.get as unknown as jest.Mock;
const mockedPost = request.post as unknown as jest.Mock;

const samplePool: DailyQuotesPool = {
  version: 1,
  count: 136,
  items: [{
    cn: '我从不在星期天早起。',
    en: 'I never get up early on Sundays.',
    source: { book: 'NCE2', lessonId: 2, title: 'Breakfast or Lunch', lineIndex: 1 },
  }],
};

describe('getDailyQuotes 契约（GET 整池 / 无参数 / 拆包后 data 本体）', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedPost.mockReset();
    mockedGet.mockResolvedValue(samplePool);
  });

  it('调用 GET 且路径精确，不传 config（无伪造分页/搜索/version 参数）', async () => {
    const result = await getDailyQuotes();

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet.mock.calls[0][0]).toBe('/content-admin/nce/daily-quotes');
    expect(mockedGet.mock.calls[0]).toHaveLength(1);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(result).toBe(samplePool);
  });

  it('返回体形状满足 DailyQuotesPool（编译期由 vue-tsc 校验，运行时校验字段）', async () => {
    const result = await getDailyQuotes();
    expect(result.version).toBe(1);
    expect(result.count).toBe(136);
    expect(result.items[0].source).toEqual({
      book: 'NCE2', lessonId: 2, title: 'Breakfast or Lunch', lineIndex: 1,
    });
  });
});
