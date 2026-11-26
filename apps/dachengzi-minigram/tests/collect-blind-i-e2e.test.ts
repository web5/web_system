/**
 * 🔵 RD 独立盲测 I 组：收藏链路端到端（页面写 meta → 收藏页读灰标）
 *
 * 为什么必须端到端：单页测试各自都绿，但**两页写的 meta 字段形状不同**时，
 * 「收藏页显示未收录」这条需求会在中间断掉 —— 这正是单页测试覆盖不到的地方。
 * 判据：E3 + E5（两页同一口径）：从任一页面收藏普通词，收藏页都必须显示「未收录」。
 */
jest.mock('../services/glossary', () => ({
  collectGlossary: jest.fn(() => Promise.resolve({ id: 1, created: true, existed: false })),
  listGlossary: jest.fn(() => Promise.resolve({ list: [], total: 0 })),
  removeGlossary: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../services/nce', () => ({ getNceLesson: jest.fn(() => Promise.resolve(null)) }));
jest.mock('../services/tts', () => ({
  speakText: jest.fn(() => Promise.resolve(true)),
  stopSpeak: jest.fn(),
  onSpeakState: jest.fn(() => () => {}),
}));
jest.mock('../services/auth', () => ({ isLoggedIn: jest.fn(() => true), loginFromGate: jest.fn() }));
jest.mock('../services/account', () => ({
  readLocalNickname: jest.fn(() => ''),
  fetchProfile: jest.fn(() => Promise.resolve({ nickname: '' })),
  isNicknameUnset: jest.fn(() => true),
}));
jest.mock('../utils/greeting', () => ({ formatGreeting: jest.fn(() => 'x'), getLocalHour: jest.fn(() => 9) }));
jest.mock('../utils/tabbar', () => ({ setTabBarSelected: jest.fn(), TAB_INDEX: { home: 0, discover: 1, mine: 2 } }));
jest.mock('../utils/daily', () => ({
  getDailyQuoteSource: jest.fn(() => ({ cn: '我星期天从不早起。', en: 'I never get up early on Sundays.', book: 'nce2', lessonId: 3 })),
  getDailyQuoteMeta: jest.fn(() => ({ book: 'nce2', lessonId: 3 })),
  BOOK_LABEL: { nce2: '新概念二' },
}));
jest.mock('../utils/quote-words', () => ({ readWordsCache: jest.fn(() => []), writeWordsCache: jest.fn() }));
jest.mock('../pages/nce/books', () => ({ DEFAULT_NCE_BOOK: 'nce2', nceBookTotal: () => 96 }));

import { collectGlossary } from '../services/glossary';
import { buildKnown, tokenize } from '../utils/tokenize';

const collectMock = collectGlossary as unknown as jest.Mock;

const wxMock: any = {
  getStorageSync: jest.fn(() => ''),
  setStorageSync: jest.fn(),
  showToast: jest.fn(),
  setNavigationBarTitle: jest.fn(),
  pageScrollTo: jest.fn(),
  navigateTo: jest.fn(),
  switchTab: jest.fn(),
};

const captured: any[] = [];
let homeCfg: any;
let detailCfg: any;
let glossaryCfg: any;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).getApp = () => ({ eventBus: null, radiusClassOf: () => '' });
  (globalThis as any).Page = jest.fn((c: any) => { captured.push(c); });
  require('../pages/home/index/index');
  homeCfg = captured[captured.length - 1];
  require('../pages/nce/detail/detail');
  detailCfg = captured[captured.length - 1];
  require('../pages/mine/glossary/index');
  glossaryCfg = captured[captured.length - 1];
});

beforeEach(() => {
  jest.clearAllMocks();
  collectMock.mockResolvedValue({ id: 1, created: true, existed: false });
});

function bind(cfg: any, data: Record<string, unknown> = {}) {
  const ctx: any = {
    data: { ...JSON.parse(JSON.stringify(cfg.data)), ...data },
    setData: jest.fn(function (this: any, patch: any) { Object.assign(this.data, patch); }),
  };
  for (const k of Object.keys(cfg)) {
    if (k === 'data' || k in ctx) continue;
    const v = cfg[k];
    ctx[k] = typeof v === 'function' ? v.bind(ctx) : v;
  }
  return ctx;
}

/** 把页面写出的 payload 送进收藏页，返回列表项的渲染字段 */
function feedToGlossary(payload: any) {
  const ctx = bind(glossaryCfg);
  glossaryCfg.apply.call(ctx, [{
    id: 1,
    tag: payload.tag,
    sourceText: payload.sourceText,
    enMain: payload.enMain,
    note: payload.note,
    meta: payload.meta,
    createdAt: '2026-11-26T00:00:00Z',
  }]);
  return ctx.data.items[0];
}

describe('I1 首页收藏普通词 → 收藏页显示「未收录」', () => {
  it('链路成立', async () => {
    const ctx = bind(homeCfg, { overlay: null });
    ctx._quoteWords = [];
    await homeCfg.onDrawerCollectWord.call(ctx, { detail: { word: 'bed', lineIndex: 0, hasDef: false } });
    const payload = collectMock.mock.calls[0][0];
    const row = feedToGlossary(payload);
    expect(row.unlistedText).toBe('未收录');
    expect(row.metaText).toBe('Lesson 3 · 单词 bed');
  });
});

describe('I2 详情页收藏普通词 → 收藏页显示「未收录」（E5 两页同口径）', () => {
  it('链路成立', async () => {
    const en = 'I sometimes stay in bed until lunchtime.';
    const ctx = bind(detailCfg, {
      id: 3,
      book: 'nce2',
      detail: { id: 3, title: 'T', lines: [{ en, cn: 'c' }], words: [] },
      lines: [{ idx: 0, en, cn: 'c', tokens: tokenize(en, buildKnown([])) }],
      overlay: { kind: 'drawer', scope: 'word', lineIndex: 0, lineText: en, word: 'bed', hasDef: false, phonetic: '' },
    });
    await detailCfg.onDrawerCollectWord.call(ctx, { detail: { word: 'bed', lineIndex: 0, hasDef: false } });
    const payload = collectMock.mock.calls[0][0];
    expect(payload.tag).toBe('word');
    // 🔴 用户路径：从详情页收藏普通词，收藏页必须能认出「未收录」
    const row = feedToGlossary(payload);
    expect(row.unlistedText).toBe('未收录');
  });
});

describe('I3 生词收藏两页都不得误标「未收录」', () => {
  it('首页收藏生词 → 无灰标', async () => {
    const ctx = bind(homeCfg, { overlay: null });
    ctx._quoteWords = [{ word: 'early' }];
    await homeCfg.onDrawerCollectWord.call(ctx, { detail: { word: 'early', lineIndex: 0, hasDef: true } });
    expect(feedToGlossary(collectMock.mock.calls[0][0]).unlistedText).toBe('');
  });

  it('详情页收藏生词 → 无灰标', async () => {
    const en = 'I never get up early on Sundays.';
    const ctx = bind(detailCfg, {
      id: 3,
      book: 'nce2',
      detail: { id: 3, title: 'T', lines: [{ en, cn: 'c' }], words: [{ word: 'early' }] },
      lines: [{ idx: 0, en, cn: 'c', tokens: tokenize(en, buildKnown([{ word: 'early' }])) }],
      overlay: null,
    });
    await detailCfg.onDrawerCollectWord.call(ctx, { detail: { word: 'early', lineIndex: 0, hasDef: true } });
    expect(feedToGlossary(collectMock.mock.calls[0][0]).unlistedText).toBe('');
  });
});
