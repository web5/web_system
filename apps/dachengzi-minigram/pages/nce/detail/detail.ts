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
 * 🔴 服务层零改动：services/tts.ts / utils/request.ts / services/auth.ts 一律不改，
 *    本文件只复用 speakText/stopSpeak/onSpeakState、loginFromGate、collectGlossary 既有契约。
 */
import { getNceLesson, type NceLessonDetail, type NceWord } from '../../../services/nce';
import { DEFAULT_NCE_BOOK, nceBookTotal } from '../books';
import { speakText, onSpeakState, stopSpeak, type SpeakState } from '../../../services/tts';
import { collectGlossary } from '../../../services/glossary';
import { isLoggedIn, loginFromGate } from '../../../services/auth';

interface WordToken {
  idx: number;
  /** 展示片段（单词或标点/空白） */
  t: string;
  /** 可点单词（小写）；非单词为 '' */
  w: string;
  /** D-06：词汇表收录词显示点线；非可点片段恒 false */
  hasDef: boolean;
}

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

interface WordTipView {
  word: string;
  phonetic?: string;
  pos?: string;
  def?: string;
  example?: string;
  /** 表外词：暂无释义且保留可点 */
  none: boolean;
}

interface NceTapEvent {
  currentTarget: { dataset: Record<string, string | number | boolean | undefined> };
}

/** V21+ 阅读三档：沉浸（连排通读）/ 双语（中文常显）/ 点按=精读（逐句展开 + 生词 tip）。默认沉浸。 */
type ReadMode = 'immersion' | 'bilingual' | 'tap';
const READ_MODES: ReadMode[] = ['immersion', 'bilingual', 'tap'];
/** 把任意 storage / dataset 值收敛到合法档，非法/缺失一律回落默认档 immersion。 */
function normalizeMode(v: unknown): ReadMode {
  return typeof v === 'string' && (READ_MODES as string[]).includes(v) ? (v as ReadMode) : 'immersion';
}

/**
 * 把英文句子切成「单词 / 非单词」片段，供 V3 点词 tip 使用。
 * D-06：known 为词汇表小写词集合，仅直收词置 hasDef=true 显示点线；
 * 表外词 / 标点仍产出可点 token（hasDef=false），形态变化词由 _lookupWord 的 R3 兜底查释义。
 */
function tokenize(en: string, known?: Record<string, boolean>): WordToken[] {
  const re = /[A-Za-z]+(?:['’][A-Za-z]+)*|[^A-Za-z]+/g;
  const out: WordToken[] = [];
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(en)) !== null) {
    const t = m[0];
    const w = /^[A-Za-z]/.test(t) ? t.toLowerCase() : '';
    out.push({ idx: k++, t, w, hasDef: !!w && !!known && known[w] === true });
  }
  return out;
}

