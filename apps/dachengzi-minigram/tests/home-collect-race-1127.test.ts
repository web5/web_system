/// <reference types="node" />
/**
 * 首页「今日一句」收藏 · **异步回调串台**（2026-11-27 P0）
 *
 * 缺陷（真机可达，不是理论问题）：
 *   `collectQuote` / `collectQuoteWord` 都是「await 之前读目标，await 之后**不校验目标是否还是同一个**
 *   就写 `true`」。请求在飞的时候用户换了词 / 换了句，迟到的响应会把**新目标**点亮成「已收藏」。
 *
 * 复现序列（词卡那条）：
 *   ① 点词 A → 词卡打开，quoteWordCollected = 缓存(A) = false
 *   ② 点「收藏」→ 请求在飞（真机 200~800ms）
 *   ③ 响应回来前用户点词 B（onQuoteWordTap 换词，quoteWordCollected 重算为 false）
 *   ④ A 的响应回来 ok → 无条件写 quoteWordCollected = true
 *      → **B 的词卡显示「已收藏」，但 B 根本没收藏过**
 *
 * 🔴 本文件的核心不是「收藏成功要变 true」（那是旧用例已覆盖的），而是**时序**：
 *    用可控 deferred 把「响应回来的时刻」交给用例显式决定，让「换目标」发生在 await 中间。
 *    静态返回值（`mockResolvedValue`）永远造不出这个窗口 —— 一 resolve 就结束了，中间没有缝。
 *
 * 对照口径：详情页同位置是对的（`pages/nce/detail/detail.ts:760-776` 的 `collectTipWord`）：
 *   ```ts
 *   const cur = this.data.overlay;
 *   const same = !!cur && cur.kind === 'wordtip'
 *     && String(cur.word || '').toLowerCase() === word;
 *   if (!same) return;
 *   ```
 *   本文件按同一口径断言首页：**结果只写回它自己那个目标**。
 */
export {};

/** 整句 A / B：换句用例的判据（A 是初始句，B 是「用户切过去的新句」） */
const LINE_A_EN = 'He is an engineer.';
const LINE_A_CN = '他是一名工程师。';
const LINE_B_EN = 'He is a doctor.';
const LINE_B_CN = '他是一名医生。';

/**
 * collectGlossary 桩：**每次调用挂一个可控 deferred**（不是 mockResolvedValue）。
 * 只有用例显式 `settle(i, ...)` 时，第 i 个请求才会真正返回 —— 这是复现串台时序的唯一手段。
 */
const mockGlossary: any = {
  calls: [] as any[],
  pending: [] as Array<{ resolve: (v: any) => void; reject: (e: any) => void }>,
  /** 放行第 i 个请求（默认 ok、新建） */
  settle(i = 0, res: any = { id: 1, created: true, existed: false }) {
    mockGlossary.pending[i].resolve(res);
  },
  /** 让第 i 个请求失败 */
  fail(i = 0, err: any = new Error('boom')) {
    mockGlossary.pending[i].reject(err);
  },
};

jest.mock('../services/glossary', () => ({
  collectGlossary: (payload: any) => {
    mockGlossary.calls.push(payload);
    return new Promise((resolve: any, reject: any) => {
      mockGlossary.pending.push({ resolve, reject });
    });
  },
}));

jest.mock('../services/nce', () => ({ getNceLesson: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../services/tts', () => ({
  speakText: jest.fn(() => Promise.resolve(true)),
  stopSpeak: jest.fn(),
  onSpeakState: jest.fn(() => jest.fn()),
}));
const mockAuth: any = { loggedIn: true };
jest.mock('../services/auth', () => ({ isLoggedIn: () => mockAuth.loggedIn }));
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
  getDailyQuoteSource: jest.fn(() => ({ cn: '他是一名工程师。', en: 'He is an engineer.', book: 'NCE2', lessonId: 4 })),
  getDailyQuoteMeta: jest.fn(() => ({ book: 'NCE2', lessonId: 4 })),
  BOOK_LABEL: { NCE2: '新概念二册' },
}));

