/// <reference types="node" />
/**
 * 首页 · D2 点空白关词卡 + D7 收藏态回查（2026-11-27 第二批）
 *
 * 与 `tests/nce-detail-card-collect-1127.test.ts` 是**同一批口径的另一端**：
 *  - D2：根节点 `bindtap="onQuotePageTap"`（不是透明遮罩），点空白关词卡、点词不关；
 *  - D7：词卡 / 抽屉的初始「已收藏」态从本地缓存取（不再写死 false），
 *    且已收藏的按钮再点**仍然发真实写请求**（缓存失效兜底）。
 *
 * 首页保持两态（`☆ 收藏 / ✓ 已收藏`）—— 三态是本轮 D1 详情页词卡的范围，
 * 首页的 `quoteCollected` / `quoteWordCollected` 语义与既有 44 条用例一致，未改动。
 */
export {};

const QUOTE_EN = 'He is an engineer.';

const mockTts: any = {
  listeners: new Set<(s: any) => void>(),
  playingText: '',
  stopCalls: 0,
  emit(next: any) { mockTts.listeners.forEach((cb: (s: any) => void) => cb(next)); },
};
jest.mock('../services/tts', () => ({
  speakText: jest.fn(() => Promise.resolve(true)),
  stopSpeak: jest.fn(() => { mockTts.stopCalls += 1; mockTts.emit(null); }),
  onSpeakState: jest.fn((cb: (s: any) => void) => { mockTts.listeners.add(cb); return () => { mockTts.listeners.delete(cb); }; }),
}));

jest.mock('../services/nce', () => ({ getNceLesson: jest.fn(() => Promise.resolve(null)) }));

const mockGlossary: any = { calls: [] as any[], resolve: { id: 1, existed: false }, reject: false };
jest.mock('../services/glossary', () => ({
  collectGlossary: (payload: any) => {
    mockGlossary.calls.push(payload);
    if (mockGlossary.reject) return Promise.reject(new Error('boom'));
    return Promise.resolve(mockGlossary.resolve);
  },
}));

jest.mock('../services/auth', () => ({ isLoggedIn: jest.fn(() => true), loginFromGate: jest.fn() }));
jest.mock('../services/account', () => ({
  readLocalNickname: jest.fn(() => '橙子'),
  fetchProfile: jest.fn(() => Promise.resolve({ nickname: '橙子' })),
  isNicknameUnset: jest.fn(() => false),
}));
jest.mock('../utils/greeting', () => ({ formatGreeting: jest.fn(() => '橙子，下午好'), getLocalHour: jest.fn(() => 15) }));
jest.mock('../utils/tabbar', () => ({ setTabBarSelected: jest.fn(), TAB_INDEX: { home: 0 } }));
jest.mock('../utils/daily', () => ({
  getDailyQuoteSource: jest.fn(() => ({ cn: '他是一名工程师。', en: QUOTE_EN, book: 'NCE2', lessonId: 4 })),
  getDailyQuoteMeta: jest.fn(() => ({ book: 'NCE2', lessonId: 4 })),
  BOOK_LABEL: { NCE2: '新概念二册' },
}));
jest.mock('../utils/quote-words', () => ({
  readWordsCache: jest.fn(() => [{ word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/en/' }]),
  writeWordsCache: jest.fn(),
}));
jest.mock('../pages/nce/books', () => ({ DEFAULT_NCE_BOOK: 'NCE2', nceBookTotal: () => 96 }));

let store: Record<string, any> = {};
const mockWx: any = {
  getStorageSync: jest.fn((k: string) => (store[k] === undefined ? '' : store[k])),
  setStorageSync: jest.fn((k: string, v: any) => { store[k] = v; }),
  removeStorageSync: jest.fn((k: string) => { delete store[k]; }),
  showToast: jest.fn(),
  navigateTo: jest.fn(),
  switchTab: jest.fn(),
};

let pageConfig: any = null;

beforeAll(() => {
  (globalThis as any).wx = mockWx;
  (globalThis as any).getApp = () => ({ eventBus: { on: jest.fn(), off: jest.fn() }, radiusClassOf: () => '' });
  (globalThis as any).Page = (cfg: any) => { pageConfig = cfg; };
  require('../pages/home/index/index');
});

beforeEach(() => {
  store = {};
  jest.clearAllMocks();
  mockTts.listeners.clear();
  mockTts.stopCalls = 0;
  mockGlossary.calls = [];
  mockGlossary.resolve = { id: 1, existed: false };
  mockGlossary.reject = false;
});

const fs = require('fs');
const path = require('path');
const APP = path.resolve(__dirname, '..');
const read = (p: string): string => fs.readFileSync(path.join(APP, p), 'utf8');
const stripWxml = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '');

function makeCtx(patch: Record<string, unknown> = {}): any {
  const ctx: any = Object.create(pageConfig);
  ctx.data = { ...JSON.parse(JSON.stringify(pageConfig.data)), ...patch };
  ctx.data.quote = { cn: '他是一名工程师。', en: QUOTE_EN };
  ctx.setData = function (p: Record<string, unknown>) { Object.assign(this.data, p); };
  ctx._alive = true;
  ctx._quoteSeq = 0;
  ctx._quoteWords = [{ word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/en/' }];
  ctx._quoteMeta = { book: 'NCE2', lessonId: 4 };
  ctx._speakingWord = '';
  ctx._playingText = '';
  ctx._offSpeakState = null;
  pageConfig.onLoad.call(ctx);          // 真实订阅链（stopSpeak 推 null → 播放态归零）
  return ctx;
}

// ═════════════════════════ D2 ═════════════════════════
describe('D2 点空白关词卡（首页这一端）', () => {
  it('静态：根节点 bindtap="onQuotePageTap"，词卡容器 catchtap="noop"，没有遮罩层', () => {
    const w = stripWxml(read('pages/home/index/index.wxml'));
    const rootTag = (w.match(/<view class="page[^"]*"[^>]*>/) || [''])[0];
    expect(rootTag).toMatch(/^<view\s/);          // 防空转
    expect(rootTag).toMatch(/bindtap="onQuotePageTap"/);
    const tipTag = (w.match(/<view wx:if="\{\{overlay && overlay\.kind === 'wordtip'\}\}"[^>]*>/) || [''])[0];
    expect(tipTag).toMatch(/^<view\s/);
    expect(tipTag).toMatch(/catchtap="noop"/);
    expect(w).not.toMatch(/class="[^"]*tap-mask/);
    expect(w).not.toMatch(/class="[^"]*page-mask/);
  });

  it('行为：点空白 → 关词卡；正在读该词 → stopSpeak', () => {
    const ctx = makeCtx();
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip' });
    ctx._playingText = 'engineer';               // 正在读这个词（不是整句）
    const before = mockTts.stopCalls;
    ctx.onQuotePageTap({ target: { dataset: {} } });
    expect(ctx.data.overlay).toBeNull();
    expect(mockTts.stopCalls).toBeGreaterThan(before);
  });

  it('🔴 点在词上（target 带 data-w）→ 不关闭；换另一个词也不受根节点影响', () => {
    const ctx = makeCtx();
    ctx._quoteWords = [
      { word: 'engineer', pos: 'n.', def: '工程师' },
      { word: 'doctor', pos: 'n.', def: '医生' },
    ];
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    // 根节点也会收到这次 tap（真机上 catchtap 会阻断，但这里是第二道保险的场景）
    ctx.onQuotePageTap({ target: { dataset: { w: 'engineer', hasdef: true } } });
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'engineer' });
    // 换词：内容真的换成另一个词（不是「只对当前词免疫」）
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'doctor', hasdef: true } } });
    ctx.onQuotePageTap({ target: { dataset: { w: 'doctor', hasdef: true } } });
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'doctor' });
  });

  it('行为：抽屉打开时点空白不动它', () => {
    const ctx = makeCtx();
    ctx.onQuoteLineLongPress();
    ctx.onQuotePageTap({ target: { dataset: {} } });
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'line' });
  });

  it('行为：没有浮层时不 setData（不发多余重绘）', () => {
    const ctx = makeCtx();
    const spy = jest.spyOn(ctx, 'setData');
    ctx.onQuotePageTap({ target: { dataset: {} } });
    ctx.onQuotePageTap();
    expect(spy).not.toHaveBeenCalled();
  });
});

