/**
 * 新概念英语 · 课文详情
 *
 * 阅读体验判据（与 PC portal 一致）：正文默认纯英文、点句才出中文；
 * 中文导入问题优先；生词就地查；习题读完再展开；浅色白底。
 * 小程序无 DOM，逐句英文在 JS 里切成 token 数组交给 wxml 渲染，
 * 既避免 rich-text 的 XSS 面，也不用正则 lookbehind（旧版兼容）。
 */
import { getNceLesson, type NceLessonDetail, type NceWord } from '../../../services/nce';
import {
  speakLines,
  onLineProgress,
  onSpeakState,
  stopSpeak,
  pauseSpeak,
  resumeSpeak,
  type LineProgress,
  type SpeakState,
} from '../../../services/tts';

interface Token {
  k: number; // 稳定 key，wx:key="k"
  text: string;
  wi?: number; // detail.words 中的下标；无则普通文本
  isWord?: boolean; // WXML 里避免 `!== undefined` 表达式（部分基础库解析不稳）
}
interface LineView {
  idx: number; // 稳定 key，避免 wx:key="index" 在嵌套 wx:for 下被内层 index 遮蔽
  en: string;
  cn: string;
  tokens: Token[];
  showCn: boolean;
}

interface NceTapEvent {
  currentTarget: { dataset: Record<string, string | number | undefined> };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenize(sentence: string, words: NceWord[]): Token[] {
  if (!words || !words.length) return [{ k: 0, text: sentence }];
  const index = new Map<string, number>();
  words.forEach((w, i) => { if (w.word) index.set(w.word.toLowerCase(), i); });
  const names = words
    .map((w) => w.word)
    .filter((w): w is string => !!w)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe);
  if (!names.length) return [{ k: 0, text: sentence }];
  const re = new RegExp('\\b(' + names.join('|') + ')\\b', 'gi');
  return sentence.split(re).filter(Boolean).map((part, k) => {
    const wi = index.get(part.toLowerCase());
    return wi === undefined ? { k, text: part } : { k, text: part, wi, isWord: true };
  });
}

