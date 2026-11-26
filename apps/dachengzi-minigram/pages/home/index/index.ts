/**
 * 大橙子英语 · 首页（tab 1 / 启动页）
 *
 * 整改后（specs/dachengzi-minigram/review-remove-ai-2026-11-13.md §2/§3.1）：
 * 问候 hero + 今日一句 + 常用功能（默认 NCE）+「更多功能」跳发现。
 * 已删除：新对话卡、最近对话整块、feature-flags 开关依赖。
 *
 * 为什么首页必须自己登记 tabBar 高亮：自定义 tabBar 组件在每个页面是独立实例，
 * selected 会回到初始值，权威做法见 utils/tabbar.ts 的 setTabBarSelected。
 */
import { isLoggedIn } from '../../../services/auth';
import { readLocalNickname, fetchProfile, isNicknameUnset } from '../../../services/account';
import { formatGreeting, getLocalHour } from '../../../utils/greeting';
import { getDailyQuote, getDailyQuoteMeta, BOOK_LABEL } from '../../../utils/daily';
import { setTabBarSelected, TAB_INDEX } from '../../../utils/tabbar';
import { FEATURES, getPinned, FEATURES_UPDATED_EVENT, type FeatureDef } from '../../../utils/features';

/** 册别角标文案（A3 方案①，原型 d3c3730281e758d8）：中文册名 + · L{课号}；
 *  book 缺失/非法 → 返回空串（WXML 隐藏 pill，不显 undefined）；lessonId 缺失只显册名，绝不编造课号。 */
function bookBadgeText(): string {
  const { book, lessonId } = getDailyQuoteMeta();
  const label = book ? BOOK_LABEL[book] : undefined;
  if (!label) return '';
  return Number.isInteger(lessonId) ? `${label} · L${lessonId}` : label;
}

/** 未登录时的登录引导落点：「我的」页有登录入口 */
const MINE_PATH = '/pages/mine/index/index';
const DISCOVER_PATH = '/pages/discover/index/index';

/**
 * 昵称拉取中的中性 loading 占位（原型 114 加载态）。
 * 刻意不含昵称、不含逗号、不含时段文案：拉取中不编造昵称、不另抄文案表；
 * 真实展示串一律由 formatGreeting(nickname, getLocalHour()) 生成。
 */
const GREETING_LOADING = '…';

/**
 * 跨时段重算的心跳周期（ms）。tabBar 页常驻不销毁，
 * 11:50 停到 12:10 若不重算就还挂着「早上好」——靠这个 tick 兜住。
 * 60s 粒度足够（时段边界是整点），且只在「本地小时真的变了」时才 setData。
 */
const GREETING_TICK_MS = 60 * 1000;

/** 当前「常用功能」项（按 getPinned 顺序映射注册表） */
function pinnedFeatures(): FeatureDef[] {
  const ids = getPinned();
  return FEATURES.filter((f) => ids.includes(f.id));
}

interface FeatureTapEvent {
  currentTarget: { dataset: { path?: string } };
}