// ═════════════════════════ D7 ═════════════════════════
describe('D7 收藏态跨界面回查（首页这一端）', () => {
  it('收藏过的词再点开 → ✓ 已收藏（初值来自缓存）', async () => {
    const first = makeCtx();
    first.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    await first.collectQuoteWord();
    expect(first.data.quoteWordCollected).toBe(true);

    const again = makeCtx();                      // 新上下文 = 重新进入页面的那份 data
    again.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    expect(again.data.quoteWordCollected).toBe(true);
  });

  it('换句（_applyQuote）时已收藏态按新句的缓存重算，不是一律 false', () => {
    store.dachengzi_collected_lines = [QUOTE_EN.toLowerCase()];
    const ctx = makeCtx();
    ctx._applyQuote({ cn: '他是一名工程师。', en: QUOTE_EN, book: 'NCE2', lessonId: 4 }, []);
    expect(ctx.data.quoteCollected).toBe(true);

    const ctx2 = makeCtx();
    ctx2._applyQuote({ cn: '另一句。', en: 'Another sentence.', book: 'NCE2', lessonId: 5 }, []);
    expect(ctx2.data.quoteCollected).toBe(false); // 没收藏过的句子仍是 ☆
  });

  it('抽屉的已收藏 key 集合按缓存算（句档 / 词档各自）', () => {
    store.dachengzi_collected_lines = [QUOTE_EN.toLowerCase()];
    store.dachengzi_collected_words = ['engineer'];
    const ctx = makeCtx();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    expect(ctx.data.collectedKeys).toEqual(['collect-line', 'collect-word']);

    // 句档只剩 line 一个 key（上一词留下的 word key 不许串进来）
    const ctx2 = makeCtx({ collectedKeys: ['collect-word'] });
    ctx2.onQuoteLineLongPress();
    expect(ctx2.data.collectedKeys).toEqual(['collect-line']);
  });

  it('🔴 缓存失效兜底：已显示 ✓ 仍发真实写请求（点一次就与服务器对齐）', async () => {
    store.dachengzi_collected_words = ['engineer'];
    const ctx = makeCtx();
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    expect(ctx.data.quoteWordCollected).toBe(true);       // 初值来自缓存
    await ctx.collectQuoteWord();
    expect(mockGlossary.calls).toHaveLength(1);           // 不许短路
  });

  it('收藏成功写缓存（页脚与词卡两条入口都写）', async () => {
    const ctx = makeCtx();
    await ctx.collectQuote();
    expect(store.dachengzi_collected_lines).toContain(QUOTE_EN.toLowerCase());
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    await ctx.collectQuoteWord();
    expect(store.dachengzi_collected_words).toContain('engineer');
  });

  it('静态：key 集合经**一个**属性交给抽屉组件（不留第二套判断）', () => {
    const w = stripWxml(read('pages/home/index/index.wxml'));
    expect(w).toContain('collected-keys="{{collectedKeys}}"');
    expect(w).not.toContain('line-collected=');
    expect(w).not.toContain('word-collected=');
  });
});
