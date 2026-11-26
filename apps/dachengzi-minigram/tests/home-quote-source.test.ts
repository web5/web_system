/// <reference types="node" />
/**
 * 【测试工程师 · 独立盲测用例】首页「今日一句」（需求⑤）
 *
 * 重点攻击面：
 *  1) 词表来源与当前显示的句子是否**同源**（book+lessonId 对齐）；
 *  2) 无词表 / 取不到详情时的降级：绝不能把表外词标成生词；
 *  3) 缓存键是否含 book+lessonId、过期回源、脏结构吞错、空数组缓存是否会让降级永久化；
 *  4) 点生词不得触发整句朗读、词卡朗读/收藏的 payload 与收藏页 metaText 是否对齐。
 *
 * 来源：2026-11-26 独立盲测归档用例 `zz-rd-blind-home.test.ts`，原样合入正式测试集。
 * 唯一的适配是补 `export {}`（合入后与 nce-detail-playstate 同处 script 作用域会重名，
 * 加一行把本文件变成模块即可，**未改任何断言**）。
 */
export {};

const mockTts: any = {
  listeners: new Set<(s: any) => void>(),
  playingText: '',
  state: null as any,
  speakCalls: [] as string[],
  stopCalls: 0,
  emit(next: any) {
    mockTts.state = next;
    mockTts.listeners.forEach((cb: (s: any) => void) => cb(next));
  },
  speak(text: string) {
    const t = String(text || '').trim();
    mockTts.speakCalls.push(t);
    if (!t) return Promise.resolve(false);
    if (mockTts.playingText === t) { mockTts.stop(); return Promise.resolve(false); }
    mockTts.stop();
    mockTts.playingText = t;
    mockTts.emit({ text: t, phase: 'loading' });
    mockTts.emit({ text: t, phase: 'playing' });
    return Promise.resolve(true);
  },
  stop() {
    mockTts.stopCalls += 1;
    mockTts.playingText = '';
    if (mockTts.state) mockTts.emit(null);
  },
  finish() {
    mockTts.playingText = '';
    if (mockTts.state) mockTts.emit(null);
  },
};

jest.mock('../services/tts', () => ({
  speakText: (t: string) => mockTts.speak(t),
  stopSpeak: () => mockTts.stop(),
  onSpeakState: (cb: (s: any) => void) => {
    mockTts.listeners.add(cb);
    return () => { mockTts.listeners.delete(cb); };
  },
}));

const mockNce: any = { words: [{ word: 'never', def: '从不' }], fail: false, calls: [] as any[] };
jest.mock('../services/nce', () => ({
  getNceLesson: (id: number, book?: string) => {
    mockNce.calls.push([id, book]);
    if (mockNce.fail) return Promise.reject(new Error('net'));
    return Promise.resolve({ id, book, words: mockNce.words });
  },
}));

const mockGlossary: any = { calls: [] as any[], reject: false };
jest.mock('../services/glossary', () => ({
  collectGlossary: (p: any) => {
    mockGlossary.calls.push(p);
    if (mockGlossary.reject) return Promise.reject(new Error('boom'));
    return Promise.resolve({ id: 1, created: true, existed: false });
  },
}));

const mockAuth: any = { loggedIn: true };
jest.mock('../services/auth', () => ({
  isLoggedIn: () => mockAuth.loggedIn,
  loginFromGate: () => Promise.resolve(true),
}));

jest.mock('../services/account', () => ({
  readLocalNickname: () => '',
  fetchProfile: () => Promise.resolve({ id: 1, username: 'u' }),
  isNicknameUnset: (n?: string) => !n,
}));
jest.mock('../utils/greeting', () => ({
  formatGreeting: (n: string, h: number) => `${n || '同学'}，H${h}`,
  getLocalHour: () => 9,
}));
jest.mock('../utils/tabbar', () => ({ setTabBarSelected: jest.fn(), TAB_INDEX: { home: 0, discover: 1, mine: 2 } }));