/** storage 真的存住：D7 缓存回查走真实 get/set（收藏成功会写缓存，影响「换词后的初值」） */
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
  (globalThis as any).Page = jest.fn((cfg: any) => { pageConfig = cfg; });
  (globalThis as any).getApp = jest.fn(() => ({ eventBus: { on: jest.fn(), off: jest.fn() }, radiusClassOf: () => '' }));
  require('../pages/home/index/index');
});

beforeEach(() => {
  jest.clearAllMocks();
  store = {};
  mockAuth.loggedIn = true;
  mockGlossary.calls = [];
  mockGlossary.pending = [];
});

/** 课文词表：A / B 都是生词（点按才不会被 E1 守卫挡掉） */
const WORDS = [
  { word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/ˌendʒɪˈnɪə/' },
  { word: 'doctor', pos: 'n.', def: '医生', phonetic: '/ˈdɒktə/' },
];

/**
 * 页面上下文：方法走 Page 原型（与真机一致），data 独立可改。
 * 关键点是 `setData` 会**立即**落到 this.data —— 串台断言看的就是回调写的这一笔。
 */
function makeCtx(): any {
  const ctx: any = Object.create(pageConfig);
  ctx.data = JSON.parse(JSON.stringify(pageConfig.data));
  ctx.data.overlay = null;
  ctx.data.quote = { cn: LINE_A_CN, en: LINE_A_EN };
  ctx.data.quoteTokens = [];
  ctx.data.quoteCollected = false;
  ctx.data.quoteWordCollected = false;
  ctx.data.collectedKeys = [];
  ctx.setData = function (p: Record<string, unknown>) { Object.assign(this.data, p); };
  ctx._alive = true;
  ctx._quoteWords = WORDS;
  ctx._quoteMeta = { book: 'NCE2', lessonId: 4 };
  ctx._playingText = '';
  ctx._speakingWord = '';
  return ctx;
}

/** 点一个生词（走真实 onQuoteWordTap：换词 + 按缓存重算 quoteWordCollected 都在里面） */
const tapWord = (ctx: any, w: string) =>
  ctx.onQuoteWordTap({ currentTarget: { dataset: { w, hasdef: true } } });

/** 换句（走真实 _applyQuote：句子、切词、已收藏态一起重算） */
const applyLineB = (ctx: any) =>
  ctx._applyQuote({ cn: LINE_B_CN, en: LINE_B_EN, book: 'NCE2', lessonId: 5 }, [
    { word: 'doctor', pos: 'n.', def: '医生', phonetic: '/ˈdɒktə/' },
  ]);

// ═════════════════════════ ① 词卡：换词后，迟到的结果不许点亮新词 ═════════════════════════
describe('词卡收藏串台（collectQuoteWord）', () => {
  it('① 点收藏 A → 响应未回前切到词 B → 放行 A 的响应 → quoteWordCollected 仍为 false', async () => {
    const ctx = makeCtx();
    tapWord(ctx, 'engineer');                          // 词卡 A
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'engineer' });
    expect(ctx.data.quoteWordCollected).toBe(false);    // A 没收藏过

    const p = ctx.collectQuoteWord();                   // 请求在飞（A）
    expect(mockGlossary.calls).toHaveLength(1);
    expect(mockGlossary.calls[0].enMain).toBe('engineer');

    tapWord(ctx, 'doctor');                             // ③ 响应回来前用户点词 B
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'doctor' });
    expect(ctx.data.quoteWordCollected).toBe(false);    // 换词已复位（B 没收藏过）

    mockGlossary.settle(0);                             // ④ A 的响应这才回来
    await p;

    // 🔴 红点：A 的「成功」不许写到 B 的按钮上
    expect(ctx.data.quoteWordCollected).toBe(false);
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'doctor' }); // 卡片仍在 B、也没被关掉
    // A 本身是收藏成功的：缓存里应有 A（缓存按对象记，不受「当前看的是谁」影响）
    expect(store['dachengzi_collected_words']).toContain('engineer');
  });

  it('② 点收藏 A → 响应未回前 closeQuoteTip() 关卡片 → 放行 → quoteWordCollected 仍为 false', async () => {
    const ctx = makeCtx();
    tapWord(ctx, 'engineer');
    const p = ctx.collectQuoteWord();
    expect(mockGlossary.calls).toHaveLength(1);

    ctx.closeQuoteTip();                                // 用户中途关掉卡片（已复位为 false）
    expect(ctx.data.overlay).toBeNull();
    expect(ctx.data.quoteWordCollected).toBe(false);

    mockGlossary.settle(0);
    await p;

    // 🔴 红点：卡片都关了，迟到结果不许把「已收藏」留在数据里（否则下次开卡前就是假状态）
    expect(ctx.data.quoteWordCollected).toBe(false);
    expect(ctx.data.overlay).toBeNull();
  });

  it('③ 正向：响应回来时仍是 A → quoteWordCollected 变 true（修串台不能把正常路径改坏）', async () => {
    const ctx = makeCtx();
    tapWord(ctx, 'engineer');
    const p = ctx.collectQuoteWord();
    mockGlossary.settle(0);
    await p;

    expect(ctx.data.quoteWordCollected).toBe(true);
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'engineer' }); // 成功不关卡片（既有行为）
  });

  it('③b 正向：响应为 existed=true（重复收藏）时同样点亮 true', async () => {
    const ctx = makeCtx();
    tapWord(ctx, 'engineer');
    const p = ctx.collectQuoteWord();
    mockGlossary.settle(0, { id: 2, created: false, existed: true });
    await p;
    expect(ctx.data.quoteWordCollected).toBe(true);
  });

  it('⑥ 护栏（失败不许假成功）：首次请求 reject → quoteWordCollected 保持 false、不外抛', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx();
    tapWord(ctx, 'engineer');
    const p = ctx.collectQuoteWord();
    mockGlossary.fail(0, new Error('network'));
    await expect(p).resolves.toBeUndefined();           // 结果只在页面内部消化
    expect(ctx.data.quoteWordCollected).toBe(false);
    errSpy.mockRestore();
  });
});

