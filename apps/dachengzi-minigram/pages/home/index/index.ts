/**
 * 大橙子英语 · 首页（tab 1 / 启动页）
 *
 * 整改后（specs/dachengzi-minigram/review-remove-ai-2026-11-13.md §2/§3.1）：
 * 问候 hero + 今日一句 + 常用功能（默认 NCE）+「更多功能」跳发现。
 * 已删除：新对话卡、最近对话整块、feature-flags 开关依赖。
 *
 * 为什么首页必须自己登记 tabBar 高亮：自定义 tabBar 组件在每个页面是独立实例，
 * selected 会回到初始值，权威做法见 utils/tabbar.ts 的 setTabBarSelected。
 *
 * 2026-11-26 今日一句交互（用户口径 ⑤）：
 *  - 英文按句切词，只有**当前课文生词**可点（点线下划 + 可点），点开底部词卡看释义；
 *  - 词卡/句子都可朗读：点整句朗读整句、词卡「朗读」读该词；再点同一段即停止；
 *  - 收藏：整句收藏（tag='nce'）与单词收藏（tag='word'）都落 collectGlossary。
 *  - 生词表来源：今日一句缓存只带 book/lessonId，需回查课文详情（utils/quote-words 缓存 7 天）；
 *    取不到词表时降级为「只保留整句朗读/收藏」，不把表外词当生词乱标下划线。
 */
import { isLoggedIn } from '../../../services/auth';
import { readLocalNickname, fetchProfile, isNicknameUnset } from '../../../services/account';
import { formatGreeting, getLocalHour } from '../../../utils/greeting';
import { getDailyQuoteSource, getDailyQuoteMeta, BOOK_LABEL, type DailyQuoteSource } from '../../../utils/daily';
import { setTabBarSelected, TAB_INDEX } from '../../../utils/tabbar';
import { FEATURES, getPinned, FEATURES_UPDATED_EVENT, type FeatureDef } from '../../../utils/features';
import { speakText, onSpeakState, stopSpeak, type SpeakState } from '../../../services/tts';
import { getNceLesson, type NceWord } from '../../../services/nce';
import { collectGlossary } from '../../../services/glossary';
import { tokenize, buildKnown, type WordToken } from '../../../utils/tokenize';
import { lookupWord, type WordLookup } from '../../../utils/lexicon';
import { readWordsCache, writeWordsCache } from '../../../utils/quote-words';

/** 册别角标文案（A3 方案①，原型 d3c3730281e758d8）：中文册名 + · L{课号}；
 *  book 缺失/非法 → 返回空串（WXML 隐藏 pill，不显 undefined）；lessonId 缺失只显册名，绝不编造课号。 */
function badgeTextOf(book?: string, lessonId?: number): string {
  const label = book ? BOOK_LABEL[book] : undefined;
  if (!label) return '';
  return Number.isInteger(lessonId) ? `${label} · L${lessonId}` : label;
}

/** data 初值用的角标文案：与初值句子同一 tick 解析，随首次刷新由 _applyQuote 覆盖。 */
function bookBadgeText(): string {
  const { book, lessonId } = getDailyQuoteMeta();
  return badgeTextOf(book, lessonId);
}

/** 未登录时的登录引导落点：「我的」页有登录入口 */
const MINE_PATH = '/pages/mine/index/index';
const DISCOVER_PATH = '/pages/discover/index/index';

/**
 * 昵称拉取中的中性 loading 占位（原型 114 加载态）。
 * 刻意不含昵称、不含逗号、不含时段文案：拉取中不编造昵称、不另抄文案表；
 * 真实展示串一律由 formatGreeting(nickname, getLocalHour()) 生成。
 * 🔴 只用于 data 初值 / 登录态下的「拉取中」；未登录/登出是确定空态，用 ''（见 showGreetingPlaceholder）。
 */
const GREETING_LOADING = '…';

