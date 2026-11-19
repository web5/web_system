/// <reference types="node" />
/**
 * 需求① #8900 · NCE 详情页 V7-C（第 2 次冻结 / D1=C）红灯用例
 *
 * 注：小程序 tsconfig.json 的 types 仅含 wechat-miniprogram/jest（禁改面），
 * 故本测试文件用三斜线指令单独引入 node 类型（fs/path/__dirname），不改任何配置。
 *
 * 覆盖 `10` ④ C1/C2/C3/C4/C5/C6 + `02` V1/V2/V3/V5/V6/V8：
 *   - C1/C2 V7-C 静态断言：顶部不存在连续朗读入口、无整篇/连续朗读调度、
 *     全仓 speakLines/playLines/pauseSpeak/resumeSpeak 仍 0 匹配、tts.ts 零改动、无常驻 .acts ♪/☆
 *   - C3 点句就地展开中文（不触发 speakText）、再点收起、至多 1 句
 *   - C4 V3-A 封闭规则表 R3 逐词命中 / 表外「暂无释义」且保留可点
 *   - C5 平台原生 bindlongpress 长按气泡（含且仅含朗读此句 / 收藏两动作、禁 tap+timer）
 *   - C6 V5 气泡「朗读此句」恰好一次 speakText(line.en)、仅该句高亮、再点同句停止
 *   - V6 收藏沿用 collectGlossary({tag:'nce'}) 契约 + T1 未登录「请先登录」守卫
 *
 * 对应 SOP §7 B 抽样清单：#1 speakText / #2 stopSpeak / #3 onSpeakState（零改动回归）+
 * #8 collectGlossary({tag:'nce'})（不改回归）。测试形态照 home-index.test.ts / features.test.ts。
 *
 * 🔴 生效真源：10-D1方案C冻结与技术方案.md；08 整份作废，不据其「单句播放原语 / 逐句高亮 0..n-1」落码。
 */
import * as fs from 'fs';
import * as path from 'path';

const APP = path.resolve(__dirname, '..');
const src = (rel: string): string => fs.readFileSync(path.join(APP, rel), 'utf8');

/** 递归收集生产源码（排除 tests/ 内的断言字面量、prototype/ 演示稿、node_modules） */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', 'tests', 'prototype'].includes(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|js|wxml|wxss)$/.test(name)) out.push(p);
  }
  return out;
}

// ─────────────────────────── 静态护栏（C1 / C2 / S3 / S4） ───────────────────────────

