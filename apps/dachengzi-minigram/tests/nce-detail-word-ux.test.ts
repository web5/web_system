/// <reference types="node" />
/**
 * 课文详情 · 单词交互（2026-11-26 需求 ②③④ → 2026-11-26 变体 B 迁移后）
 *
 * 覆盖用户口径：
 *  ② 点非生词不高亮、点普通词不弹词卡（E1）；WXML 侧所有英文词都是节点（R-READ-04）；
 *  ③ 长按任意英文单词 → 底部抽屉四项（E5 两页同口径）；
 *  ④ 词卡「朗读」按钮 → 读该词，关闭词卡顺手停朗读。
 *
 * 与 nce-detail-v7c.test.ts 的分工：那份锁 V7-C 主链路（点句/点词 tip/长按句子/收藏），
 * 本份只锁单词级交互。2026-11-26 变体 B 后长按气泡退役，③ 的判据整体改为「单槽位 overlay
 * + 抽屉事件 handler」——**停止语义与收藏 payload 契约一字未改**。
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
import { actionsOf } from '../utils/line-actions';

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

/** 页面上下文桩：把页面内部方法显式挂上（onWordTap 依赖 _lookupWord / openOverlay 等） */
function makeThis() {
  const ctx: any = {
    data: JSON.parse(JSON.stringify({
      ...pageConfig.data,
      overlay: null,
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
  // 页面内部方法桩：与页面实际调用面保持同步。
  // 2026-11-26 变体 B：`_anchorFloat` 已删除；单槽位重构后新增 openOverlay / closeOverlay。
  for (const k of ['_lookupWord', '_applyLineTap', 'toggleLine', 'openOverlay', 'closeOverlay', 'closeTip', '_subscribeReading', '_lineIdxOf', '_resetPlayingState']) {
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

describe('② 非生词不高亮 / 点普通词不弹词卡（E1）', () => {
  it('行为：点非生词等同点句子（tap 档展开该句中文），不弹词卡', () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onWordTap.call(ctx, {
      currentTarget: { dataset: { w: 'doctor', i: 1, hasdef: false } },
    });
    expect(ctx.data.overlay).toBeNull();
    expect(ctx.data.expandedIdx).toBe(1);
  });

  it('行为：点普通词不弹抽屉（E1 只管点按；长按才出抽屉）', () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onWordTap.call(ctx, {
      currentTarget: { dataset: { w: 'doctor', i: 1, hasdef: false } },
    });
    expect(ctx.data.overlay).toBeNull();          // 既不是 wordtip 也不是 drawer
  });

  it('静态：所有英文词都是节点（条件只判 tk.w），事件挂全部词，else 分支仍是纯文本', () => {
    const fs = require('fs');
    const path = require('path');
    const w = fs.readFileSync(path.resolve(__dirname, '../pages/nce/detail/detail.wxml'), 'utf8');
    // 2026-11-26 R-READ-04（AC-B.28）：渲染条件不再含 hasDef，否则普通词没有节点
    expect(w).toMatch(/<text wx:if="\{\{tk\.w\}\}" class="w \{\{tk\.hasDef \? 'has-def' : ''\}\}"[^>]*catchtap="onWordTap"[^>]*catchlongpress="onWordLongPress"/);
    expect(w).not.toMatch(/tk\.w && tk\.hasDef/);
    // 非单词 token（标点 / 空格）仍是纯文本，没有任何事件绑定
    const elseBranch = (/<text wx:else>([\s\S]*?)<\/text>/.exec(w) || ['', ''])[1];
    expect(elseBranch).not.toMatch(/catch|bind/);
  });
});

describe('③ 长按任意单词 → 抽屉（朗读此句 / 收藏此句 / 朗读单词 / 收藏单词）', () => {
  it('长按生词 → overlay = drawer/word（word / lineIndex / hasDef / 所在句），句子档被覆盖', () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onLongPress.call(ctx, { currentTarget: { dataset: { i: 1 } } });
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'line', lineIndex: 1 });
    pageConfig.onWordLongPress.call(ctx, {
      currentTarget: { dataset: { w: 'engineer', i: 0, hasdef: true } },
    });
    expect(ctx.data.overlay).toMatchObject({
      kind: 'drawer', scope: 'word', word: 'engineer', lineIndex: 0, hasDef: true, phonetic: '/en/',
    });
    expect(ctx.data.overlay.lineText).toBe('He is an engineer.');
  });

  it('长按普通词（hasDef=false）同样弹抽屉、scope=word，动作仍是 4 项', () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onWordLongPress.call(ctx, {
      currentTarget: { dataset: { w: 'doctor', i: 1, hasdef: false } },
    });
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'word', word: 'doctor', hasDef: false });
    expect(ctx.data.overlay.phonetic).toBe('');   // 无音标，标题区走「暂无释义」
    expect(actionsOf('word')).toHaveLength(4);    // 与生词档完全一致，不因 hasDef 少项
  });

  it('「朗读单词」：恰好一次 speakText(word)，并收起抽屉（V-B11）', () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onWordLongPress.call(ctx, {
      currentTarget: { dataset: { w: 'engineer', i: 0, hasdef: true } },
    });
    pageConfig.onDrawerSpeakWord.call(ctx, { detail: { word: 'engineer', lineIndex: 0 } });
    expect(speakTextMock).toHaveBeenCalledTimes(1);
    expect(speakTextMock).toHaveBeenCalledWith('engineer');
    expect(ctx.data.overlay).toBeNull();
  });

  it('「收藏单词」：collectGlossary 走 tag=word，enMain/meta 齐备', async () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onWordLongPress.call(ctx, {
      currentTarget: { dataset: { w: 'engineer', i: 0, hasdef: true } },
    });
    await pageConfig.onDrawerCollectWord.call(ctx, { detail: { word: 'engineer', lineIndex: 0, hasDef: true } });
    expect(collectMock).toHaveBeenCalledTimes(1);
    const payload = collectMock.mock.calls[0][0];
    expect(payload.tag).toBe('word');
    expect(payload.enMain).toBe('engineer');
    expect(payload.note).toBe('n. 工程师');
    expect(payload.meta).toMatchObject({ book: 'NCE2', lessonId: 4, lineIndex: 0, word: 'engineer' });
  });

  it('「收藏单词」普通词档：note / phonetic 允许为空，不因「无释义」拒收（AC-B.31）', async () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onWordLongPress.call(ctx, {
      currentTarget: { dataset: { w: 'doctor', i: 1, hasdef: false } },
    });
    await pageConfig.onDrawerCollectWord.call(ctx, { detail: { word: 'doctor', lineIndex: 1, hasDef: false } });
    const payload = collectMock.mock.calls[0][0];
    expect(payload.tag).toBe('word');
    expect(payload.enMain).toBe('doctor');
    expect(payload.note).toBe('');
    expect(payload.meta.phonetic).toBe('');
  });

  it('未登录收藏单词：弹「请先登录」守卫，不发请求', async () => {
    const ctx = makeThis();
    seedLines(ctx);
    isLoggedInMock.mockReturnValue(false);
    pageConfig.onWordLongPress.call(ctx, {
      currentTarget: { dataset: { w: 'engineer', i: 0, hasdef: true } },
    });
    await pageConfig.onDrawerCollectWord.call(ctx, { detail: { word: 'engineer', lineIndex: 0, hasDef: true } });
    expect(ctx.data.guestLoginShow).toBe(true);
    expect(collectMock).not.toHaveBeenCalled();
  });

  it('长按句子 → 抽屉只剩两项（朗读此句 / 收藏此句），单词档被覆盖', () => {
    const ctx = makeThis();
    seedLines(ctx);
    ctx.data.overlay = { kind: 'drawer', scope: 'word', lineIndex: 0, lineText: 'x', word: 'engineer', hasDef: true, phonetic: '' };
    pageConfig.onLongPress.call(ctx, { currentTarget: { dataset: { i: 1 } } });
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'line', lineIndex: 1 });
    expect(actionsOf('line').map((a) => a.label)).toEqual(['朗读此句', '收藏此句']);
  });

  it('onDrawerClose：抽屉收起到 null（组件只抛信号，页面是唯一状态持有者）', () => {
    const ctx = makeThis();
    seedLines(ctx);
    pageConfig.onLongPress.call(ctx, { currentTarget: { dataset: { i: 0 } } });
    expect(ctx.data.overlay).not.toBeNull();
    pageConfig.onDrawerClose.call(ctx, { detail: { via: 'mask' } });
    expect(ctx.data.overlay).toBeNull();
  });
});

describe('④ 词卡朗读按钮', () => {
  it('读当前单词：speakText(overlay.word)，并标记本次朗读来自单词', () => {
    const ctx = makeThis();
    seedLines(ctx);
    // 2026-11-26 单槽位：词卡内容在 overlay（kind='wordtip'）里
    ctx.data.overlay = { kind: 'wordtip', word: 'engineer', pos: 'n.', def: '工程师', none: false };
    pageConfig.speakTipWord.call(ctx);
    expect(speakTextMock).toHaveBeenCalledWith('engineer');
    expect(ctx._speakingWord).toBe('engineer');
  });

  it('词卡播放态由 onSpeakState 回流：单词朗读点亮 tipPlaying，结束（null）复位', () => {
    const ctx = makeThis();
    seedLines(ctx);
    ctx.data.overlay = { kind: 'wordtip', word: 'engineer', none: false };
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
    ctx.data.overlay = { kind: 'wordtip', word: 'engineer', none: false };
    ctx.data.tipPlaying = true;
    pageConfig.closeTip.call(ctx);
    expect(stopSpeakMock).toHaveBeenCalled();
    expect(ctx.data.overlay).toBeNull();
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