/**
 * 今日一句初值：句子 + 出处**一次性**解析（P1-1）。
 * 🔴 句子与 book/lessonId 必须出自同一次解析，否则「拿别的课的词表给这句话打点线」——
 *    这正是盲测 P1-1 的错源缺陷（旧实现：句子在模块加载时定死、课号在 onShow 时重算）。
 * data.quote 只暴露 { cn, en }，出处另存 _quoteMeta 供点词/收藏溯源。
 */
const INITIAL_SOURCE: DailyQuoteSource = getDailyQuoteSource();
const INITIAL_QUOTE = { cn: INITIAL_SOURCE.cn, en: INITIAL_SOURCE.en };

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

interface QuoteTapEvent {
  currentTarget: { dataset: { w?: string } };
}

Page({
  data: {
    /** 圆角风格：页面根节点叠加的 class（app.wxss 的 .radius-* 覆盖类驱动） */
    radiusClass: '',
    /**
     * 动态问候：严格「<昵称>，<问候语>」，由 formatGreeting(nickname, getLocalHour()) 生成。
     * 🔴 data 初值即首帧渲染状态，必须与登录态一致，不依赖 onShow 时序兜住：
     *    已登录 → 中性 loading 占位 GREETING_LOADING（拉取中不编造昵称）；
     *    未登录 → ''（确定的空态，首帧就不出现「…」）。
     *    故用三元而非写死：写死占位会让未登录冷启动闪一帧「…」。
     * 绝不在 Page({data}) 初始化阶段调用 fetchProfile()——
     * 拉取只能在 onShow 登录态下触发，守住「未登录整页 login-gate、零业务请求」。
     */
    greetingText: isLoggedIn() ? GREETING_LOADING : '',
    /** 今日一句（本地文案池按日期取模，同天稳定、隔天自动换）—— 形状保持 { cn, en } 不变 */
    quote: INITIAL_QUOTE,
    /** 今日一句英文切词结果（无词表时 hasDef 全 false → 全部纯文本，仅整句可操作） */
    quoteTokens: tokenize(INITIAL_QUOTE.en) as WordToken[],
    /** 今日一句点词词卡（null = 收起） */
    quoteTip: null as WordLookup | null,
    /** 整句朗读中（true = 正在读今日一句） */
    quotePlaying: false,
    /** 正在朗读的单词（'' = 无），驱动词卡「朗读/停止」文案 */
    quoteWordPlaying: '',
    /** 册别角标文案（方案①浅青 pill；book 缺失时为空串 → WXML 隐藏） */
    bookBadge: bookBadgeText(),
    /** 角标开关（默认开；灰度/回滚可置 false 隐藏角标，不影响取句） */
    showBookBadge: true,
    /**
     * 登录态：false 时整页渲染登录引导卡（login-gate），不发起任何业务请求。
     * 🔴 data 初值即首帧渲染状态，必须与登录态一致（isLoggedIn 是纯同步 storage 读），
     *    不依赖 onShow 里的 setData 时序兜住——写死 true 会让未登录冷启动闪一帧 hero。
     */
    loggedIn: isLoggedIn(),
    /** 常用功能（pinned 项，读 utils/features 注册表） */
    features: [] as FeatureDef[],
  },

  _offAuthLogged: null as (() => void) | null,
  _offAuthExpired: null as (() => void) | null,
  _offFeaturesUpdated: null as (() => void) | null,
  /** 「资料已更新」广播退订函数（onUnload 调用）：昵称改动即时重算问候 */
  _offProfileUpdated: null as (() => void) | null,
  /** 今日一句朗读状态订阅退订（onUnload） */
  _offSpeakState: null as (() => void) | null,
  /** 今日一句所在课文的词表（点词查释义 / hasDef 判定） */
  _quoteWords: [] as NceWord[],
  /** 屏幕上这句话的出处（与 data.quote 同源）；点词查词失败不猜、收藏溯源不记错课号 */
  _quoteMeta: { book: INITIAL_SOURCE.book, lessonId: INITIAL_SOURCE.lessonId } as {
    book?: string;
    lessonId?: number;
  },
  /** 意图标记：本次朗读是否为单词（'' = 整句或无）；仅在事件未携带文本时兜底 */
  _speakingWord: '' as string,
  /** 真实播放文本（'' = 空闲）：只由 tts 的 onSpeakState 回流，页面不自己猜（P2-1） */
  _playingText: '' as string,
  /** 词表拉取序号：切走再回来 / 隔天换句时丢弃过期响应 */
  _quoteSeq: 0 as number,

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
        if (!p.nickname) return;
        // P2-1：广播携带的是「更新的权威值」。进入应用前先推进序号，把此前所有在途的
        // refreshGreeting 响应（其 fetchProfile 携的是旧昵称）判为过期——否则
        // 「广播(新名) → 旧响应后到(旧名)」会把刚改好的昵称刷回旧名（回跳）。
        this._greetSeq += 1;
        this.applyGreeting(p.nickname, getLocalHour());
      };
      __bus.on('profile:updated', this._offProfileUpdated);
    }
    // 今日一句朗读状态：播放结束/中断由 tts 推 null，页面据此复位按钮态
    this._offSpeakState = onSpeakState((s) => this._onSpeakState(s));
  },

  onUnload() {
    // 先关闸：卸载后任何晚到的异步回调都不许再 setData
    this._alive = false;
    this.stopGreetingTicker();
    stopSpeak();
    if (this._offSpeakState) {
      this._offSpeakState();
      this._offSpeakState = null;
    }
    this._speakingWord = '';
    this._playingText = '';
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
    // 切走即停朗读：首页是 tab 页常驻，后台继续出声会打扰
    stopSpeak();
    this._speakingWord = '';
    // 不依赖 stopSpeak 的 null 一定被收到：播放态一并显式归零（null 事件仍会复位 data）
    this._playingText = '';
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
    void this.loadQuoteWords();
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
   *  - 🔴 未登录立即返回：整页 login-gate、零业务请求，greetingText 置空串（''，确定的空态，
   *    不是「…」加载态——P2-3：留占位会在登录态切换瞬间闪「…」）。
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
      // 登出：在途响应一律作废（序号推进），文案清空（''）
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

  /** 未登录 / 登出态：回到确定的空态（''），同样做重绘去重 */
  showGreetingPlaceholder() {
    this._greetNick = '';
    this._greetHour = -1;
    // P2-3：未登录是「确定的空态」而非「加载中」。空串由 index.wxml 的 wx:if="{{loggedIn}}" 兜住；
    // 若这里仍写 GREETING_LOADING，未登录↔登录切换那一瞬会闪一个「…」。
    if (this.data.greetingText !== '') {
      this.setData({ greetingText: '' });
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

  /* ─────────────── 今日一句：点词 / 朗读 / 收藏（2026-11-26 ⑤） ─────────────── */

  /**
   * 取今日一句所在课文的词表：有缓存直接用，无缓存回查课文详情（结果写入 utils/quote-words 缓存）。
   * 取不到（缺 book/lessonId、请求失败）→ 空词表：今日一句退化为「纯文本 + 整句朗读/收藏」，
   * 绝不把表外词错标成生词（否则违背「非生词不高亮」）。
   *
   * 🔴 P1-1：句子与词表必须同源 —— 这里只解析**一次**来源（getDailyQuoteSource），
   *    句子与词表在同一个 setData 里一起落地，不会出现「屏幕是 A 句、点线来自 B 课」。
   *    首启「兜底句 → 池子就绪」也自洽：池子还没到位时只有兜底句 + 兜底句自己那课的词表；
   *    池子到位后句子换新、词表同刷（旧实现是句子永不刷新、课号每次 onShow 重算）。
   */
  async loadQuoteWords() {
    const seq = (this._quoteSeq += 1);
    const src = getDailyQuoteSource();
    const { book, lessonId } = src;
    if (!book || !Number.isInteger(lessonId)) {
      // 无出处（旧缓存行缺字段）：屏幕这句话按纯文本降级，不换句、不猜课号
      this._applyQuoteWords(this.data.quote.en, []);
      return;
    }
    const id = Number(lessonId);
    const cached = readWordsCache(book, id);
    if (cached) {
      this._applyQuote(src, cached);
      return;
    }
    let detail: unknown;
    try {
      detail = await getNceLesson(id, book);
    } catch {
      if (!this._alive || seq !== this._quoteSeq) return;
      // 回查失败：保持屏幕现状（不换句、不错源），本次按纯文本降级，下次进页再回源
      this._applyQuoteWords(this.data.quote.en, []);
      return;
    }
    // ⚠️ try 只包请求：落地逻辑不在 catch 里，避免页面自身缺陷被「静默降级」掩盖
    if (!this._alive || seq !== this._quoteSeq) return;
    const raw = detail ? (detail as { words?: unknown }).words : undefined;
    // P2-5：「响应缺 words 字段」是降级信号，不是「本课没有生词」——不落缓存，
    // 否则空数组会被当成有效值缓存 7 天，后端修好了也回不来。
    const hasWordsField = Array.isArray(raw);
    const words = hasWordsField ? (raw as NceWord[]) : [];
    if (hasWordsField) writeWordsCache(book, id, words);
    this._applyQuote(src, words);
  },

  /** 写词表并重切当前这句话（hasDef 只认词表直收词）；不换句，供降级路径复用 */
  _applyQuoteWords(en: string, words: NceWord[]) {
    this._quoteWords = words;
    this.setData({ quoteTokens: tokenize(en, buildKnown(words)) });
  },

  /**
   * 句子与词表**同一次**落地（P1-1 的核心约束）：句子、切词、出处、角标一起写。
   * 调用方保证 words 属于 src 这句话的课文。
   */
  _applyQuote(src: DailyQuoteSource, words: NceWord[]) {
    this._quoteWords = words;
    this._quoteMeta = { book: src.book, lessonId: src.lessonId };
    this.setData({
      quote: { cn: src.cn, en: src.en },
      quoteTokens: tokenize(src.en, buildKnown(words)),
      bookBadge: badgeTextOf(src.book, src.lessonId),
    });
  },

  /** 点生词 → 底部词卡；再点同一词收起、点其它词替换内容 */
  onQuoteWordTap(e: QuoteTapEvent) {
    const w = String((e.currentTarget.dataset.w) || '').toLowerCase();
    if (!w) return;
    const cur = this.data.quoteTip;
    if (cur && cur.word === w) {
      // 收起卡片 = 关卡片：与 closeQuoteTip 同口径（P2-4，正在读这个词就停掉）
      this.closeQuoteTip();
      return;
    }
    this.setData({ quoteTip: lookupWord(w, this._quoteWords), quoteWordPlaying: '' });
  },

  /** 关闭词卡：顺手停掉「词卡朗读」（P2-4，与详情页 closeTip 同口径）。
   *  判据看「当前真实在播的文本」而不是会被换词清掉的标记位：是整句 → 不停（用户可能想继续听）。 */
  closeQuoteTip() {
    const playing = this._playingText;
    if (playing && playing !== String(this.data.quote.en || '').trim()) {
      stopSpeak();
      this._speakingWord = '';
      this._playingText = '';
    }
    this.setData({ quoteTip: null, quoteWordPlaying: '' });
  },

  /** 点整句（英文空白/卡片空白）→ 朗读整句；再点同句由 speakText 的 same-text 语义停止 */
  speakQuote() {
    this._speakingWord = '';
    void speakText(this.data.quote.en);
  },

  /** 词卡「朗读」→ 读该词；再点停止 */
  speakQuoteWord() {
    const tip = this.data.quoteTip;
    if (!tip || !tip.word) return;
    this._speakingWord = tip.word;
    void speakText(tip.word);
  },

  /**
   * 屏幕上这句话的出处（收藏溯源 / 角标）：优先用 _applyQuote 记下的那份，
   * 保证与 data.quote 同源（P1-1）；尚未记录时回源一次，绝不凭当天课号硬猜。
   */
  _sourceMeta(): { book?: string; lessonId?: number } {
    const m = this._quoteMeta;
    if (m) return m;
    const { book, lessonId } = getDailyQuoteMeta();
    return { book, lessonId };
  },

  /** 收藏整句：tag='nce'，与课文详情页句子收藏同一契约（收藏页显示 Lesson · 第 N 句） */
  async collectQuote() {
    if (!isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const q = this.data.quote;
    // P1-1：出处取「屏幕上这句话」的记录，不在收藏时重算（否则课号会与句子错源）
    const { book, lessonId } = this._sourceMeta();
    const src = `今日一句${book ? ` · ${book}` : ''}${Number.isInteger(lessonId) ? ` · Lesson ${lessonId}` : ''}`;
    try {
      const res = await collectGlossary({
        tag: 'nce',
        enMain: q.en,
        note: q.cn,
        sourceText: src,
        meta: { book, lessonId, from: 'daily' },
      });
      wx.showToast({ title: res.existed ? '已在收藏中' : '已收藏', icon: 'none' });
    } catch (err) {
      // 失败提示由 utils/request.ts 统一负责；页面只留排障痕
      console.error('[home/collectQuote]', err);
    }
  },

  /** 收藏单词：tag='word'，与详情页长按「收藏单词」同一契约 */
  async collectQuoteWord() {
    const tip = this.data.quoteTip;
    if (!tip || !tip.word) return;
    if (!isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    // P1-1：出处同上，取屏幕上这句话的记录（收藏页 metaText 的 Lesson 号才对得上句子）
    const { book, lessonId } = this._sourceMeta();
    const note = [tip.pos, tip.def].filter(Boolean).join(' ');
    try {
      const res = await collectGlossary({
        tag: 'word',
        enMain: tip.word,
        note,
        sourceText: `今日一句${Number.isInteger(lessonId) ? ` · Lesson ${lessonId}` : ''}`,
        meta: { book, lessonId, word: tip.word, phonetic: tip.phonetic || '', from: 'daily' },
      });
      wx.showToast({ title: res.existed ? '已在生词本' : '已收藏', icon: 'none' });
    } catch (err) {
      console.error('[home/collectQuoteWord]', err);
    }
  },

  /**
   * 朗读状态：null 复位；非 null 时**按 tts 推来的权威文本**点亮对应按钮（P2-1）。
   * 🔴 不能用 _speakingWord 反推：speakText 内部会先 stopSpeak() 推一次 null，
   *    页面收到 null 就把标记位清零，紧接着的 loading/playing 用清零后的标记算 → 永远点不亮
   *    （「整句在播 → 点词卡朗读」时更会把整句按钮错亮成停止态）。
   *    以 s.text 判定：等于整句 → 整句亮；否则就是单词朗读 → 词卡按钮亮。
   */
  _onSpeakState(s: SpeakState | null) {
    if (!s) {
      this._playingText = '';
      this._speakingWord = '';
      this.setData({ quotePlaying: false, quoteWordPlaying: '' });
      return;
    }
    const text = String(s.text || '').trim();
    this._playingText = text;
    if (!text) {
      // 事件未携带文本（兼容老调用方）：退回意图标记，行为与改动前一致
      this.setData({ quotePlaying: !this._speakingWord, quoteWordPlaying: this._speakingWord });
      return;
    }
    const isQuote = text === String(this.data.quote.en || '').trim();
    this.setData({ quotePlaying: isQuote, quoteWordPlaying: isQuote ? '' : text });
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
