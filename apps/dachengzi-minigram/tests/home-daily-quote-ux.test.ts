/// <reference types="node" />
/**
 * 首页「今日一句」交互（2026-11-26 需求 ⑤）
 *
 * 覆盖用户口径：点按朗读整句 / 点生词看释义并朗读、收藏单词 / 收藏整句。
 * 关键约束：今日一句缓存行只有 { cn, en, book?, lessonId? }，生词表必须回查课文详情；
 * 取不到词表时降级为「纯文本 + 整句朗读/收藏」，绝不把表外词错标成生词。
 */
jest.mock('../services/nce', () => ({ getNceLesson: jest.fn() }));
jest.mock('../services/tts', () => ({
  speakText: jest.fn(() => Promise.resolve(true)),
  stopSpeak: jest.fn(),
  onSpeakState: jest.fn(() => jest.fn()),
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
  // 2026-11-26 P1-1：页面改用「句子 + 出处一次性解析」的同源入口（句子与 book/lessonId
  // 结构上不可能错源）。这里只补齐 mock 依赖面，既有断言一条未改；
  // 「缺 book/lessonId」用例改为控制这个桩（见下方 loadQuoteWords 降级用例）。
  getDailyQuoteSource: jest.fn(() => ({
    cn: '他是一名工程师。', en: 'He is an engineer.', book: 'NCE2', lessonId: 4,
  })),
  BOOK_LABEL: { NCE2: '新概念二册' },
}));

import { getNceLesson } from '../services/nce';
import { speakText, stopSpeak } from '../services/tts';
import { collectGlossary } from '../services/glossary';
import { isLoggedIn } from '../services/auth';
import { getDailyQuoteMeta, getDailyQuoteSource } from '../utils/daily';

const getLessonMock = getNceLesson as unknown as jest.Mock;
const speakTextMock = speakText as unknown as jest.Mock;
const collectMock = collectGlossary as unknown as jest.Mock;
const isLoggedInMock = isLoggedIn as unknown as jest.Mock;
const metaMock = getDailyQuoteMeta as unknown as jest.Mock;
const srcMock = getDailyQuoteSource as unknown as jest.Mock;

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

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).Page = jest.fn((cfg: any) => { pageConfig = cfg; });
  (globalThis as any).getApp = jest.fn(() => ({ eventBus: { on: jest.fn(), off: jest.fn() }, radiusClassOf: () => '' }));
  require('../pages/home/index/index');
});