// ═════════════════════════ ④ 整句：换句后，迟到的结果不许点亮新句 ═════════════════════════
describe('整句收藏串台（collectQuote）', () => {
  it('④ 点收藏 → 响应未回前 _applyQuote 换成另一句 → 放行 → 新句 quoteCollected 仍为 false', async () => {
    const ctx = makeCtx();
    expect(ctx.data.quoteCollected).toBe(false);

    const p = ctx.collectQuote();                       // 请求在飞（句子 A）
    expect(mockGlossary.calls).toHaveLength(1);
    expect(mockGlossary.calls[0].enMain).toBe(LINE_A_EN);

    applyLineB(ctx);                                    // ④ 响应回来前换句
    expect(ctx.data.quote.en).toBe(LINE_B_EN);
    expect(ctx.data.quoteCollected).toBe(false);        // 换句已按新句重算（B 没收藏过）

    mockGlossary.settle(0);                             // A 的响应这才回来
    await p;

    // 🔴 红点：A 的「成功」不许把 B 点亮
    expect(ctx.data.quoteCollected).toBe(false);
    expect(ctx.data.quote.en).toBe(LINE_B_EN);          // 句子没被回调改动
    expect(store['dachengzi_collected_lines']).toContain('he is an engineer.');
  });

  it('⑤ 正向：响应回来时仍是同一句 → quoteCollected 变 true', async () => {
    const ctx = makeCtx();
    const p = ctx.collectQuote();
    mockGlossary.settle(0);
    await p;
    expect(ctx.data.quoteCollected).toBe(true);
  });

  it('⑤b 正向：同句 + existed=true 也点亮 true', async () => {
    const ctx = makeCtx();
    const p = ctx.collectQuote();
    mockGlossary.settle(0, { id: 3, created: false, existed: true });
    await p;
    expect(ctx.data.quoteCollected).toBe(true);
  });
});
