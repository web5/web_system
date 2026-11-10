// 个人信息：头像 + 昵称可编辑、邮箱可绑定、手机号置灰（暂不可用）
//
// 头像：微信原生 chooseAvatar 拿临时路径 → 上传 upload-service 拿 URL → 随「保存」PATCH 到后端 avatar（跨端同步）。
//   上传成功持久化 URL 到 storage + globalData；上传失败降级本机临时路径展示，不污染后端。
// 昵称：<input type="nickname"> 微信原生昵称输入，随「保存」PATCH 到后端持久化。
// 邮箱：自绘验证码页（bind-email），点击跳转即可，不在本页做绑定。
// 手机号：暂不可用，置灰占位（去掉 getPhoneNumber 交互）。
import { fetchProfile, updateProfile, readMessage, uploadAvatar } from '../../../services/account';
import { isLoggedIn } from '../../../services/auth';

/** 头像本地持久化 storage key */
const AVATAR_STORAGE_KEY = 'kd_profile_avatar';

/** 微信 chooseAvatar 回调事件的 detail（只取用到的字段） */
interface ChooseAvatarEvent {
  detail: { avatarUrl?: string };
}

/** 读本地持久化头像路径（读不到返回空串，交由渲染层兜底「橙」占位） */
function readLocalAvatar(): string {
  try {
    return wx.getStorageSync(AVATAR_STORAGE_KEY) || '';
  } catch {
    return '';
  }
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
    /** 保存中锁：避免重复提交 */
    saving: false,
  },

  /**
   * 本次会话内「已上传成功的头像 URL」（onSave 据此决定是否带 avatar 字段）。
   * 未上传成功过 = null，避免把本机临时路径传到后端污染多端字段。
   * ⚠️ Page() 参数是对象字面量：运行时字段初始化只能写成 `null as <类型>`（见 mine/index/index.ts）。
   */
  _syncedAvatarUrl: null as string | null,

  async loadProfile() {
    try {
      const info = await fetchProfile();
      this.setData({
        email: info.email || '',
        nickname: info.nickname || '',
        avatarUrl: info.avatar || readLocalAvatar(),
        uid: info.id ? String(info.id) : '',
      });
    } catch {
      // 拉取失败保持原值，不打扰
    }
  },

  /** 头像：chooseAvatar 回调 → 乐观展示临时路径 → 上传拿 URL → 成功持久化 URL，失败降级本机展示 */
  onChooseAvatar(e: ChooseAvatarEvent) {
    const tempPath = e?.detail?.avatarUrl;
    if (!tempPath) return;
    // 乐观展示：立即用临时路径回填，避免等待上传期间的空白
    this.setData({ avatarUrl: tempPath });
    void uploadAvatar(tempPath)
      .then((url) => {
        // 上传成功：记录已同步 URL（onSave 用），并持久化到 storage + globalData + 页面态
        this._syncedAvatarUrl = url;
        this.persistAvatar(url);
      })
      .catch(() => {
        // 上传失败：不阻断；本次会话仍展示临时路径（降级）。不落 storage，避免临时路径污染多端。
        wx.showToast({ title: '头像上传失败，未同步', icon: 'none' });
      });
  },

  /** 昵称输入 */
  onNickInput(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value });
  },

  /** 保存：昵称持久化到后端；头像若本次上传成功过则一并 PATCH（否则不传，避免临时路径污染多端） */
  async onSave() {
    if (this.data.saving) return;
    const nickname = (this.data.nickname || '').trim();
    this.setData({ saving: true });
    try {
      const updated = await updateProfile({
        nickname,
        avatar: this._syncedAvatarUrl || undefined,
      });
      // 成功后以服务端返回为准刷新本地 userInfo / globalData
      const app = getApp<IAppOption>();
      if (app && app.globalData.userInfo) {
        app.globalData.userInfo.nickname = updated.nickname;
        if (updated.avatar) {
          app.globalData.userInfo.avatar = updated.avatar;
        }
      }
      this.setData({ nickname: updated.nickname || '' });
      if (updated.avatar) this.setData({ avatarUrl: updated.avatar });
      wx.showToast({ title: '已保存', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: readMessage(err, '保存失败，请稍后重试'), icon: 'none' });
    } finally {
      this.setData({ saving: false });
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
    try {
      wx.setStorageSync(AVATAR_STORAGE_KEY, path);
    } catch {
      // 写 storage 失败不阻断展示
    }
    const app = getApp<IAppOption>();
    if (app && app.globalData.userInfo) {
      app.globalData.userInfo.avatar = path;
    }
    this.setData({ avatarUrl: path });
  },
});
