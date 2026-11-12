/**
 * 大橙子个人助理 · 我的（tab 3）
 *
 * 范围收敛：头像卡 + 学习 3 项（翻译记录 / 课文学习进度 / 生词本）
 * + 通用 4 项（翻译设置 / 设置 / 用户协议与隐私政策 / 关于与免责）。
 * 退出登录已归入「设置」页，本页不再提供退出入口。
 * 专业版、AI 记忆（口味 / 记忆）、合同评估设置、我的合同、对话记录、消息通知、清除缓存
 * 已全部移除（能力不在本期范围内；清除缓存已挪进「设置」页）。
 *
 * 数字一律读真数据，读不到就显示空 / 未开始，绝不写死假数字。
 */
import { listGlossary } from '../../../services/glossary';
import { isLoggedIn } from '../../../services/auth';
import { fetchProfile, isNicknameUnset, resolveAvatarUrl, readLocalAvatar, readLocalNickname } from '../../../services/account';
import { setTabBarSelected, TAB_INDEX } from '../../../utils/tabbar';
import { TRANSLATE_HISTORY_KEY } from '../../../utils/translate-keys';
import { readFlags, FLAGS_UPDATED_EVENT, FlagsState } from '../../../utils/feature-flags';

/** 翻译记录条数：读本地历史（写入方 = packageTranslate result 页，key 与 history 页一致） */
function readTrCount(): string {
  try {
    const list: unknown = wx.getStorageSync(TRANSLATE_HISTORY_KEY);
    if (Array.isArray(list) && list.length) return list.length + ' 条';
  } catch {
    // 读不到就留空：宁可不显示，也不编造条数
  }
  return '';
}

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
    /** 脱敏邮箱；空 = 未绑定（手机未绑时展示兜底，#1） */
    email: '',
    /** 本机翻译记录条数（空则不展示数字） */
    trCount: '',
    /** 生词本条数摘要 */
    glossarySummary: '0 条',
    /** 课文学习进度：暂无进度落库接口，先显示「未开始」（不编造数字） */
    nceSummary: '未开始',
    /** 本地功能开关：flags.translate 控制「我的翻译记录 / 翻译设置」两行（默认关，安全侧） */
    flags: { chat: false, translate: false } as FlagsState,
  },

  /**
   * 登录态过期广播退订函数（onUnload 调用）。
   * ⚠️ Page() 参数是对象字面量、没有类属性语法：`xxx: T = v` 会被解析成「把 T 当值用」，
   * 真机编译 fatal（TS2693）——运行时字段初始化只能写成 `null as <类型>`。
   */
  _offAuthExpired: null as (() => void) | null,
  _offAuthLogged: null as (() => void) | null,
  /** 「资料已更新」广播退订函数（onUnload 调用） */
  _offProfileUpdated: null as (() => void) | null,
  /** 功能开关变更广播退订函数（onUnload 调用） */
  _offFlagsUpdated: null as (() => void) | null,

  /**
   * 账号信息脏标记：上一次 fetchProfile 失败置 true，收敛成功后清 false。
   * 用途仅限**可观测 + 后续重试提示**（台账 #8688：`:125` 原为 `.catch(() => undefined)`，
   * 「拿不到数据」与「数据就是旧值」界面上不可区分）。
   * ⛔ 绝不可用它拦 onShow 的 fetchProfile —— 本类问题的复发根源正是「读侧有守卫」。
   */
  profileStale: false as boolean,

  onLoad() {
    // 登录态过期广播：request 401 清 token 后发 auth:expired → 本页弹登录墙。
    // （旧方案 reLaunch 回首页会清空页面栈，致右滑返回永远回首页，已废弃）
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      this._offAuthExpired = () => this.setData({ loggedIn: false });
      __bus.on('auth:expired', this._offAuthExpired);
      // 登录成功广播：首启静默登录成功后刷新登录态并重拉账号信息（收口首启竞态）
      this._offAuthLogged = () => {
        this.setData({ loggedIn: isLoggedIn() });
        this.onShow();
      };
      __bus.on('auth:logged', this._offAuthLogged);
      // 资料已更新广播：详情页保存昵称/头像成功后 emit → 本页立即回显。
      // 台账 #8688：原先只有 storage 写入（profile.ts:132/162），已挂载的本页收不到任何通知，
      // 只能指望 onShow 重跑且 fetchProfile 成功 → 「保存成功但本页仍显示旧值」。
      this._offProfileUpdated = (payload?: unknown) => {
        const p = (payload || {}) as { nickname?: string; avatar?: string };
        const patch: Record<string, string> = {};
        if (p.nickname) patch.nickname = p.nickname;
        // 与 :122 同口径：相对 URL 必须拼 apiBase，否则 <image> 按包内路径解析导致加载失败
        if (p.avatar) patch.avatar = resolveAvatarUrl(p.avatar);
        if (Object.keys(patch).length) this.setData(patch);
      };
      __bus.on('profile:updated', this._offProfileUpdated);
      // 功能开关变更广播：设置页拨开关后本页即时重渲染（翻译两行出现/消失）
      this._offFlagsUpdated = () => this.setData({ flags: readFlags() });
      __bus.on(FLAGS_UPDATED_EVENT, this._offFlagsUpdated);
    }
  },

  onUnload() {
    // 退订登录态广播，避免回调打到已销毁实例
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
      if (this._offFlagsUpdated) {
        __bus.off(FLAGS_UPDATED_EVENT, this._offFlagsUpdated);
        this._offFlagsUpdated = null;
      }
    }
  },

  onShow() {
    // tabBar 高亮登记：组件每页独立实例，须由页面显式登记（详见 utils/tabbar.ts）
    setTabBarSelected(this, TAB_INDEX.mine);

    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

    const loggedIn = isLoggedIn();
    // 开关状态每次进页以 storage 为准刷新
    this.setData({ loggedIn, flags: readFlags() });
    // 未登录：只渲染登录卡，不发起任何业务请求（判据第 8 条）
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

    // 账号信息：头像 / 昵称 / 手机号（未绑定显示占位文案，不展示假数据；wx_ 占位昵称按未设置兜底）
    void fetchProfile()
      .then((info) => {
        this.profileStale = false;
        this.setData({
          // 手机未绑定时不写占位，交由渲染层按 phone → email → 占位兜底（#1）
          phone: info.phone || '',
          email: info.email || '',
          nickname: isNicknameUnset(info.nickname) ? readLocalNickname() : (info.nickname || ''),
          avatar: resolveAvatarUrl(info.avatar || readLocalAvatar()),
        });
      })
      .catch((e: unknown) => {
        // 台账 #8688：原先 `.catch(() => undefined)` 把失败完全吞掉，无 toast / 无日志 / 无标记，
        // 于是「拿不到数据」与「数据就是旧值」在界面上不可区分（这既是难查的根因，也是真机复现不可判定的原因）。
        // 现在：console.warn 留痕 + 置脏标记。⚠️ 标记只是给「可观测 / 后续重试」用，
        // 下一次 onShow **照常**重拉（不许拿它当跳过请求的守卫，见 profileStale 注释）。
        this.profileStale = true;
        console.warn('[mine] 账号信息拉取失败，本次沿用本地缓存/旧值，下次进页重试', e);
      });

    // 翻译记录条数：本地历史实时读；生词本只取总数（pageSize=1），失败保持 0 条不打扰
    this.setData({ trCount: readTrCount() });
    void listGlossary(1, 1)
      .then((r) => {
        this.setData({ glossarySummary: (r.total || 0) + ' 条' });
      })
      .catch(() => undefined);
  },

  goProfile() { wx.navigateTo({ url: '/pages/mine/profile/profile' }); },
  goHistory() { wx.navigateTo({ url: '/packageTranslate/pages/translate/history/history' }); },
  /** 课文学习进度：进课文列表（进度暂无落库接口） */
  goNce() { wx.navigateTo({ url: '/pages/nce/index/index' }); },
  goGlossary() { wx.navigateTo({ url: '/pages/mine/glossary/index' }); },
  /** 翻译设置：翻译功能自己的默认参数（源/目标语言、语气、风格、发音、流式） */
  goTrSettings() { wx.navigateTo({ url: '/packageTranslate/pages/translate/settings/settings' }); },
  goAppSettings() { wx.navigateTo({ url: '/pages/mine/settings/settings' }); },
  goAgreement() { wx.navigateTo({ url: '/pages/mine/agreement/agreement' }); },
  goAbout() { wx.navigateTo({ url: '/pages/mine/about/about' }); },

  /** 登录卡登录成功后回调：刷新本页内容 */
  onLogged() {
    this.setData({ loggedIn: isLoggedIn() });
    this.onShow();
  },
});