describe('C1/C2 · V7-C 静态护栏（无连续朗读入口 / 无整篇调度 / tts.ts 零改动）', () => {
  it('C1: detail.wxml 无 #cont-btn / data-cont / 「连续朗读」按钮', () => {
    const wxml = src('pages/nce/detail/detail.wxml');
    expect(wxml).not.toMatch(/cont-btn|data-cont|连续朗读/);
  });

  it('C1/V1/V8: 句子区无常驻 .acts ♪/☆ 元素（现状 11-13 版每句右侧常驻 → 红灯）', () => {
    const wxml = src('pages/nce/detail/detail.wxml');
    expect(wxml).not.toMatch(/class="acts"|class="play"|class="fav"/);
  });

  it('C2/S3: 全仓生产源码仍 0 匹配 speakLines|playLines|pauseSpeak|resumeSpeak|toggleContinuous|stopContinuous', () => {
    const files = walk(APP);
    expect(files.length).toBeGreaterThan(10); // 确实扫到了源码，不是空扫
    for (const f of files) {
      const t = fs.readFileSync(f, 'utf8');
      expect(t).not.toMatch(/speakLines|playLines|pauseSpeak|resumeSpeak|toggleContinuous|stopContinuous/);
    }
  });

  it('C2: detail.ts 无整篇朗读调度（for/await 循环 await speakText(line.en)）', () => {
    const ts = src('pages/nce/detail/detail.ts');
    expect(ts).not.toMatch(/for\s*\([\s\S]{0,200}await\s+speakText/);
    expect(ts).not.toMatch(/readingLineIdx\s*=\s*\w+\s*\+\s*1|seq\[|逐句高亮/);
  });

  it('S4/清单 1/2/3: tts.ts 4 个既有导出签名不变，不新增单句播放原语 / 句边界回调', () => {
    const tts = src('services/tts.ts');
    expect(tts).toMatch(/export async function speakText\(text: string\)/);
    expect(tts).toMatch(/export function stopSpeak\(\)/);
    expect(tts).toMatch(/export function onSpeakState\(cb: SpeakStateListener\)/);
    expect(tts).toMatch(/export interface SpeakState/);
    expect(tts).toMatch(/if \(playingText === t\) \{[\s\S]{0,120}stopSpeak\(\)/); // same-text 停止语义仍在
    expect(tts).not.toMatch(/speakLine\(|句边界|onLineBoundary|speakSentence/);
  });
});

// ─────────────────────────── 行为用例：捕获 Page 配置 ───────────────────────────

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

import { speakText, stopSpeak } from '../services/tts';
import { collectGlossary } from '../services/glossary';
import { isLoggedIn } from '../services/auth';
import { getNceLesson } from '../services/nce';

const speakTextMock = speakText as unknown as jest.Mock;
const stopSpeakMock = stopSpeak as unknown as jest.Mock;
const collectMock = collectGlossary as unknown as jest.Mock;
const isLoggedInMock = isLoggedIn as unknown as jest.Mock;
const getNceLessonMock = getNceLesson as unknown as jest.Mock;

const listeners: Record<string, Array<(p?: unknown) => void>> = {};
const bus = {
  on: jest.fn((e: string, h: (p?: unknown) => void) => { (listeners[e] ||= []).push(h); }),
  off: jest.fn((e: string, h: (p?: unknown) => void) => {
    listeners[e] = (listeners[e] || []).filter((x) => x !== h);
  }),
  emit: jest.fn((e: string) => { (listeners[e] || []).slice().forEach((h) => h()); }),
};

const wxMock = {
  getStorageSync: jest.fn(() => 1),
  setStorageSync: jest.fn(),
  showToast: jest.fn(),
  switchTab: jest.fn(),
  navigateTo: jest.fn(),
  setNavigationBarTitle: jest.fn(),
  pageScrollTo: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
  // D-01/D-02 锚定浮层：SelectorQuery 桩（同步回调），rect 为视口 px、scroll 为滚动偏移 px
  getSystemInfoSync: jest.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
  createSelectorQuery: jest.fn(() => {
    const q: any = {
      select: jest.fn(() => q),
      selectViewport: jest.fn(() => q),
      boundingClientRect: jest.fn(() => q),
      scrollOffset: jest.fn(() => q),
      exec: jest.fn((cb: (res: any[]) => void) => cb([
        { left: 60, top: 200, right: 120, bottom: 230, width: 60, height: 30 },
        { scrollTop: 100, scrollLeft: 0 },
      ])),
    };
    return q;
  }),
};

let pageConfig: any = null;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).getApp = () => ({ eventBus: bus, radiusClassOf: () => '', globalData: {} });
  (globalThis as any).Page = jest.fn((cfg: any) => { pageConfig = cfg; });
  require('../pages/nce/detail/detail');
});

beforeEach(() => {
  jest.clearAllMocks();
  isLoggedInMock.mockReturnValue(true);
  for (const k of Object.keys(listeners)) delete listeners[k];
});

function makeThis(over: Record<string, unknown> = {}): any {
  const ctx: any = {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    _playingIdx: -1,
    _offSpeakState: null,
    _authExpired: false,
    _offAuthExpired: null,
    _offAuthLogged: null,
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    load: jest.fn(),
  };
  // Page 配置里的内部方法需显式挂到 ctx 桩上（onWordTap 依赖 _lookupWord；
  // D-01/D-02 落码后 onWordTap/onLongPress 还依赖 _anchorFloat），否则 this.xxx 不是函数。
  // V21+：toggleLine/onWordTap 共用 _applyLineTap 按档分派，也需挂到桩上；
  // 容错 typeof 判断，保证 TDD 红阶段（实现未落码时方法还不存在）不因 undefined.bind 崩桩。
  for (const k of ['_lookupWord', '_anchorFloat', '_applyLineTap', 'toggleLine']) {
    if (typeof (pageConfig as any)[k] === 'function') {
      ctx[k] = (pageConfig as any)[k].bind(ctx);
    }
  }
  Object.assign(ctx, over);
  return ctx;
}

const mockLines = () => [
  { idx: 0, en: 'I have just received a letter.', cn: '我刚收到一封信。', tokens: [] },
  { idx: 1, en: 'He is an engineer.', cn: '他是个工程师。', tokens: [] },
  { idx: 2, en: 'He has been there for six months.', cn: '他在那儿已经住了六个月了。', tokens: [] },
  { idx: 3, en: 'He is working for a big firm.', cn: '他在一家大公司工作。', tokens: [] },
  { idx: 4, en: 'He has already visited many places.', cn: '他已经去过很多地方。', tokens: [] },
];

describe('C3/V2 · 点句就地展开中文（不触发 speakText）', () => {
  it('点第 3 句展开该句中文、再点收起、点第 4 句仅第 4 句展开（至多 1 句）', () => {
    const ctx = makeThis();
    ctx.data.readMode = 'tap'; // V21+：默认档改为 immersion，逐句展开中文是 tap/精读档语义（断言不变）
    ctx.data.lines = mockLines();
    speakTextMock.mockClear();

    // 现状 toggleLine = 点句即朗读 → 下面两条断言必红
    expect(typeof pageConfig.toggleLine).toBe('function');
    pageConfig.toggleLine.call(ctx, { currentTarget: { dataset: { i: 2 } } });
    expect(speakTextMock).not.toHaveBeenCalled();
    expect(ctx.data.expandedIdx).toBe(2);

    pageConfig.toggleLine.call(ctx, { currentTarget: { dataset: { i: 2 } } });
    expect(ctx.data.expandedIdx).toBe(-1); // 再点收起
    pageConfig.toggleLine.call(ctx, { currentTarget: { dataset: { i: 3 } } });
    expect(ctx.data.expandedIdx).toBe(3);  // 至多 1 句展开
    expect(speakTextMock).not.toHaveBeenCalled();
  });
});

describe('C4/V3-A · 封闭规则表 R3（不得实现期扩充）', () => {
  const words = [
    { word: 'engineer', phonetic: '/ˌendʒɪˈnɪə/', pos: 'n.', def: '工程师', example: 'Tim is an engineer.' },
    { word: 'receive', pos: 'v.', def: '收到' },
    { word: 'month', pos: 'n.', def: '月份' },
    { word: 'firm', pos: 'n.', def: '公司' },
  ];

  it('逐词命中 / 全部未命中一律「暂无释义」且保留可点', () => {
    const ctx = makeThis();
    ctx.data.detail = { id: 4, title: 'L4', words };
    expect(typeof pageConfig._lookupWord).toBe('function'); // 现状无 → 红灯
    const q = (w: string) => pageConfig._lookupWord.call(ctx, w);

    expect(q('engineer').def).toBe('工程师');       // w 直接命中
    expect(q('months').def).toBe('月份');          // R3-2 s$→去 s → month
    expect(q('received').def).toBe('收到');        // R3-3/R3-5 → receive
    expect(q('has').none).toBe(true);               // R3-5 → have，words[] 无 have → 暂无释义
    expect(q('been').none).toBe(true);              // R3-5 → be，words[] 无 be → 暂无释义
    expect(q('just').none).toBe(true);              // 表外词 → 暂无释义
    expect(q('has').word).toBe('has');              // 保留可点（仍返回词条结构）
  });

  it('R3 候选集固定顺序 [w, 词元, 词元+e, w去s, 词元+s]，首个命中即返回', () => {
    const ctx = makeThis();
    ctx.data.detail = { id: 4, title: 'L4', words };
    const q = (w: string) => pageConfig._lookupWord.call(ctx, w);
    // received 词元 receiv → 词元+'e' = receive 命中（词元+'e' 在候选集第 3 位）
    expect(q('received').word).toBe('receive');
    // tip 缺失字段省略（month 无 phonetic/example）
    expect(q('months').phonetic).toBeFalsy();
    expect(q('months').example).toBeFalsy();
  });
});

describe('C5/V4 · 平台原生 bindlongpress 长按气泡', () => {
  it('detail.wxml 用 bindlongpress（与 bindtap 同句节点），禁 tap+timer 模拟', () => {
    const wxml = src('pages/nce/detail/detail.wxml');
    expect(wxml).toMatch(/bindlongpress=/);                       // 现状无 → 红灯
    expect(wxml).not.toMatch(/setTimeout|lpTimer|longPressTimer|lpFired/);
    // 同一句节点同时挂 bindtap 与 bindlongpress（平台互斥分发）
    expect(wxml).toMatch(/bindtap="toggleLine"[\s\S]{0,200}bindlongpress=|bindlongpress=[\s\S]{0,200}bindtap="toggleLine"/);
  });

  it('气泡含且仅含「朗读此句」「收藏」两动作', () => {
    const wxml = src('pages/nce/detail/detail.wxml');
    expect(wxml).toMatch(/朗读此句/);
    expect(wxml).toMatch(/收藏/);
    const acts = (wxml.match(/data-bubble-act="(play|fav)"/g) || []);
    expect(new Set(acts).size).toBe(2);
  });

  it('长按第 5 句弹气泡、不展开中文（长按与 tap 平台互斥）', () => {
    const ctx = makeThis();
    ctx.data.lines = mockLines();
    expect(typeof pageConfig.onLongPress).toBe('function'); // 现状无 → 红灯
    pageConfig.onLongPress.call(ctx, { currentTarget: { dataset: { i: 4 } } });
    expect(ctx.data.bubbleIdx).toBe(4);
    expect(ctx.data.expandedIdx).toBe(-1); // 长按不展开中文
  });
});

describe('C6/V5 · 气泡「朗读此句」= 恰好一次 speakText(line.en)、再点同句停止', () => {
  it('单句朗读仅该句高亮、其他句不高亮、再次点停止且不推进到第 3 句', () => {
    const ctx = makeThis();
    ctx.data.lines = mockLines();
    expect(typeof pageConfig.onBubbleSpeak).toBe('function'); // 现状无 → 红灯
    speakTextMock.mockClear();
    stopSpeakMock.mockClear();

    pageConfig.onBubbleSpeak.call(ctx, { currentTarget: { dataset: { i: 1 } } });
    expect(speakTextMock).toHaveBeenCalledTimes(1);
    expect(speakTextMock).toHaveBeenCalledWith('He is an engineer.');
    expect(ctx.data.readingLineIdx).toBe(1);
    // 无整篇调度：不会连播第 2..末句
    expect(speakTextMock.mock.calls.map((c) => c[0])).toEqual(['He is an engineer.']);

    // 再次点同一句 → 停止、清高亮（same-text → stopSpeak 语义，tts.ts 零改动）
    pageConfig.onBubbleSpeak.call(ctx, { currentTarget: { dataset: { i: 1 } } });
    expect(stopSpeakMock).toHaveBeenCalled();
    expect(speakTextMock).toHaveBeenCalledTimes(1);
    expect(ctx.data.readingLineIdx).toBe(-1);
  });
});

// ───────────────────── 选项 A · V7-C 视觉对齐定位断言（18 §5 / D-01…D-11） ─────────────────────
// 🔴 本轮范围：D-01/D-02/D-03/D-04/D-06/D-07/D-09/D-11；D-05(.head 保留)/D-08/D-10/D-1/D-2 不做。

/**
 * 19:11 口径变更后的锚定判据（正反例共用，防假绿）：
 * - 生词 tip 不再是 absolute 就近锚定浮层，改为移动端底部固定浮层 position:fixed / bottom:0；
 * - 长按气泡仍是 absolute 就近锚定（_anchorFloat / bubblePos 行为不变）。
 * 两者分开判，避免用旧口径把新实现误判为通过。
 */
function isTipBottomSheet(css: string): boolean {
  const tip = (/\.word-tip\s*\{[^}]*\}/.exec(css) || [''])[0];
  return (
    /position:\s*fixed/.test(tip) &&
    !/position:\s*absolute/.test(tip) &&
    /bottom:\s*0/.test(tip) &&
    /left:\s*0/.test(tip) &&
    /right:\s*0/.test(tip)
  );
}
function isBubbleAnchored(css: string): boolean {
  const bubble = (/\.bubble\s*\{[^}]*\}/.exec(css) || [''])[0];
  return /position:\s*absolute/.test(bubble) && !/position:\s*fixed/.test(bubble);
}

