/**
 * 🔵 RD 独立盲测 C 组：首页（pages/home/index）行为反例
 *
 * 判据（需求真源）：
 *  - 需求①+18:05 追加：长按**任意**英文单词 → 四项（普通词 / 生词同路径，AC-B.28/30/31/33）
 *  - E1：点按普通词 → 无反应（不弹词卡、不弹抽屉、不朗读、不请求）；点生词 → 词卡
 *  - D3/AC-B.17-19：单槽位互斥，物理上不可能两开
 *  - D4/AC-B.12-14：关闭三通道
 *  - AC-B.15/V-B11：动作后立即收起
 *  - K9/BB3：tab 页 onHide 必须把 overlay 归零
 *  - E3：收藏普通词 meta.hasDef=false（收藏页灰标判据）
 *  - U1：首页不实现行尾 ■（页脚唯一停止入口）
 */
jest.mock('../services/auth', () => ({ isLoggedIn: jest.fn(() => true) }));
jest.mock('../services/account', () => ({
  readLocalNickname: jest.fn(() => '阿橙'),
  fetchProfile: jest.fn(() => Promise.resolve({ nickname: '阿橙' })),
  isNicknameUnset: jest.fn(() => false),
}));
jest.mock('../utils/greeting', () => ({
  formatGreeting: jest.fn(() => '阿橙，早上好'),
  getLocalHour: jest.fn(() => 9),
}));
jest.mock('../utils/tabbar', () => ({
  setTabBarSelected: jest.fn(),
  TAB_INDEX: { home: 0, discover: 1, mine: 2 },
}));
jest.mock('../utils/daily', () => {
  const q = { cn: '我星期天从不早起。', en: 'I never get up early on Sundays.', book: 'nce2', lessonId: 3 };
  return {
    __q: q,
    getDailyQuoteSource: jest.fn(() => ({ ...q })),
    getDailyQuoteMeta: jest.fn(() => ({ book: q.book, lessonId: q.lessonId })),
    BOOK_LABEL: { nce2: '新概念二' },
  };
});
jest.mock('../utils/quote-words', () => ({
  readWordsCache: jest.fn(() => [
    { word: 'early', phonetic: '/ˈɜːli/', pos: 'adv.', def: '早' },
    { word: 'sunday', phonetic: '/ˈsʌndeɪ/', pos: 'n.', def: '星期日' },
  ]),
  writeWordsCache: jest.fn(),
}));
jest.mock('../services/nce', () => ({ getNceLesson: jest.fn(() => Promise.resolve({ words: [] })) }));
jest.mock('../services/tts', () => ({
  speakText: jest.fn(() => Promise.resolve(true)),
  stopSpeak: jest.fn(),
  onSpeakState: jest.fn(() => () => {}),
}));
jest.mock('../services/glossary', () => ({
  collectGlossary: jest.fn(() => Promise.resolve({ id: 1, created: true, existed: false })),
}));

import { isLoggedIn } from '../services/auth';
import { speakText, stopSpeak, onSpeakState } from '../services/tts';
import { collectGlossary } from '../services/glossary';
import { actionsOf } from '../utils/line-actions';

const speakTextMock = speakText as unknown as jest.Mock;
const stopSpeakMock = stopSpeak as unknown as jest.Mock;
const onSpeakStateMock = onSpeakState as unknown as jest.Mock;
const collectMock = collectGlossary as unknown as jest.Mock;
const isLoggedInMock = isLoggedIn as unknown as jest.Mock;

const EN = 'I never get up early on Sundays.';

const wxMock: Record<string, jest.Mock> = {
  getStorageSync: jest.fn(() => ''),
  setStorageSync: jest.fn(),
  removeStorageSync: jest.fn(),
  showToast: jest.fn(),
  navigateTo: jest.fn(),
  switchTab: jest.fn(),
  setNavigationBarTitle: jest.fn(),
};

let pageConfig: any = null;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).getApp = () => ({ eventBus: null, radiusClassOf: () => '' });
  (globalThis as any).Page = jest.fn((cfg: any) => { pageConfig = cfg; });
  require('../pages/home/index/index');
});

beforeEach(() => {
  jest.clearAllMocks();
  isLoggedInMock.mockReturnValue(true);
  speakTextMock.mockResolvedValue(true);
  collectMock.mockResolvedValue({ id: 1, created: true, existed: false });
});

