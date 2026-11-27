/// <reference types="node" />
/**
 * D7 · 收藏态**双向实时同步**（2026-11-27 第二批 → 用户真机反馈后升级为最高优先级）
 *
 * 用户原话：「首页今日一句卡片那里收藏了，但是长按抽屉那里没有及时同步收藏状态」。
 * 复现（v1.0.20）：首页卡片点「☆ 收藏」→ 变「✓ 已收藏」→ 长按句子开抽屉 →
 * 抽屉里仍是「☆ 收藏此句」。
 *
 * 两个方向都必须成立，缺一不可：
 *  · 方向 1（卡片/词卡 → 抽屉）：开抽屉那一刻，已收藏的项直接渲染成 ✓ 已收藏；
 *  · 方向 2（抽屉 → 卡片/词卡）：抽屉里收藏成功后，页面上那颗按钮已经是 ✓ 已收藏。
 *
 * 🔴 本文件刻意把**真实组件实例**接进页面桩（`selectComponent('#drawer')` 返回真组件），
 *    并按页面 wxml 的属性绑定把 `collectedKeys` 同步给组件 —— 再断言组件的渲染产物
 *    （class 含 `is-collected` / 文案「已收藏」），而不是只断言页面 data 里有个数组。
 *    上一批的假绿教训：只断言 data 字段对「数据改了但界面没变」零鉴别力。
 *
 * 🔴 A8 红线：`collectedKeys` 只是字符串数组，组件仍只 import `services/tts`。
 */
import * as fs from 'fs';
import * as path from 'path';

export {};

const APP = path.resolve(__dirname, '..');
const src = (rel: string): string => fs.readFileSync(path.join(APP, rel), 'utf8');
const stripWxml = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '');

const QUOTE_EN = 'He is an engineer.';
const WORD_LINE = 'He is an engineer.';

/* ───────────────────────────── services / wx 桩 ───────────────────────────── */

jest.mock('../services/nce', () => ({ getNceLesson: jest.fn() }));
jest.mock('../services/tts', () => ({
  speakText: jest.fn(() => Promise.resolve(true)),
  stopSpeak: jest.fn(),
  onSpeakState: jest.fn(() => jest.fn()),
}));
jest.mock('../services/glossary', () => ({ collectGlossary: jest.fn() }));
jest.mock('../services/auth', () => ({ isLoggedIn: jest.fn(() => true), loginFromGate: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../services/account', () => ({
  readLocalNickname: jest.fn(() => '橙子'),
  fetchProfile: jest.fn(() => Promise.resolve({ nickname: '橙子' })),
  isNicknameUnset: jest.fn(() => false),
}));
jest.mock('../utils/greeting', () => ({ formatGreeting: jest.fn(() => '橙子，下午好'), getLocalHour: jest.fn(() => 15) }));
jest.mock('../utils/tabbar', () => ({ setTabBarSelected: jest.fn(), TAB_INDEX: { home: 0 } }));
jest.mock('../utils/daily', () => ({
  getDailyQuote: jest.fn(() => ({ cn: '他是一名工程师。', en: 'He is an engineer.' })),
  getDailyQuoteMeta: jest.fn(() => ({ book: 'NCE2', lessonId: 4 })),
  getDailyQuoteSource: jest.fn(() => ({ cn: '他是一名工程师。', en: 'He is an engineer.', book: 'NCE2', lessonId: 4 })),
  BOOK_LABEL: { NCE2: '新概念二册' },
}));
jest.mock('../pages/nce/books', () => ({ DEFAULT_NCE_BOOK: 'NCE2', nceBookTotal: () => 96 }));

import { getNceLesson } from '../services/nce';
import { collectGlossary } from '../services/glossary';
import { isLoggedIn } from '../services/auth';

const getLessonMock = getNceLesson as unknown as jest.Mock;
const collectMock = collectGlossary as unknown as jest.Mock;
const isLoggedInMock = isLoggedIn as unknown as jest.Mock;

let store: Record<string, unknown> = {};
const wxMock: any = {
  getStorageSync: jest.fn((k: string) => (store[k] === undefined ? '' : store[k])),
  setStorageSync: jest.fn((k: string, v: unknown) => { store[k] = v; }),
  removeStorageSync: jest.fn((k: string) => { delete store[k]; }),
  showToast: jest.fn(),
  getSystemInfoSync: jest.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
  setNavigationBarTitle: jest.fn(),
  pageScrollTo: jest.fn(),
  navigateTo: jest.fn(),
  switchTab: jest.fn(),
};