describe('19:11 · 生词 tip 底部浮层 / 长按 bubble 就近锚定（口径变更，D-01 部分作废）', () => {
  const wxss = () => src('pages/nce/detail/detail.wxss');
  const wxml = () => src('pages/nce/detail/detail.wxml');
  const ts = () => src('pages/nce/detail/detail.ts');

  it('正例：.word-tip 为底部固定浮层、.bubble 仍 absolute 就近锚定', () => {
    expect(isTipBottomSheet(wxss())).toBe(true);
    expect(isBubbleAnchored(wxss())).toBe(true);
  });

  it('反例（防假绿）：tip 回退成 absolute 就近锚定、或 bubble 回退成 fixed，判据必须失败', () => {
    const css = wxss();
    const tipReverted = css.replace(
      /(\.word-tip\s*\{[^}]*?)position:\s*fixed/,
      '$1position: absolute',
    );
    expect(tipReverted).not.toBe(css);                  // 确认反例确实改到了浮层规则
    expect(isTipBottomSheet(tipReverted)).toBe(false);
    const bubbleReverted = css.replace(
      /(\.bubble\s*\{[^}]*?)position:\s*absolute/,
      '$1position: fixed',
    );
    expect(bubbleReverted).not.toBe(css);
    expect(isBubbleAnchored(bubbleReverted)).toBe(false);
  });

  it('word-tip 无 tipPos 的 left/top 内联样式；bubble 仍以 rpx 绑定锚点坐标', () => {
    const w = wxml();
    expect(w).toMatch(/wx:if="\{\{tipWord\}\}" class="word-tip/);    // 底部浮层按 tipWord 渲染
    expect(w).not.toMatch(/class="word-tip[^"]*"\s+style="left:/);   // 🔴 不再绑 tipPos
    expect(w).toMatch(/class="bubble[^"]*"\s+style="left:\{\{[^}]+\}\}rpx;top:\{\{[^}]+\}\}rpx"/);
  });

  it('detail.ts 用 createSelectorQuery + boundingClientRect + scrollOffset 换算页面坐标（含滚动偏移）', () => {
    const t = ts();
    expect(t).toMatch(/wx\.createSelectorQuery\(\)/);
    expect(t).toMatch(/\.boundingClientRect\(\)/);
    expect(t).toMatch(/\.selectViewport\(\)\.scrollOffset\(\)/);
    expect(t).toMatch(/scrollTop/);
  });

  it('点词：底部浮层显示（tipWord 出）、tipPos 不再驱动 word-tip、closeTip 清空（tap 档 + 生词语义）', () => {
    const ctx = makeThis();
    ctx.data.readMode = 'tap'; // V26：生词 tip 仅 tap 档生效
    ctx.data.lines = mockLines();
    ctx.data.detail = { id: 4, title: 'L4', words: [{ word: 'engineer', def: '工程师' }] };
    expect(typeof pageConfig._anchorFloat).toBe('function');   // 🔴 函数本体保留（长按气泡仍用）
    wxMock.createSelectorQuery.mockClear();
    pageConfig.onWordTap.call(ctx, {
      currentTarget: { dataset: { w: 'engineer', anchor: 'w-0-2', i: 0, hasdef: true } },
    });
    expect(ctx.data.tipWord).toBeTruthy();                     // 底部浮层渲染条件成立
    expect(ctx.data.tipWord.word).toBe('engineer');            // tipWord 内容正确
    expect(ctx.data.tipWord.def).toBe('工程师');
    expect(ctx.data.tipWord.none).toBe(false);
    expect(ctx.data.tipPos).toBeNull();                       // 🔴 tipPos 不再被写入/驱动
    expect(wxMock.createSelectorQuery).not.toHaveBeenCalled();  // 🔴 不为 tip 调 _anchorFloat
    expect(ctx.data.expandedIdx).toBe(-1);                    // 点按生词不展开该句中文
    pageConfig.closeTip.call(ctx);
    expect(ctx.data.tipWord).toBeNull();
    expect(ctx.data.tipPos).toBeNull();
  });

  it('长按：保存锚点坐标到 bubblePos，closeBubble 清空；expandedIdx 语义不变（V4）', () => {
    const ctx = makeThis();
    ctx.data.lines = mockLines();
    pageConfig.onLongPress.call(ctx, {
      currentTarget: { dataset: { i: 4 } },
    });
    expect(ctx.data.bubbleIdx).toBe(4);
    expect(ctx.data.expandedIdx).toBe(-1);
    expect(ctx.data.bubblePos).toEqual({ left: 136, top: 672 });
    pageConfig.closeBubble.call(ctx);
    expect(ctx.data.bubbleIdx).toBe(-1);
    expect(ctx.data.bubblePos).toBeNull();
  });
});

