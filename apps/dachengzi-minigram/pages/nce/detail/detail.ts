/**
 * 新概念英语 · 课文详情（D1=C / V7-C 生效 · 通篇阅读视图）
 *
 * 生效真源：10-D1方案C冻结与技术方案.md（08 整份作废）。
 *
 * 需求①（V1–V8）：
 * - V1/V7-C：顶部工具条不存在「连续朗读」入口；无整篇/连播调度；进页不自动播；
 *   句子区无常驻 ♪/☆ 控件。C ≠ 删掉所有朗读 —— V5 单句朗读仍可用。
 * - V2 点句就地展开该句中文（再点收起、同时至多 1 句、不触发 speakText）。
 * - V3 点词中文 tip：封闭规则表 R3（V3-A）查 d.words[]；表外词「暂无释义」且保留可点。
 * - V4 平台原生 bindlongpress 长按句子出自绘气泡（含且仅含「朗读此句」「收藏」）。
 * - V5 气泡「朗读此句」= 恰好一次 speakText(line.en)、仅该句高亮；再点同句停止。
 * - V6 收藏沿用 collectGlossary({tag:'nce', …}) 契约；T1 未登录弹 modal-login「请先登录」。
 * - V8 字号三级 + S0–S5 逐态无常驻控件。
 *
 * 需求②（V9–V20，本页面也是三数据页之一）：
 * - V11 页面级 authExpired 标志 + load() catch 分流（会话过期不裸失败、保持骨架准备弹窗）。
 * - V12/V13/V18 login-gate modal 态弹窗 + 页面级订阅（onLoad on / onUnload off）。
 * - V16 auth:logged 回调内显式 void this.load()，不依赖 onShow()。
 * - V17 稍后→常驻提示条→再唤起；登录成功前不消失。
 *
 * 选项 A（18 §5，2026-11-18）：仅对齐 D-01/D-02 锚定浮层、D-03 配色反相、
 * D-04/D-11 信息结构与操作提示、D-06 词点线、D-07 展开态蓝系、D-09 句序号；
 * D-05（.head 保留）/ D-08 / D-10 / D-1 / D-2 均不在本轮范围。
 *
 * 2026-11-19 19:11 口径变更：生词 tip 作废「就近锚定」，改移动端底部统一浮层。
 * onWordTap 不再为 tip 调用 _anchorFloat；tipPos 字段保留但不得驱动 word-tip。
 * 🔴 _anchorFloat 函数本体与 bubblePos 长按气泡锚定逻辑完全保留、行为不变。
 *
 * 2026-11-20 治本授权（用户原话「不做临时修补，要从合理的实现方案去改」）：
 *    原「utils/request.ts 一律不改」红线就此解除 —— 依据 49 §5 方案 B，在
 *    utils/request.ts 建立失败提示统一错误契约（常规失败必有且仅有一条中文 string toast），
 *    页面层不再自行弹失败 toast / 不再做 hasHttpResponse 判定，只保留 console.error 排障留痕。
 *    services/tts.ts / services/auth.ts 仍零改动；speakText/stopSpeak/onSpeakState、
 *    loginFromGate、collectGlossary 既有契约不变。
 *
 * 2026-11-26 阅读体验 5 项（用户口径，cli-preview 可验）：
 *  - ① 沉浸档由「整段连排」改为「逐句一行」（仍整篇连续阅读），文末参考译文同步逐句换行；
 *  - ② 非课文生词点击不再有任何词级高亮（.w:active 只对 .has-def 生效），
 *       事件也只在生词节点上挂 —— 点非生词等同点句子空白（点按档仍展开该句中文）；
 *  - ③ 新增长按生词 → 自绘气泡「朗读单词 / 收藏单词」（长按句子气泡两项行为不变）；
 *  - ④ 底部生词词卡新增「朗读」按钮（读该词，再点停止）。
 *  - 生词点按开词卡的档位由「仅 tap 档」放宽为全档（沉浸/双语也可查词），
 *    非生词在任何档位都不出词卡。
 */