let homeCfg: any = null;
let detailCfg: any = null;
let drawerCfg: any = null;
let lastCfg: any = null;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).Page = (cfg: any) => { lastCfg = cfg; };
  (globalThis as any).Component = (cfg: any) => { drawerCfg = cfg; };
  (globalThis as any).getApp = () => ({
    eventBus: { on: jest.fn(), off: jest.fn() },
    radiusClassOf: () => '',
  });
  require('../pages/home/index/index');
  homeCfg = lastCfg;
  require('../pages/nce/detail/detail');
  detailCfg = lastCfg;
  require('../components/action-drawer/index');
});

beforeEach(() => {
  jest.clearAllMocks();
  store = {};
  isLoggedInMock.mockReturnValue(true);
  collectMock.mockResolvedValue({ id: 1, existed: false });
  const words = [{ word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/ˌendʒɪˈnɪə/' }];
  getLessonMock.mockResolvedValue({ id: 4, title: 'L4', words, lines: [{ en: WORD_LINE, cn: '他是一名工程师。' }] });
});

/* ───────────────────────── 真实组件实例（抽屉） ───────────────────────── */

/** 组件属性默认值 → data（真机里 properties 通过 this.data 读取） */
function propDefaults(cfg: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg.properties || {})) out[k] = (v as { value?: unknown }).value;
  return out;
}