Page({
  data: {
    /** 圆角风格：页面根节点叠加的 class（app.wxss 的 .radius-* 覆盖类驱动） */
    radiusClass: '',
    /**
     * 动态问候：严格「<昵称>，<问候语>」，由 formatGreeting(nickname, getLocalHour()) 生成。
     * 初值为中性 loading 占位，绝不在 Page({data}) 初始化阶段调用 fetchProfile()——
     * 拉取只能在 onShow 登录态下触发，守住「未登录整页 login-gate、零业务请求」。
     */
    greetingText: GREETING_LOADING,
    /** 今日一句（本地文案池按日期取模，同天稳定、隔天自动换） */
    quote: getDailyQuote(),
    /** 册别角标文案（方案①浅青 pill；book 缺失时为空串 → WXML 隐藏） */
    bookBadge: bookBadgeText(),
    /** 角标开关（默认开；灰度/回滚可置 false 隐藏角标，不影响取句） */
    showBookBadge: true,
    /** 登录态：false 时整页渲染登录引导卡（login-gate），不发起任何业务请求 */
    loggedIn: true,
    /** 常用功能（pinned 项，读 utils/features 注册表） */
    features: [] as FeatureDef[],
  },

  _offAuthLogged: null as (() => void) | null,
  _offAuthExpired: null as (() => void) | null,
  _offFeaturesUpdated: null as (() => void) | null,
  /** 「资料已更新」广播退订函数（onUnload 调用）：昵称改动即时重算问候 */
  _offProfileUpdated: null as (() => void) | null,

  /**
   * 卸载守卫：onLoad 置 true、onUnload 置 false。
   * 修复「onUnload 之后 setData」——晚到的 fetchProfile 响应在已销毁页面上 setData 会告警/丢数据。
   * 默认 true：允许被测上下文不调 onLoad 也能驱动（生产路径必经 onLoad）。
   */
  _alive: true as boolean,
  /**
   * 请求序号：每次 refreshGreeting 自增，回调只在「自己仍是最新一次」时落 setData。
   * 修复「并发竞态」——onShow 连触发时旧响应后到会把刚改好的昵称刷回去。
   */
  _greetSeq: 0 as number,
  /** 跨时段重算定时器句柄（onHide / onUnload 必须清掉，否则 tabBar 页常驻泄漏） */
  _greetTimer: null as ReturnType<typeof setInterval> | null,
  /** 上一次算文案用的本地小时（-1 = 尚未算过）；ticker 只在小时间真的变了才重算 */
  _greetHour: -1 as number,
  /** 已解析昵称缓存：ticker 复用它重算，不重发 verify、不重拉 profile */
  _greetNick: '' as string,

  onLoad() {
    this._alive = true;
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      this._offAuthLogged = () => this.setData({ loggedIn: isLoggedIn() });
      __bus.on('auth:logged', this._offAuthLogged);
      this._offAuthExpired = () => this.setData({ loggedIn: false });
      __bus.on('auth:expired', this._offAuthExpired);
      // 常用功能变更广播：发现页「添加常用」后本页即时刷新
      this._offFeaturesUpdated = () => this.refreshPinned();
      __bus.on(FEATURES_UPDATED_EVENT, this._offFeaturesUpdated);
      // 「资料已更新」广播：昵称在别处保存成功后即时重算问候，不必等下一次 onShow
      this._offProfileUpdated = (payload?: unknown) => {
        if (!this._alive) return;
        const p = (payload || {}) as { nickname?: string };
        if (p.nickname) this.applyGreeting(p.nickname, getLocalHour());
      };
      __bus.on('profile:updated', this._offProfileUpdated);
    }
  },

  onUnload() {
    // 先关闸：卸载后任何晚到的异步回调都不许再 setData
    this._alive = false;
    this.stopGreetingTicker();
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      if (this._offAuthLogged) {
        __bus.off('auth:logged', this._offAuthLogged);
        this._offAuthLogged = null;
      }
      if (this._offAuthExpired) {
        __bus.off('auth:expired', this._offAuthExpired);
        this._offAuthExpired = null;
      }
      if (this._offFeaturesUpdated) {
        __bus.off(FEATURES_UPDATED_EVENT, this._offFeaturesUpdated);
        this._offFeaturesUpdated = null;
      }
      if (this._offProfileUpdated) {
        __bus.off('profile:updated', this._offProfileUpdated);
        this._offProfileUpdated = null;
      }
    }
  },

  /** 切走 tab 时停表：不占后台定时器，回来 onShow 再起 */
  onHide() {
    this.stopGreetingTicker();
  },

  onShow() {
    setTabBarSelected(this, TAB_INDEX.home);
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
    this.setData({ loggedIn: isLoggedIn() });
    this.refreshPinned();
    this.startGreetingTicker();
    this.refreshGreeting();
  },

  /** 登录卡登录成功后回调：刷新登录态与常用功能 */
  onLogged() {
    this.setData({ loggedIn: isLoggedIn() });
    this.refreshPinned();
    this.startGreetingTicker();
    this.refreshGreeting();
  },

  /**
   * 动态问候（page-spec §2026-11-23 ① / 原型 114）：
   *  - 🔴 未登录立即返回：整页 login-gate、零业务请求，greetingText 保持中性占位。
   *    fetchProfile() 绝不写进 Page({data}) 初始化，只在登录态的 onShow / onLogged 触发。
   *  - 昵称三态（照搬 pages/mine/index/index.ts 的既有范式）：
   *    本地 readLocalNickname() 秒显 → fetchProfile() 收敛 → isNicknameUnset() 判空/wx_ 占位
   *    → 回退本地缓存 → formatGreeting 内 resolveNickname 兜底「同学」。
   *  - 拉取中：无本地缓存就维持 GREETING_LOADING 占位，不闪烁、不编造昵称。
   *  - 时区只认设备本地时区：hour 一律取 getLocalHour()（内部 Date#getHours()，
   *    纯函数层 utils/greeting.ts），页面不写死 UTC+8、不引第三方库。
   *  - 展示串严格「<昵称>，<问候语>」由 formatGreeting 生成，页面/wxml 不自己拼逗号。
   */
  refreshGreeting() {
    if (!isLoggedIn()) {
      // 登出：在途响应一律作废（序号推进），文案回到中性占位
      this._greetSeq += 1;
      this.showGreetingPlaceholder();
      return;
    }

    // 序号先推进：此后任何更早的响应都判定为过期
    const seq = (this._greetSeq += 1);

    // 秒显：有本地缓存昵称立即出问候，避免进页空白；没有就维持 loading 占位等收敛
    const local = readLocalNickname();
    if (local) this.applyGreeting(local, getLocalHour());

    void fetchProfile()
      .then((info) => {
        // B：页面已卸载 / C：已有更新的一次 refreshGreeting → 本次结果直接丢弃
        if (!this._alive || seq !== this._greetSeq) return;
        // isNicknameUnset 判空 / wx_ 占位 → 回退本地缓存；最终兜底「同学」交给 formatGreeting
        const nick = isNicknameUnset(info.nickname) ? readLocalNickname() : (info.nickname || '');
        this.applyGreeting(nick, getLocalHour());
      })
      .catch(() => {
        if (!this._alive || seq !== this._greetSeq) return;
        // 拉取失败：沿用本地缓存 / 兜底，绝不编造昵称（hero 装饰位静默降级，不打扰用户）
        this.applyGreeting(readLocalNickname(), getLocalHour());
      });
  },

  /**
   * 唯一写入口：算串 → 与当前值比对 → 不同才 setData。
   * D：本地昵称先写一次、profile 回来再写一次，如果文案一致就不重复重绘（不闪）。
   * 同时记录「本次用的昵称 / 小时」，供 ticker 复用（不重拉 profile）。
   */
  applyGreeting(nickname: string, hour: number) {
    this._greetNick = nickname;
    this._greetHour = hour;
    const text = formatGreeting(nickname, hour);
    if (text === this.data.greetingText) return;
    this.setData({ greetingText: text });
  },

  /** 未登录 / 登出态：回到中性占位（同样做重绘去重） */
  showGreetingPlaceholder() {
    this._greetNick = '';
    this._greetHour = -1;
    if (this.data.greetingText !== GREETING_LOADING) {
      this.setData({ greetingText: GREETING_LOADING });
    }
  },

  /** 起跨时段心跳（重复调用不会叠加：先清再起） */
  startGreetingTicker() {
    this.stopGreetingTicker();
    this._greetTimer = setInterval(() => this.onGreetingTick(), GREETING_TICK_MS);
  },

  stopGreetingTicker() {
    if (this._greetTimer !== null) {
      clearInterval(this._greetTimer);
      this._greetTimer = null;
    }
  },

  /**
   * A：跨时段自动重算。tabBar 页常驻，进页时是「早上好」，停留过 12:00 仍挂着旧文案。
   * 这里只做两件廉价事：读本地小时 + 与上次比对；**小时没变就什么都不做**。
   * 不发 verify、不重拉 profile（复用 _greetNick 已解析昵称），失败/登出态直接跳过。
   */
  onGreetingTick() {
    if (!this._alive) return;
    if (!isLoggedIn()) return;
    const hour = getLocalHour();
    if (hour === this._greetHour) return;
    this.applyGreeting(this._greetNick, hour);
  },

  refreshPinned() {
    this.setData({ features: pinnedFeatures() });
  },

  /** 点常用功能卡：needLogin 项先判登录，再 navigateTo */
  goFeature(e: FeatureTapEvent) {
    const path = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.path) || '');
    const feature = FEATURES.find((f) => f.path === path);
    if (!feature) return;
    if (feature.needLogin && !isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.switchTab({ url: MINE_PATH });
      return;
    }
    wx.navigateTo({ url: feature.path });
  },

  /** 更多功能 → 发现页（tab 2，全部功能列表） */
  goMore() {
    wx.switchTab({ url: DISCOVER_PATH });
  },

  onShareAppMessage() {
    return { title: '大橙子英语', path: '/pages/home/index/index' };
  },
});
