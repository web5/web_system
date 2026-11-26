/// <reference types="node" />
/**
 * 【测试工程师 · 独立盲测用例】课文详情页（需求①~④）
 *
 * 只按用户 2026-11-26 口述需求 + 已拍板口径下断言，不看开发提交的用例。
 * tts 用「忠实模型」桩：speakText 同文本再调 = 停止；stopSpeak 仅在非空闲时推 null；
 * onSpeakState 只在状态变化时回调（不补发当前态）——这三条与 services/tts.ts 现状一致，
 * 是判断「页面是否会残留播放态」的前提。
 *
 * 来源：2026-11-26 独立盲测归档用例 `zz-rd-blind-detail.test.ts`，原样合入正式测试集。
 * 唯一的适配是补 `export {}`（合入后与 home-quote-source 同处 script 作用域会重名，
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
  /** 模拟自然播完 */
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

const mockNce: any = { detail: null, calls: [] as Array<[number, string]> };
jest.mock('../services/nce', () => ({
  getNceLesson: (id: number, book?: string) => {
    mockNce.calls.push([id, String(book || '')]);
    return Promise.resolve(mockNce.detail);
  },
}));

const mockGlossary: any = { calls: [] as any[], reject: false };
jest.mock('../services/glossary', () => ({
  collectGlossary: (payload: any) => {
    mockGlossary.calls.push(payload);
    if (mockGlossary.reject) return Promise.reject(new Error('boom'));
    return Promise.resolve({ id: 1, created: true, existed: false });
  },
}));

const mockAuth: any = { loggedIn: true };
jest.mock('../services/auth', () => ({
  isLoggedIn: () => mockAuth.loggedIn,
  loginFromGate: () => Promise.resolve(true),
}));

const mockWx: any = {
  getStorageSync: jest.fn(() => ''),
  setStorageSync: jest.fn(),
  getSystemInfoSync: jest.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
  setNavigationBarTitle: jest.fn(),
  createSelectorQuery: jest.fn(() => ({
    select: () => ({
      boundingClientRect: () => ({
        selectViewport: () => ({
          scrollOffset: () => ({ exec: (cb: any) => cb([{ left: 10, bottom: 100 }, { scrollTop: 0 }]) }),
        }),
      }),
    }),
  })),
  showToast: jest.fn(),
  pageScrollTo: jest.fn(),
};

let pageConfig: any = null;

beforeAll(() => {
  (globalThis as any).wx = mockWx;
  (globalThis as any).getApp = () => ({
    radiusClassOf: () => '',
    eventBus: { on: jest.fn(), off: jest.fn() },
  });
  (globalThis as any).Page = (cfg: any) => { pageConfig = cfg; };
  require('../pages/nce/detail/detail');
});

beforeEach(() => {
  mockTts.listeners.clear();
  mockTts.playingText = '';
  mockTts.state = null;
  mockTts.speakCalls = [];
  mockTts.stopCalls = 0;
  mockNce.detail = null;
  mockNce.calls = [];
  mockGlossary.calls = [];
  mockGlossary.reject = false;
  mockAuth.loggedIn = true;
  mockWx.showToast.mockClear();
});

/** 造一个页面上下文（this）：方法走原型，data 独立 */
function makeCtx(patch: Record<string, unknown> = {}): any {
  const ctx: any = Object.create(pageConfig);
  ctx.data = { ...pageConfig.data, ...patch };
  ctx.setData = function (p: Record<string, unknown>) { Object.assign(this.data, p); };
  return ctx;
}

const LINES = [
  { en: 'The play was good.', cn: '这出戏很好。' },
  { en: 'He plays well.', cn: '' },
  { en: 'Do you like plays', cn: '你喜欢戏剧吗' },
];
const WORDS = [
  { word: 'play', phonetic: '/pleɪ/', pos: 'n.', def: '戏剧' },
  { word: 'the', def: '这' },
];

/** 加载一课的上下文（走真实 load() 流程，得 lines/tokens/fullCn） */
async function loaded(opts: { lines?: any[]; words?: any[]; readMode?: string } = {}): Promise<any> {
  const ctx = makeCtx({ id: 7, book: 'NCE2', loading: true, readMode: opts.readMode || 'tap' });
  mockNce.detail = {
    id: 7, book: 'NCE2', title: 'Test', titleCn: '', text: '',
    lines: opts.lines || LINES, words: opts.words === undefined ? WORDS : opts.words,
    translation: '', exercises: [], sources: [], fetchedAt: '', textSource: 'xdf', bookTitle: '',
  };
  ctx._subscribeReading();
  await ctx.load();
  return ctx;
}

