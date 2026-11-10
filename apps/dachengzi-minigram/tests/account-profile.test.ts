import { isNicknameUnset, resolveAvatarUrl } from '../services/account';

/** resolveAvatarUrl 内部经 wx.getStorageSync('api_base') 取 base，这里用最小 mock */
const wxMock = { getStorageSync: jest.fn() };
(globalThis as { wx?: unknown }).wx = wxMock;

describe('isNicknameUnset（昵称「未设置」判定，前端兜底 #8/#9）', () => {
  it('空串 / undefined / 纯空白 → 未设置', () => {
    expect(isNicknameUnset('')).toBe(true);
    expect(isNicknameUnset(undefined)).toBe(true);
    expect(isNicknameUnset('   ')).toBe(true);
  });

  it('wx_ 前缀的 openid 派生占位 → 未设置（不显示乱码）', () => {
    expect(isNicknameUnset('wx_abc123def0')).toBe(true);
  });

  it('真实微信昵称 → 已设置', () => {
    expect(isNicknameUnset('大橙子')).toBe(false);
  });

  it('普通英文昵称（非 wx_ 前缀）→ 已设置', () => {
    expect(isNicknameUnset('Alice')).toBe(false);
  });
});

describe('resolveAvatarUrl（头像相对 URL 拼接 apiBase，#2）', () => {
  beforeEach(() => {
    wxMock.getStorageSync.mockReset();
    wxMock.getStorageSync.mockReturnValue('https://dev.kedouai.com');
  });

  it('空 / 未定义 / 纯空白 → 空串', () => {
    expect(resolveAvatarUrl('')).toBe('');
    expect(resolveAvatarUrl(undefined)).toBe('');
    expect(resolveAvatarUrl('   ')).toBe('');
  });

  it('完整 URL 原样返回', () => {
    expect(resolveAvatarUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
  });

  it('本机临时路径（wxfile:// / http://tmp/…）原样返回', () => {
    expect(resolveAvatarUrl('wxfile://tmp_abc')).toBe('wxfile://tmp_abc');
    expect(resolveAvatarUrl('http://tmp/abc')).toBe('http://tmp/abc');
  });

  it('相对路径拼上 apiBase（去掉 base 尾斜杠）', () => {
    expect(resolveAvatarUrl('/api/uploads/avatars/x.png')).toBe(
      'https://dev.kedouai.com/api/uploads/avatars/x.png',
    );
  });

  it('base 带尾斜杠时只保留一份斜杠', () => {
    wxMock.getStorageSync.mockReturnValue('https://dev.kedouai.com/');
    expect(resolveAvatarUrl('/api/uploads/avatars/x.png')).toBe(
      'https://dev.kedouai.com/api/uploads/avatars/x.png',
    );
  });

  it('相对路径但无 apiBase → 原样返回（不破坏展示兜底）', () => {
    wxMock.getStorageSync.mockReturnValue('');
    expect(resolveAvatarUrl('/api/uploads/avatars/x.png')).toBe('/api/uploads/avatars/x.png');
  });
});
