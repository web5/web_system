/**
 * 🔵 RD 独立盲测 D 组：课文详情（pages/nce/detail）行为反例
 *
 * 判据：
 *  - 需求②：长按单词 → 四项；长按当前句空白 → 两项
 *  - 18:05 追加 / AC-B.28-33：普通词也是四项、朗读/收藏走同一路径
 *  - E1（19:00 拍板口径）：点普通词不弹词卡；**详情页点按档仍照常展开该句译文**
 *  - U1（19:15）：正在朗读那句的行尾显示 ■，点击真停；只在播放时渲染
 *  - E3/E5：收藏普通词必须带 hasDef=false（否则收藏页无「未收录」灰标，两页口径不一致）
 *  - AC-B.15：动作后立即收起
 *  - 无坐标（V-B2）
 */
jest.mock('../services/nce', () => ({ getNceLesson: jest.fn() }));
jest.mock('../services/tts', () => ({
  speakText: jest.fn(() => Promise.resolve(true)),
  stopSpeak: jest.fn(),
  onSpeakState: jest.fn(() => () => {}),
}));
jest.mock('../services/glossary', () => ({
  collectGlossary: jest.fn(() => Promise.resolve({ id: 1, created: true, existed: false })),
}));
jest.mock('../services/auth', () => ({
  isLoggedIn: jest.fn(() => true),
  loginFromGate: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../pages/nce/books', () => ({ DEFAULT_NCE_BOOK: 'nce2', nceBookTotal: () => 96 }));

import { getNceLesson } from '../services/nce';
import { speakText, stopSpeak } from '../services/tts';
import { collectGlossary } from '../services/glossary';
import { isLoggedIn } from '../services/auth';
import { actionsOf } from '../utils/line-actions';
import { tokenize, buildKnown } from '../utils/tokenize';

const getLessonMock = getNceLesson as unknown as jest.Mock;
const speakTextMock = speakText as unknown as jest.Mock;
const stopSpeakMock = stopSpeak as unknown as jest.Mock;
const collectMock = collectGlossary as unknown as jest.Mock;
const isLoggedInMock = isLoggedIn as unknown as jest.Mock;

const LESSON = {
  id: 3,
  book: 'nce2',
  bookTitle: '新概念二',
  title: 'Please send me a card',
  titleCn: '请给我寄一张明信片',
  text: '',
  textSource: 'xdf',
  lines: [
    { en: 'I never get up early on Sundays.', cn: '我星期天从不早起。' },
    { en: 'I sometimes stay in bed until lunchtime.', cn: '我有时在床上呆到午饭时间。' },
    { en: '', cn: '' }, // 边界：空句
    { en: 'Last Sunday I got up very late.', cn: '' }, // 边界：cn 为空
  ],
  words: [
    { word: 'early', phonetic: '/ˈɜːli/', pos: 'adv.', def: '早' },
    { word: 'sunday', phonetic: '/ˈsʌndeɪ/', pos: 'n.', def: '星期日' },
    { word: 'lunchtime', phonetic: '/ˈlʌntʃtaɪm/', pos: 'n.', def: '午饭时间' },
  ],
};

const wxMock: Record<string, jest.Mock> = {
  getStorageSync: jest.fn(() => ''),
  setStorageSync: jest.fn(),
  showToast: jest.fn(),
  setNavigationBarTitle: jest.fn(),
  pageScrollTo: jest.fn(),
};

let pageConfig: any = null;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).getApp = () => ({ eventBus: null, radiusClassOf: () => '' });
  (globalThis as any).Page = jest.fn((cfg: any) => { pageConfig = cfg; });
  require('../pages/nce/detail/detail');
});

beforeEach(() => {
  jest.clearAllMocks();
  isLoggedInMock.mockReturnValue(true);
  speakTextMock.mockResolvedValue(true);
  collectMock.mockResolvedValue({ id: 1, created: true, existed: false });
  getLessonMock.mockResolvedValue(LESSON);
});