describe('需求① V4/V6：文末参考译文按句换行 + 空值兜底', () => {
  it('3 句 cn → 以 \\n 连接（不是空串拼接，也不是空格）', async () => {
    const ctx = await loaded();
    expect(ctx.data.fullCn).toBe('这出戏很好。\n你喜欢戏剧吗');
  });

  it('中间 cn 为空串 → 跳过空句，不产生连续两个换行', async () => {
    const ctx = await loaded();
    expect(ctx.data.fullCn.split('\n').filter((s: string) => !s.trim())).toEqual([]);
  });

  it('全课 cn 为空 → 兜底文案，不出空块', async () => {
    const ctx = await loaded({ lines: [{ en: 'A.', cn: '' }, { en: 'B.', cn: '  ' }] });
    expect(ctx.data.fullCn).toBe('（本课暂无参考译文）');
  });

  it('反例：lines 为空数组 → 兜底文案且不抛', async () => {
    const ctx = await loaded({ lines: [] });
    expect(ctx.data.fullCn).toBe('（本课暂无参考译文）');
    expect(ctx.data.lines).toEqual([]);
  });

  it('V2 句子不截断：lines 全部进入渲染模型', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ en: `Sentence ${i + 1}.`, cn: `第${i + 1}句` }));
    const ctx = await loaded({ lines: many });
    expect(ctx.data.lines).toHaveLength(12);
    expect(ctx.data.lines[11].en).toBe('Sentence 12.');
  });
});

describe('需求② V9/V10/V11：非生词不高亮但可展开；生词全档出词卡', () => {
  it('V9 tap 档点句子 = 展开该句中文，且不弹词卡', async () => {
    const ctx = await loaded({ readMode: 'tap' });
    ctx.toggleLine({ currentTarget: { dataset: { i: '1' } } });
    expect(ctx.data.expandedIdx).toBe(1);
    expect(ctx.data.tipWord).toBeNull();
  });

  it('V9 再点同一句收起；点另一句替换（至多 1 句）', async () => {
    const ctx = await loaded({ readMode: 'tap' });
    ctx.toggleLine({ currentTarget: { dataset: { i: '1' } } });
    ctx.toggleLine({ currentTarget: { dataset: { i: '1' } } });
    expect(ctx.data.expandedIdx).toBe(-1);
    ctx.toggleLine({ currentTarget: { dataset: { i: '1' } } });
    ctx.toggleLine({ currentTarget: { dataset: { i: '2' } } });
    expect(ctx.data.expandedIdx).toBe(2);
  });

  it('V11 无词表（words=[]）→ 所有 token hasDef=false，点线为零', async () => {
    const ctx = await loaded({ words: [] });
    const anyDef = ctx.data.lines.some((l: any) => l.tokens.some((t: any) => t.hasDef));
    expect(anyDef).toBe(false);
  });

  it('V11 无词表时点句子仍展开中文（不能因为「无生词」把整页点按搞死）', async () => {
    const ctx = await loaded({ words: [], readMode: 'tap' });
    ctx.toggleLine({ currentTarget: { dataset: { i: '0' } } });
    expect(ctx.data.expandedIdx).toBe(0);
  });

  it('V10 沉浸档点生词也出词卡（口径：全档放宽）', async () => {
    const ctx = await loaded({ readMode: 'immersion' });
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    expect(ctx.data.tipWord && ctx.data.tipWord.word).toBe('play');
    expect(ctx.data.tipWord.none).toBe(false);
    expect(ctx.data.tipWord.def).toBe('戏剧');
  });

  it('V10 再点同一词收起；点另一个生词替换内容', async () => {
    const ctx = await loaded({ readMode: 'tap' });
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    expect(ctx.data.tipWord).toBeNull();
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'the', hasdef: true } } });
    expect(ctx.data.tipWord.word).toBe('the');
  });

  it('反例：非生词走兜底分发（若别处误调 onWordTap）不得出词卡', async () => {
    const ctx = await loaded({ readMode: 'tap' });
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'good', hasdef: false } } });
    expect(ctx.data.tipWord).toBeNull();
    expect(ctx.data.expandedIdx).toBe(0); // 等同点句子空白
  });

  it('反例：hasdef 以字符串 "false" 传入时不得被当成生词', async () => {
    const ctx = await loaded({ readMode: 'tap' });
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'good', hasdef: 'false' } } });
    expect(ctx.data.tipWord).toBeNull();
  });

  it('生词表外词（hasDef=true 但词表里查不到）→ 词卡「暂无释义」且保留可点', async () => {
    const ctx = await loaded({ readMode: 'tap' });
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'nonexistent', hasdef: true } } });
    expect(ctx.data.tipWord.none).toBe(true);
    expect(ctx.data.tipWord.word).toBe('nonexistent');
  });
});

