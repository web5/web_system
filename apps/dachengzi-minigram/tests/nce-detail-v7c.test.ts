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
  for (const k of ['_lookupWord', '_anchorFloat']) {
    ctx[k] = (pageConfig as any)[k].bind(ctx);
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

/** 锚定判据（正反例共用，防假绿）：两个浮层都必须 position:absolute 且不得 fixed 全宽底条 */
function isAnchored(css: string): boolean {
  const tip = (/\.word-tip\s*\{[^}]*\}/.exec(css) || [''])[0];
  const bubble = (/\.bubble\s*\{[^}]*\}/.exec(css) || [''])[0];
  return (
    /position:\s*absolute/.test(tip) && /position:\s*absolute/.test(bubble) &&
    !/position:\s*fixed/.test(tip) && !/position:\s*fixed/.test(bubble) &&
    !/left:\s*30rpx;\s*right:\s*30rpx;\s*bottom:\s*40rpx/.test(tip) &&
    !/left:\s*30rpx;\s*right:\s*30rpx;\s*bottom:\s*40rpx/.test(bubble)
  );
}

describe('选项 A · D-01/D-02 锚定浮层（最高优先）', () => {
  const wxss = () => src('pages/nce/detail/detail.wxss');
  const wxml = () => src('pages/nce/detail/detail.wxml');
  const ts = () => src('pages/nce/detail/detail.ts');

  it('正例：.word-tip/.bubble 由 fixed 底部全宽条改为 absolute 锚定浮层', () => {
    expect(isAnchored(wxss())).toBe(true);
  });

  it('反例（防假绿）：把锚定改回 position:fixed 时同一判据必须失败', () => {
    const reverted = wxss().replace(
      /((?:\.word-tip|\.bubble)\s*\{[^}]*?)position:\s*absolute/g,
      '$1position: fixed',
    );
    expect(reverted).not.toBe(wxss());          // 确认反例确实改到了浮层规则
    expect(isAnchored(reverted)).toBe(false);   // 断言必须失败，否则是假绿
  });

  it('浮层有坐标 style：left/top 以 rpx 绑定锚点坐标（两个浮层各一处）', () => {
    const w = wxml();
    expect(w).toMatch(/class="word-tip[^"]*"\s+style="left:\{\{[^}]+\}\}rpx;top:\{\{[^}]+\}\}rpx"/);
    expect(w).toMatch(/class="bubble[^"]*"\s+style="left:\{\{[^}]+\}\}rpx;top:\{\{[^}]+\}\}rpx"/);
  });

  it('detail.ts 用 createSelectorQuery + boundingClientRect + scrollOffset 换算页面坐标（含滚动偏移）', () => {
    const t = ts();
    expect(t).toMatch(/wx\.createSelectorQuery\(\)/);
    expect(t).toMatch(/\.boundingClientRect\(\)/);
    expect(t).toMatch(/\.selectViewport\(\)\.scrollOffset\(\)/);
    expect(t).toMatch(/scrollTop/);
  });

  it('点词：保存锚点坐标到 tipPos（含滚动偏移换算成 rpx），closeTip 清空', () => {
    const ctx = makeThis();
    ctx.data.detail = { id: 4, title: 'L4', words: [] };
    expect(typeof pageConfig._anchorFloat).toBe('function');
    pageConfig.onWordTap.call(ctx, {
      currentTarget: { dataset: { w: 'just', anchor: 'w-0-3' } },
    });
    expect(ctx.data.tipWord).toBeTruthy();
    // 桩：rect.left=60 / rect.bottom=230 / scrollTop=100 / windowWidth=375 → k=2
    // left=(60+8)*2=136；top=(230+100+6)*2=672（含滚动偏移，不含则仅 472）
    expect(ctx.data.tipPos).toEqual({ left: 136, top: 672 });
    expect(wxMock.createSelectorQuery).toHaveBeenCalled();
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

  it('tip 白底蓝边窄卡片、bubble 深色 #1F2937 紧凑气泡，视觉层级相反', () => {
    const css = wxss();
    const tip = (/\.word-tip\s*\{[^}]*\}/.exec(css) || [''])[0];
    const bubble = (/\.bubble\s*\{[^}]*\}/.exec(css) || [''])[0];
    expect(tip).toMatch(/background:\s*#FFFFFF/);
    expect(tip).toMatch(/border:\s*1rpx solid #DBEAFE/);
    expect(tip).toMatch(/width:\s*\d+rpx/);            // 收窄为卡片
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

  it('D-07 展开态蓝系：.sent.expanded/.sent-cn.show 浅蓝 + 蓝左边框，不再灰系', () => {
    const css = wxss();
    const exp = (/\.sent\.expanded\s*\{[^}]*\}/.exec(css) || [''])[0];
    const cn = (/\.sent-cn\.show\s*\{[^}]*\}/.exec(css) || [''])[0];
    expect(exp).toMatch(/background:\s*#EFF6FF/);
    expect(exp).toMatch(/border-left-color:\s*#3B82F6/);
    expect(cn).toMatch(/background:\s*#EFF6FF/);
    expect(cn).toMatch(/border-left:[^;]*#3B82F6/);
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
