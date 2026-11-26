/// <reference types="node" />
/**
 * 课文详情 · 单词交互（2026-11-26 需求 ②③④）
 *
 * 覆盖用户口径：
 *  ② 点非生词不高亮（WXML 只给生词挂事件；行为层非生词走点句语义）；
 *  ③ 长按生词 → 气泡「朗读单词 / 收藏单词」（长按句子两项气泡不变）；
 *  ④ 词卡「朗读」按钮 → 读该词，关闭词卡顺手停朗读。
 *
 * 与 nce-detail-v7c.test.ts 的分工：那份锁 V7-C 主链路（点句/点词 tip/长按句子/收藏），
 * 本份只锁本轮新增的单词级交互，避免把新需求塞进旧规格文件。
 */
jest.mock('../services/nce', () => ({
  getNceLesson: jest.fn(),
  getNceMeta: jest.fn(),
  listNceLessons: jest.fn(),
}));
jest.mock('../services/tts', () => ({
  speakText: jest.fn(() => Promise.resolve(true)),
  stopSpeak: jest.fn(),
  onSpeakState: jest.fn(() => jest.fn()),
}));
jest.mock('../services/glossary', () => ({
  collectGlossary: jest.fn(() => Promise.resolve({ id: 1, existed: false })),
}));
jest.mock('../services/auth', () => ({
  isLoggedIn: jest.fn(() => true),
  loginFromGate: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../pages/nce/books', () => ({
  DEFAULT_NCE_BOOK: 'NCE2',
  NCE_BOOKS: [{ book: 'NCE2' }],
  nceBookTotal: jest.fn(() => 96),
  buildNceGroupRanges: jest.fn(() => []),
}));

import { speakText, stopSpeak, onSpeakState } from '../services/tts';
import { collectGlossary } from '../services/glossary';
import { isLoggedIn } from '../services/auth';

const speakTextMock = speakText as unknown as jest.Mock;
const stopSpeakMock = stopSpeak as unknown as jest.Mock;
const onSpeakStateMock = onSpeakState as unknown as jest.Mock;
const collectMock = collectGlossary as unknown as jest.Mock;
const isLoggedInMock = isLoggedIn as unknown as jest.Mock;

const wxMock = {
  getStorageSync: jest.fn(() => 1),
  setStorageSync: jest.fn(),
  showToast: jest.fn(),
  setNavigationBarTitle: jest.fn(),
  pageScrollTo: jest.fn(),
  getSystemInfoSync: jest.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
  createSelectorQuery: jest.fn(() => {
    const q: any = {
      select: jest.fn(() => q),
      selectViewport: jest.fn(() => q),
      boundingClientRect: jest.fn(() => q),
      scrollOffset: jest.fn(() => q),
      exec: jest.fn((cb: (r: unknown[]) => void) => cb([{ left: 20, bottom: 80 }, { scrollTop: 100 }])),
    };
    return q;
  }),
};

let pageConfig: any = null;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).Page = jest.fn((cfg: any) => { pageConfig = cfg; });
  (globalThis as any).getApp = jest.fn(() => ({
    eventBus: { on: jest.fn(), off: jest.fn() },
    radiusClassOf: () => '',
  }));
  require('../pages/nce/detail/detail');
});

beforeEach(() => {
  jest.clearAllMocks();
  isLoggedInMock.mockReturnValue(true);
  wxMock.getStorageSync.mockReturnValue(1);
});

/** 页面上下文桩：把页面内部方法显式挂上（onWordTap 依赖 _lookupWord / _applyLineTap） */
function makeThis() {
  const ctx: any = {
    data: JSON.parse(JSON.stringify({
      ...pageConfig.data,
      tipWord: null,
      wordBubble: null,
      wordPlaying: '',
      tipPlaying: false,
      readMode: 'tap',
    })),
    setData: jest.fn(function (this: any, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    }),
    _playingIdx: -1,
    _speakingWord: '',
    _offSpeakState: null,
  };
  // 页面内部方法桩：把这些方法显式挂上（onWordTap 依赖 _lookupWord / _applyLineTap；
  // 播放态回流依赖 _lineIdxOf / _resetPlayingState —— 与页面实际调用面保持同步）
  for (const k of ['_lookupWord', '_applyLineTap', 'toggleLine', '_anchorFloat', '_subscribeReading', '_lineIdxOf', '_resetPlayingState']) {
    ctx[k] = pageConfig[k];
  }
  return ctx;
}

