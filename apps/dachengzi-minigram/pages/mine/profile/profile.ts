// 个人信息：头像 + 昵称可编辑、邮箱可绑定、手机号置灰（暂不可用）
//
// 头像：微信原生 chooseAvatar 拿临时路径 → 上传 upload-service 拿 URL → 成功后**立即** PUT 落库 avatar（去掉保存按钮后必须即时）。
//   上传失败降级本机临时路径展示，不污染后端。
// 昵称：<input type="nickname"> 微信原生昵称输入，bindblur/bindconfirm 自动 PUT 落库（trim 后非空才落库）。
// 邮箱：自绘验证码页（bind-email），点击跳转即可，不在本页做绑定。
// 手机号：暂不可用，置灰占位（去掉 getPhoneNumber 交互）。
import {
  fetchProfile,
  updateProfile,
  readMessage,
  uploadAvatar,
  isNicknameUnset,
  resolveAvatarUrl,
  readLocalAvatar,
  writeLocalAvatar,
  writeLocalNickname,
} from '../../../services/account';
import { isLoggedIn } from '../../../services/auth';

/** 微信 chooseAvatar 回调事件的 detail（只取用到的字段） */
interface ChooseAvatarEvent {
  detail: { avatarUrl?: string };
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
    /** 昵称；空 = 尚未取到（渲染层兜底「未设置昵称」） */
    nickname: '',
    /** 头像展示路径（后端 URL / 本机持久路径 / 临时路径；空 = 显示「橙」占位） */
    avatarUrl: '',
    /** 账号 id；空则不显示 ID 行 */
    uid: '',
    /** 脱敏邮箱；空串 = 未绑定 */
    email: '',
  },

  /**
   * 最近一次落库成功的昵称（用于去重：失焦/确认若值未变则不重复 PUT）。
   * ⚠️ Page() 参数是对象字面量：运行时字段初始化只能写成 `null as <类型>`（见 mine/index/index.ts）。
   */
  _syncedNickname: null as string | null,

  /** 昵称落库中锁：避免 blur 与 confirm 连发重复提交 */
  _nickSaving: false as boolean,

  async loadProfile() {
    try {
      const info = await fetchProfile();
      const nickname = isNicknameUnset(info.nickname) ? '' : (info.nickname || '');
      const avatar = info.avatar || readLocalAvatar();
      this._syncedNickname = nickname;
      this.setData({
        email: info.email || '',
        nickname,
        // 相对 URL 拼上 apiBase（兼容历史已落库的相对路径）
        avatarUrl: resolveAvatarUrl(avatar),
        uid: info.id ? String(info.id) : '',
      });
    } catch {
      // 拉取失败保持原值，不打扰
    }
  },

  /** 头像：chooseAvatar 回调 → 乐观展示临时路径 → 上传拿 URL → 上传成功即落库（去掉保存按钮后必须即时） */
  onChooseAvatar(e: ChooseAvatarEvent) {
    const tempPath = e?.detail?.avatarUrl;
    if (!tempPath) return;
    // 乐观展示：立即用临时路径回填，避免等待上传期间的空白
    this.setData({ avatarUrl: tempPath });
    void uploadAvatar(tempPath)
      .then((url) => {
        // 上传成功 → 立即 PUT 落库；落库成功才持久化 URL（storage + globalData + 页面态）
        return updateProfile({ avatar: url }).then((updated) => {
          this.persistAvatar(updated.avatar || url);
          wx.showToast({ title: '头像已更新', icon: 'none' });
        });
      })
      .catch((err) => {
        // 上传失败或落库失败：不阻断；本次会话仍展示临时路径（降级）。不落 storage，避免污染多端。
        wx.showToast({ title: readMessage(err, '头像更新失败'), icon: 'none' });
      });
  },

  /** 昵称输入 */
  onNickInput(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value });
  },

  /** 昵称失焦自动保存：直接读事件值，不依赖 bindinput 先更新 data（部分机型 type="nickname" 一键填昵称不触发 bindinput） */
  onNickBlur(e: WechatMiniprogram.InputBlur) {
    void this.saveNickname(e?.detail?.value);
  },

  /** 昵称「完成」键自动保存：同上，直接读事件值 */
  onNickConfirm(e: WechatMiniprogram.InputConfirm) {
    void this.saveNickname(e?.detail?.value);
  },

  /** 昵称自动落库：trim 后非空且与上次落库值不同才 PUT（去掉保存按钮，#9） */
  async saveNickname(value?: string) {
    // 事件直传值优先；空串回退 data.nickname（仅非空），避免 blur/confirm 给出空串时昵称静默丢失
    const raw = (value !== undefined && value !== '') ? value : (this.data.nickname || '');
    const nickname = raw.trim();
    if (!nickname || nickname === this._syncedNickname || this._nickSaving) return;
    this._nickSaving = true;
    try {
      const updated = await updateProfile({ nickname });
      // 成功后以服务端返回为准刷新本地 userInfo / globalData
      const app = getApp<IAppOption>();
      if (app && app.globalData.userInfo) {
        app.globalData.userInfo.nickname = updated.nickname;
      }
      const next = updated.nickname || '';
      this._syncedNickname = next;
      this.setData({ nickname: next });
      // 写本地缓存：供「我的」页秒显/兜底（与头像同口径）
      writeLocalNickname(next);
      wx.showToast({ title: '昵称已更新', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: readMessage(err, '昵称保存失败'), icon: 'none' });
    } finally {
      this._nickSaving = false;
    }
  },

  /** 邮箱：未绑定直接进绑定页；已绑定先二次确认（更换） */
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

  /** 头像持久化到 storage + globalData，并刷新页面态 */
  persistAvatar(path: string) {
    writeLocalAvatar(path);
    const app = getApp<IAppOption>();
    if (app && app.globalData.userInfo) {
      app.globalData.userInfo.avatar = path;
    }
    this.setData({ avatarUrl: resolveAvatarUrl(path) });
  },
});