beforeEach(() => {
  jest.clearAllMocks();
  store = {};
  isLoggedInMock.mockReturnValue(true);
  metaMock.mockReturnValue({ book: 'NCE2', lessonId: 4 });
  getLessonMock.mockResolvedValue({
    id: 4,
    title: 'L4',
    words: [
      { word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/ˌendʒɪˈnɪə/' },
    ],
    lines: [{ en: 'He is an engineer.', cn: '他是一名工程师。' }],
  });
});

function makeThis() {
  const ctx: any = {
    data: JSON.parse(JSON.stringify({
      ...pageConfig.data,
      // 2026-11-26 step2：浮层单槽位（原 quoteTip 已并入 overlay）
      overlay: null,
      quotePlaying: false,
      quoteWordPlaying: '',
    })),
    setData: jest.fn(function (this: any, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    }),
    _alive: true,
    _quoteWords: [],
    _quoteSeq: 0,
    _speakingWord: '',
    _playingText: '',
  };
  // 页面内部方法（loadQuoteWords 会回调 _applyQuote / _applyQuoteWords，收藏会走 _sourceMeta，
  // 浮层入口走 openOverlay / closeOverlay，「再点同一词收起」走 closeQuoteTip
  // —— 与页面实际调用面同步）
  for (const k of [
    '_applyQuote', '_applyQuoteWords', '_sourceMeta', 'closeQuoteTip',
    'openOverlay', 'closeOverlay', '_collectLine', '_collectWord',
  ]) ctx[k] = pageConfig[k];
  return ctx;
}

/** 生词点按的模拟事件：wxml 现在对**所有**单词节点都带 data-hasdef（E1 守卫的判据来源） */
const wordTapEvent = (w: string, hasDef = true) => ({
  currentTarget: { dataset: { w, hasdef: hasDef } },
});

const wordOf = (ctx: any, w: string) => ctx.data.quoteTokens.find((t: any) => t.w === w);

describe('生词表回查与降级', () => {
  it('有 book/lessonId → 回查课文详情，只有词表直收词标 hasDef，并写本地缓存', async () => {
    const ctx = makeThis();
    await pageConfig.loadQuoteWords.call(ctx);
    expect(getLessonMock).toHaveBeenCalledWith(4, 'NCE2');
    expect(wordOf(ctx, 'engineer').hasDef).toBe(true);
    expect(wordOf(ctx, 'he').hasDef).toBe(false);
    expect(store['nce_words_cache_v1']).toBeTruthy();      // 词表已落缓存
  });

  it('缓存命中 → 不再请求课文详情', async () => {
    const ctx = makeThis();
    // 先跑一次把缓存写进去
    await pageConfig.loadQuoteWords.call(ctx);
    getLessonMock.mockClear();
    const ctx2 = makeThis();
    await pageConfig.loadQuoteWords.call(ctx2);
    expect(getLessonMock).not.toHaveBeenCalled();
    expect(wordOf(ctx2, 'engineer').hasDef).toBe(true);
  });

  it('缺 book/lessonId → 不发请求，整句降级为纯文本（全部 hasDef=false）', async () => {
    metaMock.mockReturnValue({});
    // 同源入口同样没有出处（旧缓存行形态）——判据不变：不回查、不误标
    srcMock.mockReturnValueOnce({ cn: '他是一名工程师。', en: 'He is an engineer.' });
    const ctx = makeThis();
    await pageConfig.loadQuoteWords.call(ctx);
    expect(getLessonMock).not.toHaveBeenCalled();
    expect(ctx.data.quoteTokens.every((t: any) => t.hasDef === false)).toBe(true);
  });

  it('请求失败 → 静默降级（全 false），不抛错', async () => {
    getLessonMock.mockRejectedValue(new Error('network'));
    const ctx = makeThis();
    await expect(pageConfig.loadQuoteWords.call(ctx)).resolves.toBeUndefined();
    expect(ctx.data.quoteTokens.every((t: any) => t.hasDef === false)).toBe(true);
  });
});

describe('点词 / 朗读 / 收藏', () => {
  it('点生词 → 出词卡（释义来自课文词表）；再点同一词收起', async () => {
    const ctx = makeThis();
    await pageConfig.loadQuoteWords.call(ctx);
    pageConfig.onQuoteWordTap.call(ctx, wordTapEvent('engineer'));
    // 单槽位：词卡 = overlay.kind === 'wordtip'（比只断「有值」更严：还锁了判别位）
    expect(ctx.data.overlay).toBeTruthy();
    expect(ctx.data.overlay.kind).toBe('wordtip');
    expect(ctx.data.overlay.word).toBe('engineer');
    expect(ctx.data.overlay.def).toBe('工程师');
    pageConfig.onQuoteWordTap.call(ctx, wordTapEvent('engineer'));
    expect(ctx.data.overlay).toBeNull();
  });

  it('点整句 → speakText(quote.en) 恰好一次', () => {
    const ctx = makeThis();
    pageConfig.speakQuote.call(ctx);
    expect(speakTextMock).toHaveBeenCalledWith('He is an engineer.');
    expect(ctx._speakingWord).toBe('');
  });

  it('词卡朗读 → speakText(word)，并标记本次朗读来自单词', async () => {
    const ctx = makeThis();
    await pageConfig.loadQuoteWords.call(ctx);
    pageConfig.onQuoteWordTap.call(ctx, wordTapEvent('engineer'));
    pageConfig.speakQuoteWord.call(ctx);
    expect(speakTextMock).toHaveBeenCalledWith('engineer');
    expect(ctx._speakingWord).toBe('engineer');
  });

  it('收藏整句 → tag=nce，enMain/note 与今日一句一致，meta 带来源锚点', async () => {
    const ctx = makeThis();
    await pageConfig.collectQuote.call(ctx);
    const payload = collectMock.mock.calls[0][0];
    expect(payload.tag).toBe('nce');
    expect(payload.enMain).toBe('He is an engineer.');
    expect(payload.note).toBe('他是一名工程师。');
    expect(payload.meta).toMatchObject({ book: 'NCE2', lessonId: 4, from: 'daily' });
  });

  it('收藏单词 → tag=word，enMain=词、note=词性+释义', async () => {
    const ctx = makeThis();
    await pageConfig.loadQuoteWords.call(ctx);
    pageConfig.onQuoteWordTap.call(ctx, wordTapEvent('engineer'));
    await pageConfig.collectQuoteWord.call(ctx);
    const payload = collectMock.mock.calls[0][0];
    expect(payload.tag).toBe('word');
    expect(payload.enMain).toBe('engineer');
    expect(payload.note).toBe('n. 工程师');
    expect(payload.meta).toMatchObject({ lessonId: 4, word: 'engineer', from: 'daily' });
  });

  it('未登录收藏 → toast 提示，不发请求', async () => {
    isLoggedInMock.mockReturnValue(false);
    const ctx = makeThis();
    await pageConfig.collectQuote.call(ctx);
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '请先登录', icon: 'none' });
    expect(collectMock).not.toHaveBeenCalled();
  });

  it('朗读态：整句播放中 quotePlaying=true；结束（null）复位；切走时 stopSpeak', () => {
    const ctx = makeThis();
    pageConfig._onSpeakState.call(ctx, { text: 'He is an engineer.', phase: 'playing' });
    expect(ctx.data.quotePlaying).toBe(true);
    pageConfig._onSpeakState.call(ctx, null);
    expect(ctx.data.quotePlaying).toBe(false);
    expect(ctx.data.quoteWordPlaying).toBe('');

    // onHide 现在还要做 K9 浮层归零（读 this.data.overlay），故桩需带 data / setData
    pageConfig.onHide.call({
      stopGreetingTicker: jest.fn(),
      _speakingWord: '',
      _playingText: '',
      data: { overlay: null },
      setData: jest.fn(),
    });
    expect(stopSpeak).toHaveBeenCalled();
  });
});