/** 构造带 setData 的页面上下文；quote 与 token（含 hasDef）手工钉死，隔离实现思路 */
function makeThis(overrides: Record<string, unknown> = {}) {
  const ctx: any = {
    data: {
      ...JSON.parse(JSON.stringify(pageConfig.data)),
      quote: { cn: '我星期天从不早起。', en: EN },
      quoteTokens: [],
      overlay: null,
      quotePlaying: false,
      quoteWordPlaying: '',
      ...overrides,
    },
    _quoteWords: [
      { word: 'early', phonetic: '/ˈɜːli/', pos: 'adv.', def: '早' },
      { word: 'sunday', phonetic: '/ˈsʌndeɪ/', pos: 'n.', def: '星期日' },
    ],
    _quoteMeta: { book: 'nce2', lessonId: 3 },
    _speakingWord: '',
    _playingText: '',
    _alive: true,
    setData: jest.fn(function (this: any, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    }),
  };
  // 页面方法互为兄弟：把 Page 配置里的方法挂到 ctx 上（this 指向 ctx），
  // 否则 this.closeOverlay / this._collectWord 之类会 undefined
  for (const k of Object.keys(pageConfig)) {
    if (k === 'data' || k in ctx) continue;
    const v = pageConfig[k];
    ctx[k] = typeof v === 'function' ? v.bind(ctx) : v;
  }
  return ctx;
}

const ev = (dataset: Record<string, unknown>) => ({ currentTarget: { dataset } });

describe('C1 长按 → 抽屉（任意单词，生词/普通词同路径）', () => {
  it('长按普通词（hasDef=false）→ scope=word / 4 项 / hasDef=false / 无音标', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'i', hasdef: false }));
    expect(ctx.data.overlay).toMatchObject({
      kind: 'drawer', scope: 'word', word: 'i', hasDef: false, lineText: EN, lineIndex: 0,
    });
    expect(ctx.data.overlay.phonetic).toBe('');
    expect(actionsOf('word')).toHaveLength(4);
  });

  it('长按生词（hasDef=true）→ 4 项 + 带音标', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'early', hasdef: true }));
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'word', word: 'early', hasDef: true });
    expect(ctx.data.overlay.phonetic).toBe('/ˈɜːli/');
  });

  it('dataset.hasdef 为字符串 "true"（不同基础库）也认', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'early', hasdef: 'true' }));
    expect(ctx.data.overlay.hasDef).toBe(true);
  });

  it('反例：脏 token（data-w 为空）→ 不产生任何浮层', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: '' }));
    expect(ctx.data.overlay).toBeNull();
  });

  it('长按句子空白 → 两项档 scope=line', () => {
    const ctx = makeThis();
    pageConfig.onQuoteLineLongPress.call(ctx);
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'line', lineIndex: 0, lineText: EN });
    expect(actionsOf('line')).toHaveLength(2);
  });
});

describe('C2 点按（E1）', () => {
  it('点普通词 → 无浮层、无 toast、不朗读', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordTap.call(ctx, ev({ w: 'i', hasdef: false }));
    expect(ctx.data.overlay).toBeNull();
    expect(wxMock.showToast).not.toHaveBeenCalled();
    expect(speakTextMock).not.toHaveBeenCalled();
  });

  it('点生词 → 词卡 wordtip', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordTap.call(ctx, ev({ w: 'early', hasdef: true }));
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'early' });
    expect(ctx.data.overlay.none).toBe(false);
  });

  it('再点同一个生词 → 收起词卡', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordTap.call(ctx, ev({ w: 'early', hasdef: true }));
    pageConfig.onQuoteWordTap.call(ctx, ev({ w: 'early', hasdef: true }));
    expect(ctx.data.overlay).toBeNull();
  });
});

describe('C3 单槽位互斥（D3 / AC-B.17-19）', () => {
  it('词卡开着时长按单词 → 变成抽屉（不叠加）', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordTap.call(ctx, ev({ w: 'early', hasdef: true }));
    expect(ctx.data.overlay.kind).toBe('wordtip');
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'get', hasdef: false }));
    expect(ctx.data.overlay.kind).toBe('drawer');
    expect(ctx.data.overlay.word).toBe('get');
  });

  it('抽屉开着时程序性再点生词 → 只剩一个浮层（wordtip），不出现两开', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'get', hasdef: false }));
    pageConfig.onQuoteWordTap.call(ctx, ev({ w: 'early', hasdef: true }));
    expect(ctx.data.overlay.kind).toBe('wordtip');
    const kinds = [ctx.data.overlay].filter(Boolean).length;
    expect(kinds).toBe(1);
  });

  it('抽屉开着时长按另一词 → 替换内容（同实例换 data，不新开）', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'get', hasdef: false }));
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'up', hasdef: false }));
    expect(ctx.data.overlay.word).toBe('up');
  });
});

