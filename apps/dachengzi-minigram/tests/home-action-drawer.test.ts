/// <reference types="node" />
/**
 * 首页 · 长按动作抽屉接入（2026-11-26 step2 / 变体 B / 复用 step0 公共层）
 *
 * 本文件只锁「本轮新增的那层结构 + 新口径」，不重复既有首页测试（home-index /
 * home-greeting-wiring / home-quote-source / home-daily-quote-ux）已有的行为断言：
 *  1. **单槽位不变量**（方案 §4.1 / F1 / F2）：`data` 里只有 `overlay` 一个浮层字段，
 *     旧 `quoteTip` 彻底消失；每次 setData 的 patch 里 `overlay` 只能是「一个值」。
 *  2. **长按两个入口**：任意英文单词 → `scope='word'`（4 项，含表外词）；英文句子空白 →
 *     `scope='line'`（2 项）。4 项/2 项由组件 `actionsOf` 决定，这里用真实组件实例验证。
 *  3. **E1**：点按普通词（`hasDef=false`）不弹词卡、`overlay` 不变。
 *  4. **U1**（19:15 拍板）：`quotePlaying=true` 才渲染行尾 ■，点击 = stopSpeak + 归零。
 *  5. **K9**（tabBar 常驻页）：`onHide` 必须把 `overlay` 归零，否则返回首页时抽屉「自己回来」。
 *  6. **不复制实现**：页面里不得出现第二份抽屉 UI / 第二份动作表（静态断言）。
 *
 * 只更新过既有断言的两处，均在 home-daily-quote-ux / home-quote-source 里注明理由
 * （旧断言锁的是已作废的渲染结构 + 已消失的 quoteTip 字段）。
 */
import * as fs from 'fs';
import * as path from 'path';

const APP = path.resolve(__dirname, '..');
const src = (rel: string): string => fs.readFileSync(path.join(APP, rel), 'utf8');
/** 去掉 wxml 注释再断言：注释会提到 `ad-*` / 「抽屉」等字面量（说明「不要在此自绘」） */
const stripWxmlComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '');

jest.mock('../services/nce', () => ({ getNceLesson: jest.fn() }));
/**
 * tts 桩：忠实模拟 `services/tts.stopSpeak()` 会向订阅者推一次 `null`（页面播放态归零
 * 依赖这条契约，而不是自己猜）。若桩里 stopSpeak 什么都不做，就测不出「切走即复位」。
 */
const mockTts: { listeners: Set<(s: any) => void>; emit: (s: any) => void } = {
  listeners: new Set(),
  emit(s) { mockTts.listeners.forEach((cb) => cb(s)); },
};
jest.mock('../services/tts', () => ({
  speakText: jest.fn(() => Promise.resolve(true)),
  stopSpeak: jest.fn(() => { mockTts.emit(null); }),
  onSpeakState: jest.fn((cb: (s: any) => void) => {
    mockTts.listeners.add(cb);
    return () => { mockTts.listeners.delete(cb); };
  }),
}));
jest.mock('../services/glossary', () => ({
  collectGlossary: jest.fn(() => Promise.resolve({ id: 1, existed: false })),
}));
jest.mock('../services/auth', () => ({ isLoggedIn: jest.fn(() => true) }));
jest.mock('../services/account', () => ({
  readLocalNickname: jest.fn(() => '橙子'),
  fetchProfile: jest.fn(() => Promise.resolve({ nickname: '橙子' })),
  isNicknameUnset: jest.fn(() => false),
}));
jest.mock('../utils/greeting', () => ({
  formatGreeting: jest.fn(() => '橙子，下午好'),
  getLocalHour: jest.fn(() => 15),
}));
jest.mock('../utils/tabbar', () => ({ setTabBarSelected: jest.fn(), TAB_INDEX: { home: 0 } }));
jest.mock('../utils/daily', () => ({
  getDailyQuote: jest.fn(() => ({ cn: '他是一名工程师。', en: 'He is an engineer.' })),
  getDailyQuoteMeta: jest.fn(() => ({ book: 'NCE2', lessonId: 4 })),
  getDailyQuoteSource: jest.fn(() => ({
    cn: '他是一名工程师。', en: 'He is an engineer.', book: 'NCE2', lessonId: 4,
  })),
  BOOK_LABEL: { NCE2: '新概念二册' },
}));

