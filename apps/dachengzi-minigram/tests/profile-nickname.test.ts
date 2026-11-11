/**
 * 个人信息页（profile.ts）昵称保存数据流单测
 *
 * 捕获 Page({...}) 配置对象，直接对 saveNickname / onNickBlur / onNickConfirm 做行为断言。
 * 重点钉住三件事：
 *   ① blur/confirm 直读 e.detail.value（不依赖 bindinput 先更新 data）这条修复是否生效；
 *   ② 去重 / 保存锁是否拦得住 blur 与 confirm 连发的重复 PUT；
 *   ③ 空串事件值的边界：回退 data.nickname（仅非空）再落库，不再「bindinput 已写入的昵称被丢弃」。
 */
import { updateProfile, writeLocalNickname } from '../services/account';

jest.mock('../services/account', () => ({
  fetchProfile: jest.fn(),
  updateProfile: jest.fn(),
  readMessage: jest.fn((_e: unknown, fallback: string) => fallback),
  uploadAvatar: jest.fn(),
  isNicknameUnset: jest.fn((n?: string) => {
    const s = (n || '').trim();
    return !s || s.startsWith('wx_');
  }),
  resolveAvatarUrl: jest.fn((u?: string) => (u || '')),
  readLocalAvatar: jest.fn(() => ''),
  readLocalNickname: jest.fn(() => ''),
  writeLocalAvatar: jest.fn(),
  writeLocalNickname: jest.fn(),
}));

jest.mock('../services/auth', () => ({ isLoggedIn: jest.fn(() => true) }));

const updateProfileMock = updateProfile as jest.Mock;
const writeLocalNicknameMock = writeLocalNickname as jest.Mock;

// 捕获 Page 配置（必须在 require profile.ts 之前挂好）
let pageConfig: Record<string, any> | null = null;
(globalThis as { Page?: unknown }).Page = (cfg: Record<string, any>) => {
  pageConfig = cfg;
};

const appMock = { globalData: { userInfo: {} as Record<string, unknown> }, radiusClassOf: () => '' };
(globalThis as { getApp?: unknown }).getApp = () => appMock;
(globalThis as { wx?: unknown }).wx = {
  getStorageSync: jest.fn(() => ''),
  setStorageSync: jest.fn(),
  showToast: jest.fn(),
  navigateBack: jest.fn(),
  navigateTo: jest.fn(),
};

// 触发 profile.ts 执行 Page({...})
require('../pages/mine/profile/profile');

/** 构造一个最小 page 实例，供 saveNickname 等方法 call 绑定 this */
function makeCtx(initial: { nickname?: string } = {}) {
  const data = {
    nickname: initial.nickname ?? '',
    avatarUrl: '',
    email: '',
    uid: '',
    radiusClass: '',
  };
  return {
    data,
    _syncedNickname: null as string | null,
    _nickSaving: false,
    // onNickBlur/onNickConfirm 内部经 `this.saveNickname(...)` 调用，故把配置对象的方法挂到实例上
    saveNickname: pageConfig!.saveNickname,
    setData(patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    },
  };
}

describe('昵称保存数据流（profile.ts）', () => {
  beforeEach(() => {
    updateProfileMock.mockReset();
    updateProfileMock.mockImplementation(async (p: { nickname?: string }) => ({
      id: 1,
      username: 'u1',
      nickname: p.nickname ?? '',
    }));
    writeLocalNicknameMock.mockReset();
  });

  it('saveNickname：新昵称落库 + 回写 data + 记 _syncedNickname', async () => {
    const ctx = makeCtx();
    await pageConfig!.saveNickname.call(ctx, '大橙子');

    expect(updateProfileMock).toHaveBeenCalledTimes(1);
    expect(updateProfileMock).toHaveBeenCalledWith({ nickname: '大橙子' });
    expect(ctx.data.nickname).toBe('大橙子');
    expect(ctx._syncedNickname).toBe('大橙子');
  });

  it('saveNickname：trim 后为空不落库', async () => {
    const ctx = makeCtx();
    await pageConfig!.saveNickname.call(ctx, '   ');

    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it('saveNickname：与上次落库值相同 → 去重，不重复 PUT', async () => {
    const ctx = makeCtx();
    ctx._syncedNickname = '大橙子';
    await pageConfig!.saveNickname.call(ctx, '大橙子');

    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it('saveNickname：空串事件值 → 回退 data.nickname 并落库（不再静默丢弃）', async () => {
    // 模拟：bindinput 已把用户输入写进 data，但 blur/confirm 事件给出空串
    const ctx = makeCtx({ nickname: '已输入的值' });
    await pageConfig!.saveNickname.call(ctx, '');

    // 空串回退 data.nickname（仅非空）→ 照常落库，不再静默丢弃
    expect(updateProfileMock).toHaveBeenCalledWith({ nickname: '已输入的值' });
    expect(ctx.data.nickname).toBe('已输入的值');
    expect(ctx._syncedNickname).toBe('已输入的值');
  });

  it('saveNickname：落库成功后写本地昵称缓存（供「我的」页秒显/兜底）', async () => {
    const ctx = makeCtx();
    await pageConfig!.saveNickname.call(ctx, '大橙子');

    expect(writeLocalNicknameMock).toHaveBeenCalledWith('大橙子');
  });

  it('onNickBlur：直读 e.detail.value 保存（不依赖 bindinput）', async () => {
    const ctx = makeCtx();
    await pageConfig!.onNickBlur.call(ctx, { detail: { value: 'Bob' } });

    expect(updateProfileMock).toHaveBeenCalledWith({ nickname: 'Bob' });
    expect(ctx.data.nickname).toBe('Bob');
  });

  it('onNickConfirm：直读 e.detail.value 保存（不依赖 bindinput）', async () => {
    const ctx = makeCtx();
    await pageConfig!.onNickConfirm.call(ctx, { detail: { value: 'Carol' } });

    expect(updateProfileMock).toHaveBeenCalledWith({ nickname: 'Carol' });
  });
});