function makeDrawer(props: Record<string, unknown> = {}): any {
  const inst: any = {
    data: { ...propDefaults(drawerCfg), ...JSON.parse(JSON.stringify(drawerCfg.data || {})), ...props },
    setData(this: any, patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    triggerEvent: jest.fn(),
  };
  for (const block of [drawerCfg.methods, drawerCfg.lifetimes, drawerCfg.pageLifetimes, drawerCfg.observers]) {
    Object.keys(block || {}).forEach((k) => {
      if (typeof block[k] === 'function') inst[k] = (block[k] as (...a: unknown[]) => unknown).bind(inst);
    });
  }
  return inst;
}

/**
 * 框架语义：先把新值写进 data，再调 observer。
 * ⚠️ 只有**声明了 observer** 的属性才会回调（本组件只有 scope / visible / collectedKeys），
 * 所以 `lineText` / `word` 这类纯展示属性只写 data —— 这也正是真机的行为。
 */
function setProp(c: any, prop: string, value: unknown) {
  c.data[prop] = value;
  if (typeof c[prop] === 'function') c[prop](value);
}

/**
 * 按页面 wxml 的绑定把页面 data 同步进组件（真机由框架做，桩里显式模拟）。
 * 🔴 顺序：先 scope/文本/collectedKeys，最后 visible —— 开抽屉那一帧组件要在
 *    「key 已就位」的状态下 `_seedCollect(true)`，否则会先按空集合点亮再被覆盖（闪一下）。
 */
function syncBindings(ctx: any, comp: any): void {
  const ov = ctx.data.overlay;
  const open = !!ov && ov.kind === 'drawer';
  setProp(comp, 'scope', open ? ov.scope : '');
  setProp(comp, 'lineText', open ? ov.lineText : '');
  setProp(comp, 'word', open ? (ov.word || '') : '');
  setProp(comp, 'collectedKeys', ctx.data.collectedKeys || []);
  setProp(comp, 'visible', open);
}

/** 抽屉该项当前渲染成什么（label + class 是否带 is-collected） */
function renderedCollect(comp: any, key: string): { label: string; collected: boolean } {
  const item = (comp.data.acts as any[]).find((a) => a.key === key);
  if (!item) throw new Error(`动作项缺失：${key}`);
  return { label: item.label, collected: item.collected === true };
}

function tapCollect(comp: any, key: string) {
  comp.onActionTap({ currentTarget: { dataset: { key, kind: 'collect' } } });
  expect(comp.data.collect[key === 'collect-word' ? 'word' : 'line']).toBe('busy');
}

/**
 * 🔴 `collectedKeys` 是**集合**语义（消费方只有组件的 `includes(key)`），
 *    「先收句子还是先收单词」不是契约、也随用户操作顺序变。
 *    一律排序后比较，避免 `toEqual(['collect-line','collect-word'])` 把 push 顺序钉成契约
 *    （顺序反了会一条绿一条红 —— 原型复测第二轮指出）。
 */
const sortedKeys = (keys: readonly string[]): string[] => [...keys].sort();

/* ───────────────────────────── 页面上下文桩 ───────────────────────────── */

function makeHomeCtx(patch: Record<string, unknown> = {}): any {
  const ctx: any = Object.create(homeCfg);
  ctx.data = { ...JSON.parse(JSON.stringify(homeCfg.data)), ...patch };
  ctx.data.quote = { cn: '他是一名工程师。', en: QUOTE_EN };
  ctx.setData = function (p: Record<string, unknown>) { Object.assign(this.data, p); };
  ctx._quoteWords = [{ word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/en/' }];
  ctx._quoteMeta = { book: 'NCE2', lessonId: 4 };
  ctx._speakingWord = '';
  ctx._playingText = '';
  ctx._quoteSeq = 0;
  ctx._alive = true;
  ctx._offSpeakState = null;
  return ctx;
}

function makeDetailCtx(patch: Record<string, unknown> = {}): any {
  const ctx: any = Object.create(detailCfg);
  ctx.data = { ...JSON.parse(JSON.stringify(detailCfg.data)), ...patch };
  ctx.setData = function (p: Record<string, unknown>) { Object.assign(this.data, p); };
  ctx._playingText = '';
  ctx._playingIdx = -1;
  ctx._speakingWord = '';
  ctx._tipCollectTimer = null;
  ctx._offSpeakState = null;
  ctx.data.lines = [{ idx: 0, en: WORD_LINE, cn: '他是工程师。', tokens: [], stopIcon: '/assets/icons/stop.svg' }];
  ctx.data.detail = { id: 4, title: 'L4', words: [{ word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/en/' }] };
  ctx.data.book = 'NCE2';
  ctx.data.id = 4;
  return ctx;
}

/* ═══════════════════════ 方向 1：卡片/词卡 → 抽屉 ═══════════════════════ */

describe('方向 1 · 首页：卡片收藏过的句子，长按开抽屉就是 ✓ 已收藏', () => {
  it('🔴 卡片点收藏 → 开抽屉 → 组件渲染出 done 态（class is-collected + 文案已收藏）', async () => {
    const ctx = makeHomeCtx();
    const comp = makeDrawer({ visible: false, scope: 'line' });
    ctx.selectComponent = (sel: string) => (sel === '#drawer' ? comp : null);

    await ctx.collectQuote();                        // 卡片「☆ 收藏」→ 已收藏（写缓存）
    expect(ctx.data.quoteCollected).toBe(true);

    ctx.onQuoteLineLongPress();                      // 长按句子空白 → 开抽屉
    syncBindings(ctx, comp);

    expect(sortedKeys(ctx.data.collectedKeys)).toEqual(sortedKeys(['collect-line']));
    expect(comp.data.collect.line).toBe('done');
    expect(renderedCollect(comp, 'collect-line')).toEqual({ label: '已收藏', collected: true });
  });

  it('词卡收藏过的单词，长按同一个词开抽屉 → collect-word 是 ✓ 已收藏', async () => {
    const ctx = makeHomeCtx();
    const comp = makeDrawer({ visible: false, scope: 'word' });
    ctx.selectComponent = (sel: string) => (sel === '#drawer' ? comp : null);

    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    await ctx.collectQuoteWord();                    // 词卡「☆ 收藏」→ 已收藏
    ctx.closeQuoteTip();

    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    syncBindings(ctx, comp);

    // 🔴 精确等于：只差后缀的两个 key 用 toContain 断，写错一个字会静默通过
    expect(sortedKeys(ctx.data.collectedKeys)).toEqual(sortedKeys(['collect-word']));        // 句子没收藏过，不许串台
    expect(renderedCollect(comp, 'collect-word')).toEqual({ label: '已收藏', collected: true });
    expect(renderedCollect(comp, 'collect-line')).toEqual({ label: '收藏此句', collected: false });
  });

  it('没收藏过的句子 → 抽屉仍是 ☆ 收藏此句（修复不许把默认态也改成已收藏）', () => {
    const ctx = makeHomeCtx();
    const comp = makeDrawer({ visible: false, scope: 'line' });
    ctx.onQuoteLineLongPress();
    syncBindings(ctx, comp);
    expect(ctx.data.collectedKeys).toEqual([]);
    expect(renderedCollect(comp, 'collect-line')).toEqual({ label: '收藏此句', collected: false });
  });
});

describe('方向 1 · 详情页：词卡/句子收藏过，长按开抽屉就是 ✓ 已收藏', () => {
  it('词卡收藏过该词 → 长按该词开抽屉 → collect-word 是 ✓ 已收藏', async () => {
    const ctx = makeDetailCtx();
    const comp = makeDrawer({ visible: false, scope: 'word' });
    ctx.selectComponent = (sel: string) => (sel === '#drawer' ? comp : null);

    ctx.onWordTap({ currentTarget: { dataset: { i: 0, w: 'engineer', hasdef: true } } });
    await ctx.collectTipWord();                      // 词卡「☆ 收藏」→ 已收藏
    ctx.closeTip();

    ctx.onWordLongPress({ currentTarget: { dataset: { i: 0, w: 'engineer', hasdef: true } } });
    syncBindings(ctx, comp);

    expect(sortedKeys(ctx.data.collectedKeys)).toEqual(sortedKeys(['collect-word']));
    expect(renderedCollect(comp, 'collect-word')).toEqual({ label: '已收藏', collected: true });
  });

  it('『A 句收藏了』不许让 B 句抽屉亮成已收藏（按当前长按的那一句算）', () => {
    store.dachengzi_collected_lines = ['another sentence.'];
    const ctx = makeDetailCtx();
    const comp = makeDrawer({ visible: false, scope: 'line' });
    ctx.onLongPress({ currentTarget: { dataset: { i: 0 } } });   // 第 0 句 = WORD_LINE
    syncBindings(ctx, comp);
    expect(ctx.data.collectedKeys).toEqual([]);
    expect(renderedCollect(comp, 'collect-line')).toEqual({ label: '收藏此句', collected: false });
  });
});

/* ═══════════════════════ 方向 2：抽屉 → 卡片/词卡 ═══════════════════════ */

describe('方向 2 · 首页：抽屉里收藏成功，卡片按钮立刻是 ✓ 已收藏', () => {
  it('🔴 抽屉「收藏此句」成功 → quoteCollected=true（.dq-act 渲染已收藏）+ key 集合含 collect-line', async () => {
    const ctx = makeHomeCtx();
    const comp = makeDrawer({ visible: false, scope: 'line' });
    ctx.selectComponent = (sel: string) => (sel === '#drawer' ? comp : null);
    ctx.onQuoteLineLongPress();
    syncBindings(ctx, comp);
    expect(ctx.data.quoteCollected).toBe(false);     // 卡片初始是 ☆

    tapCollect(comp, 'collect-line');
    await ctx.onDrawerCollectLine({ detail: { lineIndex: 0, text: QUOTE_EN } });

    expect(ctx.data.quoteCollected).toBe(true);      // ← 卡片按钮的渲染依据
    expect(sortedKeys(ctx.data.collectedKeys)).toEqual(sortedKeys(['collect-line']));
    expect(comp.data.collect.line).toBe('done');     // ← 抽屉自己也是 ✓（onCollectDone 回传）
    // 关掉再开：卡片仍是已收藏，抽屉也仍是 ✓（同一份缓存）
    ctx.onDrawerClose();
    syncBindings(ctx, comp);
    ctx.onQuoteLineLongPress();
    syncBindings(ctx, comp);
    expect(renderedCollect(comp, 'collect-line')).toEqual({ label: '已收藏', collected: true });
  });

  it('抽屉「收藏单词」成功 → key 集合含 collect-word；之后点开同一个词卡就是 ✓ 已收藏', async () => {
    const ctx = makeHomeCtx();
    const comp = makeDrawer({ visible: false, scope: 'word' });
    ctx.selectComponent = (sel: string) => (sel === '#drawer' ? comp : null);
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    syncBindings(ctx, comp);

    tapCollect(comp, 'collect-word');
    await ctx.onDrawerCollectWord({ detail: { word: 'engineer', lineIndex: 0, hasDef: true } });
    expect(sortedKeys(ctx.data.collectedKeys)).toEqual(sortedKeys(['collect-word']));
    expect(comp.data.collect.word).toBe('done');

    ctx.onDrawerClose();
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    expect(ctx.data.quoteWordCollected).toBe(true);  // 词卡按钮按缓存取初值
  });

  it('收藏失败 → 卡片不许被点亮（只有 ok 才同步）', async () => {
    collectMock.mockRejectedValue(new Error('boom'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeHomeCtx();
    const comp = makeDrawer({ visible: false, scope: 'line' });
    ctx.selectComponent = (sel: string) => (sel === '#drawer' ? comp : null);
    ctx.onQuoteLineLongPress();
    syncBindings(ctx, comp);
    tapCollect(comp, 'collect-line');
    await ctx.onDrawerCollectLine({ detail: { lineIndex: 0, text: QUOTE_EN } });
    expect(ctx.data.quoteCollected).toBe(false);
    expect(ctx.data.collectedKeys).toEqual([]);
    expect(comp.data.collect.line).toBe('idle');
    errSpy.mockRestore();
  });
});

describe('方向 2 · 详情页：抽屉里收藏成功，页面侧状态同步', () => {
  it('抽屉「收藏单词」成功 → key 集合含 collect-word；之后点开词卡就是 ✓ 已收藏', async () => {
    const ctx = makeDetailCtx();
    const comp = makeDrawer({ visible: false, scope: 'word' });
    ctx.selectComponent = (sel: string) => (sel === '#drawer' ? comp : null);
    ctx.onWordLongPress({ currentTarget: { dataset: { i: 0, w: 'engineer', hasdef: true } } });
    syncBindings(ctx, comp);

    tapCollect(comp, 'collect-word');
    await ctx.onDrawerCollectWord({ detail: { word: 'engineer', lineIndex: 0, hasDef: true } });
    expect(sortedKeys(ctx.data.collectedKeys)).toEqual(sortedKeys(['collect-word']));
    expect(comp.data.collect.word).toBe('done');

    ctx.onDrawerClose();
    ctx.onWordTap({ currentTarget: { dataset: { i: 0, w: 'engineer', hasdef: true } } });
    expect(ctx.data.tipCollect).toBe('done');
  });

  it('抽屉「收藏此句」成功 → key 集合含 collect-line（句维度按 lineIndex）', async () => {
    const ctx = makeDetailCtx();
    const comp = makeDrawer({ visible: false, scope: 'line' });
    ctx.selectComponent = (sel: string) => (sel === '#drawer' ? comp : null);
    ctx.onLongPress({ currentTarget: { dataset: { i: 0 } } });
    syncBindings(ctx, comp);

    tapCollect(comp, 'collect-line');
    await ctx.onDrawerCollectLine({ detail: { lineIndex: 0, text: WORD_LINE } });
    expect(sortedKeys(ctx.data.collectedKeys)).toEqual(sortedKeys(['collect-line']));
    expect(comp.data.collect.line).toBe('done');
  });
});

/* ═══════════════════════ 静态：绑定真的在 wxml 上 ═══════════════════════ */

describe('静态：两页都把 key 集合交给抽屉、卡片按钮都绑同一份状态', () => {
  it('两页 action-drawer 都有 collected-keys 绑定，且不复存在旧的两布尔属性', () => {
    for (const rel of ['pages/home/index/index.wxml', 'pages/nce/detail/detail.wxml']) {
      const w = stripWxml(src(rel));
      expect(w).toContain('collected-keys="{{collectedKeys}}"');
      expect(w).not.toMatch(/line-collected=|word-collected=/);
    }
  });

  it('首页卡片按钮的渲染依据是 quoteCollected（✓ check / 已收藏），不是别的字段', () => {
    const w = stripWxml(src('pages/home/index/index.wxml'));
    expect(w).toMatch(/\{\{quoteCollected \? icons\.check : icons\.star\}\}/);
    expect(w).toMatch(/\{\{quoteCollected \? '已收藏' : '收藏'\}\}/);
  });

  it('组件 collectedKeys → _seedCollect 的同步链没被绕过（observer 真的接了）', () => {
    expect(typeof drawerCfg.observers.collectedKeys).toBe('function');
    const fnSrc = String(drawerCfg.observers.collectedKeys);
    expect(fnSrc).toContain('_seedCollect');
  });
});