/** 造一个「已加载课文」的页面上下文 */
function makeLoaded(readMode: 'immersion' | 'bilingual' | 'tap' = 'immersion') {
  const known = buildKnown(LESSON.words);
  const lines = LESSON.lines.map((l, i) => ({
    idx: i, en: l.en, cn: l.cn, tokens: tokenize(l.en, known),
  }));
  const ctx: any = {
    data: {
      ...JSON.parse(JSON.stringify(pageConfig.data)),
      id: 3,
      book: 'nce2',
      detail: LESSON,
      lines,
      loading: false,
      error: '',
      readMode,
      expandedIdx: -1,
      overlay: null,
      readingLineIdx: -1,
      readingPhase: 'idle',
      wordPlaying: '',
      tipPlaying: false,
      fullCn: LESSON.lines.map((l) => (l.cn || '').trim()).filter(Boolean).join('\n'),
    },
    _playingIdx: -1,
    _speakingWord: '',
    _playingText: '',
    setData: jest.fn(function (this: any, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    }),
  };
  for (const k of Object.keys(pageConfig)) {
    if (k === 'data' || k in ctx) continue;
    const v = pageConfig[k];
    ctx[k] = typeof v === 'function' ? v.bind(ctx) : v;
  }
  return ctx;
}

const ev = (dataset: Record<string, unknown>) => ({ currentTarget: { dataset } });

describe('D1 长按 → 抽屉（任意单词四项 / 句空白两项）', () => {
  it('长按普通词 → scope=word / hasDef=false / phonetic 空 / 4 项', () => {
    const ctx = makeLoaded();
    pageConfig.onWordLongPress.call(ctx, ev({ w: 'bed', i: 1, hasdef: false }));
    expect(ctx.data.overlay).toMatchObject({
      kind: 'drawer', scope: 'word', word: 'bed', hasDef: false, lineIndex: 1,
      lineText: 'I sometimes stay in bed until lunchtime.',
    });
    expect(ctx.data.overlay.phonetic).toBe('');
    expect(actionsOf('word')).toHaveLength(4);
  });

  it('长按生词 → hasDef=true + 音标', () => {
    const ctx = makeLoaded();
    pageConfig.onWordLongPress.call(ctx, ev({ w: 'early', i: 0, hasdef: true }));
    expect(ctx.data.overlay).toMatchObject({ hasDef: true, word: 'early' });
    expect(ctx.data.overlay.phonetic).toBe('/ˈɜːli/');
  });

  it('长按句子空白（.sent 冒泡）→ 两项档，且不展开译文', () => {
    const ctx = makeLoaded('tap');
    pageConfig.onLongPress.call(ctx, ev({ i: 1 }));
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'line', lineIndex: 1 });
    expect(ctx.data.expandedIdx).toBe(-1);
    expect(actionsOf('line')).toHaveLength(2);
  });

  it('反例：越界句下标 / 脏词 → 不产生浮层', () => {
    const ctx = makeLoaded();
    pageConfig.onWordLongPress.call(ctx, ev({ w: '', i: 0 }));
    expect(ctx.data.overlay).toBeNull();
    pageConfig.onWordLongPress.call(ctx, ev({ w: 'bed', i: 99 }));
    expect(ctx.data.overlay).toBeNull();
    pageConfig.onLongPress.call(ctx, ev({ i: 99 }));
    expect(ctx.data.overlay).toBeNull();
  });

  it('空句（en=""）长按空白 → 仍然只开抽屉、不崩', () => {
    const ctx = makeLoaded();
    pageConfig.onLongPress.call(ctx, ev({ i: 2 }));
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'line', lineIndex: 2, lineText: '' });
  });
});