function seedLines(ctx: any) {
  ctx.data.lines = [
    { idx: 0, en: 'He is an engineer.', cn: '他是工程师。', tokens: [] },
    { idx: 1, en: 'She is a doctor.', cn: '她是医生。', tokens: [] },
  ];
  ctx.data.detail = { id: 4, title: 'L4', words: [{ word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/en/' }] };
  ctx.data.book = 'NCE2';
  ctx.data.id = 4;
}

describe('② 非生词不高亮', () => {
  it('行为：点非生词等同点句子（tap 档展开该句中文），不弹词卡', () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onWordTap.call(ctx, {
      currentTarget: { dataset: { w: 'doctor', i: 1, hasdef: false } },
    });
    expect(ctx.data.tipWord).toBeNull();
    expect(ctx.data.expandedIdx).toBe(1);
  });

  it('静态：非生词分支是纯文本（无 catchtap / 无 has-def），只有生词分支挂事件', () => {
    const fs = require('fs');
    const path = require('path');
    const w = fs.readFileSync(path.resolve(__dirname, '../pages/nce/detail/detail.wxml'), 'utf8');
    // 生词分支：has-def + 点/长按事件
    expect(w).toMatch(/wx:if="\{\{tk\.w && tk\.hasDef\}\}" class="w has-def"[^>]*catchtap="onWordTap"[^>]*catchlongpress="onWordLongPress"/);
    // 非生词分支：没有任何事件绑定
    const elseBranch = (/<text wx:else>([\s\S]*?)<\/text>/.exec(w) || ['', ''])[1];
    expect(elseBranch).not.toMatch(/catch|bind/);
  });
});

describe('③ 长按生词 → 朗读单词 / 收藏单词', () => {
  it('长按生词弹出单词气泡：word/lineIdx 正确、坐标由触点换算 rpx、句子气泡被收起', () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onWordLongPress.call(ctx, {
      currentTarget: { dataset: { w: 'engineer', i: 0 } },
      touches: [{ pageX: 100, pageY: 200 }],
    });
    expect(ctx.data.wordBubble).toBeTruthy();
    expect(ctx.data.wordBubble.word).toBe('engineer');
    expect(ctx.data.wordBubble.lineIdx).toBe(0);
    expect(ctx.data.wordBubble.left).toBe(200);  // 100px * (750/375)
    expect(ctx.data.wordBubble.top).toBe(408);   // 200px * 2 + 8
    expect(ctx.data.bubbleIdx).toBe(-1);
    expect(ctx.data.tipWord).toBeNull();
  });

  it('长按行尾词时气泡左边界夹紧，不出屏', () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onWordLongPress.call(ctx, {
      currentTarget: { dataset: { w: 'engineer', i: 0 } },
      touches: [{ pageX: 370, pageY: 200 }],
    });
    expect(ctx.data.wordBubble.left).toBe(410);  // 750 - 340
  });

  it('朗读单词：恰好一次 speakText(word)，并收起气泡', () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onWordLongPress.call(ctx, {
      currentTarget: { dataset: { w: 'engineer', i: 0 } },
      touches: [{ pageX: 10, pageY: 10 }],
    });
    pageConfig.onWordBubbleSpeak.call(ctx);
    expect(speakTextMock).toHaveBeenCalledTimes(1);
    expect(speakTextMock).toHaveBeenCalledWith('engineer');
    expect(ctx.data.wordBubble).toBeNull();
  });

  it('收藏单词：collectGlossary 走 tag=word，enMain/meta 锚点齐全', async () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onWordLongPress.call(ctx, {
      currentTarget: { dataset: { w: 'engineer', i: 0 } },
      touches: [{ pageX: 10, pageY: 10 }],
    });
    await pageConfig.collectWord.call(ctx);
    expect(collectMock).toHaveBeenCalledTimes(1);
    const payload = collectMock.mock.calls[0][0];
    expect(payload.tag).toBe('word');
    expect(payload.enMain).toBe('engineer');
    expect(payload.note).toBe('n. 工程师');
    expect(payload.meta).toMatchObject({ book: 'NCE2', lessonId: 4, lineIndex: 0, word: 'engineer' });
  });

  it('未登录收藏单词：弹「请先登录」守卫，不发请求', async () => {
    const ctx = makeThis();
    seedLines(ctx);
    isLoggedInMock.mockReturnValue(false);
    pageConfig.onWordLongPress.call(ctx, {
      currentTarget: { dataset: { w: 'engineer', i: 0 } },
      touches: [{ pageX: 10, pageY: 10 }],
    });
    await pageConfig.collectWord.call(ctx);
    expect(ctx.data.guestLoginShow).toBe(true);
    expect(collectMock).not.toHaveBeenCalled();
  });

  it('长按句子仍是原两项气泡，且会清掉单词气泡（互斥）', () => {
    const ctx = makeThis();
    seedLines(ctx);
    ctx.data.wordBubble = { word: 'engineer', lineIdx: 0, left: 0, top: 0 };
    pageConfig.onLongPress.call(ctx, { currentTarget: { dataset: { i: 1 } } });
    expect(ctx.data.bubbleIdx).toBe(1);
    expect(ctx.data.wordBubble).toBeNull();
  });
});

