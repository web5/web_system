/**
 * fetchProfile / updateProfile 的数据流单测
 *
 * 目标：钉住 account.ts 的「响应解包」与「字段落位」两条口径：
 *   ① /api/auth/verify 返回 { code, data: user } 信封时正确解包出 user；
 *      直接返回 user 对象（无信封）时原样返回，二者都兼容。
 *   ② updateProfile 的 payload 原样透传 nickname/avatar，返回值同样解包。
 *
 * 这是「我的」页头像/昵称/邮箱/手机号能否正确渲染的上游前提——
 * 解包错了，展示层无论如何兜底都拿不到真数据。
 */
import { fetchProfile, updateProfile } from '../services/account';

jest.mock('../utils/request', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  setToken: jest.fn(),
  getToken: jest.fn(),
}));

import { get, put } from '../utils/request';

const getMock = get as jest.Mock;
const putMock = put as jest.Mock;

// 兜底 wx（account.ts 的 getUploadBase 只在 resolveAvatarUrl/uploadAvatar 用到，本套用例不触发）
(globalThis as { wx?: unknown }).wx = { getStorageSync: jest.fn(() => '') };

describe('fetchProfile 落字段（phone/email/nickname/avatar）', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('信封形态 { code:200, data:user } → 正确解包，五个展示字段齐备', async () => {
    getMock.mockResolvedValueOnce({
      code: 200,
      data: {
        id: 1,
        username: 'u1',
        phone: '138****6688',
        email: 'a***@x.com',
        nickname: '大橙子',
        avatar: '/api/uploads/avatars/a.png',
      },
    });

    const info = await fetchProfile();
    expect(getMock).toHaveBeenCalledWith('/api/auth/verify');
    expect(info).toEqual({
      id: 1,
      username: 'u1',
      phone: '138****6688',
      email: 'a***@x.com',
      nickname: '大橙子',
      avatar: '/api/uploads/avatars/a.png',
    });
  });

  it('直接返回 user 对象（无信封）→ 原样返回，不丢字段', async () => {
    getMock.mockResolvedValueOnce({
      id: 2,
      username: 'u2',
      nickname: 'Alice',
      avatar: 'https://cdn.example.com/a.png',
    });

    const info = await fetchProfile();
    expect(info.nickname).toBe('Alice');
    expect(info.avatar).toBe('https://cdn.example.com/a.png');
    expect(info.phone).toBeUndefined();
  });

  it('字段缺失（未绑定）→ undefined，交由展示层兜底，不抛错', async () => {
    getMock.mockResolvedValueOnce({ code: 200, data: { id: 3, username: 'u3' } });

    const info = await fetchProfile();
    expect(info.phone).toBeUndefined();
    expect(info.email).toBeUndefined();
    expect(info.nickname).toBeUndefined();
    expect(info.avatar).toBeUndefined();
  });
});

describe('updateProfile 数据流', () => {
  beforeEach(() => {
    putMock.mockReset();
  });

  it('payload 透传 nickname，返回值解包出 user（saveNickname 依赖 updated.nickname）', async () => {
    putMock.mockResolvedValueOnce({
      code: 0,
      data: { id: 1, username: 'u1', nickname: 'Bob' },
    });

    const updated = await updateProfile({ nickname: 'Bob' });
    expect(putMock).toHaveBeenCalledWith('/api/users/me', { nickname: 'Bob' });
    expect(updated.nickname).toBe('Bob');
  });

  it('payload 透传 avatar（头像落库依赖 updated.avatar）', async () => {
    putMock.mockResolvedValueOnce({
      code: 0,
      data: { id: 1, username: 'u1', avatar: '/api/uploads/avatars/b.png' },
    });

    const updated = await updateProfile({ avatar: '/api/uploads/avatars/b.png' });
    expect(putMock).toHaveBeenCalledWith('/api/users/me', { avatar: '/api/uploads/avatars/b.png' });
    expect(updated.avatar).toBe('/api/uploads/avatars/b.png');
  });
});
