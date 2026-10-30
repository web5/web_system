/**
 * 用户记忆（admin 只读面板 · #8229 批次 2 卡 2.4）api 层回归守卫。
 *
 * 锁三件事：
 * 1. 路由口径：GET /users/:id/memory（挂在 users 前缀下，复用网关既有通道）；
 * 2. 分页参数走 query（page/pageSize），不进 body；
 * 3. userApi 聚合对象暴露 getUserMemory（视图统一从 userApi 取）。
 */
jest.mock('./request', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.resolve({ summary: null, memories: { list: [], total: 0 } })) },
}));

import request from './request';
import { getUserMemory, userApi } from './user';

const mockedGet = request.get as unknown as jest.Mock;

describe('getUserMemory（admin 只读用户记忆接口）', () => {
  beforeEach(() => mockedGet.mockClear());

  it('打到 /users/:id/memory，分页参数走 query', async () => {
    await getUserMemory('1024', 2, 10);

    expect(mockedGet).toHaveBeenCalledTimes(1);
    const [url, config] = mockedGet.mock.calls[0];

    expect(url).toBe('/users/1024/memory');
    expect(config).toEqual({ params: { page: 2, pageSize: 10 } });
  });

  it('缺省分页为第 1 页、每页 50 条', async () => {
    await getUserMemory('1024');

    const [, config] = mockedGet.mock.calls[0];
    expect(config).toEqual({ params: { page: 1, pageSize: 50 } });
  });

  it('userApi 聚合对象暴露 getUserMemory', () => {
    expect(typeof userApi.getUserMemory).toBe('function');
  });
});