Page({
  /** 朗读状态订阅的退订函数（onHide / onUnload 时调用） */
  _offSpeakState: null as null | (() => void),
  /** 当前正在朗读的句下标（-1 = 无） */
  _playingIdx: -1,
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
      const words: NceWord[] = d.words || [];
      const known: Record<string, boolean> = {};
      words.forEach((x) => { known[String(x.word || '').toLowerCase()] = true; });
      const lines: NceLineView[] = (d.lines || []).map((l, i) => ({
        idx: i, en: l.en, cn: l.cn, tokens: tokenize(l.en, known),
      }));
      // V24 参考译文 = 整篇 lines[].cn 拼接（跳过空值）；全部为空时给兜底文案。
      const cnParts = lines.map((l) => (l.cn || '').trim()).filter((s) => s.length > 0);
      const fullCn = cnParts.length ? cnParts.join('') : '（本课暂无参考译文）';
      wx.setNavigationBarTitle({ title: `Lesson ${d.id} · ${d.title}` });
      this.setData({
        detail: d, lines, readingLineIdx: -1, readingPhase: 'idle',
        expandedIdx: -1, bubbleIdx: -1, tipWord: null, tipPos: null,
        bubblePos: null, fullCn, cnExpanded: false, loading: false,
      });
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
    const clear = { bubbleIdx: -1, tipWord: null, tipPos: null, bubblePos: null };
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
   * V23/V26′ 点词热区分发（27 §3.3 按档分发不变；19:11 ③ 生词 tip 改底部统一浮层）：
   * .w 始终 catchtap="onWordTap"，档位判定全放这里，WXML 不按档动态切 bind/catch。
   * - readMode !== 'tap' 或该 token 无 hasDef（含空白/非生词文字）→ 与 toggleLine 同语义：_applyLineTap(i)；
   * - 仅 tap 档 + hasDef 生词 → 只出底部浮层 tipWord（复用 _lookupWord），
   *   🔴 不再调用 _anchorFloat 就近锚定，不写 tipPos，也不展开该句中文；再点同一词收起、
   *   再点其它词替换浮层内容。tipPos 字段保留但不得驱动 word-tip。
   * 生词 tip 仅 tap 档生效。
   */
  onWordTap(e: NceTapEvent) {
    const ds = e.currentTarget.dataset;
    const i = Number(ds.i ?? 0);
    const hasDef = ds.hasdef === true || ds.hasdef === 'true';
    if (this.data.readMode !== 'tap' || !hasDef) {
      this._applyLineTap(i);
      return;
    }
    const raw = String(ds.w || '');
    if (!raw) return;
    const w = raw.toLowerCase();
    const cur = this.data.tipWord;
    if (cur && cur.word === w) {
      this.setData({ tipWord: null, tipPos: null });
      return;
    }
    // 19:11 ③：底部浮层由 tipWord 驱动；不取 anchor、不调 _anchorFloat、不写 tipPos。
    this.setData({ tipWord: this._lookupWord(w), tipPos: null, bubbleIdx: -1, bubblePos: null });
  },

  closeTip() { this.setData({ tipWord: null, tipPos: null }); },

  /**
   * V3-A 封闭规则表 R3（02 §1.4 :110-118，实现期不得扩充）：
   * R3-1 小写化 → R3-2 -s/-es → R3-3 -ed → R3-4 -ing → R3-5 不规则词封闭枚举
   * → R3-6 候选集固定顺序 [w, 词元, 词元+'e', w去s, 词元+'s'] 查 d.words[]，
   * 首个命中即返回该词条；全部未命中一律「暂无释义」且保留可点。
   */
  _lookupWord(w: string): WordTipView {
    const detail = this.data.detail;
    const words: NceWord[] = (detail && detail.words) || [];
    const byKey = (k: string): NceWord | undefined =>
      words.find((x) => String(x.word).toLowerCase() === k);

    // R3-5 不规则词封闭枚举（映射后仍查 d.words[]）
    const IRREG: Record<string, string> = {
      has: 'have', have: 'have', had: 'have',
      been: 'be', is: 'be', am: 'be', are: 'be', was: 'be', were: 'be',
      does: 'do', do: 'do', did: 'do',
      gone: 'go', went: 'go',
      received: 'receive',
    };

    // R3-2 / R3-3 / R3-4 词形还原（单一词元）
    let stem = w;
    if (/ies$/.test(stem)) stem = stem.replace(/ies$/, 'y');
    else if (/(ches|shes|sses|xes)$/.test(stem)) stem = stem.replace(/es$/, '');
    else if (/ied$/.test(stem)) stem = stem.replace(/ied$/, 'y');
    else if (/ed$/.test(stem)) stem = stem.replace(/ed$/, '');
    else if (/ing$/.test(stem)) stem = stem.replace(/ing$/, '');
    else if (/s$/.test(stem) && !/ss$/.test(stem)) stem = stem.replace(/s$/, '');

    const lemma = IRREG[w] || stem;
    // R3-6 候选集固定顺序
    const candidates = [w, lemma, lemma + 'e', w.replace(/s$/, ''), lemma + 's'];
    for (const c of candidates) {
      const hit = byKey(c);
      if (hit) {
        return {
          word: hit.word,
          phonetic: hit.phonetic,
          pos: hit.pos,
          def: hit.def,
          example: hit.example,
          none: false,
        };
      }
    }
    // 表外词：暂无释义且保留可点
    return { word: w, none: true };
  },

  /** V4 平台原生 bindlongpress 长按气泡（与 bindtap 同句节点，平台互斥分发）+ D-02 锚点 */
  onLongPress(e: NceTapEvent) {
    const i = Number(e.currentTarget.dataset.i);
    const line = this.data.lines[i];
    if (!line) return;
    this.setData({ bubbleIdx: i, expandedIdx: -1, tipWord: null, tipPos: null });
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
      // 收藏错误可观测性：① 真实错误落 console（保留后端 400 的 statusCode / message 供排查）；
      // ② 不再无条件覆盖 utils/request.ts 已弹的真实提示 —— 仅当 err 无 HTTP 响应时补网络兜底。
      // 🔴 本轮只让错误可见，未改后端/未做 DDL，收藏端到端仍失败（根因见 30，修复待用户授权）。
      console.error('[nce/collect]', err);
      const hasHttpResponse = typeof err === 'object' && err !== null && 'statusCode' in err;
      if (!hasHttpResponse) wx.showToast({ title: '网络异常，请重试', icon: 'none' });
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
    this.setData({ id: next, readingLineIdx: -1, readingPhase: 'idle' });
    void this.load();
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  onRetry() { void this.load(); },

  /** 朗读状态：null 复位；非 null 高亮跟随当前朗读句（V5 单句朗读态） */
  _onSpeakState(s: SpeakState | null) {
    if (!s) {
      this._playingIdx = -1;
      this.setData({ readingLineIdx: -1, readingPhase: 'idle' });
      return;
    }
    this.setData({
      readingPhase: s.phase === 'loading' ? 'loading' : 'playing',
      readingLineIdx: this._playingIdx,
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