import { getNceLesson } from '../services/nce';
import { speakText, stopSpeak } from '../services/tts';
import { collectGlossary } from '../services/glossary';
import { isLoggedIn } from '../services/auth';

const getLessonMock = getNceLesson as unknown as jest.Mock;
const speakTextMock = speakText as unknown as jest.Mock;
const stopSpeakMock = stopSpeak as unknown as jest.Mock;
const collectMock = collectGlossary as unknown as jest.Mock;
const isLoggedInMock = isLoggedIn as unknown as jest.Mock;

const QUOTE_EN = 'He is an engineer.';

let store: Record<string, unknown> = {};
const wxMock = {
  getStorageSync: jest.fn((k: string) => (store[k] === undefined ? '' : store[k])),
  setStorageSync: jest.fn((k: string, v: unknown) => { store[k] = v; }),
  removeStorageSync: jest.fn((k: string) => { delete store[k]; }),
  showToast: jest.fn(),
  navigateTo: jest.fn(),
  switchTab: jest.fn(),
};

let pageConfig: any = null;
let drawerCfg: any = null;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).Page = jest.fn((cfg: any) => { pageConfig = cfg; });
  (globalThis as any).Component = jest.fn((cfg: any) => { drawerCfg = cfg; });
  (globalThis as any).getApp = jest.fn(() => ({
    eventBus: { on: jest.fn(), off: jest.fn() },
    radiusClassOf: () => '',
  }));
  require('../pages/home/index/index');
  require('../components/action-drawer/index');
});

beforeEach(() => {
  jest.clearAllMocks();
  store = {};
  mockTts.listeners.clear();
  isLoggedInMock.mockReturnValue(true);
  getLessonMock.mockResolvedValue({
    id: 4,
    title: 'L4',
    words: [{ word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/ˌendʒɪˈnɪə/' }],
    lines: [{ en: QUOTE_EN, cn: '他是一名工程师。' }],
  });
  collectMock.mockResolvedValue({ id: 1, existed: false });
});

/** 页面上下文桩：记录每次 setData 的 patch，便于断「同帧只有一种 overlay」 */
function makeCtx() {
  const patches: Array<Record<string, unknown>> = [];
  const ctx: any = Object.create(pageConfig);
  ctx.data = JSON.parse(JSON.stringify(pageConfig.data));
  ctx.patches = patches;
  ctx.setData = function (patch: Record<string, unknown>) {
    patches.push(patch);
    Object.assign(this.data, patch);
  };
  ctx._alive = true;
  ctx._quoteSeq = 0;
  ctx._quoteWords = [];
  ctx._speakingWord = '';
  ctx._playingText = '';
  // 复刻真实订阅链（onLoad 里 onSpeakState 订阅）：否则「stopSpeak 推 null → 播放态归零」
  // 这条契约测不到，会得出「切走没复位」的假红。
  pageConfig.onLoad.call(ctx);
  return ctx;
}

/** 加载词表后取一个特定词的 token（默认取表外普通词 is） */
async function ctxWithWords(): Promise<any> {
  const ctx = makeCtx();
  await ctx.loadQuoteWords();
  return ctx;
}

/** 真实抽屉组件实例（复用 step0 组件，不是复刻） */
function makeDrawer(props: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(drawerCfg.properties || {})) {
    defaults[k] = (v as { value?: unknown }).value;
  }
  const inst: any = {
    data: { ...defaults, ...JSON.parse(JSON.stringify(drawerCfg.data || {})), ...props },
    setData(this: any, patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    triggerEvent: jest.fn(),
  };
  for (const block of [drawerCfg.methods, drawerCfg.lifetimes, drawerCfg.pageLifetimes, drawerCfg.observers]) {
    Object.keys(block || {}).forEach((k) => {
      if (typeof block[k] === 'function') inst[k] = block[k].bind(inst);
    });
  }
  return inst;
}

const tokenOf = (ctx: any, w: string) => ctx.data.quoteTokens.find((t: any) => t.w === w);

/* ─────────────────────────── 单槽位不变量 ─────────────────────────── */

describe('单槽位 overlay（方案 §4.1 / F1 / F2）', () => {
  it('data 里只有 overlay 一个浮层字段：旧的 quoteTip 已删除', () => {
    expect(pageConfig.data).toHaveProperty('overlay');
    expect(pageConfig.data.overlay).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(pageConfig.data, 'quoteTip')).toBe(false);
  });

  it('所有浮层字段名里只有 overlay 一个是「浮层」语义（防再长出第二个槽位）', () => {
    const keys = Object.keys(pageConfig.data).filter((k) => /^(overlay|quoteTip|tip|drawer|bubble)/i.test(k));
    expect(keys).toEqual(['overlay']);
  });

  it('每次 setData 的 overlay 都是「一个值」：不存在同帧两个 kind 并存', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    const overlayPatches = ctx.patches.filter((p: any) => 'overlay' in p);
    expect(overlayPatches.length).toBeGreaterThanOrEqual(2);
    overlayPatches.forEach((p: any) => {
      const v = p.overlay;
      if (v !== null) expect(typeof v.kind).toBe('string');
      // 单槽位：patch 里不可能出现 drawer 与 wordtip 两个字段名
      expect('drawer' in p).toBe(false);
      expect('wordtip' in p).toBe(false);
      expect('quoteTip' in p).toBe(false);
    });
    // 最后一次是词卡（整体替换了抽屉，而不是两个字段各开一半）
    expect(ctx.data.overlay.kind).toBe('wordtip');
  });
});