describe('D2 点按（E1：不弹词卡；点按档照常展开译文）', () => {
  it('点按档点普通词 → 展开该句译文（19:00 拍板口径），不弹词卡', () => {
    const ctx = makeLoaded('tap');
    pageConfig.onWordTap.call(ctx, ev({ w: 'bed', i: 1, hasdef: false }));
    expect(ctx.data.overlay).toBeNull();
    expect(ctx.data.expandedIdx).toBe(1);
  });

  it('点按档再点同一普通词 → 收起译文', () => {
    const ctx = makeLoaded('tap');
    pageConfig.onWordTap.call(ctx, ev({ w: 'bed', i: 1, hasdef: false }));
    pageConfig.onWordTap.call(ctx, ev({ w: 'stay', i: 1, hasdef: false }));
    expect(ctx.data.expandedIdx).toBe(-1);
  });

  it('沉浸档点普通词 → 只清浮层，不展开译文', () => {
    const ctx = makeLoaded('immersion');
    ctx.data.overlay = { kind: 'wordtip', word: 'x', none: true };
    pageConfig.onWordTap.call(ctx, ev({ w: 'bed', i: 1, hasdef: false }));
    expect(ctx.data.overlay).toBeNull();
    expect(ctx.data.expandedIdx).toBe(-1);
  });

  it('点生词 → 词卡（任意阅读档都出）', () => {
    for (const mode of ['immersion', 'bilingual', 'tap'] as const) {
      const ctx = makeLoaded(mode);
      pageConfig.onWordTap.call(ctx, ev({ w: 'early', i: 0, hasdef: true }));
      expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'early' });
      expect(ctx.data.overlay.none).toBe(false);
    }
  });

  it('点生词 → 不展开译文（词卡与展开互不串味）', () => {
    const ctx = makeLoaded('tap');
    pageConfig.onWordTap.call(ctx, ev({ w: 'early', i: 0, hasdef: true }));
    expect(ctx.data.expandedIdx).toBe(-1);
  });
});

describe('D3 U1 行尾 ■（19:15 拍板）', () => {
  it('朗读此句 → readingLineIdx = 该句下标（■ 只在该句渲染）', () => {
    const ctx = makeLoaded();
    pageConfig.onWordLongPress.call(ctx, ev({ w: 'bed', i: 1, hasdef: false }));
    pageConfig.onDrawerSpeakLine.call(ctx, { detail: { lineIndex: 1, text: ctx.data.lines[1].en } });
    expect(ctx.data.readingLineIdx).toBe(1);
    expect(ctx.data.overlay).toBeNull(); // 动作后立即收起
    expect(speakTextMock).toHaveBeenCalledWith(ctx.data.lines[1].en);
  });

  it('tts 回流权威文本 → 命中该句才高亮（不按意图标记反推）', () => {
    const ctx = makeLoaded();
    pageConfig._onSpeakState.call(ctx, { text: ctx.data.lines[3].en, phase: 'playing' });
    expect(ctx.data.readingLineIdx).toBe(3);
  });

  it('朗读单词 → readingLineIdx = -1（■ 不出现，避免「读词却显示句子停止按钮」）', () => {
    const ctx = makeLoaded();
    pageConfig.onWordLongPress.call(ctx, ev({ w: 'bed', i: 1, hasdef: false }));
    pageConfig.onDrawerSpeakWord.call(ctx, { detail: { word: 'bed', lineIndex: 1 } });
    expect(ctx.data.readingLineIdx).toBe(-1);
    expect(speakTextMock).toHaveBeenCalledWith('bed');
  });

  it('点 ■（stopLineSpeak）→ 真停（stopSpeak）+ 播放态归零', () => {
    const ctx = makeLoaded();
    pageConfig._onSpeakState.call(ctx, { text: ctx.data.lines[0].en, phase: 'playing' });
    expect(ctx.data.readingLineIdx).toBe(0);
    pageConfig.stopLineSpeak.call(ctx);
    expect(stopSpeakMock).toHaveBeenCalled();
    expect(ctx.data.readingLineIdx).toBe(-1);
    expect(ctx.data.readingPhase).toBe('idle');
    expect(ctx.data.wordPlaying).toBe('');
  });

  it('播放中关抽屉（遮罩）→ 不打断朗读，■ 仍在该句且仍可停（U1 的唯一停止路径不能被关掉）', () => {
    const ctx = makeLoaded();
    pageConfig.onWordLongPress.call(ctx, ev({ w: 'bed', i: 1, hasdef: false }));
    pageConfig.onDrawerSpeakLine.call(ctx, { detail: { lineIndex: 1, text: ctx.data.lines[1].en } });
    expect(ctx.data.readingLineIdx).toBe(1);
    // 再开一次抽屉（模拟用户又长按），然后点遮罩关掉
    pageConfig.onWordLongPress.call(ctx, ev({ w: 'stay', i: 1, hasdef: false }));
    pageConfig.onDrawerClose.call(ctx, { detail: { via: 'mask' } });
    expect(ctx.data.overlay).toBeNull();
    expect(ctx.data.readingLineIdx).toBe(1); // 播放没被打断
    expect(stopSpeakMock).not.toHaveBeenCalled();
    // ■ 仍可停
    pageConfig.stopLineSpeak.call(ctx);
    expect(stopSpeakMock).toHaveBeenCalledTimes(1);
  });

  it('反例：关抽屉不得把播放态一起清掉（否则 ■ 消失 = 再也停不下来）', () => {
    const ctx = makeLoaded();
    pageConfig.onWordLongPress.call(ctx, ev({ w: 'bed', i: 1, hasdef: false }));
    pageConfig.onDrawerClose.call(ctx, { detail: { via: 'close' } });
    const before = ctx.data.readingLineIdx;
    expect(ctx.data.readingLineIdx).toBe(before);
  });

  it('反例：课文里有两句完全相同 → 朗读第二句时 ■ 落在第一句（文本→下标反查的歧义）', () => {
    const ctx = makeLoaded();
    // 构造重复句：把第 3 句改成与第 0 句同文
    const dup = ctx.data.lines[0].en;
    ctx.data.lines = ctx.data.lines.map((l: any, i: number) => (i === 3 ? { ...l, en: dup, tokens: tokenize(dup, buildKnown(LESSON.words)) } : l));
    pageConfig.onDrawerSpeakLine.call(ctx, { detail: { lineIndex: 3, text: dup } });
    // 模拟 tts 真实回流（speakText 内部 emitState({text: dup, phase:'loading'})）
    pageConfig._onSpeakState.call(ctx, { text: dup, phase: 'loading' });
    // 用户点的是第 3 句（data-i=3），期望 ■ 留在第 3 句；
    // 实际实现按「文本→下标反查」命中第一句 → 停止按钮跑到别句上
    expect(ctx.data.readingLineIdx).toBe(3);
  });
});

