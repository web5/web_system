/**
 * 大橙子英语 · 我的（tab 3）
 *
 * 整改后（specs/dachengzi-minigram/review-remove-ai-2026-11-13.md §2/§3.3）：
 * 头像卡 + 课文学习进度 + 收藏（原生词本）+ 设置 + 协议 + 关于。
 * 已删除：我的翻译记录、翻译设置两行，及其 translate-keys / feature-flags 依赖。
 *
 * 数字一律读真数据，读不到就显示空 / 未开始，绝不写死假数字。
 */
import { listGlossary } from '../../../services/glossary';
import { isLoggedIn } from '../../../services/auth';
import { fetchProfile, isNicknameUnset, resolveAvatarUrl, readLocalAvatar, readLocalNickname } from '../../../services/account';
import { setTabBarSelected, TAB_INDEX } from '../../../utils/tabbar';

Page({
  data: {
    radiusClass: '',
    /** 登录态：false 时整页渲染登录引导卡（不拉任何业务数据） */
    loggedIn: true,
    /** 昵称；空/占位 = 未设置（渲染层显示引导「点击设置昵称」，不显示 wx_ 乱码） */
    nickname: '',
    /** 头像 URL；空 = 未设置（渲染层兜底「橙」占位） */
    avatar: '',
    /** 脱敏手机号；空 = 未绑定（禁止展示硬编码假数据） */
    phone: '',
    /** 脱敏邮箱；空 = 未绑定（手机未绑时展示兜底） */
    email: '',
    /** 收藏条数摘要 */
    glossarySummary: '0 条',
    /** 课文学习进度：暂无进度落库接口，先显示「未开始」（不编造数字） */
    nceSummary: '未开始',
  },

  _offAuthExpired: null as (() => void) | null,
  _offAuthLogged: null as (() => void) | null,
  /** 「资料已更新」广播退订函数（onUnload 调用） */
  _offProfileUpdated: null as (() => void) | null,

  /**
   * 账号信息脏标记：上一次 fetchProfile 失败置 true，收敛成功后清 false。
   * 用途仅限**可观测 + 后续重试提示**。⛔ 绝不可用它拦 onShow 的 fetchProfile。
   */
  profileStale: false as boolean,

  onLoad() {
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      this._offAuthExpired = () => this.setData({ loggedIn: false });
      __bus.on('auth:expired', this._offAuthExpired);
      this._offAuthLogged = () => {
        this.setData({ loggedIn: isLoggedIn() });
        this.onShow();
      };
      __bus.on('auth:logged', this._offAuthLogged);
      this._offProfileUpdated = (payload?: unknown) => {
        const p = (payload || {}) as { nickname?: string; avatar?: string };
        const patch: Record<string, string> = {};
        if (p.nickname) patch.nickname = p.nickname;
        if (p.avatar) patch.avatar = resolveAvatarUrl(p.avatar);
        if (Object.keys(patch).length) this.setData(patch);
      };
      __bus.on('profile:updated', this._offProfileUpdated);
    }
  },

  onUnload() {
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      if (this._offAuthExpired) {
        __bus.off('auth:expired', this._offAuthExpired);
        this._offAuthExpired = null;
      }
      if (this._offAuthLogged) {
        __bus.off('auth:logged', this._offAuthLogged);
        this._offAuthLogged = null;
      }
      if (this._offProfileUpdated) {
        __bus.off('profile:updated', this._offProfileUpdated);
        this._offProfileUpdated = null;
      }
    }
  },

  onShow() {
    setTabBarSelected(this, TAB_INDEX.mine);

    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

    const loggedIn = isLoggedIn();
    this.setData({ loggedIn });
    // 未登录：只渲染登录卡，不发起任何业务请求
    if (!loggedIn) return;

    // 账号信息秒显：先读本地缓存（昵称/头像），避免每次进页先空白，再 fetchProfile 收敛
    const localNickname = readLocalNickname();
    const localAvatar = readLocalAvatar();
    if (localNickname || localAvatar) {
      this.setData({
        ...(localNickname ? { nickname: localNickname } : {}),
        ...(localAvatar ? { avatar: resolveAvatarUrl(localAvatar) } : {}),
      });
    }

    void fetchProfile()
      .then((info) => {
        this.profileStale = false;
        this.setData({
          phone: info.phone || '',
          email: info.email || '',
          nickname: isNicknameUnset(info.nickname) ? readLocalNickname() : (info.nickname || ''),
          avatar: resolveAvatarUrl(info.avatar || readLocalAvatar()),
        });
      })
      .catch((e: unknown) => {
        this.profileStale = true;
        console.warn('[mine] 账号信息拉取失败，本次沿用本地缓存/旧值，下次进页重试', e);
      });

    // 收藏只取总数（pageSize=1），失败保持 0 条不打扰
    void listGlossary(1, 1)
      .then((r) => {
        this.setData({ glossarySummary: (r.total || 0) + ' 条' });
      })
      .catch(() => undefined);
  },

  goProfile() { wx.navigateTo({ url: '/pages/mine/profile/profile' }); },
  /** 课文学习进度：进课文列表（进度暂无落库接口） */
  goNce() { wx.navigateTo({ url: '/pages/nce/index/index' }); },
  goGlossary() { wx.navigateTo({ url: '/pages/mine/glossary/index' }); },
  goAppSettings() { wx.navigateTo({ url: '/pages/mine/settings/settings' }); },
  goAgreement() { wx.navigateTo({ url: '/pages/mine/agreement/agreement' }); },
  goAbout() { wx.navigateTo({ url: '/pages/mine/about/about' }); },

  /** 登录卡登录成功后回调：刷新本页内容 */
  onLogged() {
    this.setData({ loggedIn: isLoggedIn() });
    this.onShow();
  },
});