/* ─────────────────────────── 长按两个入口 ─────────────────────────── */

describe('长按任意英文单词 → drawer/word（4 项，表外词同样可用）', () => {
  it('长按表外普通词（hasDef=false）→ overlay={kind:drawer,scope:word}，hasDef=false、无音标', async () => {
    const ctx = await ctxWithWords();
    expect(tokenOf(ctx, 'is').hasDef).toBe(false);   // 前置：is 不在词表里

    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'is', hasdef: false } } });

    expect(ctx.data.overlay).toMatchObject({
      kind: 'drawer',
      scope: 'word',
      word: 'is',
      hasDef: false,
      phonetic: '',
      lineIndex: 0,
      lineText: QUOTE_EN,
    });
  });

  it('表外词的抽屉仍是 4 项（动作集合与 hasDef 无关）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    // 用真实组件按页面给的作用域取动作集合：proves「overlay.scope → 4 项」这条链路
    const c = makeDrawer({ scope: ctx.data.overlay.scope, wordHasDef: ctx.data.overlay.hasDef });
    c.scope(ctx.data.overlay.scope);
    expect(c.data.acts.map((a: any) => a.label))
      .toEqual(['朗读此句', '收藏此句', '朗读单词', '收藏单词']);
  });

  it('长按生词（hasDef=true）→ 带音标（音标只进标题区，不影响动作）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    expect(ctx.data.overlay).toMatchObject({
      kind: 'drawer', scope: 'word', word: 'engineer', hasDef: true, phonetic: '/ˌendʒɪˈnɪə/',
    });
    const c = makeDrawer({ scope: 'word' });
    c.scope('word');
    expect(c.data.acts).toHaveLength(4);
  });

  it('脏 token（空 data-w）不产生浮层', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: '' } } });
    expect(ctx.data.overlay).toBeNull();
  });

  it('dataset 里布尔值以字符串 "true" 传上来也认（不同基础库形态）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'engineer', hasdef: 'true' } } });
    expect(ctx.data.overlay.hasDef).toBe(true);
  });
});