describe('选项 A · D-03 配色反相（tip 白底蓝边 / bubble 深色）', () => {
  const wxss = () => src('pages/nce/detail/detail.wxss');

  it('tip 白底蓝边底部浮层（width:auto）、bubble 深色 #1F2937 紧凑气泡，视觉层级相反', () => {
    const css = wxss();
    const tip = (/\.word-tip\s*\{[^}]*\}/.exec(css) || [''])[0];
    const bubble = (/\.bubble\s*\{[^}]*\}/.exec(css) || [''])[0];
    expect(tip).toMatch(/background:\s*#FFFFFF/);
    expect(tip).toMatch(/border:\s*1rpx solid #DBEAFE/);
    expect(tip).toMatch(/width:\s*auto/);              // 19:11：底部浮层横向铺满，不再收窄卡片
    expect(tip).toMatch(/border-radius:\s*[^;]*rpx/);  // 上方圆角
    expect(Number((/z-index:\s*(\d+)/.exec(tip) || ['', '0'])[1])).toBeGreaterThan(
      Number((/z-index:\s*(\d+)/.exec(bubble) || ['', '0'])[1]),
    );                                                 // z-index 高于气泡
    expect(bubble).toMatch(/background:\s*#1F2937/);
    expect(bubble).toMatch(/width:\s*\d+rpx/);         // 收窄为气泡
    expect(tip).not.toMatch(/background:\s*#1F2937/);
    expect(bubble).not.toMatch(/background:\s*#FFFFFF/);
  });

  it('bubble 动作为浅色文字（深色底），tip 词头为品牌深蓝（白底）', () => {
    const css = wxss();
    expect(css).toMatch(/\.bi\s*\{[^}]*color:\s*#FFFFFF/);
    expect(css).toMatch(/\.wt-w\s*\{[^}]*color:\s*#1D4ED8/);
  });

  it('19:11 ② 展开态/中文块保留浅蓝背景但去掉左侧色条；.sent 仍留 transparent 占位防跳版', () => {
    const css = wxss();
    const exp = (/\.sent\.expanded\s*\{[^}]*\}/.exec(css) || [''])[0];
    const cn = (/\.sent-cn\.show\s*\{[^}]*\}/.exec(css) || [''])[0];
    expect(exp).toMatch(/background:\s*#EFF6FF/);
    expect(exp).not.toMatch(/border-left-color:\s*#[0-9A-Fa-f]{6}/);
    expect(cn).toMatch(/background:\s*#EFF6FF/);
    expect(cn).not.toMatch(/border-left:[^;]*#[0-9A-Fa-f]{6}/);
    expect(css).toMatch(/\.sent\s*\{[^}]*border-left:\s*6rpx solid transparent/); // 占位防跳版
    expect(exp).not.toMatch(/#FAFBFF/);
    expect(cn).not.toMatch(/#F3F4F6/);
  });
});

describe('选项 A · D-06 词点线 / hasDef 标记', () => {
  it('WXML 仅 tk.hasDef 带 has-def，补 .w.hit 命中态；WXSS 有极轻点线', () => {
    const w = src('pages/nce/detail/detail.wxml');
    const css = src('pages/nce/detail/detail.wxss');
    expect(w).toMatch(/class="w \{\{tk\.hasDef \? 'has-def' : ''\}\}/);
    expect(w).toMatch(/'hit'/);
    expect(css).toMatch(/\.w\.has-def\s*\{[^}]*border-bottom:\s*1rpx dotted #3B82F6/);
    expect(css).toMatch(/\.w\.hit\s*\{/);
  });

  it('tokenize 产出 hasDef：词汇表收录词 true、表外词 false，全部 token 带布尔标记', async () => {
    const ctx = makeThis();
    getNceLessonMock.mockResolvedValueOnce({
      id: 4, title: 'L4',
      words: [{ word: 'engineer', def: '工程师' }],
      lines: [{ en: 'He is an engineer just.', cn: '译' }],
    });
    await pageConfig.load.call(ctx);
    const tokens: Array<{ w: string; hasDef: boolean }> = ctx.data.lines[0].tokens;
    expect(tokens.find((t) => t.w === 'engineer')!.hasDef).toBe(true);
    expect(tokens.find((t) => t.w === 'just')!.hasDef).toBe(false);
    expect(tokens.find((t) => t.w === 'he')!.hasDef).toBe(false);
    expect(tokens.every((t) => typeof t.hasDef === 'boolean')).toBe(true);
  });
});

describe('选项 A · D-04/D-09/D-11 信息结构、句序号、可发现性', () => {
  const wxml = () => src('pages/nce/detail/detail.wxml');

  it('句子列表外包 .card + .sect-h「通篇阅读视图 / D1 主定义」+ .hint 长按提示', () => {
    const w = wxml();
    expect(w).toMatch(/class="card"[\s\S]{0,400}class="sentences"/);
    expect(w).toMatch(/class="sect-h"/);
    expect(w).toMatch(/通篇阅读视图/);
    expect(w).toMatch(/D1 主定义 · 英文全文不打断/);
    expect(w).toMatch(/class="hint"/);
    expect(w).toMatch(/长按句子/);
    expect(w).toMatch(/朗读此句/);
    expect(w).toMatch(/收藏/);
  });

  it('每句补 .sn 句序号，句子文本包 .stx；.sn 为小号浅灰', () => {
    const w = wxml();
    const css = src('pages/nce/detail/detail.wxss');
    expect(w).toMatch(/class="sn"[\s\S]{0,120}class="stx"/);
    expect(css).toMatch(/\.sn\s*\{[^}]*font-size:\s*\d+rpx[^}]*color:\s*#[0-9A-Fa-f]{6}/);
    expect(css).toMatch(/\.stx\s*\{/);
  });

  it('边界：D-05 .head 保留；D-08/D-10 未做（仍是 .pager，无 .lesson-nav）；无常驻控件 / 连播入口', () => {
    const w = wxml();
    expect(w).toMatch(/class="head"/);            // D-05 保留
    expect(w).toMatch(/class="pager"/);           // D-10 未做
    expect(w).not.toMatch(/class="lesson-nav"/);  // D-10 未做
    expect(w).not.toMatch(/class="fz"/);          // D-08 未做
    expect(w).not.toMatch(/连续朗读|data-cont|cont-btn/);
  });
});

describe('V6/清单 8 · 收藏沿用 collectGlossary({tag:"nce"}) 契约 + T1 守卫', () => {
  it('已登录：tag 恒 nce、meta 结构不变、源码文本为 line.en', async () => {
    const ctx = makeThis();
    ctx.data.lines = mockLines();
    ctx.data.id = 4;
    ctx.data.book = 'NCE2';
    ctx.data.detail = { id: 4, title: 'L4', words: [] };
    collectMock.mockClear();
    await pageConfig.collectLine.call(ctx, { currentTarget: { dataset: { i: 0 } } });
    expect(collectMock).toHaveBeenCalledWith({
      tag: 'nce',
      enMain: 'I have just received a letter.',
      note: '我刚收到一封信。',
      sourceText: 'Lesson 4 · L4',
      meta: { book: 'NCE2', lessonId: 4, lineIndex: 0 },
    });
  });

  it('T1 从未登录：弹「请先登录」守卫，不弹「登录已过期」、不 switchTab 跳「我的」', async () => {
    isLoggedInMock.mockReturnValue(false);
    const ctx = makeThis();
    ctx.data.lines = mockLines();
    collectMock.mockClear();
    wxMock.switchTab.mockClear();

    await pageConfig.collectLine.call(ctx, { currentTarget: { dataset: { i: 0 } } });
    expect(ctx.data.guestLoginShow).toBe(true);        // 现状 toast+switchTab → 红灯
    expect(ctx.data.showAuthModal).not.toBe(true);     // 不弹 T2 的「登录已过期」
    expect(wxMock.switchTab).not.toHaveBeenCalled();
    expect(collectMock).not.toHaveBeenCalled();
  });
});

// ═══════════════ V21–V28 · 阅读三档与点句热区（用户 16:30/16:45 口径） ═══════════════
// 🔴 覆盖 27 §3.3 分发真源 + 29 §3 判据表；保留上方 C1–C6 / 选项 A / V6 全部既有成功态用例与桩。

/** V21 默认档 + 三档切换（含 onLoad 读回持久化 nce-mode） */
describe('V21 · 默认档 immersion + setReadMode 三档切换写 nce-mode', () => {
  const gs = wxMock.getStorageSync as unknown as jest.Mock;
  afterEach(() => { gs.mockImplementation(() => 1); });   // 还原默认桩，避免串味（clearAllMocks 不清实现）

  it('pageConfig.data.readMode 默认 immersion；makeThis 桩继承默认值', () => {
    expect(pageConfig.data.readMode).toBe('immersion');
    expect(makeThis().data.readMode).toBe('immersion');
    expect(pageConfig.data.cnExpanded).toBe(false);
    expect(pageConfig.data.fullCn).toBe('');
  });

  it('setReadMode 三档切换：readMode 正确 + 只写 nce-mode + 切档清浮层/展开态', () => {
    const ctx = makeThis();
    ctx.data.lines = mockLines();
    ctx.data.expandedIdx = 2;
    ctx.data.tipWord = { word: 'x', none: true };
    expect(typeof pageConfig.setReadMode).toBe('function');
    for (const m of ['bilingual', 'tap', 'immersion', 'bogus']) {
      wxMock.setStorageSync.mockClear();
      pageConfig.setReadMode.call(ctx, { currentTarget: { dataset: { mode: m } } });
      expect(wxMock.setStorageSync).toHaveBeenCalledWith('nce-mode', m === 'bogus' ? 'immersion' : m);
      expect(ctx.data.readMode).toBe(m === 'bogus' ? 'immersion' : m);
    }
    expect(ctx.data.expandedIdx).toBe(-1);
    expect(ctx.data.tipWord).toBeNull();
    expect(ctx.data.tipPos).toBeNull();
    expect(ctx.data.bubbleIdx).toBe(-1);
  });

  it('onLoad 读回持久化的 nce-mode，且非法/缺失值回落默认档 immersion', () => {
    gs.mockImplementation((k: string) => (k === 'nce-mode' ? 'bilingual' : 1));
    const a = makeThis();
    pageConfig.onLoad.call(a, { id: '4', book: 'NCE2' });
    expect(a.data.readMode).toBe('bilingual');
    expect(a.data.fontStep).toBe(1);

    gs.mockImplementation((k: string) => (k === 'nce-mode' ? 'NOT_A_MODE' : 1));
    const b = makeThis();
    pageConfig.onLoad.call(b, { id: '4', book: 'NCE2' });
    expect(b.data.readMode).toBe('immersion');

    gs.mockImplementation(() => 1);   // storage 里是 number 1（非字符串）→ 回落 immersion
    const c = makeThis();
    pageConfig.onLoad.call(c, { id: '4', book: 'NCE2' });
    expect(c.data.readMode).toBe('immersion');
  });
});

/** V22 阅读档 / 字号档正交：切档互不复位、各写各的 storage key */
describe('V22 · 阅读档与字号档正交（切档互不复位）', () => {
  it('setReadMode 不写 nce-font、不复位 fontStep', () => {
    const ctx = makeThis();
    ctx.data.fontStep = 2;
    wxMock.setStorageSync.mockClear();
    pageConfig.setReadMode.call(ctx, { currentTarget: { dataset: { mode: 'bilingual' } } });
    expect(wxMock.setStorageSync).toHaveBeenCalledWith('nce-mode', 'bilingual');
    expect(wxMock.setStorageSync).not.toHaveBeenCalledWith('nce-font', expect.anything());
    expect(ctx.data.fontStep).toBe(2);
    expect(ctx.data.readMode).toBe('bilingual');
  });

  it('setFont 不写 nce-mode、不复位 readMode（取 step=2 避开既有 `step || 1` 的 0-falsy 边界，聚焦正交判据）', () => {
    const ctx = makeThis();
    ctx.data.readMode = 'tap';
    wxMock.setStorageSync.mockClear();
    pageConfig.setFont.call(ctx, { currentTarget: { dataset: { step: 2 } } });
    expect(wxMock.setStorageSync).toHaveBeenCalledWith('nce-font', 2);
    expect(wxMock.setStorageSync).not.toHaveBeenCalledWith('nce-mode', expect.anything());
    expect(ctx.data.readMode).toBe('tap');
    expect(ctx.data.fontStep).toBe(2);
  });

  it('WXML 两组 seg 并列（阅读档 bindtap=setReadMode / 字号档 bindtap=setFont），各自独立', () => {
    const w = src('pages/nce/detail/detail.wxml');
    expect(w).toMatch(/bindtap="setReadMode"/);
    expect(w).toMatch(/bindtap="setFont"/);
    expect(w).toMatch(/data-mode="immersion"/);
    expect(w).toMatch(/data-mode="bilingual"/);
    expect(w).toMatch(/data-mode="tap"/);
    expect(w).toMatch(/mode-\{\{readMode\}\}/);
  });
});

/** V23 tap 档点文字热区（空白 + 非生词文字）展开/收起该句中文 */
describe('V23 · tap 档点句任意位置展开/收起该句中文（catchtap 不吞整行）', () => {
  it('点非生词文字（hasdef=false）→ 展开该句中文、不弹 tip；再点收起；点空白 toggleLine 同语义', () => {
    const ctx = makeThis();
    ctx.data.readMode = 'tap';
    ctx.data.lines = mockLines();
    expect(typeof pageConfig.onWordTap).toBe('function');

    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'have', i: 2, hasdef: false } } });
    expect(ctx.data.expandedIdx).toBe(2);
    expect(ctx.data.tipWord).toBeNull();
    expect(wxMock.createSelectorQuery).not.toHaveBeenCalled();  // 非生词不锚定 tip

    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'been', i: 2, hasdef: false } } });
    expect(ctx.data.expandedIdx).toBe(-1);   // 再点收起

    pageConfig.toggleLine.call(ctx, { currentTarget: { dataset: { i: 3 } } });  // 点空白
    expect(ctx.data.expandedIdx).toBe(3);
    expect(speakTextMock).not.toHaveBeenCalled();
  });

  it('静态：.w 始终 catchtap=onWordTap 且带 data-hasdef（WXML 不按档动态切 bind/catch）', () => {
    const w = src('pages/nce/detail/detail.wxml');
    expect(w).toMatch(/data-hasdef="\{\{tk\.hasDef\}\}"/);
    expect(w).toMatch(/catchtap="onWordTap"/);
    expect(w).not.toMatch(/bindtap="\{\{readMode/);
    expect(w).not.toMatch(/catchtap="\{\{readMode/);
  });
});

/** V24 沉浸点句不展开 + 参考译文折叠区 */
describe('V24 · 沉浸档点句不展开逐句中文 + 文末参考译文折叠区', () => {
  it('immersion 点空白 / 点生词文字都不设 expandedIdx、不弹 tip、不锚定浮层', () => {
    const ctx = makeThis();
    ctx.data.readMode = 'immersion';
    ctx.data.lines = mockLines();
    ctx.data.detail = { id: 4, title: 'L4', words: [] };

    pageConfig.toggleLine.call(ctx, { currentTarget: { dataset: { i: 2 } } });
    expect(ctx.data.expandedIdx).toBe(-1);
    expect(ctx.data.tipWord).toBeNull();

    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'just', i: 0, hasdef: true, anchor: 'w-0-3' } } });
    expect(ctx.data.expandedIdx).toBe(-1);           // 🔴 沉浸点生词也不展开
    expect(ctx.data.tipWord).toBeNull();             // 🔴 沉浸不弹生词 tip
    expect(wxMock.createSelectorQuery).not.toHaveBeenCalled();
  });

  it('toggleCnSection 开合 cnExpanded（默认收起）；load() 拼整篇 fullCn + 空值兜底', async () => {
    const ctx = makeThis();
    expect(ctx.data.cnExpanded).toBe(false);
    expect(typeof pageConfig.toggleCnSection).toBe('function');
    pageConfig.toggleCnSection.call(ctx);
    expect(ctx.data.cnExpanded).toBe(true);
    pageConfig.toggleCnSection.call(ctx);
    expect(ctx.data.cnExpanded).toBe(false);

    getNceLessonMock.mockResolvedValueOnce({
      id: 4, title: 'L4', words: [],
      lines: [{ en: 'A', cn: '第一句。' }, { en: 'B', cn: '第二句。' }, { en: 'C', cn: '' }],
    });
    await pageConfig.load.call(ctx);
    expect(ctx.data.fullCn).toBe('第一句。第二句。');
    expect(ctx.data.fullCn).not.toMatch(/第三|undefined|null/);
    expect(ctx.data.cnExpanded).toBe(false);          // 换课重置折叠区

    getNceLessonMock.mockResolvedValueOnce({
      id: 5, title: 'L5', words: [],
      lines: [{ en: 'A', cn: '' }, { en: 'B', cn: '   ' }],
    });
    await pageConfig.load.call(ctx);
    expect(ctx.data.fullCn).toBe('（本课暂无参考译文）');   // 空值兜底
  });

  it('静态：WXML 有 cn-fold 折叠区 + 双语/tap 中文渲染分支；WXSS 有 mode-immersion 独立排版', () => {
    const w = src('pages/nce/detail/detail.wxml');
    const css = src('pages/nce/detail/detail.wxss');
    expect(w).toMatch(/参考译文 \/ 中文解释/);
    expect(w).toMatch(/bindtap="toggleCnSection"/);
    expect(w).toMatch(/cnExpanded/);
    expect(w).toMatch(/\{\{fullCn\}\}/);
    expect(w).toMatch(/wx:if="\{\{readMode === 'immersion'\}\}" class="cn-fold"/);
    expect(css).toMatch(/\.mode-immersion \.sentences \.sn\s*\{[^}]*display:\s*none/);  // 去 .sn 序号
    expect(css).toMatch(/\.mode-immersion \.sentences \.sent\s*\{[^}]*display:\s*inline/); // 连排成段
    expect(css).toMatch(/\.mode-immersion \.card\s*\{[^}]*border:\s*none/);             // 去卡片边框
    expect(css).toMatch(/\.mode-immersion \.sentences \.en\s*\{[^}]*line-height:\s*2\.15/); // 行距更宽
  });
});

/** V25 双语常显 + 点句不 toggle */
describe('V25 · 双语档全部中文常显、点句不 toggle expandedIdx', () => {
  it('WXML .sent-cn 的 wx:if 含 readMode === bilingual 常显分支（不依赖 expandedIdx）', () => {
    const w = src('pages/nce/detail/detail.wxml');
    expect(w).toMatch(/readMode === 'bilingual' \|\| expandedIdx === si/);
  });

  it('bilingual 点空白 / 点生词都不 toggle expandedIdx、不弹 tip', () => {
    const ctx = makeThis();
    ctx.data.readMode = 'bilingual';
    ctx.data.lines = mockLines();
    ctx.data.detail = { id: 4, title: 'L4', words: [] };
    pageConfig.toggleLine.call(ctx, { currentTarget: { dataset: { i: 1 } } });
    expect(ctx.data.expandedIdx).toBe(-1);
    expect(ctx.data.tipWord).toBeNull();
    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'just', i: 0, hasdef: true, anchor: 'w-0-3' } } });
    expect(ctx.data.expandedIdx).toBe(-1);           // 不 toggle
    expect(ctx.data.tipWord).toBeNull();             // 双语不弹生词 tip
    expect(wxMock.createSelectorQuery).not.toHaveBeenCalled();
  });
});