describe('需求③ V12~V18：长按生词气泡（朗读单词 / 收藏单词）', () => {
  it('V12 长按生词 → 出单词气泡，带 word/lineIdx/left/top', async () => {
    const ctx = await loaded({ readMode: 'immersion' });
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '1', w: 'Play' } }, touches: [{ pageX: 100, pageY: 200 }] });
    expect(ctx.data.wordBubble.word).toBe('play'); // 统一小写
    expect(ctx.data.wordBubble.lineIdx).toBe(1);
    expect(ctx.data.wordBubble.left).toBe(200);  // 100px * (750/375)
    expect(ctx.data.wordBubble.top).toBe(408);   // 200px * 2 + 8
  });

  it('V13 先长按句子再长按单词 → 句子气泡必须关掉（互斥）', async () => {
    const ctx = await loaded({ readMode: 'tap' });
    ctx.onLongPress({ currentTarget: { dataset: { i: '0' } } });
    expect(ctx.data.bubbleIdx).toBe(0);
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: 'play' } }, touches: [{ pageX: 10, pageY: 10 }] });
    expect(ctx.data.wordBubble).not.toBeNull();
    expect(ctx.data.bubbleIdx).toBe(-1);
    expect(ctx.data.bubblePos).toBeNull();
  });

  it('V16 先长按单词再长按句子 → 单词气泡关掉，句子气泡两项照旧', async () => {
    const ctx = await loaded({ readMode: 'tap' });
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: 'play' } }, touches: [{ pageX: 10, pageY: 10 }] });
    ctx.onLongPress({ currentTarget: { dataset: { i: '1' } } });
    expect(ctx.data.wordBubble).toBeNull();
    expect(ctx.data.bubbleIdx).toBe(1);
  });

  it('V13 长按单词时同时收起词卡（同一时刻只有一个浮层）', async () => {
    const ctx = await loaded({ readMode: 'tap' });
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    expect(ctx.data.tipWord).not.toBeNull();
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: 'play' } }, touches: [{ pageX: 10, pageY: 10 }] });
    expect(ctx.data.tipWord).toBeNull();
    expect(ctx.data.wordBubble).not.toBeNull();
  });

  it('V14 点「朗读单词」→ speakText(该词) 恰好一次，气泡收起', async () => {
    const ctx = await loaded();
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: 'play' } }, touches: [{ pageX: 10, pageY: 10 }] });
    ctx.onWordBubbleSpeak();
    expect(mockTts.speakCalls).toEqual(['play']);
    expect(ctx.data.wordBubble).toBeNull();
  });

  it('V15 点「收藏单词」→ collectGlossary tag=word 且 meta 字段齐备', async () => {
    const ctx = await loaded();
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: 'play' } }, touches: [{ pageX: 10, pageY: 10 }] });
    await ctx.collectWord();
    expect(mockGlossary.calls).toHaveLength(1);
    const p = mockGlossary.calls[0];
    expect(p.tag).toBe('word');
    expect(p.enMain).toBe('play');
    expect(p.meta).toMatchObject({ book: 'NCE2', lessonId: 7, lineIndex: 0, word: 'play', phonetic: '/pleɪ/' });
    expect(p.note).toBe('n. 戏剧');
    expect(p.sourceText).toContain('Lesson 7');
  });

  it('V15 反例：收藏接口失败 → 不抛、不崩、气泡已收起', async () => {
    const ctx = await loaded();
    mockGlossary.reject = true;
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: 'play' } }, touches: [{ pageX: 10, pageY: 10 }] });
    await expect(ctx.collectWord()).resolves.toBeUndefined();
    expect(ctx.data.wordBubble).toBeNull();
  });

  it('V18 未登录收藏单词 → 弹「请先登录」，不调接口', async () => {
    const ctx = await loaded();
    mockAuth.loggedIn = false;
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: 'play' } }, touches: [{ pageX: 10, pageY: 10 }] });
    await ctx.collectWord();
    expect(mockGlossary.calls).toHaveLength(0);
    expect(ctx.data.guestLoginShow).toBe(true);
  });

  it('V17 右边缘夹紧：pageX=740/375 → left 不超过 750-340=410', async () => {
    const ctx = await loaded();
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: 'play' } }, touches: [{ pageX: 740, pageY: 50 }] });
    expect(ctx.data.wordBubble.left).toBe(410);
  });

  it('V17 pageX=0 → left 不小于 0', async () => {
    const ctx = await loaded();
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: 'play' } }, touches: [{ pageX: 0, pageY: 0 }] });
    expect(ctx.data.wordBubble.left).toBe(0);
    expect(ctx.data.wordBubble.top).toBe(8);
  });

  it('V17 反例：touches 缺失（老基础库/合成事件）→ 不抛异常，退回左上角', async () => {
    const ctx = await loaded();
    expect(() => ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: 'play' } } })).not.toThrow();
    expect(ctx.data.wordBubble.left).toBe(0);
  });

  it('V17 反例：windowWidth 异常为 0 → 不得算出 Infinity/NaN 坐标', async () => {
    const ctx = await loaded();
    mockWx.getSystemInfoSync.mockReturnValueOnce({ windowWidth: 0, windowHeight: 0 });
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: 'play' } }, touches: [{ pageX: 100, pageY: 100 }] });
    expect(Number.isFinite(ctx.data.wordBubble.left)).toBe(true);
    expect(Number.isFinite(ctx.data.wordBubble.top)).toBe(true);
  });

  it('反例：长按空 data-w（脏 token）→ 不产生气泡', async () => {
    const ctx = await loaded();
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: '' } }, touches: [{ pageX: 10, pageY: 10 }] });
    expect(ctx.data.wordBubble).toBeNull();
  });
});