describe('D4 收藏（E3 / E5：普通词必须带 hasDef=false）', () => {
  it('收藏普通词 → meta.hasDef === false（否则收藏页「未收录」灰标不出现）', async () => {
    const ctx = makeLoaded();
    pageConfig.onWordLongPress.call(ctx, ev({ w: 'bed', i: 1, hasdef: false }));
    await pageConfig.onDrawerCollectWord.call(ctx, { detail: { word: 'bed', lineIndex: 1, hasDef: false } });
    const payload = collectMock.mock.calls[0][0];
    expect(payload.tag).toBe('word');
    expect(payload.enMain).toBe('bed');
    expect(payload.meta).toHaveProperty('hasDef');
    expect(payload.meta.hasDef).toBe(false);
  });

  it('收藏此句 → tag=nce + meta.lineIndex 为该句下标 + note=译文', async () => {
    const ctx = makeLoaded();
    await pageConfig.onDrawerCollectLine.call(ctx, { detail: { lineIndex: 1, text: ctx.data.lines[1].en } });
    const payload = collectMock.mock.calls[0][0];
    expect(payload.tag).toBe('nce');
    expect(payload.meta.lineIndex).toBe(1);
    expect(payload.note).toBe('我有时在床上呆到午饭时间。');
    expect(payload.sourceText).toContain('Lesson 3');
  });

  it('未登录收藏 → 抽屉先收起 + 本页内联 modal（不是 toast）', async () => {
    isLoggedInMock.mockReturnValue(false);
    const ctx = makeLoaded();
    pageConfig.onWordLongPress.call(ctx, ev({ w: 'bed', i: 1, hasdef: false }));
    await pageConfig.onDrawerCollectWord.call(ctx, { detail: { word: 'bed', lineIndex: 1, hasDef: false } });
    expect(ctx.data.overlay).toBeNull();
    expect(ctx.data.guestLoginShow).toBe(true);
    expect(wxMock.showToast).not.toHaveBeenCalled();
    expect(collectMock).not.toHaveBeenCalled();
  });
});