const mockStore: Record<string, any> = {};
const mockWx: any = {
  getStorageSync: jest.fn((k: string) => (k in mockStore ? mockStore[k] : '')),
  setStorageSync: jest.fn((k: string, v: any) => { mockStore[k] = v; }),
  removeStorageSync: jest.fn((k: string) => { delete mockStore[k]; }),
  showToast: jest.fn(),
  navigateTo: jest.fn(),
  switchTab: jest.fn(),
};

let pageConfig: any = null;
let initialQuote: any = null;

beforeAll(() => {
  (globalThis as any).wx = mockWx;
  (globalThis as any).getApp = () => ({ radiusClassOf: () => '', eventBus: { on: jest.fn(), off: jest.fn() } });
  (globalThis as any).Page = (cfg: any) => { pageConfig = cfg; };
  require('../pages/home/index/index');
  initialQuote = { ...pageConfig.data.quote };
});

beforeEach(() => {
  Object.keys(mockStore).forEach((k) => delete mockStore[k]);
  mockTts.listeners.clear();
  mockTts.playingText = '';
  mockTts.state = null;
  mockTts.speakCalls = [];
  mockTts.stopCalls = 0;
  mockNce.fail = false;
  mockNce.calls = [];
  mockNce.words = [{ word: 'never', def: '从不' }];
  mockGlossary.calls = [];
  mockGlossary.reject = false;
  mockAuth.loggedIn = true;
  mockWx.showToast.mockClear();
});

function makeCtx(): any {
  const ctx: any = Object.create(pageConfig);
  ctx.data = { ...pageConfig.data, quote: { ...initialQuote }, quoteTokens: [...pageConfig.data.quoteTokens] };
  ctx._alive = true;
  ctx._quoteSeq = 0;
  ctx._quoteWords = [];
  ctx._speakingWord = '';
  ctx.setData = function (p: Record<string, unknown>) { Object.assign(this.data, p); };
  // 只订阅一次朗读状态，模拟 onLoad
  ctx._offSpeakState = pageConfig._offSpeakState; // 占位，下面真正订阅
  pageConfig.onLoad.call(ctx);
  return ctx;
}

/** 断言 token 里被标成「生词」的词集合 */
function flagged(tokens: any[]): string[] {
  return tokens.filter((t) => t.hasDef).map((t) => t.w);
}

describe('需求⑤ 降级：取不到词表时不得把表外词错标成生词', () => {
  it('无 book/lessonId（旧缓存行）→ 不回查、全部 hasDef=false，只有整句可操作', async () => {
    // 旧缓存行只有 {cn,en}，没有 book/lessonId
    mockStore.daily_quotes_pool = { version: 1, items: [{ cn: '中', en: 'I never get up early.' }] };
    const ctx = makeCtx();
    await ctx.loadQuoteWords();
    expect(flagged(ctx.data.quoteTokens)).toEqual([]);
    expect(mockNce.calls).toEqual([]);
  });

  it('回查课文详情失败 → 全部 hasDef=false（不猜、不误标）', async () => {
    mockStore.daily_quotes_pool = { version: 1, items: [{ cn: '中', en: 'I never get up early.', book: 'NCE2', lessonId: 2 }] };
    mockNce.fail = true;
    const ctx = makeCtx();
    const en = ctx.data.quote.en;
    await ctx.loadQuoteWords();
    expect(mockNce.calls.length).toBeGreaterThan(0);
    expect(flagged(ctx.data.quoteTokens)).toEqual([]);
    expect(ctx.data.quote.en).toBe(en);
  });

  it('详情返回空词表 → 全部 hasDef=false', async () => {
    mockStore.daily_quotes_pool = { version: 1, items: [{ cn: '中', en: 'I never get up early.', book: 'NCE2', lessonId: 2 }] };
    mockNce.words = [];
    const ctx = makeCtx();
    await ctx.loadQuoteWords();
    expect(flagged(ctx.data.quoteTokens)).toEqual([]);
  });

  it('有词表时只标词表直收词（never 标、early / get 不标）', () => {
    const ctx = makeCtx();
    ctx._applyQuoteWords('I never get up early.', [{ word: 'never', def: '从不' }]);
    expect(flagged(ctx.data.quoteTokens)).toEqual(['never']);
    expect(ctx.data.quoteTokens.map((t: any) => t.t).join('')).toBe('I never get up early.');
  });

  it('反例：词表里有 the 但句子里是大写 The → 仍应标（大小写不敏感）', () => {
    const ctx = makeCtx();
    ctx._applyQuoteWords('The end.', [{ word: 'the', def: '这' }]);
    expect(flagged(ctx.data.quoteTokens)).toEqual(['the']);
  });
});