describe('需求④ V19~V22：词卡朗读按钮', () => {
  it('V19 点「朗读」→ speakText(当前词) 一次；播放态由 onSpeakState 回流为 true', async () => {
    const ctx = await loaded();
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.speakTipWord();
    expect(mockTts.speakCalls).toEqual(['play']);
    expect(ctx.data.tipPlaying).toBe(true);
  });

  it('V20 再点同词 → 停止（speakText same-text 语义），按钮回「朗读」', async () => {
    const ctx = await loaded();
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.speakTipWord();
    expect(ctx.data.tipPlaying).toBe(true);
    ctx.speakTipWord();
    expect(ctx.data.tipPlaying).toBe(false);
    expect(mockTts.playingText).toBe('');
  });

  it('V22 自然播完（tts 推 null）→ tipPlaying 复位，不残留', async () => {
    const ctx = await loaded();
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.speakTipWord();
    mockTts.finish();
    expect(ctx.data.tipPlaying).toBe(false);
    expect(ctx.data.wordPlaying).toBe('');
  });

  it('V21 朗读中关卡片 → stopSpeak 被调用（不留尾巴）', async () => {
    const ctx = await loaded();
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.speakTipWord();
    const before = mockTts.stopCalls;
    ctx.closeTip();
    expect(mockTts.stopCalls).toBeGreaterThan(before);
    expect(mockTts.playingText).toBe('');
  });

  it('V21 反例：朗读中点「另一个生词」再关卡片 —— 关卡片必须仍能 stopSpeak', async () => {
    const ctx = await loaded();
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.speakTipWord();                       // play 在播
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'the', hasdef: true } } }); // 切到 the（tipPlaying 被置 false）
    const before = mockTts.stopCalls;
    ctx.closeTip();                            // 关卡片
    expect(ctx.data.tipWord).toBeNull();
    expect(mockTts.stopCalls).toBeGreaterThan(before); // 期望：关卡片即停
  });

  it('V23 朗读中切课（下一课）→ stopSpeak + 词卡/单词气泡/按钮态全清', async () => {
    const ctx = await loaded();
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.speakTipWord();
    ctx.onWordLongPress({ currentTarget: { dataset: { i: '0', w: 'play' } }, touches: [{ pageX: 10, pageY: 10 }] });
    mockNce.detail = { ...mockNce.detail, id: 8 };
    await ctx.goLesson({ currentTarget: { dataset: { delta: '1' } } });
    expect(mockTts.playingText).toBe('');
    expect(ctx.data.wordBubble).toBeNull();
    expect(ctx.data.tipPlaying).toBe(false);
    expect(ctx.data.wordPlaying).toBe('');
  });

  it('V23 反例：切档（点按→沉浸）时不得残留「停止」按钮态与浮层', async () => {
    const ctx = await loaded();
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.speakTipWord();
    ctx.setReadMode({ currentTarget: { dataset: { mode: 'immersion' } } });
    expect(ctx.data.tipPlaying).toBe(false);
    expect(ctx.data.tipWord).toBeNull();
  });
});