describe('④ 词卡朗读按钮', () => {
  it('读当前单词：speakText(tipWord.word)，并标记本次朗读来自单词', () => {
    const ctx = makeThis();
    seedLines(ctx);
    ctx.data.tipWord = { word: 'engineer', pos: 'n.', def: '工程师', none: false };
    pageConfig.speakTipWord.call(ctx);
    expect(speakTextMock).toHaveBeenCalledWith('engineer');
    expect(ctx._speakingWord).toBe('engineer');
  });

  it('词卡播放态由 onSpeakState 回流：单词朗读点亮 tipPlaying，结束（null）复位', () => {
    const ctx = makeThis();
    seedLines(ctx);
    ctx.data.tipWord = { word: 'engineer', none: false };
    ctx._speakingWord = 'engineer';
    pageConfig._onSpeakState.call(ctx, { text: 'engineer', phase: 'playing' });
    expect(ctx.data.wordPlaying).toBe('engineer');
    expect(ctx.data.tipPlaying).toBe(true);
    pageConfig._onSpeakState.call(ctx, null);
    expect(ctx.data.tipPlaying).toBe(false);
    expect(ctx.data.wordPlaying).toBe('');
  });

  it('播放中关闭词卡 → 顺手 stopSpeak，避免卡片关了还在放音', () => {
    const ctx = makeThis();
    seedLines(ctx);
    ctx.data.tipWord = { word: 'engineer', none: false };
    ctx.data.tipPlaying = true;
    pageConfig.closeTip.call(ctx);
    expect(stopSpeakMock).toHaveBeenCalled();
    expect(ctx.data.tipWord).toBeNull();
    expect(ctx.data.tipPlaying).toBe(false);
  });

  it('静态：词卡头部有朗读按钮，文案随播放态切换', () => {
    const fs = require('fs');
    const path = require('path');
    const w = fs.readFileSync(path.resolve(__dirname, '../pages/nce/detail/detail.wxml'), 'utf8');
    expect(w).toMatch(/catchtap="speakTipWord"/);
    expect(w).toMatch(/\{\{tipPlaying \? '停止' : '朗读'\}\}/);
  });
});

describe('切词/查表抽到 utils 后行为不变（回归）', () => {
  it('onSpeakState 仍在 onShow 订阅（页面级，不退化成组件级）', () => {
    const ctx = makeThis() as any;
    (globalThis as any).getApp = jest.fn(() => ({ eventBus: { on: jest.fn(), off: jest.fn() }, radiusClassOf: () => '' }));
    pageConfig.onShow.call(ctx);
    expect(onSpeakStateMock).toHaveBeenCalled();
  });
});
