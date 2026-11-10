import { isNicknameUnset } from '../services/account';

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