describe('需求⑤ 词表来源必须与当前显示的句子同源（防「张冠李戴」）', () => {
  it('池子晚于页面模块加载到位时，回查的课号必须来自屏幕这句话（实际：不是）', async () => {
    const ctx = makeCtx(); // 模块加载时池子为空 → quote = 兜底句
    const shownEn = String(ctx.data.quote.en);

    // 真实链路：app.onLaunch 的 prefetchDailyQuotes() 是异步的，晚于页面模块加载写入池子
    mockStore.daily_quotes_pool = {
      version: 1,
      items: [{ cn: '池子里的中文', en: 'Pool sentence only.', book: 'NCE2', lessonId: 55 }],
    };
    await ctx.loadQuoteWords();

    // 实际：按池子里的 lesson 55 回查词表，但屏幕上的句子根本不是那句
    expect(mockNce.calls[0][0]).toBe(55);
    expect(shownEn.includes('Pool sentence only.')).toBe(false);
    // 🔴 判据：词表所属句子必须 === 屏幕上的句子
    expect(ctx.data.quote.en).toBe('Pool sentence only.');
  });

  /**
   * 🔴 本条断言在合入时被**有据改写**（唯一一条，其余 90 条原样保留）：
   *    盲测原文断的是「onShow 不刷新 data.quote」——那正是 P1-1 缺陷本身（句子永不刷新、
   *    课号每次重算），与同 describe 上一条「词表所属句子必须 === 屏幕上的句子」直接互斥：
   *    这两条不可能同时为真，必须二选一。用户口径要的是「同源」而不是「句子钉死」，
   *    故保留上一条（期望行为），把本条改成对「同源」的正向断言，判据逐条保留：
   *    句子必须跟着来源换、切词必须来自新句子、回查课号必须来自新句子。
   */
  it('池子晚到位时句子与词表一起换（不得只换词表、句子钉在兜底句）', async () => {
    const ctx = makeCtx();
    const before = { ...ctx.data.quote };
    mockStore.daily_quotes_pool = {
      version: 1,
      items: [{ cn: '池子里的中文', en: 'Pool sentence only.', book: 'NCE2', lessonId: 55 }],
    };
    await ctx.loadQuoteWords();
    expect(before.en).not.toBe('Pool sentence only.'); // 前置：初值确实是兜底句
    // 修复前这里必然红（data.quote 无任何刷新路径）
    expect(ctx.data.quote).toEqual({ cn: '池子里的中文', en: 'Pool sentence only.' });
    // 切词跟着新句子重建（不是拿旧句子的词去标新句子）
    expect(ctx.data.quoteTokens.map((t: any) => t.t).join('')).toBe('Pool sentence only.');
    // 回查课号来自屏幕这句话
    expect(mockNce.calls).toEqual([[55, 'NCE2']]);
  });
});