describe('回归：切页/回前台后的播放态残留（onHide 先退订再 stopSpeak）', () => {
  it('朗读中切后台再回来 → 句子高亮 / 词卡按钮态必须复位', async () => {
    const ctx = await loaded({ readMode: 'tap' });
    ctx.onShow(); // 订阅
    ctx.onBubbleSpeak({ currentTarget: { dataset: { i: '0' } } });
    expect(ctx.data.readingLineIdx).toBe(0);
    ctx.onHide();  // 退订 + stopSpeak
    ctx.onShow();  // 回来再订阅
    expect(ctx.data.readingLineIdx).toBe(-1);
    expect(ctx.data.readingPhase).toBe('idle');
  });

  it('朗读单词中切后台再回来 → 词卡按钮不得继续显示「停止」', async () => {
    const ctx = await loaded({ readMode: 'tap' });
    ctx.onShow();
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.speakTipWord();
    expect(ctx.data.tipPlaying).toBe(true);
    ctx.onHide();
    ctx.onShow();
    expect(ctx.data.tipPlaying).toBe(false);
  });
});

describe('回归：点句子朗读 / 收藏（口径未被本次改动改坏）', () => {
  it('气泡「朗读此句」→ speakText(line.en) 恰好一次，仅该句高亮', async () => {
    const ctx = await loaded();
    ctx.onBubbleSpeak({ currentTarget: { dataset: { i: '1' } } });
    expect(mockTts.speakCalls).toEqual(['He plays well.']);
    expect(ctx.data.readingLineIdx).toBe(1);
  });

  it('再点同句 → 停止，高亮复位', async () => {
    const ctx = await loaded();
    ctx.onBubbleSpeak({ currentTarget: { dataset: { i: '1' } } });
    ctx.onBubbleSpeak({ currentTarget: { dataset: { i: '1' } } });
    expect(ctx.data.readingLineIdx).toBe(-1);
    expect(mockTts.playingText).toBe('');
  });

  it('读单词时不得把「句子高亮」点亮 / 读句子时不得把「词卡按钮」点亮', async () => {
    const ctx = await loaded();
    ctx.onBubbleSpeak({ currentTarget: { dataset: { i: '0' } } });
    expect(ctx.data.wordPlaying).toBe('');
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.speakTipWord();
    expect(ctx.data.readingLineIdx).toBe(-1);
    expect(ctx.data.tipPlaying).toBe(true);
  });

  it('句子 A 播放中再朗读句子 B → B 必须高亮（切句不断高亮）', async () => {
    const ctx = await loaded();
    ctx.onBubbleSpeak({ currentTarget: { dataset: { i: '0' } } });
    expect(ctx.data.readingLineIdx).toBe(0);
    ctx.onBubbleSpeak({ currentTarget: { dataset: { i: '2' } } });
    expect(ctx.data.readingLineIdx).toBe(2); // 期望：高亮跟随到新的朗读句
    expect(ctx.data.readingPhase).toBe('playing');
  });

  it('句子播放中从词卡点「朗读」→ 词卡按钮必须进入「停止」态', async () => {
    const ctx = await loaded();
    ctx.onBubbleSpeak({ currentTarget: { dataset: { i: '0' } } }); // 先有语音在播
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.speakTipWord();
    expect(ctx.data.tipPlaying).toBe(true); // 期望：正在读该词 → 按钮显示「停止」
  });

  it('收藏整句 tag=nce，meta 带 lessonId/lineIndex（旧契约不变）', async () => {
    const ctx = await loaded();
    await ctx.collectLine({ currentTarget: { dataset: { i: '2' } } });
    const p = mockGlossary.calls[0];
    expect(p.tag).toBe('nce');
    expect(p.enMain).toBe('Do you like plays');
    expect(p.meta).toMatchObject({ book: 'NCE2', lessonId: 7, lineIndex: 2 });
  });

  it('load 后所有浮层/播放态归零（换课不残留旧坐标与旧词卡）', async () => {
    const ctx = await loaded();
    ctx.onWordTap({ currentTarget: { dataset: { i: '0', w: 'play', hasdef: true } } });
    ctx.onLongPress({ currentTarget: { dataset: { i: '0' } } });
    await ctx.load();
    expect(ctx.data.tipWord).toBeNull();
    expect(ctx.data.bubbleIdx).toBe(-1);
    expect(ctx.data.bubblePos).toBeNull();
    expect(ctx.data.wordBubble).toBeNull();
    expect(ctx.data.tipPlaying).toBe(false);
    expect(ctx.data.expandedIdx).toBe(-1);
  });
});
