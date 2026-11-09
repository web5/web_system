// 个人信息：手机号 / 邮箱 三态（未绑定 / 已绑定 / 更换）
//
// 只保留有真数据源的项：昵称（读 /api/auth/verify）、手机号（微信原生验证组件）、
// 邮箱（自绘验证码页）。原「昵称」点击行、「实名认证」、「微信账号」三行已整行删除——
// 昵称无 updateProfile 接口、实名认证随合同评估下线失去存在理由、
// 微信账号在 wx.login 取 openid 时即完成且原状态是写死的「已绑定」。
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

/** 微信手机号快速验证回调事件的 detail（只取用到的字段） */
interface PhoneEventDetail {
  code?: string;
  errMsg?: string;
  errno?: number;
}
interface PhoneEvent {
  detail: PhoneEventDetail;
}

/** 绑定入参：手机号走一次性 code，邮箱走地址 + 验证码 */
interface BindPayload {
  code?: string;
  email?: string;
  emailCode?: string;
}

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
    /** 昵称；空 = 尚未取到（渲染层兜底，不写死假昵称） */
    nickname: '',
    /** 账号 id；空则不显示 ID 行 */
    uid: '',
    /** 脱敏手机号；空串 = 未绑定 */
    phone: '',
    /** 脱敏邮箱；空串 = 未绑定 */
    email: '',
    /** 进行中锁：避免重复提交（真机由一次性 code + 后端兜底） */
    busy: false,
  },

  async loadProfile() {
    try {
      const info = await fetchProfile();
      this.setData({
        phone: info.phone || '',
        email: info.email || '',
        nickname: info.nickname || '',
        uid: info.id ? String(info.id) : '',
      });
    } catch {
      // 拉取失败保持原值，不打扰
    }
  },

  /** 手机号：微信手机号快速验证（button open-type="getPhoneNumber" 回调） */
  onGetPhone(e: PhoneEvent) {
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
        success: (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
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
        success: (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
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
  async doBind(source: BindSource, payload: BindPayload) {
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
    } catch (err) {
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
  confirmMerge(source: BindSource, payload: BindPayload, hint: string, masked: string) {
    const title = source === 'phone' ? '该手机号已注册' : '该邮箱已注册';
    wx.showModal({
      title,
      content:
        hint ||
        `${masked} 已注册大橙子个人助理账号。绑定后会把当前小程序的翻译记录、课文学习进度与生词本合并到该账号，合并不可撤销。`,
      confirmText: '确认合并',
      cancelText: '取消',
      success: (res: WechatMiniprogram.ShowModalSuccessCallbackResult) => {
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
          } catch (err) {
            wx.showToast({ title: readMessage(err, '合并失败，你的数据未发生变更'), icon: 'none' });
          }
        })();
      },
    });
  },
});