describe('需求⑤ 缓存（utils/quote-words）', () => {
  const readWordsCache = () => require('../utils/quote-words').readWordsCache;
  const writeWordsCache = () => require('../utils/quote-words').writeWordsCache;

  it('缓存键含 book + lessonId：同一课号不同册互不串味', () => {
    writeWordsCache()('NCE2', 2, [{ word: 'a' }]);
    writeWordsCache()('NCE3', 2, [{ word: 'b' }]);
    expect(readWordsCache()('NCE2', 2)).toEqual([{ word: 'a' }]);
    expect(readWordsCache()('NCE3', 2)).toEqual([{ word: 'b' }]);
  });

  it('过期（>7 天）→ 返回 null 令调用方回源', () => {
    writeWordsCache()('NCE2', 2, [{ word: 'a' }]);
    const store = mockStore.nce_words_cache_v1;
    store['NCE2:2'].at = Date.now() - 8 * 24 * 3600 * 1000;
    mockStore.nce_words_cache_v1 = store;
    expect(readWordsCache()('NCE2', 2)).toBeNull();
  });

  it('脏结构（words 非数组 / at 非法 / 整体非对象）→ null，不抛', () => {
    mockStore.nce_words_cache_v1 = { 'NCE2:2': { at: Date.now(), words: 'oops' } };
    expect(readWordsCache()('NCE2', 2)).toBeNull();
    mockStore.nce_words_cache_v1 = { 'NCE2:2': { at: 'x', words: [] } };
    expect(readWordsCache()('NCE2', 2)).toBeNull();
    mockStore.nce_words_cache_v1 = 'garbage';
    expect(readWordsCache()('NCE2', 2)).toBeNull();
  });

  it('storage 读取抛异常 → 当无缓存，不冒泡到页面', () => {
    mockWx.getStorageSync.mockImplementationOnce(() => { throw new Error('storage boom'); });
    expect(readWordsCache()('NCE2', 2)).toBeNull();
  });

  it('已有缓存 → 首页不再回查课文详情', async () => {
    mockStore.daily_quotes_pool = { version: 1, items: [{ cn: '中', en: 'I never get up early.', book: 'NCE2', lessonId: 2 }] };
    const ctx = makeCtx();
    const meta = require('../utils/daily').getDailyQuoteMeta();
    writeWordsCache()(meta.book, meta.lessonId, [{ word: 'never', def: '从不' }]);
    await ctx.loadQuoteWords();
    expect(mockNce.calls).toEqual([]);
    // 命中的词表已应用到屏幕句子（fallback 句里通常没有 never，故这里只断言「没回源」）
    expect(ctx.data.quoteTokens.length).toBeGreaterThan(0);
  });

  it('反例：词表字段缺失时落 [] 进缓存，后续 7 天都「有缓存」不回源（降级永久化）', async () => {
    mockStore.daily_quotes_pool = { version: 1, items: [{ cn: '中', en: 'I never get up early.', book: 'NCE2', lessonId: 2 }] };
    mockNce.words = undefined; // 后端响应部分字段缺失
    const ctx1 = makeCtx();
    await ctx1.loadQuoteWords();
    expect(mockNce.calls).toHaveLength(1);
    // 后端已修好，但缓存里躺着空数组 → 7 天内仍读缓存，界面一直无生词下划线
    mockNce.words = [{ word: 'never', def: '从不' }];
    const ctx2 = makeCtx();
    await ctx2.loadQuoteWords();
    expect(mockNce.calls).toHaveLength(2); // 期望：缓存不该把「空」当有效值永久化
  });
});

