// 个人信息：手机号 / 邮箱 三态（未绑定 / 已绑定 / 更换）
import {
  fetchProfile,
  bindPhone,
  bindEmail,
  applyMergedToken,
  readConflict,
  readMessage,
  type BindSource,
} from '../../../services/account';
import { isLoggedIn } from '../../../services/auth';

Page({
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
    // 登录守卫：分享直达等路径可能绕过 tab 的登录墙
    if (!isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateBack();
      return;
    }
    void this.loadProfile();
  },

  data: {
    radiusClass: '',
    nickname: '橙子哥哥',
    uid: '100238',
    joinedAt: '2026-03',
    /** 脱敏手机号；空串 = 未绑定 */
    phone: '',
    /** 脱敏邮箱；空串 = 未绑定 */
    email: '',
    realName: '已认证',
    /** 进行中锁：避免重复提交（真机由一次性 code + 后端兜底） */
    busy: false,
  },

  async loadProfile() {
    try {
      const info = await fetchProfile();
      this.setData({
        phone: info.phone || '',
        email: info.email || '',
        nickname: info.nickname || this.data.nickname,
        uid: String(info.id || this.data.uid),
      });
    } catch {
      // 拉取失败保持原值，不打扰
    }
  },

  /** 手机号：微信手机号快速验证（button open-type="getPhoneNumber" 回调） */
  onGetPhone(e: any) {
    const detail = e?.detail || {};
    // 用户拒绝：静默返回，不提示
    if (detail.errMsg && String(detail.errMsg).includes('deny')) return;
    // 额度不足（errno 1400001）：必须提示，不能静默
    if (detail.errno === 1400001) {
      wx.showToast({ title: '服务暂不可用，请稍后再试', icon: 'none' });
      return;
    }
    if (!detail.code) return;
    const code = detail.code;
    // 已绑定 → 二次确认（写明当前号码将被替换），与「更换邮箱」同一口径
    if (this.data.phone) {
      wx.showModal({
        title: '更换手机号',
        content: `更换需要重新微信授权，当前号码 ${this.data.phone} 将被新号码替换。`,
        confirmText: '更换',
        cancelText: '取消',
        success: (res: any) => {
          if (res.confirm) void this.doBind('phone', { code });
        },
      });
      return;
    }
    void this.doBind('phone', { code });
  },

  /** 邮箱：未绑定直接进绑定页；已绑定先二次确认 */
  onEmailTap() {
    if (this.data.email) {
      wx.showModal({
        title: '更换邮箱',
        content: `更换需要重新验证新邮箱，当前 ${this.data.email} 将被新邮箱替换。`,
        confirmText: '更换',
        cancelText: '取消',
        success: (res: any) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/mine/bind-email/bind-email?purpose=change' });
          }
        },
      });
      return;
    }
    wx.navigateTo({ url: '/pages/mine/bind-email/bind-email' });
  },

  /** 统一绑定入口：冲突 → 二次确认 → confirmMerge 重发 */
  async doBind(source: BindSource, payload: { code?: string; email?: string; emailCode?: string }) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const result =
        source === 'phone'
          ? await bindPhone(payload.code || '')
          : await bindEmail(payload.email || '', payload.emailCode || '');

      if (result.conflict) {
        this.confirmMerge(source, payload, result.hint, result.maskedValue);
        return;
      }
      if (result.merged) {
        applyMergedToken(result);
        wx.showToast({ title: '已合并到该账号（凭证已重签）', icon: 'none' });
      } else {
        wx.showToast({ title: '绑定成功', icon: 'none' });
      }
      void this.loadProfile();
    } catch (err: any) {
      const conflict = readConflict(err);
      if (conflict) {
        this.confirmMerge(source, payload, conflict.hint, conflict.maskedValue);
        return;
      }
      wx.showToast({ title: readMessage(err, '绑定失败，请稍后重试'), icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },

  /** 合并二次确认：写明「会合并数据」与「不可撤销」 */
  confirmMerge(source: BindSource, payload: any, hint: string, masked: string) {
    const title = source === 'phone' ? '该手机号已注册' : '该邮箱已注册';
    wx.showModal({
      title,
      content:
        hint ||
        `${masked} 已注册科豆账号。绑定后会把当前小程序的对话、生词本与口味记忆合并到该账号，合并不可撤销。`,
      confirmText: '确认合并',
      cancelText: '取消',
      success: (res: any) => {
        if (!res.confirm) return;
        void (async () => {
          try {
            const result =
              source === 'phone'
                ? await bindPhone('', true)
                : await bindEmail(payload.email || '', payload.emailCode || '', true);
            if (result.merged) {
              applyMergedToken(result);
              wx.showToast({ title: '已合并到该账号（凭证已重签）', icon: 'none' });
              void this.loadProfile();
            }
          } catch (err: any) {
            wx.showToast({ title: readMessage(err, '合并失败，你的数据未发生变更'), icon: 'none' });
          }
        })();
      },
    });
  },

  editNickname() {
    wx.showToast({ title: '修改昵称开发中', icon: 'none' });
  },
  goVerify() {
    wx.showToast({ title: '已实名认证', icon: 'none' });
  },
  bindWechat() {
    wx.showToast({ title: '已绑定微信', icon: 'none' });
  },
});