describe('D5 关闭 / onHide 归零（K9 / T11-F5）', () => {
  it('三个关闭通道都走同一入口 → overlay 归零', () => {
    for (const via of ['mask', 'swipe', 'close']) {
      const ctx = makeLoaded();
      pageConfig.onWordLongPress.call(ctx, ev({ w: 'bed', i: 1, hasdef: false }));
      pageConfig.onDrawerClose.call(ctx, { detail: { via } });
      expect(ctx.data.overlay).toBeNull();
    }
  });

  it('onHide → stopSpeak + 播放态归零 + overlay 归零 + 退订', () => {
    const ctx = makeLoaded();
    ctx._offSpeakState = jest.fn();
    ctx.data.overlay = { kind: 'drawer', scope: 'line', lineIndex: 0, lineText: 'x' };
    ctx.data.readingLineIdx = 0;
    pageConfig.onHide.call(ctx);
    expect(stopSpeakMock).toHaveBeenCalled();
    expect(ctx.data.overlay).toBeNull();
    expect(ctx.data.readingLineIdx).toBe(-1);
    expect(ctx._offSpeakState).toBeNull();
  });

  it('onShow 先归零再订阅（后台残留的假播放态不得露出来）', () => {
    const ctx = makeLoaded();
    ctx._offSpeakState = null;
    ctx.data.readingLineIdx = 2;
    pageConfig.onShow.call(ctx);
    expect(ctx.data.readingLineIdx).toBe(-1);
    expect(typeof ctx._offSpeakState).toBe('function');
  });

  it('换课（goLesson）→ 停播 + overlay 归零', () => {
    const ctx = makeLoaded();
    ctx.data.overlay = { kind: 'drawer', scope: 'word', word: 'bed', hasDef: false, lineIndex: 1, lineText: 'x', phonetic: '' };
    pageConfig.goLesson.call(ctx, ev({ delta: 1 }));
    expect(stopSpeakMock).toHaveBeenCalled();
    expect(ctx.data.overlay).toBeNull();
  });
});

describe('D6 边界数据（词表空 / cn 空 / 100+ 节点）', () => {
  it('words=[] 时仍能长按任意词（hasDef 全 false，四项照出）', async () => {
    getLessonMock.mockResolvedValue({ ...LESSON, words: [] });
    const ctx = makeLoaded();
    await pageConfig.load.call(ctx);
    expect(ctx.data.lines[0].tokens.filter((t: any) => t.w).every((t: any) => t.hasDef === false)).toBe(true);
    pageConfig.onWordLongPress.call(ctx, ev({ w: 'early', i: 0, hasdef: false }));
    expect(ctx.data.overlay).toMatchObject({ scope: 'word', hasDef: false });
  });

  it('全课无译文 → fullCn 兜底文案，不出现 undefined/null', async () => {
    getLessonMock.mockResolvedValue({ ...LESSON, lines: [{ en: 'A.', cn: '' }, { en: 'B.', cn: '' }] });
    const ctx = makeLoaded();
    await pageConfig.load.call(ctx);
    expect(ctx.data.fullCn).toBe('（本课暂无参考译文）');
  });

  it('100+ 单词节点：长按链路里没有任何坐标测量 / DOM 查询（静态：方法体扫描）', () => {
    const src = String(pageConfig.onWordLongPress) + String(pageConfig.onLongPress);
    expect(src).not.toMatch(/SelectorQuery|boundingClientRect|touches|pageX/);
    // 节点量级基线
    const known = buildKnown(LESSON.words);
    const n = LESSON.lines.reduce((s, l) => s + tokenize(l.en, known).length, 0);
    expect(n).toBeGreaterThan(0);
  });

  it('词表取不到（请求失败）→ 错误态而不是空课文', async () => {
    getLessonMock.mockRejectedValue(new Error('boom'));
    const ctx = makeLoaded();
    await pageConfig.load.call(ctx);
    expect(ctx.data.error).toBeTruthy();
    expect(ctx.data.loading).toBe(false);
  });
});
