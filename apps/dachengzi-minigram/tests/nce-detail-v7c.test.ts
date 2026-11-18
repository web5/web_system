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

const speakTextMock = speakText as unknown as jest.Mock;
const stopSpeakMock = stopSpeak as unknown as jest.Mock;
const collectMock = collectGlossary as unknown as jest.Mock;
const isLoggedInMock = isLoggedIn as unknown as jest.Mock;

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