describe('C4 关闭三通道（D4）', () => {
  it.each(['mask', 'swipe', 'close'])('via=%s → overlay 归零', (via) => {
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'get', hasdef: false }));
    pageConfig.onDrawerClose.call(ctx, { detail: { via } });
    expect(ctx.data.overlay).toBeNull();
  });

  it('反例：遮罩/✕/下滑走的是同一条页面入口（组件不得自己关）', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'get', hasdef: false }));
    pageConfig.onDrawerClose.call(ctx, { detail: { via: 'mask' } });
    expect(ctx.setData).toHaveBeenCalledWith({ overlay: null });
  });
});

describe('C5 K9 tab 页归零（切 tab / navigateTo 详情回来不得「抽屉自己回来」）', () => {
  it('onHide → overlay 置 null', () => {
    const ctx = makeThis({ overlay: { kind: 'drawer', scope: 'word', word: 'get', hasDef: false, lineIndex: 0, lineText: EN, phonetic: '' } });
    pageConfig.onHide.call(ctx);
    expect(ctx.data.overlay).toBeNull();
    expect(ctx.setData).toHaveBeenCalledWith({ overlay: null });
  });

  it('onHide 且朗读中 → 停播 + 播放态归零', () => {
    const ctx = makeThis({ overlay: null, quotePlaying: true });
    pageConfig.onHide.call(ctx);
    expect(stopSpeakMock).toHaveBeenCalled();
    expect(ctx._playingText).toBe('');
    expect(ctx._speakingWord).toBe('');
  });

  it('反例：没有浮层时 onHide 不得多余 setData（避免无意义重绘）', () => {
    const ctx = makeThis({ overlay: null });
    const before = ctx.setData.mock.calls.length;
    pageConfig.onHide.call(ctx);
    expect(ctx.setData.mock.calls.length).toBe(before);
  });
});

describe('C6 动作 → services（AC-B.15 / E3 / 权限）', () => {
  /**
   * 🔴 2026-11-26 变体 C（用户拍板）：朗读下沉到抽屉组件 ——
   * 组件内直接 `speakText`，**抽屉不关**、按钮自切 ▶/■；页面不再有
   * `onDrawerSpeakLine / onDrawerSpeakWord`（原三条朗读用例的判据对象已消失）。
   * 这里反转成「不得回潮」断言，行为侧由 `tests/action-drawer.test.ts` 的
   * 「变体 C · 朗读下沉」组覆盖（speakText 参数 / 切态 / 再点即停 / 不 emit）。
   */
  it('朗读不再经过页面：onDrawerSpeakLine / onDrawerSpeakWord 都不存在，且不调 speakText', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'bed', hasdef: false }));
    expect((pageConfig as any).onDrawerSpeakLine).toBeUndefined();
    expect((pageConfig as any).onDrawerSpeakWord).toBeUndefined();
    // 长按出来的抽屉仍在（朗读不再触发 closeOverlay）
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'word' });
    expect(speakTextMock).not.toHaveBeenCalled();
  });

  it('收藏普通词：meta.hasDef === false（收藏页「未收录」灰标判据）', async () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'bed', hasdef: false }));
    await pageConfig.onDrawerCollectWord.call(ctx, { detail: { word: 'bed', lineIndex: 0, hasDef: false } });
    const payload = collectMock.mock.calls[0][0];
    expect(payload.tag).toBe('word');
    expect(payload.meta.hasDef).toBe(false);
    expect(payload.enMain).toBe('bed');
    // 🔴 2026-11-27 方案 B 口径变更：收藏成功**不再收抽屉**（原断言 toBeNull()）。
    //    三态反馈就发生在抽屉按钮上，抽屉必须留在原地；只有未登录路径才先收起（见下一条用例）。
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'word' });
  });

  it('收藏生词：meta.hasDef === true', async () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'early', hasdef: true }));
    await pageConfig.onDrawerCollectWord.call(ctx, { detail: { word: 'early', hasDef: true } });
    expect(collectMock.mock.calls[0][0].meta.hasDef).toBe(true);
  });

  it('反例：事件未带 hasDef（老调用方）→ 用当前抽屉态兜底，不得写成 true 也不得写成 undefined', async () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'bed', hasdef: false }));
    await pageConfig.onDrawerCollectWord.call(ctx, { detail: { word: 'bed' } });
    expect(collectMock.mock.calls[0][0].meta.hasDef).toBe(false);
  });

  it('收藏此句：tag=nce + meta.from=daily + note=译文', async () => {
    const ctx = makeThis();
    pageConfig.onDrawerCollectLine.call(ctx, { detail: { lineIndex: 0, text: EN } });
    await Promise.resolve();
    const payload = collectMock.mock.calls[0][0];
    expect(payload.tag).toBe('nce');
    expect(payload.enMain).toBe(EN);
    expect(payload.note).toBe('我星期天从不早起。');
    expect(payload.meta).toMatchObject({ from: 'daily', book: 'nce2', lessonId: 3 });
  });

  it('未登录收藏单词 → 抽屉先收起 → toast 请先登录 → 不请求', async () => {
    isLoggedInMock.mockReturnValue(false);
    const ctx = makeThis();
    pageConfig.onQuoteWordLongPress.call(ctx, ev({ w: 'bed', hasdef: false }));
    await pageConfig.onDrawerCollectWord.call(ctx, { detail: { word: 'bed', hasDef: false } });
    expect(ctx.data.overlay).toBeNull();
    expect(wxMock.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '请先登录' }));
    expect(collectMock).not.toHaveBeenCalled();
  });
});