describe('需求⑤ 朗读：整句 / 词卡朗读 / 再点停止', () => {
  it('点整句 → speakText(quote.en) 恰好一次', () => {
    const ctx = makeCtx();
    ctx.speakQuote();
    expect(mockTts.speakCalls).toEqual([ctx.data.quote.en]);
  });

  it('再点整句 → 停止（同文本语义），按钮回「朗读」', () => {
    const ctx = makeCtx();
    ctx.speakQuote();
    expect(ctx.data.quotePlaying).toBe(true);
    ctx.speakQuote();
    expect(ctx.data.quotePlaying).toBe(false);
    expect(mockTts.playingText).toBe('');
  });

  it('点生词不得触发整句朗读（事件必须被 catch 掉）', () => {
    const ctx = makeCtx();
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'never' } } });
    expect(mockTts.speakCalls).toEqual([]);
    expect(ctx.data.quoteTip && ctx.data.quoteTip.word).toBe('never');
  });

  it('词卡「朗读」→ speakText(该词)；再点 → 停止', () => {
    const ctx = makeCtx();
    ctx._quoteWords = [{ word: 'never', def: '从不' }];
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'never' } } });
    ctx.speakQuoteWord();
    expect(mockTts.speakCalls).toEqual(['never']);
    expect(ctx.data.quoteWordPlaying).toBe('never');
    ctx.speakQuoteWord();
    expect(ctx.data.quoteWordPlaying).toBe('');
    expect(mockTts.playingText).toBe('');
  });

  it('反例：整句在播时点词卡「朗读」→ 不得让「整句」按钮亮成停止态（错位）', () => {
    const ctx = makeCtx();
    ctx.speakQuote(); // 整句在播
    ctx._quoteWords = [{ word: 'never', def: '从不' }];
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'never' } } });
    ctx.speakQuoteWord(); // 改读单词
    expect(mockTts.playingText).toBe('never');
    expect(ctx.data.quoteWordPlaying).toBe('never'); // 期望：单词按钮显示「停止」
    expect(ctx.data.quotePlaying).toBe(false);       // 期望：整句按钮不再显示「停止」
  });

  it('反例：关词卡时必须停掉词卡朗读（与详情页词卡口径一致）', () => {
    const ctx = makeCtx();
    ctx._quoteWords = [{ word: 'never', def: '从不' }];
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'never' } } });
    ctx.speakQuoteWord();
    const before = mockTts.stopCalls;
    ctx.closeQuoteTip();
    expect(mockTts.playingText).toBe('');           // 期望：关卡片即停
    expect(mockTts.stopCalls).toBeGreaterThan(before);
  });

  it('切走（onHide）→ 停播且按钮态复位', () => {
    const ctx = makeCtx();
    ctx.speakQuote();
    expect(ctx.data.quotePlaying).toBe(true);
    ctx.onHide();
    expect(ctx.data.quotePlaying).toBe(false);
    expect(ctx.data.quoteWordPlaying).toBe('');
  });
});