describe('长按英文句子空白 → drawer/line（2 项）', () => {
  it('overlay={kind:drawer,scope:line}，2 项恰为四项前两项', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteLineLongPress();
    expect(ctx.data.overlay).toMatchObject({
      kind: 'drawer', scope: 'line', lineIndex: 0, lineText: QUOTE_EN,
    });
    const c = makeDrawer({ scope: 'line' });
    c.scope('line');
    expect(c.data.acts.map((a: any) => a.label)).toEqual(['朗读此句', '收藏此句']);
  });

  it('句子长按 handler 只挂在英文容器上，不挂整张 .daily 卡（否则中文行/按钮也会触发）', () => {
    const w = stripWxmlComments(src('pages/home/index/index.wxml'));
    expect(w).toMatch(/class="daily-en"[^>]*catchlongpress="onQuoteLineLongPress"/);
    // `class="daily"` 那个节点上不得出现 longpress
    const dailyTag = (/<view class="daily"[^>]*>/.exec(w) || [''])[0];
    expect(dailyTag).not.toMatch(/longpress/);
    expect(w.split('catchlongpress="onQuoteLineLongPress"').length - 1).toBe(1);
  });
});

/* ─────────────────────────── E1：点按普通词无反应 ─────────────────────────── */

describe('E1：点按普通词无反应（不弹词卡、不朗读）', () => {
  it('点表外普通词 → overlay 保持 null，且不朗读整句', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    expect(ctx.data.overlay).toBeNull();
    expect(speakTextMock).not.toHaveBeenCalled();
  });

  it('点普通词不改动已有浮层（不会顺手把词卡换掉）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    const before = JSON.parse(JSON.stringify(ctx.data.overlay));
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    expect(ctx.data.overlay).toEqual(before);
  });

  it('点生词仍出词卡（守卫只挡普通词）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    expect(ctx.data.overlay.kind).toBe('wordtip');
    expect(ctx.data.overlay.def).toBe('工程师');
  });
});

/* ─────────────────────────── K9：生命周期归零 ─────────────────────────── */

describe('K9：tab 页返回时抽屉不得自己回来', () => {
  it('onHide → overlay 归零（测试原型：开着抽屉切到「我的」tab）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    expect(ctx.data.overlay).not.toBeNull();

    ctx.onHide();

    expect(ctx.data.overlay).toBeNull();
  });

  it('onHide 顺带停播 + 播放态归零（原有行为不回退）', async () => {
    const ctx = await ctxWithWords();
    ctx._onSpeakState({ text: QUOTE_EN, phase: 'playing' });
    expect(ctx.data.quotePlaying).toBe(true);
    ctx.onHide();
    expect(stopSpeakMock).toHaveBeenCalled();
    expect(ctx.data.quotePlaying).toBe(false);
    expect(ctx.data.quoteWordPlaying).toBe('');
  });

  it('overlay 已为 null 时 onHide 不发多余的浮层 setData（避免无谓重绘）', async () => {
    const ctx = await ctxWithWords();
    ctx.patches.length = 0;
    ctx.onHide();
    // 只数「含 overlay 的 patch」：onHide 里 stopSpeak 推 null 会带来一次播放态复位 setData，
    // 那是既有行为、与浮层无关。
    expect(ctx.patches.filter((p: any) => 'overlay' in p)).toEqual([]);
  });

  it('组件侧 pageLifetimes.hide 归零局部态（与页面归零是两道，互补不互替）', () => {
    const c = makeDrawer({ visible: true, scope: 'word' });
    c.setData({ swipeY: 40, dragging: true, busy: true, pressedKey: 'speak-word' });
    c.hide();
    expect(c.data).toMatchObject({ swipeY: 0, dragging: false, busy: false, pressedKey: '' });
    // 🔴 但组件**不清业务态**：visible 仍由页面 overlay 驱动（组件不持有业务状态）
    expect(c.data.visible).toBe(true);
  });
});

/* ─────────────────────────── U1：行尾 ■ 停止 ─────────────────────────── */

