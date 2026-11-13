/**
 * 新概念英语 · 课文详情（整改后：纯学习能力）
 *
 * 只保留「英文课文 + 逐句朗读 + 逐句收藏」（specs/dachengzi-minigram/review-remove-ai-2026-11-13.md §4.7）。
 * 已删除：沉浸/点按/对照三模式、点句译文、生词就地查词、参考译文、习题浮层、
 * 导读问题、整篇朗读控制条（刻度条/暂停/继续/停止）。
 *
 * 逐句朗读判据（N1-N7）：
 * - N1 点句朗读：`toggleLine` → `speakText(line.en)`，`_playingIdx = i`；
 * - N2 点同一句停止：`speakText` 内置「same text → stopSpeak」，`_onSpeakState(null)` 复位；
 * - N3 点他句切换：`speakText` 内部 `stopSpeak()` 顶掉上一句再播新句；
 * - N4 句级高亮：`_onSpeakState(s)` → `readingPhase` + `readingLineIdx = _playingIdx`；
 * - N5 逐句收藏：`collectLine`（未登录 toast + 引导到「我的」）；
 * - N6 收藏与朗读隔离：收藏按钮 `catchtap`；
 * - N7 卸载停读：`onUnload`/`onHide` → `stopSpeak()` + 退订 `onSpeakState`。
 */
import { getNceLesson, type NceLessonDetail } from '../../../services/nce';
import { DEFAULT_NCE_BOOK, nceBookTotal } from '../books';
import { speakText, onSpeakState, stopSpeak, type SpeakState } from '../../../services/tts';
import { collectGlossary } from '../../../services/glossary';
import { isLoggedIn } from '../../../services/auth';

interface NceLineView {
  /** 稳定 key（wx:key），避免嵌套 wx:for 下默认 index 遮蔽 */
  idx: number;
  en: string;
  cn: string;
}

interface NceTapEvent {
  currentTarget: { dataset: Record<string, string | number | undefined> };
}

Page({
  /** 朗读状态订阅的退订函数（onHide / onUnload 时调用） */
  _offSpeakState: null as null | (() => void),
  /** 当前正在朗读的句下标（-1 = 无）；`speakText` 的异步状态回推据此高亮 */
  _playingIdx: -1,

  data: {
    id: 0,
    /** 当前书册（默认 NCE2）：详情跳转必须带 book，否则点 NCE3 第 1 课会打开 NCE2 Lesson 1 */
    book: DEFAULT_NCE_BOOK,
    detail: null as NceLessonDetail | null,
    lines: [] as NceLineView[],
    loading: true,
    error: '',
    /** 字号档位：0=A- / 1=A / 2=A+（纯阅读偏好，`nce-font` 保留） */
    fontStep: 1,
    /** 圆角风格：页面根节点叠加的 class（app.wxss 的 .radius-* 覆盖类驱动） */
    radiusClass: '',
    /** 当前朗读句下标（高亮）；-1 = 无 */
    readingLineIdx: -1,
    /** 朗读阶段：idle | loading | playing */
    readingPhase: 'idle',
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
  },

  onLoad(options: { id?: string | number; book?: string }) {
    const id = Number(options && options.id);
    const book = String((options && options.book) || DEFAULT_NCE_BOOK);
    const fontStep = wx.getStorageSync('nce-font');
    const realId = id > 0 ? id : 1;
    this.setData({
      id: realId,
      book,
      fontStep: typeof fontStep === 'number' ? fontStep : 1,
    });
    void this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const d = await getNceLesson(this.data.id, this.data.book);
      if (!d) {
        this.setData({ error: '未找到该课，可能尚未入库' });
        return;
      }
      const lines: NceLineView[] = (d.lines || []).map((l, i) => ({ idx: i, en: l.en, cn: l.cn }));
      wx.setNavigationBarTitle({ title: `Lesson ${d.id} · ${d.title}` });
      this.setData({ detail: d, lines, readingLineIdx: -1, readingPhase: 'idle' });
    } catch {
      this.setData({ error: '课文加载失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  setFont(e: NceTapEvent) {
    const fontStep = Number(e.currentTarget.dataset.step || 1);
    wx.setStorageSync('nce-font', fontStep);
    this.setData({ fontStep });
  },

  /** 点句朗读：同句=停，他句=切换（N1/N2/N3） */
  toggleLine(e: NceTapEvent) {
    const i = Number(e.currentTarget.dataset.i);
    const line = this.data.lines[i];
    if (!line) return;
    this._playingIdx = i;
    void speakText(line.en);
  },

  /** 逐句收藏（N5）：未登录引导到「我的」，收藏按钮 catchtap 隔离不冒泡到朗读（N6） */
  async collectLine(e: NceTapEvent) {
    const i = Number(e.currentTarget.dataset.i);
    const line = this.data.lines[i];
    if (!line) return;
    if (!isLoggedIn()) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.switchTab({ url: '/pages/mine/index/index' });
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
    } catch {
      wx.showToast({ title: '收藏失败，请重试', icon: 'none' });
    }
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

  /** 朗读状态：null 复位；非 null 高亮跟随当前朗读句（N4） */
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

  /** 订阅朗读回调（onShow 时；防 onShow 重复订阅） */
  _subscribeReading() {
    if (!this._offSpeakState) this._offSpeakState = onSpeakState((s) => this._onSpeakState(s));
  },

  /** 退订朗读回调（onHide / onUnload 时） */
  _unsubscribeReading() {
    if (this._offSpeakState) {
      this._offSpeakState();
      this._offSpeakState = null;
    }
  },
});