describe('C7 播放态：首页只有页脚停止入口（U1 去重）', () => {
  it('整句播放中：quotePlaying=true；数据里不存在任何「行尾停止」字段（首页不实现 U1）', () => {
    const ctx = makeThis();
    pageConfig._onSpeakState.call(ctx, { text: EN, phase: 'playing' });
    expect(ctx.data.quotePlaying).toBe(true);
    expect(ctx.data.quoteWordPlaying).toBe('');
    expect(Object.keys(ctx.data).filter((k) => /rowStop|lineStop|sentStop/.test(k))).toEqual([]);
  });

  it('词播放中：quotePlaying=false + quoteWordPlaying=词', () => {
    const ctx = makeThis();
    pageConfig._onSpeakState.call(ctx, { text: 'early', phase: 'playing' });
    expect(ctx.data.quotePlaying).toBe(false);
    expect(ctx.data.quoteWordPlaying).toBe('early');
  });

  it('播放结束（null）→ 两个播放态都归零', () => {
    const ctx = makeThis({ quotePlaying: true, quoteWordPlaying: 'early' });
    pageConfig._onSpeakState.call(ctx, null);
    expect(ctx.data.quotePlaying).toBe(false);
    expect(ctx.data.quoteWordPlaying).toBe('');
  });

  it('页脚「■ 停止」= 再调一次 speakText(同一句)，靠 tts same-text 契约停播（真停由 E 组验证）', () => {
    const ctx = makeThis({ quotePlaying: true });
    ctx._playingText = EN;
    pageConfig.speakQuote.call(ctx);
    expect(speakTextMock).toHaveBeenCalledTimes(1);
    expect(speakTextMock).toHaveBeenCalledWith(EN);
    expect(stopSpeakMock).not.toHaveBeenCalled(); // 不是显式 stopSpeak：契约在 tts 层
  });

  it('词卡朗读 → speakText(该词)；再点停止走同一入口', () => {
    const ctx = makeThis();
    pageConfig.onQuoteWordTap.call(ctx, ev({ w: 'early', hasdef: true }));
    pageConfig.speakQuoteWord.call(ctx);
    expect(speakTextMock).toHaveBeenCalledWith('early');
  });
});

describe('C8 订阅生命周期', () => {
  it('onLoad 订阅、onUnload 退订 + stopSpeak（不得泄漏）', () => {
    const off = jest.fn();
    onSpeakStateMock.mockReturnValueOnce(off);
    const ctx = makeThis();
    pageConfig.onLoad.call(ctx);
    expect(onSpeakStateMock).toHaveBeenCalled();
    pageConfig.onUnload.call(ctx);
    expect(off).toHaveBeenCalled();
    expect(stopSpeakMock).toHaveBeenCalled();
  });
});