describe('U1：朗读中行尾 ■ 停止（19:15 拍板）', () => {
  it('quotePlaying=true 时才渲染 ■，且挂在英文句子容器行尾', () => {
    const w = stripWxmlComments(src('pages/home/index/index.wxml'));
    const tag = (/<text wx:if="\{\{quotePlaying\}\}"[^>]*>■<\/text>/).exec(w);
    expect(tag).not.toBeNull();
    expect((tag as RegExpExecArray)[0]).toContain('catchtap="stopQuoteSpeak"');
    // 位置：在 .daily-en 容器内部（行尾），不是页脚按钮
    const enOpen = w.indexOf('class="daily-en"');
    const enBlock = w.slice(enOpen, w.indexOf('daily-foot', enOpen));
    expect(enBlock).toContain('stopQuoteSpeak');
  });

  it('不播放时不渲染：没有无条件的 ■ 节点（行尾按钮只在播放态出现）', () => {
    const w = stripWxmlComments(src('pages/home/index/index.wxml'));
    // 所有带 ■ 的节点都必须带 wx:if 守卫
    const hits = Array.from(w.matchAll(/<text([^>]*)>■<\/text>/g)).map((m) => m[1]);
    expect(hits.length).toBeGreaterThan(0);
    hits.forEach((attrs) => expect(attrs).toContain('wx:if="{{quotePlaying}}"'));
  });

  it('点击 ■ → stopSpeak + 播放态归零', async () => {
    const ctx = await ctxWithWords();
    ctx._onSpeakState({ text: QUOTE_EN, phase: 'playing' });
    expect(ctx.data.quotePlaying).toBe(true);

    stopSpeakMock.mockClear();
    ctx.stopQuoteSpeak();

    expect(stopSpeakMock).toHaveBeenCalledTimes(1);
    expect(ctx.data.quotePlaying).toBe(false);
    expect(ctx.data.quoteWordPlaying).toBe('');
    expect(ctx._playingText).toBe('');
  });
});

/* ─────────────────────────── 抽屉 5 个 handler ─────────────────────────── */

describe('抽屉 5 个 handler（组件只 triggerEvent，页面调 services）', () => {
  it('speak-line → speakText(句子) 恰好一次 + 抽屉收起', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteLineLongPress();
    await ctx.onDrawerSpeakLine({ detail: { lineIndex: 0, text: QUOTE_EN } });
    expect(speakTextMock).toHaveBeenCalledTimes(1);
    expect(speakTextMock).toHaveBeenCalledWith(QUOTE_EN);
    expect(ctx.data.overlay).toBeNull();
  });

  it('speak-word → speakText(单词) + 抽屉收起（普通词同样可读）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    await ctx.onDrawerSpeakWord({ detail: { word: 'is', lineIndex: 0 } });
    expect(speakTextMock).toHaveBeenCalledWith('is');
    expect(ctx.data.overlay).toBeNull();
  });

  it('collect-line → tag=nce，meta 用 _sourceMeta 的 book/lessonId（P1-1 同源，不绕过）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteLineLongPress();
    await ctx.onDrawerCollectLine({ detail: { lineIndex: 0, text: QUOTE_EN } });
    const p = collectMock.mock.calls[0][0];
    expect(p.tag).toBe('nce');
    expect(p.enMain).toBe(QUOTE_EN);
    expect(p.note).toBe('他是一名工程师。');
    expect(p.meta).toEqual({ book: 'NCE2', lessonId: 4, from: 'daily' });
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已收藏', icon: 'none' });
    expect(ctx.data.overlay).toBeNull();
  });

  it('collect-line 重复收藏 → 「已在收藏中」（幂等不当失败）', async () => {
    const ctx = await ctxWithWords();
    collectMock.mockResolvedValue({ id: 1, existed: true });
    await ctx.onDrawerCollectLine({ detail: { lineIndex: 0, text: QUOTE_EN } });
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已在收藏中', icon: 'none' });
  });

  it('collect-word（普通词）→ hasDef:false 写进 meta（收藏页 E3 灰标的判据）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    await ctx.onDrawerCollectWord({ detail: { word: 'is', lineIndex: 0, hasDef: false } });
    const p = collectMock.mock.calls[0][0];
    expect(p.tag).toBe('word');
    expect(p.enMain).toBe('is');
    expect(p.note).toBe('');                        // 表外词无词性/释义 → 允许空串，不拒收
    expect(p.meta).toMatchObject({ book: 'NCE2', lessonId: 4, word: 'is', hasDef: false, from: 'daily' });
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已收藏', icon: 'none' });
  });

  it('collect-word（生词）→ note=词性+释义、hasDef:true、带音标', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    await ctx.onDrawerCollectWord({ detail: { word: 'engineer', lineIndex: 0, hasDef: true } });
    const p = collectMock.mock.calls[0][0];
    expect(p.note).toBe('n. 工程师');
    expect(p.meta).toMatchObject({ word: 'engineer', phonetic: '/ˌendʒɪˈnɪə/', hasDef: true });
  });

  it('未登录收藏 → 首页既有形态：toast 请先登录 + 不发请求 + 抽屉先收起', async () => {
    isLoggedInMock.mockReturnValue(false);
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    await ctx.onDrawerCollectWord({ detail: { word: 'is', lineIndex: 0, hasDef: false } });
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '请先登录', icon: 'none' });
    expect(collectMock).not.toHaveBeenCalled();
    expect(ctx.data.overlay).toBeNull();
  });

  it('close → overlay 归零（遮罩/下滑/✕ 三通道共用）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteLineLongPress();
    ctx.onDrawerClose({ detail: { via: 'mask' } });
    expect(ctx.data.overlay).toBeNull();
  });
});

