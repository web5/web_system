/**
 * 新概念英语 · 课文详情
 *
 * 阅读体验判据（与 PC portal 一致）：正文默认纯英文、点句才出中文；
 * 中文导入问题优先；生词就地查；习题读完再展开；浅色白底。
 * 小程序无 DOM，逐句英文在 JS 里切成 token 数组交给 wxml 渲染，
 * 既避免 rich-text 的 XSS 面，也不用正则 lookbehind（旧版兼容）。
 */
import { getNceLesson, type NceLessonDetail, type NceWord } from '../../../services/nce';

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
  },

  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
  },

  onLoad(options: { id?: string | number }) {
    const id = Number(options && options.id);
    const mode = wx.getStorageSync('nce-mode') || 'immersion';
    const fontStep = wx.getStorageSync('nce-font');
    this.setData({
      id: id > 0 ? id : 1,
      mode: String(mode),
      fontStep: typeof fontStep === 'number' ? fontStep : 1,
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

  /** 点句出中文：只揭示当前句，不打断整体阅读。
   *  用路径 setData，避免每次点句都重传整份 linesView（20 句 × token）。 */
  toggleLine(e: NceTapEvent) {
    if (this.data.mode === 'bilingual') return;
    const i = Number(e.currentTarget.dataset.i);
    const line = this.data.linesView[i];
    if (!line) return;
    const patch: Record<string, unknown> = { activeWord: null, wordLineIdx: -1 };
    patch[`linesView[${i}].showCn`] = !line.showCn;
    this.setData(patch as any);
  },

  /** 点生词 = 查词 + 同时揭示该句译文。
   *  🔴 触摸端手指常落在生词上，catchtap 若只弹查词卡，用户会判定「点按翻译没反应」。 */
  onWord(e: NceTapEvent) {
    const wi = Number(e.currentTarget.dataset.wi);
    const si = Number(e.currentTarget.dataset.i);
    const d = this.data.detail;
    if (!d || !d.words || wi < 0 || wi >= d.words.length) return;
    const patch: Record<string, unknown> = { activeWord: d.words[wi], wordLineIdx: si };
    if (this.data.mode !== 'bilingual' && si >= 0 && si < this.data.linesView.length
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
    this.setData({ id: next });
    void this.load();
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  onRetry() { void this.load(); },
});