describe('静态接线', () => {
  const read = (rel: string): string => require('fs').readFileSync(require('path').resolve(__dirname, '..', rel), 'utf8');

  it('今日一句卡片：整句点按朗读 + 朗读/收藏按钮 + 生词点按查词', () => {
    const w = read('pages/home/index/index.wxml');
    expect(w).toMatch(/class="daily" bindtap="speakQuote"/);
    expect(w).toContain('catchtap="speakQuote"');
    expect(w).toContain('catchtap="collectQuote"');
    expect(w).toContain('catchtap="onQuoteWordTap"');
    expect(w).toContain('catchtap="speakQuoteWord"');
    expect(w).toContain('catchtap="collectQuoteWord"');
  });

  // ⚠️ 本条既有断言已按 2026-11-26 step2「渲染结构改造」（方案 K12 / 用户拍板「长按对象 = 任意
  //    英文单词」）改写 —— 不是为了让测试变绿而放宽，而是旧断言把**已作废的结构**当成契约：
  //    旧结构 = 生词有节点(带 hasDef 条件) / 表外词是裸文本且不挂事件；新结构 = 所有 tk.w 都是
  //    `<text class="dw">` 节点（否则普通词没有长按载体），下点线只给 has-def，点按/长按都挂上、
  //    由 `onQuoteWordTap` 首行守卫实现 E1「点普通词无反应」。新断言比旧的更严：同时锁
  //    「节点条件放宽」「has-def 类只能由 hasDef 决定」「长按挂在同一个节点上」三件事。
  it('英文渲染：所有单词都是 .dw 节点，has-def 只给生词，点按/长按都挂（E1/K12）', () => {
    const w = read('pages/home/index/index.wxml');
    // ① 所有单词节点（不再以 hasDef 作为渲染条件）
    expect(w).toMatch(/wx:if="\{\{tk\.w\}\}"/);
    expect(w).not.toMatch(/tk\.w && tk\.hasDef/); // 旧条件必须彻底消失
    // ② 下点线/可点视觉只由 hasDef 决定（2026-11-26 盲测 D-4 后允许追加按下态修饰类）
    expect(w).toMatch(/class="dw \{\{tk\.hasDef \? 'has-def' : ''\}\}(?:[^"]*)?"/);
    // ③ 同一个节点同时挂 catchtap（E1 守卫入口）与 catchlongpress（长按普通词入口）
    expect(w).toMatch(/data-hasdef="\{\{tk\.hasDef\}\}"[\s\S]{0,120}catchtap="onQuoteWordTap"[\s\S]{0,120}catchlongpress="onQuoteWordLongPress"/);
    // ④ 标点等非单词 token 仍走无事件的纯文本分支
    const elseBranch = (/<text wx:else>([\s\S]*?)<\/text>/.exec(w) || ['', ''])[1];
    expect(elseBranch).not.toMatch(/catch|bind/);
  });

  // 2026-11-26 P0 · 首页「今日一句」英文整段不显示：wx:for 未声明 wx:for-item，
  // 微信默认迭代变量恒为 item，循环体却取 tk.* → tk 不在作用域 → 24 个 token 全渲染空串。
  // 教训：「用了 tk.*」和「把 tk 引入作用域」是一对约束，上面那条只断言了字符串存在，拦不住。
  // 通用扫描见 tests/wxml-for-item-scope.test.ts，这里留一条贴身的定点断言。
  it('英文 token 循环必须声明 wx:for-item="tk"（否则 tk 不在作用域，整段渲染为空）', () => {
    const w = read('pages/home/index/index.wxml');
    expect(w).toMatch(/<block[^>]*wx:for="\{\{quoteTokens\}\}"[^>]*wx:for-item="tk"/);
  });

  it('onShow 接线：登录态下拉取今日一句词表', () => {
    const ts = read('pages/home/index/index.ts');
    expect(ts).toMatch(/void this\.loadQuoteWords\(\)/);
  });
});