/* ─────────────────────────── 不复制实现（静态） ─────────────────────────── */

describe('不复制实现：页面只挂载组件，不自绘抽屉、不重定义动作表', () => {
  it('index.wxml 不含抽屉自绘结构（ad-* 类名一个都不许出现）', () => {
    const w = stripWxmlComments(src('pages/home/index/index.wxml'));
    ['ad-mask', 'ad-drawer', 'ad-grab', 'ad-head', 'ad-acts', 'ad-act'].forEach((cls) => {
      expect(w).not.toContain(cls);
    });
  });

  it('index.ts 不重定义动作集合（无 actionsOf / ACTIONS / 动作文案字面量）', () => {
    const t = src('pages/home/index/index.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(t).not.toMatch(/function\s+actionsOf/);
    expect(t).not.toMatch(/const\s+ACTIONS/);
    ['朗读此句', '收藏此句', '朗读单词', '收藏单词'].forEach((label) => {
      expect(t).not.toContain(label);
    });
    // 反向：必须 import 公共层的纯函数（收藏 toast 文案只有那一份）
    expect(t).toContain("from '../../../utils/line-actions'");
  });

  it('index.json 挂载公共组件（路径指向 components/action-drawer）', () => {
    const j = JSON.parse(src('pages/home/index/index.json'));
    expect(j.usingComponents['action-drawer']).toBe('/components/action-drawer/index');
    // 既有 login-gate 不许被覆盖
    expect(j.usingComponents['login-gate']).toBe('/components/login-gate/index');
  });

  it('组件 7 个属性 + 5 个事件全部接上（漏一个就是某个动作静默失效）', () => {
    const w = src('pages/home/index/index.wxml');
    ['visible', 'scope', 'line-text', 'line-index', 'word', 'word-has-def', 'phonetic'].forEach((p) => {
      expect(w).toContain(`${p}="{{overlay`);
    });
    ['speak-line', 'speak-word', 'collect-line', 'collect-word', 'close'].forEach((evt) => {
      expect(w).toContain(`bind:${evt}="onDrawer`);
    });
  });

  it('公共层对外契约未被本页改动（组件仍只 import utils/line-actions）', () => {
    const comp = src('components/action-drawer/index.ts');
    expect(comp).toMatch(/from '\.\.\/\.\.\/utils\/line-actions'/);
    expect(comp).not.toMatch(/services\//);
    // 4 项顺序真源：行=对象、列=动词。去掉注释后只看真正会渲染的 label 字面量顺序，
    // 防止「将来有人为了凑首页顺手改了公共层顺序」。
    const actions = src('utils/line-actions.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const labels = Array.from(actions.matchAll(/label:\s*'([^']+)'/g)).map((m) => m[1]);
    expect(labels).toEqual(['朗读此句', '收藏此句', '朗读单词', '收藏单词']);
  });
});