import { getNceLesson, type NceLessonDetail } from '../../../services/nce';
import { DEFAULT_NCE_BOOK, nceBookTotal } from '../books';
import { speakText, onSpeakState, stopSpeak, type SpeakState } from '../../../services/tts';
import { collectGlossary } from '../../../services/glossary';
import { isLoggedIn, loginFromGate } from '../../../services/auth';
import { tokenize, buildKnown, type WordToken } from '../../../utils/tokenize';
import { lookupWord, type WordLookup } from '../../../utils/lexicon';

/** D-01/D-02：浮层锚定坐标（rpx，页面坐标；null = 收起 / 未定位） */
interface FloatPos {
  left: number;
  top: number;
}
/** SelectorQuery.exec 结果元素形状（只声明所需字段，避免 any） */
interface FloatRect { left?: number; bottom?: number; }
interface FloatScroll { scrollTop?: number; }

interface NceLineView {
  /** 稳定 key（wx:key），避免嵌套 wx:for 下默认 index 遮蔽 */
  idx: number;
  en: string;
  cn: string;
  tokens: WordToken[];
}

/** 词卡视图 = utils/lexicon 的查词结果（详情页与首页共用同一形状） */
type WordTipView = WordLookup;

/** 长按生词气泡（2026-11-26 ③）：含且仅含「朗读单词」「收藏单词」 */
interface WordBubble {
  /** 小写词形（查词 / 朗读 / 收藏用） */
  word: string;
  /** 所属句下标（收藏 meta.lineIndex） */
  lineIdx: number;
  /** 气泡左上角（rpx，页面坐标） */
  left: number;
  top: number;
}

interface NceTapEvent {
  currentTarget: { dataset: Record<string, string | number | boolean | undefined> };
  /** 长按事件带原生触点（pageX/pageY 为页面坐标，px）：用于长按生词气泡定位 */
  touches?: Array<{ pageX?: number; pageY?: number; clientX?: number; clientY?: number }>;
}

/** V21+ 阅读三档：沉浸（连排通读）/ 双语（中文常显）/ 点按=精读（逐句展开 + 生词 tip）。默认沉浸。 */
type ReadMode = 'immersion' | 'bilingual' | 'tap';
const READ_MODES: ReadMode[] = ['immersion', 'bilingual', 'tap'];
/** 把任意 storage / dataset 值收敛到合法档，非法/缺失一律回落默认档 immersion。 */
function normalizeMode(v: unknown): ReadMode {
  return typeof v === 'string' && (READ_MODES as string[]).includes(v) ? (v as ReadMode) : 'immersion';
}

/**
 * 切词与查表已抽到 utils/tokenize.ts / utils/lexicon.ts（2026-11-26）：
 * 首页「今日一句」与详情页共用同一套 hasDef 判定与 R3 规则表，避免两处口径漂移。
 */