Page({
  /** 朗读状态订阅的退订函数（onHide / onUnload 时调用） */
  _offSpeakState: null as null | (() => void),
  /** 句级进度订阅的退订函数 */
  _offLineProgress: null as null | (() => void),
  /** 朗读会话序号：seek / 重新开播时自增，旧会话收尾被忽略，防竞态覆盖 */
  _readSession: 0,

  data: {
    id: 0,
    detail: null as NceLessonDetail | null,
    linesView: [] as LineView[],
    loading: true,
    error: '',
    mode: 'immersion', // immersion | tap | bilingual
    fontStep: 1,
    showTranslation: false,
    exOpen: false,
    exSheet: false,
    answers: {} as Record<string, number>,
    activeWord: null as NceWord | null,
    wordLineIdx: -1, // 查词卡就地插在哪一句下面；-1 = 不显示
    letters: ['A', 'B', 'C', 'D'],
    /** 圆角风格：页面根节点叠加的 class（app.wxss 的 .radius-* 覆盖类驱动） */
    radiusClass: '',
    /** 朗读态：reading/暂停 时为 true，驱动底部控制条 + 点句 seek */
    readingActive: false,
    /** 当前朗读句下标（高亮 + 断点）；-1 = 无 */
    readingLineIdx: -1,
    /** 朗读阶段：idle | loading | playing | paused */
    readingPhase: 'idle',
    /** 断点提示：>0 显示「继续朗读 · 第 N 句」；-1 = 无断点 */
    resumeLineIdx: -1,
  },

  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
    this._subscribeReading();
  },

  onHide() {
    this._unsubscribeReading();
    this._stopAndSave();
  },

  onUnload() {
    this._unsubscribeReading();
    this._stopAndSave();
  },

  onLoad(options: { id?: string | number }) {
    const id = Number(options && options.id);
    const mode = wx.getStorageSync('nce-mode') || 'immersion';
    const fontStep = wx.getStorageSync('nce-font');
    const realId = id > 0 ? id : 1;
    this.setData({
      id: realId,
      mode: String(mode),
      fontStep: typeof fontStep === 'number' ? fontStep : 1,
      resumeLineIdx: this._readBreakpoint(realId),
    });
    void this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const d = await getNceLesson(this.data.id);
      if (!d) {
        this.setData({ error: '未找到该课，可能尚未入库' });
        return;
      }
      const linesView: LineView[] = (d.lines || []).map((l, i) => ({
        idx: i,
        en: l.en,
        cn: l.cn,
        tokens: tokenize(l.en, d.words || []),
        showCn: false,
      }));
      wx.setNavigationBarTitle({ title: `Lesson ${d.id} · ${d.title}` });
      this.setData({
        detail: d,
        linesView,
        showTranslation: false,
        exOpen: false,
        exSheet: false,
        answers: {},
        activeWord: null,
        wordLineIdx: -1,
      });
    } catch (e) {
      this.setData({ error: '课文加载失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  setMode(e: NceTapEvent) {
    const mode = String(e.currentTarget.dataset.mode || 'immersion');
    wx.setStorageSync('nce-mode', mode);
    const linesView = (this.data.linesView || []).map((l) => ({ ...l, showCn: false }));
    this.setData({ mode, linesView, activeWord: null, wordLineIdx: -1 });
  },

  setFont(e: NceTapEvent) {
    const fontStep = Number(e.currentTarget.dataset.step || 1);
    wx.setStorageSync('nce-font', fontStep);
    this.setData({ fontStep });
  },

  /** 点句：朗读中/暂停 = 从该句续读（不弹中文）；idle 态按模式揭示中文。
   *  #11：沉浸模式 idle 禁点句揭示，只保留下方「参考译文」。
   *  用路径 setData，避免每次点句都重传整份 linesView（20 句 × token）。 */
  toggleLine(e: NceTapEvent) {
    const i = Number(e.currentTarget.dataset.i);
    // 朗读中/暂停：点句 = seek（不再弹中文）
    if (this.data.readingActive) {
      this.seekLine(i);
      return;
    }
    // idle：对照已全显；沉浸禁点句揭示（#11）
    if (this.data.mode === 'bilingual' || this.data.mode === 'immersion') return;
    const line = this.data.linesView[i];
    if (!line) return;
    const patch: Record<string, unknown> = { activeWord: null, wordLineIdx: -1 };
    patch[`linesView[${i}].showCn`] = !line.showCn;
    this.setData(patch as any);
  },

  /** 点生词 = 查词 + 按模式揭示该句译文。
   *  🔴 触摸端手指常落在生词上，catchtap 若只弹查词卡，用户会判定「点按翻译没反应」。
   *  揭示规则：对照已全显；tap 揭示；朗读中/暂停揭示（V10：看中文不打断播放）；
   *  沉浸 idle 禁揭示（#11，仅弹查词卡）。 */
  onWord(e: NceTapEvent) {
    const wi = Number(e.currentTarget.dataset.wi);
    const si = Number(e.currentTarget.dataset.i);
    const d = this.data.detail;
    if (!d || !d.words || wi < 0 || wi >= d.words.length) return;
    const patch: Record<string, unknown> = { activeWord: d.words[wi], wordLineIdx: si };
    const reveal = this.data.mode === 'tap' || this.data.readingActive;
    if (this.data.mode !== 'bilingual' && reveal
        && si >= 0 && si < this.data.linesView.length
        && !this.data.linesView[si].showCn) {
      patch[`linesView[${si}].showCn`] = true;
    }
    this.setData(patch as any);
  },

  closeWord() { this.setData({ activeWord: null, wordLineIdx: -1 }); },
  /** 习题浮层吞掉点击，避免点到遮罩直接关闭 */
  noop() {},
  toggleTrans() { this.setData({ showTranslation: !this.data.showTranslation }); },
  openSheet() { this.setData({ exSheet: true }); },
  closeSheet() { this.setData({ exSheet: false }); },
  startEx() { this.setData({ exOpen: true }); },

  choose(e: NceTapEvent) {
    const qi = String(e.currentTarget.dataset.qi);
    const oi = Number(e.currentTarget.dataset.oi);
    this.setData({ answers: { ...this.data.answers, [qi]: oi } });
  },

  goLesson(e: NceTapEvent) {
    const delta = Number(e.currentTarget.dataset.delta || 0);
    const next = this.data.id + delta;
    if (next < 1 || next > 96) {
      wx.showToast({ title: '已经是最后一课了', icon: 'none' });
      return;
    }
    // 切课前：停止朗读 + 写当前课断点（先写再切，key 用旧 id）
    this._stopAndSave();
    this.setData({
      id: next,
      readingActive: false,
      readingPhase: 'idle',
      readingLineIdx: -1,
      resumeLineIdx: this._readBreakpoint(next),
    });
    void this.load();
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  onRetry() { void this.load(); },

  /* ==================== 整篇朗读（#7） ==================== */

  /** 朗读入口（idle 态「整体朗读 / 继续朗读」） */
  onReadTap() {
    if (this.data.readingActive) return;
    const startIndex = this.data.resumeLineIdx > 0 ? this.data.resumeLineIdx : 0;
    void this.startRead(startIndex);
  },

  /** 启动一轮整篇朗读（整体 / 继续 / seek 统一入口），句下标 i 即起点 */
  async startRead(startIndex: number) {
    const lines = (this.data.linesView || []).map((l) => l.en);
    if (!lines.length) return;
    const idx = Math.max(0, Math.min(lines.length - 1, startIndex));

    // 会话自增：旧会话的收尾（_onReadFinish）因序号不匹配被忽略，防 seek 竞态覆盖
    const session = ++this._readSession;
    this.setData({
      readingActive: true,
      readingPhase: 'loading',
      readingLineIdx: idx,
      exSheet: false,
      exOpen: false,
    });

    const completed = await speakLines(lines, { startIndex: idx });
    if (session !== this._readSession) return;
    this._onReadFinish(completed);
  },

  /** 朗读收尾：自然播完清断点；停止/失败保留断点并复位 */
  _onReadFinish(completed: boolean) {
    if (completed) {
      this._clearBreakpoint();
      this.setData({
        readingActive: false,
        readingPhase: 'idle',
        readingLineIdx: -1,
        resumeLineIdx: -1,
      });
      return;
    }
    const idx = this.data.readingLineIdx;
    if (idx > 0) {
      this._saveBreakpoint(idx);
      this.setData({ resumeLineIdx: idx });
    }
    this.setData({ readingActive: false, readingPhase: 'idle', readingLineIdx: -1 });
  },

  /** 暂停 / 继续切换 */
  onPauseToggle() {
    if (!this.data.readingActive) return;
    if (this.data.readingPhase === 'paused') {
      resumeSpeak();
      this.setData({ readingPhase: 'playing' });
    } else if (this.data.readingPhase === 'playing') {
      pauseSpeak();
      this.setData({ readingPhase: 'paused' });
      this._saveBreakpoint(this.data.readingLineIdx);
    }
  },

  /** 停止：stopSpeak 会唤醒在途 speakLines，startRead 的 await 收尾写断点 + 复位 */
  onStopRead() {
    if (!this.data.readingActive) return;
    stopSpeak();
  },

  /** 点刻度条第 i 格 = 跳到第 i 句 */
  onTickTap(e: NceTapEvent) {
    this.seekLine(Number(e.currentTarget.dataset.i));
  },

  /** 跳到第 i 句续读（点句 / 点刻度条共用） */
  seekLine(i: number) {
    const lines = this.data.linesView || [];
    if (i < 0 || i >= lines.length) return;
    void this.startRead(i);
  },

  /** 朗读状态订阅：loading → 请稍候；playing → 播放中（null 交给 startRead 的 await 收尾） */
  _onSpeakState(s: SpeakState | null) {
    if (!s) return;
    this.setData({ readingPhase: s.phase === 'loading' ? 'loading' : 'playing', readingActive: true });
  },

  /** 句级进度：高亮跟随 + 写断点 + 自动滚动保持当前句可见 */
  _onLineProgress(p: LineProgress) {
    this.setData({ readingLineIdx: p.index, readingPhase: 'playing', readingActive: true });
    this._saveBreakpoint(p.index);
    try {
      wx.pageScrollTo({ selector: `#line-${p.index}`, duration: 200 });
    } catch {
      /* 基础库不支持 selector：降级为只高亮，不自动滚动 */
    }
  },

  /** 订阅朗读回调（onShow 时；防 onShow 重复订阅） */
  _subscribeReading() {
    if (!this._offSpeakState) this._offSpeakState = onSpeakState((s) => this._onSpeakState(s));
    if (!this._offLineProgress) this._offLineProgress = onLineProgress((p) => this._onLineProgress(p));
  },

  /** 退订朗读回调（onHide / onUnload 时） */
  _unsubscribeReading() {
    if (this._offSpeakState) {
      this._offSpeakState();
      this._offSpeakState = null;
    }
    if (this._offLineProgress) {
      this._offLineProgress();
      this._offLineProgress = null;
    }
  },

  /** 停止朗读并写当前课断点（onHide / onUnload / 切课 时） */
  _stopAndSave() {
    const idx = this.data.readingLineIdx;
    if (idx > 0) this._saveBreakpoint(idx);
    stopSpeak();
  },

  /** 写断点：>0 存当前句；<=0 清空 */
  _saveBreakpoint(idx: number) {
    const key = `nce-read-${this.data.id}`;
    if (idx > 0) wx.setStorageSync(key, idx);
    else wx.removeStorageSync(key);
  },

  _clearBreakpoint() {
    wx.removeStorageSync(`nce-read-${this.data.id}`);
  },

  _readBreakpoint(id: number): number {
    const v = wx.getStorageSync(`nce-read-${id}`);
    return typeof v === 'number' && v > 0 ? v : -1;
  },
});