/** V26′ 19:11 口径变更：生词 tip 仅 tap 档生效，改为底部统一浮层（不再 _anchorFloat 就近锚定） */
describe('V26′ · 生词 tip 仅 tap 档生效，改为底部统一浮层（不再就近锚定）', () => {
  it('tap 档 + hasDef → 底部浮层显示、tipWord 内容正确、不展开该句中文、不为 tip 锚定', () => {
    const ctx = makeThis();
    ctx.data.readMode = 'tap';
    ctx.data.lines = mockLines();
    ctx.data.detail = { id: 4, title: 'L4', words: [] };
    const spy = jest.spyOn(ctx, '_anchorFloat');
    wxMock.createSelectorQuery.mockClear();
    pageConfig.onWordTap.call(ctx, {
      currentTarget: { dataset: { w: 'just', anchor: 'w-0-3', i: 0, hasdef: true } },
    });
    const w = src('pages/nce/detail/detail.wxml');
    expect(w).toMatch(/wx:if="\{\{tipWord\}\}" class="word-tip/);   // 底部浮层渲染
    expect(ctx.data.tipWord).toBeTruthy();
    expect(ctx.data.tipWord.word).toBe('just');                      // 内容正确（表外词 → none）
    expect(ctx.data.tipWord.none).toBe(true);
    expect(ctx.data.expandedIdx).toBe(-1);                           // 点按生词不展开该句中文
    expect(spy).not.toHaveBeenCalled();                              // 🔴 不再为 tip 调 _anchorFloat
    expect(wxMock.createSelectorQuery).not.toHaveBeenCalled();
    expect(ctx.data.tipPos).toBeNull();                              // tipPos 可保留但不得驱动 word-tip
    expect(w).not.toMatch(/class="word-tip[^"]*"\s+style="left:/);
    spy.mockRestore();
  });

  it('再点其它生词 → 替换底部浮层内容（仍不锚定、不展开中文）', () => {
    const ctx = makeThis();
    ctx.data.readMode = 'tap';
    ctx.data.lines = mockLines();
    ctx.data.detail = { id: 4, title: 'L4', words: [{ word: 'engineer', def: '工程师' }, { word: 'firm', def: '公司' }] };
    const spy = jest.spyOn(ctx, '_anchorFloat');
    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'engineer', i: 0, hasdef: true } } });
    expect(ctx.data.tipWord.word).toBe('engineer');
    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'firm', i: 3, hasdef: true } } });
    expect(ctx.data.tipWord.word).toBe('firm');
    expect(ctx.data.tipWord.def).toBe('公司');
    expect(ctx.data.expandedIdx).toBe(-1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('非 tap 档（immersion / bilingual）点同一生词 → 底部浮层不触发、_anchorFloat 不调用', () => {
    for (const m of ['immersion', 'bilingual']) {
      const ctx = makeThis();
      ctx.data.readMode = m;
      ctx.data.lines = mockLines();
      ctx.data.detail = { id: 4, title: 'L4', words: [] };
      const spy = jest.spyOn(ctx, '_anchorFloat');
      wxMock.createSelectorQuery.mockClear();
      pageConfig.onWordTap.call(ctx, {
        currentTarget: { dataset: { w: 'just', anchor: 'w-0-3', i: 0, hasdef: true } },
      });
      expect(ctx.data.tipWord).toBeNull();
      expect(spy).not.toHaveBeenCalled();
      expect(wxMock.createSelectorQuery).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

/** V27 补三档后 V7-C 静态护栏不破（不新增连续朗读入口 / tts.ts 零改动 / 无整篇调度） */
describe('V27 · V7-C 静态护栏不破', () => {
  it('无 cont-btn/data-cont/连续朗读；detail.ts 无整篇调度；tts.ts 4 个既有导出不变', () => {
    const w = src('pages/nce/detail/detail.wxml');
    const ts = src('pages/nce/detail/detail.ts');
    const tts = src('services/tts.ts');
    expect(w).not.toMatch(/cont-btn|data-cont|连续朗读/);
    expect(ts).not.toMatch(/for\s*\([\s\S]{0,200}await\s+speakText/);
    expect(ts).not.toMatch(/readingLineIdx\s*=\s*\w+\s*\+\s*1|seq\[|逐句高亮/);
    expect(tts).toMatch(/export async function speakText\(text: string\)/);
    expect(tts).not.toMatch(/speakLine\(|句边界|onLineBoundary|speakSentence/);
  });
});

/** V28 必然失败反例（防假绿：判据须能抓住实现回退） */
describe('V28 · 必然失败反例（防假绿）', () => {
  it('静态：删掉 data-hasdef 或把 catchtap 改回按档动态切换，V23 判据必须失败', () => {
    const w = src('pages/nce/detail/detail.wxml');
    const judge = (s: string): boolean =>
      /catchtap="onWordTap"/.test(s) &&
      /data-hasdef="\{\{tk\.hasDef\}\}"/.test(s) &&
      !/bindtap="\{\{readMode/.test(s);
    expect(judge(w)).toBe(true);                                                  // 正例
    expect(judge(w.replace(' data-hasdef="{{tk.hasDef}}"', ''))).toBe(false);     // 反例①
    const dynamic = w.replace('catchtap="onWordTap"', 'bindtap="{{readMode === \'tap\' ? \'onWordTap\' : \'toggleLine\'}}"');
    expect(judge(dynamic)).toBe(false);                                            // 反例②
  });

  it('行为：若 _applyLineTap 回退成「无视 readMode 一律 toggle」，沉浸档就会错误展开（判据须失败）', () => {
    const bad = makeThis();
    bad.data.readMode = 'immersion';
    bad.data.lines = mockLines();
    bad._applyLineTap = (i: number) => {                      // 注入错误实现（箭头函数闭包，规避 this 隐式 any）
      bad.setData({ expandedIdx: bad.data.expandedIdx === i ? -1 : i });
    };
    pageConfig.toggleLine.call(bad, { currentTarget: { dataset: { i: 2 } } });
    expect(bad.data.expandedIdx).not.toBe(-1);                // 反例确实「错误地」展开 → 证明判据非恒真

    const good = makeThis();                                  // 正例：真实实现沉浸不展开
    good.data.readMode = 'immersion';
    good.data.lines = mockLines();
    pageConfig.toggleLine.call(good, { currentTarget: { dataset: { i: 2 } } });
    expect(good.data.expandedIdx).toBe(-1);
  });

  it('静态：删掉双语常显分支（改回只靠 expandedIdx），V25 判据必须失败', () => {
    const w = src('pages/nce/detail/detail.wxml');
    expect(w).toMatch(/readMode === 'bilingual' \|\| expandedIdx === si/);
    const reverted = w.replace("readMode === 'bilingual' || expandedIdx === si", 'expandedIdx === si');
    expect(reverted).not.toBe(w);
    expect(reverted).not.toMatch(/readMode === 'bilingual' \|\| expandedIdx === si/);
  });
});

// ═══════════════ 19:11 三处 UI 优化 · 静态判据 + 必然失败反例（防假绿） ═══════════════
// 🔴 判据只读取 wxss / wxml / ts 文本，不引入复杂渲染；每条正例配一条「实现回退」反例，
//    回退成蓝色正文 / 左边框 / 就近锚定时判据须失败。判据号回写另走一轮（本轮不新开 V 号）。
describe('19:11 · 三处 UI 优化静态判据（读源码文本 + 必然失败反例）', () => {
  const wxss = () => src('pages/nce/detail/detail.wxss');
  const wxml = () => src('pages/nce/detail/detail.wxml');
  const ts = () => src('pages/nce/detail/detail.ts');

  /** 判据①：.w.hit 默认色为 #1A1A1F（不含 #1D4ED8） */
  const normalBlack = (css: string): boolean => {
    const hit = (/\.w\.hit\s*\{[^}]*\}/.exec(css) || [''])[0];
    return /color:\s*#1A1A1F/.test(hit) && !/#1D4ED8/.test(hit);
  };
  /** 判据②：.sent-cn.show 无 border-left 色条（.sent.expanded 亦无蓝左边框色），且 .sent 占位边框仍 transparent */
  const noLeftBar = (css: string): boolean => {
    const cn = (/\.sent-cn\.show\s*\{[^}]*\}/.exec(css) || [''])[0];
    const exp = (/\.sent\.expanded\s*\{[^}]*\}/.exec(css) || [''])[0];
    return !/border-left:[^;]*#[0-9A-Fa-f]{6}/.test(cn) &&
      !/border-left-color:\s*#[0-9A-Fa-f]{6}/.test(exp) &&
      /\.sent\s*\{[^}]*border-left:\s*6rpx solid transparent/.test(css);
  };
  /** 判据③：.word-tip 为 position:fixed + bottom:0（不再是 absolute）；WXML 不绑 tipPos；onWordTap 不调 _anchorFloat */
  const onWordTapBody = (t: string): string => {
    const m = /onWordTap\(e: NceTapEvent\)\s*\{([\s\S]*?)\n  \},/.exec(t);
    return m ? m[1] : '';
  };
  const bottomSheet = (css: string, w: string, t: string): boolean => {
    const tip = (/\.word-tip\s*\{[^}]*\}/.exec(css) || [''])[0];
    return /position:\s*fixed/.test(tip) && /bottom:\s*0/.test(tip) &&
      !/position:\s*absolute/.test(tip) &&
      !/class="word-tip[^"]*"\s+style="left:/.test(w) &&
      !/_anchorFloat\s*\(/.test(onWordTapBody(t));
  };

  it('① 正例：.w.hit 默认色 #1A1A1F，整篇英文正文正常黑（不含 #1D4ED8）', () => {
    expect(normalBlack(wxss())).toBe(true);
  });
  it('① 反例：回退成蓝色正文 #1D4ED8 → 判据失败', () => {
    const reverted = wxss().replace(/(\.w\.hit\s*\{[^}]*?color:\s*)#1A1A1F/, '$1#1D4ED8');
    expect(reverted).not.toBe(wxss());
    expect(normalBlack(reverted)).toBe(false);
  });

  it('② 正例：.sent-cn.show 无左侧色条、.sent.expanded 无蓝左边框色、.sent 占位边框仍 transparent', () => {
    expect(noLeftBar(wxss())).toBe(true);
  });
  it('② 反例：把 border-left: 6rpx solid #3B82F6 加回中文块 → 判据失败', () => {
    const reverted = wxss().replace(
      /(\.sent-cn\.show\s*\{[^}]*?)(background:\s*#EFF6FF)/,
      '$1border-left: 6rpx solid #3B82F6; $2',
    );
    expect(reverted).not.toBe(wxss());
    expect(noLeftBar(reverted)).toBe(false);
  });

  it('③ 正例：.word-tip 为 position:fixed + bottom:0 的底部浮层，不再就近锚定', () => {
    expect(bottomSheet(wxss(), wxml(), ts())).toBe(true);
  });
  it('③ 反例：回退成 absolute 就近锚定（并重新绑定 tipPos + 调 _anchorFloat）→ 判据失败', () => {
    const revertedCss = wxss()
      .replace(/(\.word-tip\s*\{[^}]*?)position:\s*fixed/, '$1position: absolute')
      .replace(/(\.word-tip\s*\{[^}]*?)bottom:\s*0/, '$1bottom: auto');
    const revertedWxml = wxml().replace(
      'class="word-tip on"',
      'class="word-tip on" style="left:{{tipPos ? tipPos.left : 0}}rpx;top:{{tipPos ? tipPos.top : 0}}rpx"',
    );
    const revertedTs = ts().replace(
      /(const cur = this\.data\.tipWord;)/,
      "this._anchorFloat(String(ds.anchor || ''), 'tipPos');\n    $1",
    );
    expect(revertedCss).not.toBe(wxss());
    expect(revertedWxml).not.toBe(wxml());
    expect(revertedTs).not.toBe(ts());
    expect(bottomSheet(revertedCss, wxml(), ts())).toBe(false);      // CSS 回退即失败
    expect(bottomSheet(wxss(), revertedWxml, ts())).toBe(false);      // WXML 重新绑 tipPos 即失败
    expect(bottomSheet(wxss(), wxml(), revertedTs)).toBe(false);      // TS 重新就近锚定即失败
  });
});

// ═══════════════ 收藏错误可观测性（collectLine catch(err)，不覆盖服务层真实提示） ═══════════════
describe('收藏 catch · console.error 落日志 + 仅无 HTTP 响应时补兜底 toast', () => {
  it('① reject 带 statusCode 的对象 → 不再弹「收藏失败，请重试」且 console.error 被调用', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeThis();
    ctx.data.lines = mockLines();
    ctx.data.id = 4;
    ctx.data.book = 'NCE2';
    ctx.data.detail = { id: 4, title: 'L4', words: [] };
    collectMock.mockRejectedValueOnce({ statusCode: 400, message: 'property tag should not exist' });
    wxMock.showToast.mockClear();

    await pageConfig.collectLine.call(ctx, { currentTarget: { dataset: { i: 0 } } });
    expect(errSpy).toHaveBeenCalledWith('[nce/collect]', expect.objectContaining({ statusCode: 400 }));
    expect(wxMock.showToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: '收藏失败，请重试' }));
    expect(wxMock.showToast).not.toHaveBeenCalled();   // 有 HTTP 响应 → 保留 utils/request.ts 已弹的真实提示，不补兜底
    errSpy.mockRestore();
  });

  it('② reject 一个 NOT_LOGGED_IN Error（无 HTTP 响应）→ 兜底 toast「网络异常，请重试」出现', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeThis();
    ctx.data.lines = mockLines();
    ctx.data.id = 4;
    ctx.data.book = 'NCE2';
    ctx.data.detail = { id: 4, title: 'L4', words: [] };
    collectMock.mockRejectedValueOnce(new Error('NOT_LOGGED_IN'));
    wxMock.showToast.mockClear();

    await pageConfig.collectLine.call(ctx, { currentTarget: { dataset: { i: 0 } } });
    expect(errSpy).toHaveBeenCalledWith('[nce/collect]', expect.any(Error));
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '网络异常，请重试', icon: 'none' });
    errSpy.mockRestore();
  });
});