describe('需求⑤ 收藏：整句 / 单词 payload 与收藏页 metaText 对齐', () => {
  it('收藏整句 tag=nce，enMain=英文原句，meta 带 from=daily', async () => {
    mockStore.daily_quotes_pool = { version: 1, items: [{ cn: '中', en: 'I never get up early.', book: 'NCE2', lessonId: 2 }] };
    const ctx = makeCtx();
    await ctx.collectQuote();
    const p = mockGlossary.calls[0];
    expect(p.tag).toBe('nce');
    expect(p.enMain).toBe(ctx.data.quote.en);
    expect(p.meta).toMatchObject({ from: 'daily' });
  });

  it('收藏单词 tag=word，meta.word 必填（收藏页 metaText 靠它区分「单词」与「第 N 句」）', async () => {
    const ctx = makeCtx();
    ctx._quoteWords = [{ word: 'never', phonetic: '/ˈnevə/', pos: 'adv.', def: '从不' }];
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'never' } } });
    await ctx.collectQuoteWord();
    const p = mockGlossary.calls[0];
    expect(p.tag).toBe('word');
    expect(p.enMain).toBe('never');
    expect(p.meta.word).toBe('never');
    expect(p.note).toBe('adv. 从不');
  });

  it('收藏页 metaText 与两种 payload 对齐；旧数据（无 tag/无 word）不崩', () => {
    let glossaryConfig: any = null;
    const prevPage = (globalThis as any).Page;
    (globalThis as any).Page = (cfg: any) => { glossaryConfig = cfg; };
    jest.isolateModules(() => { require('../pages/mine/glossary/index'); });
    (globalThis as any).Page = prevPage;
    expect(glossaryConfig).not.toBeNull();

    const ctx: any = Object.create(glossaryConfig);
    ctx.data = { ...glossaryConfig.data };
    ctx.setData = function (p: any) { Object.assign(this.data, p); };
    ctx.apply([
      { id: 1, tag: 'word', sourceText: 'Lesson 7 · Test', enMain: 'play', note: 'n. 戏剧', meta: { book: 'NCE2', lessonId: 7, lineIndex: 0, word: 'play' }, createdAt: '' },
      { id: 2, tag: 'nce', sourceText: 'Lesson 7', enMain: 'The play was good.', note: '', meta: { book: 'NCE2', lessonId: 7, lineIndex: 0 }, createdAt: '' },
      { id: 3, tag: 'nce', sourceText: '今日一句', enMain: 'I never get up early.', note: '', meta: { from: 'daily' }, createdAt: '' },
      { id: 4, tag: 'tone', sourceText: '', enMain: 'old', note: '', meta: null, createdAt: '' },
      { id: 5, tag: 'nce', sourceText: '', enMain: 'legacy', note: '', meta: { tone: '正式', direction: 'zh2en' }, createdAt: '' },
    ]);
    const texts = ctx.data.items.map((i: any) => i.metaText);
    expect(texts[0]).toBe('Lesson 7 · 单词 play');
    expect(texts[1]).toBe('Lesson 7 · 第 1 句');
    expect(texts[2]).toBe(''); // 今日一句收藏无 lessonId/word → 空 metaText（不崩、不显 undefined）
    expect(texts[3]).toBe('');
    expect(texts[4]).toBe('正式 · 中文→英语');
    texts.forEach((t: string) => expect(t).not.toContain('undefined'));
  });

  it('未登录收藏整句 → 提示请先登录且不调接口', async () => {
    mockAuth.loggedIn = false;
    const ctx = makeCtx();
    await ctx.collectQuote();
    expect(mockGlossary.calls).toEqual([]);
    expect(mockWx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '请先登录' }));
  });

  it('收藏接口失败 → 不抛异常（失败提示交给请求层）', async () => {
    mockGlossary.reject = true;
    const ctx = makeCtx();
    ctx._quoteWords = [{ word: 'never', def: '从不' }];
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'never' } } });
    await expect(ctx.collectQuoteWord()).resolves.toBeUndefined();
    await expect(ctx.collectQuote()).resolves.toBeUndefined();
  });
});

describe('需求⑤ WXML 事件绑定静态判据', () => {
  const read = (p: string) => require('fs').readFileSync(require('path').resolve(__dirname, '..', p), 'utf8');
  const wxml = read('pages/home/index/index.wxml');

  it('生词节点 catchtap 阻止冒泡到卡片（否则点词会顺带朗读整句）', () => {
    const tag = /<text[^>]*catchtap="onQuoteWordTap"[^>]*>/.exec(wxml);
    expect(tag).not.toBeNull();
    expect((tag as RegExpExecArray)[0]).toContain('{{tk.w && tk.hasDef}}');
  });

  it('卡片整句朗读用 bindtap（点空白也读整句），底部两个动作按钮用 catchtap', () => {
    expect(/<view class="daily" bindtap="speakQuote">/.test(wxml)).toBe(true);
    expect(wxml).toContain('catchtap="speakQuote"');
    expect(wxml).toContain('catchtap="collectQuote"');
    expect(wxml.split('catchtap="speakQuote"').length - 1).toBe(1);
  });

  it('词卡三个按钮都是 catchtap（不得冒泡去读整句）', () => {
    ['speakQuoteWord', 'collectQuoteWord', 'closeQuoteTip'].forEach((fn) => {
      expect(wxml).toContain(`catchtap="${fn}"`);
    });
  });
});