Page({
  /** 朗读状态订阅的退订函数（onHide / onUnload 时调用） */
  _offSpeakState: null as null | (() => void),
  /** 当前正在朗读的句下标（-1 = 无） */
  _playingIdx: -1,
  /** 当前正在朗读的单词（'' = 本次朗读不是单词；仅用于词卡/单词气泡按钮态） */
  _speakingWord: '' as string,
  /** auth 事件订阅退订（V18 成对，页面级；组件内不订阅） */
  _offAuthExpired: null as null | (() => void),
  _offAuthLogged: null as null | (() => void),

  data: {
    id: 0,
    /** 当前书册（默认 NCE2） */
    book: DEFAULT_NCE_BOOK,
    detail: null as NceLessonDetail | null,
    lines: [] as NceLineView[],
    loading: true,
    error: '',
    /** 字号档位：0=A- / 1=A / 2=A+（持久化 nce-font） */
    fontStep: 1,
    /** V21+ 阅读档（持久化 nce-mode，默认 immersion）；与 fontStep 正交，切档互不复位 */
    readMode: 'immersion' as ReadMode,
    /** V24 文末「参考译文 / 中文解释」折叠区（默认收起） */
    cnExpanded: false,
    /** V24 整篇 lines[].cn 拼接（load 时生成，含空值兜底） */
    fullCn: '',
    /** 页面根节点叠加的圆角 class */
    radiusClass: '',
    /** V5 单句朗读高亮句下标（-1 = 无） */
    readingLineIdx: -1,
    readingPhase: 'idle',
    /** V2 点句展开中文下标（-1 = 无；至多 1 句） */
    expandedIdx: -1,
    /** V4 长按气泡所在句下标（-1 = 无） */
    bubbleIdx: -1,
    /** V3 点词 tip（null = 收起） */
    tipWord: null as WordTipView | null,
    /** 2026-11-26 ④：词卡「朗读」按钮播放态（true = 正在朗读该词） */
    tipPlaying: false,
    /** 2026-11-26 ③ 长按生词气泡（null = 收起） */
    wordBubble: null as WordBubble | null,
    /** 2026-11-26 ③ 正在朗读的单词（'' = 无）：驱动词卡/单词气泡按钮文案 */
    wordPlaying: '',
    /** 19:11：tipPos 字段保留（切档/换课/收起时仍清），但不再驱动底部浮层 word-tip */
    tipPos: null as FloatPos | null,
    /** D-02 长按气泡锚定坐标（rpx；null = 收起） */
    bubblePos: null as FloatPos | null,
    /** V6 T1 未登录守卫弹窗 modal-login「请先登录」 */
    guestLoginShow: false,
    /** V11 页面级会话过期标志（由 auth:expired 订阅置位） */
    authExpired: false,
    /** V12 T2 会话过期弹窗（login-gate modal 态） */
    showAuthModal: false,
    /** V17 稍后后的常驻提示条（登录成功前不消失） */
    showReloginTip: false,
  },

  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
    this._subscribeReading();
  },

  onHide() {
    this._unsubscribeReading();
    stopSpeak();
  },

  onUnload() {
    this._unsubscribeReading();
    stopSpeak();
    // V18：页面级退订（与 onLoad 成对，同一 handler 引用 off；组件内不订阅）
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
    }
  },

  onLoad(options: { id?: string | number; book?: string }) {
    const id = Number(options && options.id);
    const book = String((options && options.book) || DEFAULT_NCE_BOOK);
    const fontStep = wx.getStorageSync('nce-font');
    // V21+ 阅读档：与字号档两个独立 storage key，各自读取、互不复位（正交）。
    const readMode = normalizeMode(wx.getStorageSync('nce-mode'));
    const realId = id > 0 ? id : 1;
    this.setData({
      id: realId,
      book,
      fontStep: typeof fontStep === 'number' ? fontStep : 1,
      readMode,
    });
    // V13/V18：页面级订阅（onLoad on / onUnload off；先按旧引用退订防重复订阅）
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      if (this._offAuthExpired) __bus.off('auth:expired', this._offAuthExpired);
      if (this._offAuthLogged) __bus.off('auth:logged', this._offAuthLogged);
      this._offAuthExpired = () => {
        // T2：置页面级标志 + 弹 modal-auth；保持骨架/原内容，不置裸失败态
        this.setData({ authExpired: true, showAuthModal: true, showReloginTip: false });
      };
      __bus.on('auth:expired', this._offAuthExpired);
      this._offAuthLogged = () => {
        // V16：回调内显式重拉，不依赖 onShow()（详情页 onShow 不调 load）
        this.setData({
          authExpired: false,
          showAuthModal: false,
          showReloginTip: false,
          guestLoginShow: false,
        });
        void this.load();
      };
      __bus.on('auth:logged', this._offAuthLogged);
    }
    void this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const d = await getNceLesson(this.data.id, this.data.book);
      if (!d) {
        this.setData({ error: '未找到该课，可能尚未入库', loading: false });
        return;
      }
      // D-06：仅词汇表直收词带点线标记；换课时清空两个浮层锚点，避免残留旧坐标
      const known = buildKnown(d.words || []);
      const lines: NceLineView[] = (d.lines || []).map((l, i) => ({
        idx: i, en: l.en, cn: l.cn, tokens: tokenize(l.en, known),
      }));
      // V24 参考译文 = 整篇 lines[].cn 按句拼接（跳过空值）。
      // 2026-11-26 ①：分隔符由 '' 改 '\n' —— 配合 .cn-fold-c 的 white-space: pre-wrap，
      // 译文与英文一样「一句一行」，不再挤成一段。
      const cnParts = lines.map((l) => (l.cn || '').trim()).filter((s) => s.length > 0);
      const fullCn = cnParts.length ? cnParts.join('\n') : '（本课暂无参考译文）';
      wx.setNavigationBarTitle({ title: `Lesson ${d.id} · ${d.title}` });
      this.setData({
        detail: d, lines, readingLineIdx: -1, readingPhase: 'idle',
        expandedIdx: -1, bubbleIdx: -1, tipWord: null, tipPos: null,
        bubblePos: null, fullCn, cnExpanded: false, loading: false,
        wordBubble: null, wordPlaying: '', tipPlaying: false,
      });
      this._speakingWord = '';
    } catch {
      // V11：会话过期不裸失败；保持骨架/原内容（loading 保持 true），准备弹窗
      if (this.data.authExpired) return;
      this.setData({ error: '课文加载失败，请稍后重试', loading: false });
    }
  },

  setFont(e: NceTapEvent) {
    const fontStep = Number(e.currentTarget.dataset.step || 1);
    // V22 正交：只写 nce-font / 只改 fontStep，绝不碰 nce-mode / readMode。
    wx.setStorageSync('nce-font', fontStep);
    this.setData({ fontStep });
  },

  /** V21 切阅读档：只写 nce-mode / 只改 readMode，绝不碰 nce-font / fontStep（正交）。切档清浮层。 */
  setReadMode(e: NceTapEvent) {
    const mode = normalizeMode(e.currentTarget.dataset.mode);
    wx.setStorageSync('nce-mode', mode);
    this.setData({
      readMode: mode,
      expandedIdx: -1, bubbleIdx: -1,
      tipWord: null, tipPos: null, bubblePos: null,
      wordBubble: null, tipPlaying: false,
    });
  },

  /** V24 文末「参考译文 / 中文解释」折叠区开合（默认收起）。 */
  toggleCnSection() {
    this.setData({ cnExpanded: !this.data.cnExpanded });
  },

  /**
   * V21+ 点句/点词共用的按档分派（27 §3.3）：
   * - tap（精读）：toggle 该句 expandedIdx（展开/收起该句中文，至多 1 句，不触发 speakText）；
   * - immersion / bilingual：不设 expandedIdx（沉浸不展开逐句中文、双语中文常显），只清浮层。
   * 🔴 WXML 不按档动态切 bind/catch，.w 始终 catchtap=onWordTap，分发全部收敛到本方法。
   */
  _applyLineTap(i: number) {
    const line = this.data.lines[i];
    if (!line) return;
    const clear = { bubbleIdx: -1, tipWord: null, tipPos: null, bubblePos: null, wordBubble: null, tipPlaying: false };
    if (this.data.readMode === 'tap') {
      this.setData({ ...clear, expandedIdx: this.data.expandedIdx === i ? -1 : i });
    } else {
      this.setData({ ...clear, expandedIdx: -1 });
    }
  },

  /** V2/V23 点句空白热区：与点词热区共用 _applyLineTap，保证「点句任意位置」同语义。 */
  toggleLine(e: NceTapEvent) {
    this._applyLineTap(Number(e.currentTarget.dataset.i));
  },

  /**
   * D-02 长按气泡锚定浮层（19:11 后仅 bubblePos 使用；生词 tip 已改底部统一浮层，不再走这里）：
   * 取被长按句的视口 rect + 页面滚动偏移，换算成页面坐标 rpx 后写入 bubblePos 供 WXML style 绑定。
   * 原型 03:1134-1165 positionFloat(anchor) 取 left=(rect.left+8) / top=(rect.bottom+6)；
   * 小程序 boundingClientRect 为视口坐标，故 top 需叠加 scrollTop 才是页面坐标。
   * 🔴 tipPos 分支保留（字段仍在），但 onWordTap 不再调用本方法；长按气泡行为不变。
   */
  _anchorFloat(selector: string, key: 'tipPos' | 'bubblePos') {
    const k = 750 / (wx.getSystemInfoSync().windowWidth || 375); // px → rpx（750 设计稿）
    wx.createSelectorQuery().select(selector).boundingClientRect().selectViewport().scrollOffset().exec((res: unknown) => {
      const list: unknown[] = Array.isArray(res) ? res : [];
      const r = (list[0] || {}) as FloatRect;
      const s = (list[1] || {}) as FloatScroll;
      const pos: FloatPos = {
        left: Math.round((Number(r.left || 0) + 8) * k),
        top: Math.round((Number(r.bottom || 0) + Number(s.scrollTop || 0) + 6) * k),
      };
      if (key === 'tipPos') this.setData({ tipPos: pos });
      else this.setData({ bubblePos: pos });
    });
  },

  /**
   * 点词热区分发（2026-11-26 ② 口径变更）：
   * - 非生词（hasDef=false，含标点/空白）→ 不产生任何词级反馈，语义等同点句子空白（_applyLineTap）；
   *   WXML 侧非生词节点已不挂事件，这里是兜底，防止别处直接调用时行为漂移。
   * - 生词 → 任意阅读档都出底部词卡（不再限 tap 档）：沉浸/双语阅读中也可随时查词；
   *   再点同一词收起、再点其它词替换内容。词卡不展开该句中文、不锚定、不写 tipPos。
   */
  onWordTap(e: NceTapEvent) {
    const ds = e.currentTarget.dataset;
    const i = Number(ds.i ?? 0);
    const hasDef = ds.hasdef === true || ds.hasdef === 'true';
    const raw = String(ds.w || '');
    if (!hasDef || !raw) {
      this._applyLineTap(i);
      return;
    }
    const w = raw.toLowerCase();
    const cur = this.data.tipWord;
    if (cur && cur.word === w) {
      this.setData({ tipWord: null, tipPos: null, tipPlaying: false });
      return;
    }
    // 19:11 ③：底部浮层由 tipWord 驱动；不取 anchor、不调 _anchorFloat、不写 tipPos。
    this.setData({
      tipWord: this._lookupWord(w), tipPos: null, tipPlaying: false,
      bubbleIdx: -1, bubblePos: null, wordBubble: null,
    });
  },

  /** 关闭词卡：顺手停掉「词卡朗读」，避免关掉卡片还在放音。 */
  closeTip() {
    if (this.data.tipPlaying) {
      stopSpeak();
      this._speakingWord = '';
    }
    this.setData({ tipWord: null, tipPos: null, tipPlaying: false });
  },

  /**
   * 2026-11-26 ④ 词卡「朗读」：读当前单词；再点同词由 speakText 的 same-text 语义停止。
   * 播放态经 onSpeakState 回流（wordPlaying / tipPlaying），页面不自己猜结束时机。
   */
  speakTipWord() {
    const tip = this.data.tipWord;
    if (!tip || !tip.word) return;
    this._speakingWord = tip.word;
    this._playingIdx = -1;
    void speakText(tip.word);
  },

  /**
   * 2026-11-26 ③ 长按生词 → 自绘气泡「朗读单词 / 收藏单词」。
   * 定位用长按原生的 pageX/pageY（页面坐标 px）直接换算 rpx，不做 SelectorQuery，
   * 避免与句子气泡的 _anchorFloat 抢同一份坐标状态；长按句子仍是原两项气泡。
   */
  onWordLongPress(e: NceTapEvent) {
    const ds = e.currentTarget.dataset;
    const i = Number(ds.i ?? 0);
    const w = String(ds.w || '').toLowerCase();
    if (!w) return;
    const t = (e.touches && e.touches[0]) || null;
    const px2rpx = 750 / (wx.getSystemInfoSync().windowWidth || 375);
    const px = Number((t && (t.pageX !== undefined ? t.pageX : t.clientX)) || 0);
    const py = Number((t && (t.pageY !== undefined ? t.pageY : t.clientY)) || 0);
    // 气泡宽 340rpx：右边界夹紧，避免长按行尾词时气泡出屏
    const left = Math.max(0, Math.min(Math.round(px * px2rpx), 750 - 340));
    const top = Math.round(py * px2rpx + 8);
    this.setData({
      wordBubble: { word: w, lineIdx: i, left, top },
      bubbleIdx: -1, bubblePos: null,
      tipWord: null, tipPos: null, tipPlaying: false,
    });
  },

  closeWordBubble() { this.setData({ wordBubble: null }); },

  /** 单词气泡「朗读单词」：读该词并收起气泡 */
  onWordBubbleSpeak() {
    const wb = this.data.wordBubble;
    if (!wb) return;
    this.setData({ wordBubble: null });
    this._speakingWord = wb.word;
    this._playingIdx = -1;
    void speakText(wb.word);
  },

  /**
   * 单词气泡「收藏单词」：沿用 collectGlossary 契约，tag='word'。
   * note 存「词性 + 释义」便于收藏页直接读；meta 带 word/phonetic/lineIndex 供溯源。
   * 未登录同句子收藏：弹 modal-login「请先登录」。
   */
  async collectWord() {
    const wb = this.data.wordBubble;
    if (!wb) return;
    this.setData({ wordBubble: null });
    if (!isLoggedIn()) {
      this.setData({ guestLoginShow: true });
      return;
    }
    const info = this._lookupWord(wb.word);
    const { id, book, detail } = this.data;
    const note = [info.pos, info.def].filter(Boolean).join(' ');
    try {
      const res = await collectGlossary({
        tag: 'word',
        enMain: info.word || wb.word,
        note,
        sourceText: `Lesson ${id} · ${detail ? detail.title : ''}`,
        meta: { book, lessonId: id, lineIndex: wb.lineIdx, word: info.word || wb.word, phonetic: info.phonetic || '' },
      });
      wx.showToast({ title: res.existed ? '已在生词本' : '已收藏', icon: 'none' });
    } catch (err) {
      // 失败提示由 utils/request.ts 统一负责；页面只留排障痕
      console.error('[nce/collectWord]', err);
    }
  },

  /**
   * V3-A 查词：实现在 utils/lexicon.ts（R3 封闭规则表，与首页今日一句共用）。
   * 保留本方法作页面内统一入口，测试与后续调用点不变。
   */
  _lookupWord(w: string): WordTipView {
    const detail = this.data.detail;
    return lookupWord(w, (detail && detail.words) || []);
  },

  /** V4 平台原生 bindlongpress 长按气泡（与 bindtap 同句节点，平台互斥分发）+ D-02 锚点 */
  onLongPress(e: NceTapEvent) {
    const i = Number(e.currentTarget.dataset.i);
    const line = this.data.lines[i];
    if (!line) return;
    this.setData({
      bubbleIdx: i, expandedIdx: -1, tipWord: null, tipPos: null,
      wordBubble: null, tipPlaying: false,
    });
    this._anchorFloat(`#line-${i}`, 'bubblePos');
  },

  closeBubble() { this.setData({ bubbleIdx: -1, bubblePos: null }); },

  /** V5 气泡「朗读此句」：恰好一次 speakText(line.en)、仅该句高亮；再点同句停止 */
  onBubbleSpeak(e: NceTapEvent) {
    const i = Number(e.currentTarget.dataset.i);
    const line = this.data.lines[i];
    if (!line) return;
    if (this.data.readingLineIdx === i) {
      // same-text 再点 → 停止（tts.ts 零改动，页面侧显式 stopSpeak）
      stopSpeak();
      this._playingIdx = -1;
      this.setData({ readingLineIdx: -1, readingPhase: 'idle', bubbleIdx: -1, bubblePos: null });
      return;
    }
    this._playingIdx = i;
    this._speakingWord = ''; // 读句子：清掉「单词朗读」标记，避免词卡按钮态串味
    this.setData({ readingLineIdx: i, readingPhase: 'loading', bubbleIdx: -1, bubblePos: null });
    void speakText(line.en);
  },

  /** V6 收藏：collectGlossary({tag:'nce', …}) 契约不变；T1 弹「请先登录」 */
  async collectLine(e: NceTapEvent) {
    const i = Number(e.currentTarget.dataset.i);
    const line = this.data.lines[i];
    if (!line) return;
    this.setData({ bubbleIdx: -1, bubblePos: null });
    if (!isLoggedIn()) {
      this.setData({ guestLoginShow: true });
      return;
    }
    const { id, book, detail } = this.data;
    try {
      const res = await collectGlossary({
        tag: 'nce',
        enMain: line.en,
        note: line.cn || '',
        sourceText: `Lesson ${id} · ${detail ? detail.title : ''}`,
        meta: { book, lessonId: id, lineIndex: i },
      });
      wx.showToast({ title: res.existed ? '已在收藏中' : '已收藏', icon: 'none' });
    } catch (err) {
      // 失败提示由 utils/request.ts 统一负责（49 §5 方案 B / 11-20 治本授权）：
      // 常规失败在请求层保证「有且仅有一条中文 string toast」；页面层只保留排障留痕
      // （后端 400 的 statusCode / message 供排查），不再自行弹 toast / 不再做 hasHttpResponse 判定，
      // 避免与请求层重复弹或把数组 message 直接塞进 wx.showToast 的 title。
      console.error('[nce/collect]', err);
    }
  },

  /** T1「去登录」：复用 loginFromGate() 语义；成功由 auth:logged 广播收起并重拉 */
  async onGuestLogin() {
    const ok = await loginFromGate();
    if (ok) this.setData({ guestLoginShow: false });
  },

  onCloseGuest() { this.setData({ guestLoginShow: false }); },

  /** V17「稍后」：收起弹窗 + 常驻提示条（不是纯 closeModal） */
  onAuthDefer() {
    this.setData({ showAuthModal: false, showReloginTip: true });
  },

  /** V17 点提示条再次唤起同一 modal-auth；提示条登录成功前不消失 */
  onReopenAuth() {
    this.setData({ showAuthModal: true });
  },

  goLesson(e: NceTapEvent) {
    const delta = Number(e.currentTarget.dataset.delta || 0);
    const next = this.data.id + delta;
    const total = nceBookTotal(this.data.book);
    if (next < 1 || next > total) {
      wx.showToast({ title: '已经是最后一课了', icon: 'none' });
      return;
    }
    stopSpeak();
    this.setData({ id: next, readingLineIdx: -1, readingPhase: 'idle', wordBubble: null, wordPlaying: '', tipPlaying: false });
    this._speakingWord = '';
    void this.load();
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  onRetry() { void this.load(); },

  /** 朗读状态：null 复位；非 null 高亮跟随当前朗读句（V5 单句朗读态）+ 单词朗读按钮态 */
  _onSpeakState(s: SpeakState | null) {
    if (!s) {
      this._playingIdx = -1;
      this._speakingWord = '';
      this.setData({ readingLineIdx: -1, readingPhase: 'idle', wordPlaying: '', tipPlaying: false });
      return;
    }
    const tip = this.data.tipWord;
    this.setData({
      readingPhase: s.phase === 'loading' ? 'loading' : 'playing',
      readingLineIdx: this._playingIdx,
      wordPlaying: this._speakingWord,
      tipPlaying: !!this._speakingWord && !!tip && tip.word === this._speakingWord,
    });
  },

  _subscribeReading() {
    if (!this._offSpeakState) this._offSpeakState = onSpeakState((s) => this._onSpeakState(s));
  },

  _unsubscribeReading() {
    if (this._offSpeakState) {
      this._offSpeakState();
      this._offSpeakState = null;
    }
  },
});
