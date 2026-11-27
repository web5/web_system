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
import { actionsOf } from '../utils/line-actions';

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
  // V21+：toggleLine/onWordTap 共用 _applyLineTap 按档分派，也需挂到桩上；
  // 容错 typeof 判断，保证 TDD 红阶段（实现未落码时方法还不存在）不因 undefined.bind 崩桩。
  // 2026-11-26 变体 B：`_anchorFloat` 已随锚点链路整块删除，从桩表移除（不再有该键）。
  // 单槽位重构后 onWordTap / onLongPress 改调 openOverlay / closeOverlay / closeTip，
  // 这些是页面内部方法，同样要挂到桩上（否则 `this.openOverlay is not a function`）。
  // 2026-11-27 D1：收藏 payload 抽到 `_collectLine` / `_collectWord`（词卡与抽屉共用），
  // 词卡三态走 `_tipCollectPatch` / `_setTipCollect` / `_clearTipCollectTimer`，桩必须同步
  // （桩是手搓对象，只挂列表里的方法 —— 漏一个就是 `not a function`）。
  for (const k of [
    '_lookupWord', '_applyLineTap', 'toggleLine', 'openOverlay', 'closeOverlay', 'closeTip',
    '_collectLine', '_collectWord', '_tipCollectPatch', '_setTipCollect', '_clearTipCollectTimer',
    // 2026-11-27 D7 双向同步：抽屉已收藏 key 集合的两个算口（桩必须与调用面同步）
    '_drawerCollectedKeys', '_withCollectedKey',
  ]) {
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

describe('C5/V4 · 平台原生 bindlongpress 长按 → 底部动作抽屉（变体 B）', () => {
  it('detail.wxml 用 bindlongpress（与 bindtap 同句节点），禁 tap+timer 模拟', () => {
    const wxml = src('pages/nce/detail/detail.wxml');
    expect(wxml).toMatch(/bindlongpress=/);                       // 现状无 → 红灯
    expect(wxml).not.toMatch(/setTimeout|lpTimer|longPressTimer|lpFired/);
    // 同一句节点同时挂 bindtap 与 bindlongpress（平台互斥分发）
    expect(wxml).toMatch(/bindtap="toggleLine"[\s\S]{0,200}bindlongpress=|bindlongpress=[\s\S]{0,200}bindtap="toggleLine"/);
  });

  /**
   * 2026-11-26 变体 B 改写：动作集合不再是 wxml 里手写的两个 `.bi` 节点，而是
   * `utils/line-actions.actionsOf()` 的产物 + 组件渲染。判据随之改成：
   *   ① 句档恰好 2 项、且就是四项的前两项（AC-B.6 / V-B6「两项与四项第一行格位一致」）；
   *   ② detail.wxml 挂着抽屉组件的 5 个 bind（一个都不能少，否则某个动作会静默失效）。
   * 🔴 没放松：仍要求「句档只有 2 项、不多不少、顺序固定」。
   */
  it('句档恰好「朗读此句 / 收藏此句」两项（= 四项前两项），且抽屉 3 个事件全部接线', () => {
    const acts = actionsOf('line').map((a) => a.label);
    expect(acts).toEqual(['朗读此句', '收藏此句']);
    expect(actionsOf('line')).toHaveLength(2);
    expect(actionsOf('word').slice(0, 2).map((a) => a.label)).toEqual(acts); // 换档不挪位
    const wxml = src('pages/nce/detail/detail.wxml');
    expect(wxml).toMatch(/<action-drawer/);
    // 2026-11-26 变体 C（用户拍板）：朗读下沉到组件 → speak-line / speak-word 两个 bind 已删除，
    // 只剩收藏两项 + close。反向断言：不许把朗读绑定加回来（会与组件本地朗读重复一次）。
    for (const evt of ['collect-line', 'collect-word', 'close']) {
      expect(wxml).toContain(`bind:${evt}="`);
    }
    expect(wxml).not.toContain('bind:speak-line');
    expect(wxml).not.toContain('bind:speak-word');
  });

  it('长按第 5 句 → 抽屉 scope=line、lineIndex=4，不展开中文（长按与 tap 平台互斥）', () => {
    const ctx = makeThis();
    ctx.data.lines = mockLines();
    expect(typeof pageConfig.onLongPress).toBe('function'); // 现状无 → 红灯
    pageConfig.onLongPress.call(ctx, { currentTarget: { dataset: { i: 4 } } });
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'line', lineIndex: 4 });
    expect(ctx.data.overlay.lineText).toBe('He has already visited many places.');
    expect(ctx.data.expandedIdx).toBe(-1); // 长按不展开中文
  });
});

describe('C6/V5（变体 C 改写）· 抽屉朗读已下沉组件：页面不得再有朗读 handler', () => {
  /**
   * 🔴 2026-11-26 变体 C（用户拍板）：朗读在抽屉内直接调 `services/tts.speakText`，抽屉不关、
   * 按钮自切 ▶/■ —— 页面侧 `onDrawerSpeakLine / onDrawerSpeakWord` **已删除**。
   *
   * 原用例（「点一次 → speakText 恰好一次 + 抽屉收起 + 不手写 stopSpeak 分支」）所测的那条链路
   * 整体不存在了，判据对象消失 → 反转成「不得回潮」的断言（不是放宽）：
   *   · 页面若还留一份朗读 handler，会与组件本地朗读**重复朗读一次**；
   *   · 页面若再手写 stopSpeak 分支，会与抽屉里的 ■ 抢停止权。
   * 行为侧（speakText 一次 / 播放态切换 / 再点即停 / 不 emit / 不关抽屉）由
   * `tests/action-drawer.test.ts` 的「变体 C · 朗读下沉」组覆盖。
   */
  it('页面不得再有 onDrawerSpeakLine / onDrawerSpeakWord，wxml 也不许再有 speak 绑定', () => {
    expect((pageConfig as any).onDrawerSpeakLine).toBeUndefined();
    expect((pageConfig as any).onDrawerSpeakWord).toBeUndefined();
    const wxml = src('pages/nce/detail/detail.wxml');
    expect(wxml).not.toContain('bind:speak-line');
    expect(wxml).not.toContain('bind:speak-word');
  });

  it('反例（防删过头）：收藏两项 + close 三个 handler 必须仍在', () => {
    for (const fn of ['onDrawerCollectLine', 'onDrawerCollectWord', 'onDrawerClose']) {
      expect(typeof (pageConfig as any)[fn]).toBe('function');
    }
  });
});

// ───────────────────── 选项 A · V7-C 视觉对齐定位断言（18 §5 / D-01…D-11） ─────────────────────
// 🔴 本轮范围：D-01/D-02/D-03/D-04/D-06/D-07/D-09/D-11；D-05(.head 保留)/D-08/D-10/D-1/D-2 不做。

/**
 * 2026-11-26 变体 B 改写（原 D-01/D-02「长按气泡就近锚定」判据）：
 * - 生词 tip 仍是 `position:fixed / bottom:0` 的底部浮层（19:11 口径不变）；
 * - 长按气泡（`.bubble`）**已整体退役**，锚点链路（`_anchorFloat` / `boundingClientRect` /
 *   `scrollOffset` / `750/windowWidth` / `clamp(750-340)`）**从架构中删除**。
 *   → 对应用例**反转为「不得出现」**的静态断言（不是放宽，是判据对象已不存在）。
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

describe('19:11+ / B 变体 · 生词 tip 底部浮层保留、长按锚点链路删除', () => {
  const wxss = () => src('pages/nce/detail/detail.wxss');
  const wxml = () => src('pages/nce/detail/detail.wxml');
  const ts = () => src('pages/nce/detail/detail.ts');

  it('正例：.word-tip 仍为底部固定浮层；锚点气泡 .bubble 已删除', () => {
    expect(isTipBottomSheet(wxss())).toBe(true);
    expect(wxss()).not.toMatch(/\.bubble\s*\{/);
    expect(wxss()).not.toMatch(/\.word-bubble\s*\{/);
  });

  it('反例（防假绿）：tip 回退成 absolute 就近锚定 → 判据必须失败', () => {
    const css = wxss();
    const tipReverted = css.replace(
      /(\.word-tip\s*\{[^}]*?)position:\s*fixed/,
      '$1position: absolute',
    );
    expect(tipReverted).not.toBe(css);                  // 确认反例确实改到了浮层规则
    expect(isTipBottomSheet(tipReverted)).toBe(false);
  });

  it('detail.wxml 无任何 left:{{…}}rpx / top:{{…}}rpx 坐标绑定（抽屉不测坐标，V-B2）', () => {
    const w = wxml();
    expect(w).toMatch(/wx:if="\{\{overlay && overlay\.kind === 'wordtip'\}\}" class="word-tip/);
    expect(w).not.toMatch(/class="word-tip[^"]*"\s+style="left:/);
    expect(w).not.toMatch(/left:\{\{[^}]+\}\}rpx/);
    expect(w).not.toMatch(/top:\{\{[^}]+\}\}rpx/);
  });

  it('detail.ts 不得再用锚点换算链路（selector 查询 / 视口滚动偏移 / px→rpx）', () => {
    // 只看代码，不看注释：本文件的变更留痕注释里会**提到**被删除的标识符（不静默删除原则），
    // 那些提及不是实现。断言对象是「代码里还有没有这条链路」。
    const t = ts()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(t).not.toMatch(/createSelectorQuery/);
    expect(t).not.toMatch(/boundingClientRect/);
    expect(t).not.toMatch(/scrollOffset/);
    expect(t).not.toMatch(/_anchorFloat/);
    expect(t).not.toMatch(/750 \/ /);          // 不存在 px→rpx 换算
    expect(t).not.toMatch(/750 - 340/);        // clamp 常量已删
    expect(t).not.toMatch(/touches/);          // 长按不再读原生触点
  });

  it('点词：底部浮层显示（overlay.kind=wordtip）、不展开该句中文、不测任何坐标', () => {
    const ctx = makeThis();
    ctx.data.readMode = 'tap'; // V26：生词 tip 仅 tap 档生效
    ctx.data.lines = mockLines();
    ctx.data.detail = { id: 4, title: 'L4', words: [{ word: 'engineer', def: '工程师' }] };
    wxMock.createSelectorQuery.mockClear();
    pageConfig.onWordTap.call(ctx, {
      currentTarget: { dataset: { w: 'engineer', anchor: 'w-0-2', i: 0, hasdef: true } },
    });
    expect(ctx.data.overlay.kind).toBe('wordtip');            // 底部浮层渲染条件成立
    expect(ctx.data.overlay.word).toBe('engineer');            // 内容正确
    expect(ctx.data.overlay.def).toBe('工程师');
    expect(ctx.data.overlay.none).toBe(false);
    expect(wxMock.createSelectorQuery).not.toHaveBeenCalled();  // 🔴 不测任何坐标
    expect(ctx.data.expandedIdx).toBe(-1);                    // 点按生词不展开该句中文
    pageConfig.closeTip.call(ctx);
    expect(ctx.data.overlay).toBeNull();
  });

  it('长按：写单槽位 overlay（无 bubblePos 字段）；onDrawerClose 清空；expandedIdx 语义不变（V4）', () => {
    const ctx = makeThis();
    ctx.data.lines = mockLines();
    pageConfig.onLongPress.call(ctx, {
      currentTarget: { dataset: { i: 4 } },
    });
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'line', lineIndex: 4 });
    expect(ctx.data.expandedIdx).toBe(-1);
    // 旧锚点字段已从 data 中消失（不是值为 null，而是根本不存在）
    expect('bubblePos' in ctx.data).toBe(false);
    expect('bubbleIdx' in ctx.data).toBe(false);
    expect('tipPos' in ctx.data).toBe(false);
    pageConfig.onDrawerClose.call(ctx);
    expect(ctx.data.overlay).toBeNull();
  });
});

/**
 * 2026-11-26 变体 B 改写（原 D-03「tip 白底蓝边 / bubble 深色反相」）：
 * `.bubble` / `.bi` / `.word-bubble` 三个规则块随长按气泡整体删除 → 对它们的断言**整条删除**
 * （不是放宽：被断对象已不存在）。保留的判据是「词卡仍为白底蓝边底部浮层、词头仍品牌深蓝」。
 * 抽屉的配色（不透明白底 + 遮罩 .34，D6）由 `components/action-drawer/index.wxss` 承担，
 * 其静态判据落在 tests/action-drawer.test.ts。
 */
describe('选项 A · D-03 配色（词卡白底蓝边底部浮层；气泡已退役）', () => {
  const wxss = () => src('pages/nce/detail/detail.wxss');

  it('tip 白底蓝边底部浮层（width:auto）；气泡规则块已删，本页不再有深色浮层', () => {
    const css = wxss();
    const tip = (/\.word-tip\s*\{[^}]*\}/.exec(css) || [''])[0];
    expect(tip).toMatch(/background:\s*#FFFFFF/);
    expect(tip).toMatch(/border:\s*1rpx solid #DBEAFE/);
    expect(tip).toMatch(/width:\s*auto/);              // 19:11：底部浮层横向铺满，不再收窄卡片
    expect(tip).toMatch(/border-radius:\s*[^;]*rpx/);  // 上方圆角
    expect(css).not.toMatch(/\.bubble\s*\{/);          // 🔴 长按气泡规则块已删
    expect(css).not.toMatch(/\.word-bubble\s*\{/);
  });

  it('tip 词头为品牌深蓝（白底）；.bi 浅色文字规则已随气泡删除', () => {
    const css = wxss();
    expect(css).toMatch(/\.wt-w\s*\{[^}]*color:\s*#1D4ED8/);
    expect(css).not.toMatch(/\.bi\s*\{/);
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

describe('选项 A · D-06 词点线 / hasDef 标记（R-READ-04 后：点线只控样式，不控渲染）', () => {
  it('WXML 所有英文词都是节点（条件只判 tk.w），has-def 点线由插值控制；WXSS 词级高亮只作用于 .has-def', () => {
    const w = src('pages/nce/detail/detail.wxml');
    const css = src('pages/nce/detail/detail.wxss');
    // 2026-11-26 R-READ-04（AC-B.28 / V-B17）：渲染条件不再含 hasDef，
    // 否则非生词没有节点 → 「长按任意英文单词」物理上做不到。
    expect(w).toMatch(/<text wx:if="\{\{tk\.w\}\}" class="w \{\{tk\.hasDef \? 'has-def' : ''\}\}(?:[^"]*)?"/);
    expect(w).not.toMatch(/tk\.w && tk\.hasDef/);
    expect(css).toMatch(/\.w\.has-def\s*\{[^}]*border-bottom:\s*1rpx dotted #3B82F6/);
    // 🔴 非生词不高亮：全局 .w:active 与废弃的 .w.hit 都必须不存在
    expect(css).not.toMatch(/\.w:active\s*\{/);
    expect(css).not.toMatch(/\.w\.hit\s*\{/);
    expect(w).not.toMatch(/'hit'/);
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
    // 2026-11-26 变体 B：提示文案随「长按对象 = 任意英文单词」更新（E4 的补偿手段之一），
    // 动作文案（朗读此句 / 收藏此句）已搬进组件，故此处只断文案口径不断节点。
    expect(w).toMatch(/长按任意单词/);
    expect(w).toMatch(/朗读\/收藏单词/);
    expect(w).toMatch(/朗读\/收藏整句/);
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
    // 2026-11-26 变体 B：入口从 `collectLine(e.dataset.i)` 改为抽屉事件
    // `onDrawerCollectLine({detail:{lineIndex,text}})`；payload 契约一字未改。
    await pageConfig.onDrawerCollectLine.call(ctx, {
      detail: { lineIndex: 0, text: 'I have just received a letter.' },
    });
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

    await pageConfig.onDrawerCollectLine.call(ctx, {
      detail: { lineIndex: 0, text: 'I have just received a letter.' },
    });
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
    ctx.data.overlay = { kind: 'wordtip', word: 'x', none: true };
    expect(typeof pageConfig.setReadMode).toBe('function');
    for (const m of ['bilingual', 'tap', 'immersion', 'bogus']) {
      wxMock.setStorageSync.mockClear();
      pageConfig.setReadMode.call(ctx, { currentTarget: { dataset: { mode: m } } });
      expect(wxMock.setStorageSync).toHaveBeenCalledWith('nce-mode', m === 'bogus' ? 'immersion' : m);
      expect(ctx.data.readMode).toBe(m === 'bogus' ? 'immersion' : m);
    }
    expect(ctx.data.expandedIdx).toBe(-1);
    // 2026-11-26 变体 B：五个旧浮层字段 → 单槽位 overlay null
    expect(ctx.data.overlay).toBeNull();
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
    expect(ctx.data.overlay).toBeNull();
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
  it('immersion 点空白不展开；点生词仍可查词（2026-11-26 全档可查词，但不锚定浮层）', () => {
    const ctx = makeThis();
    ctx.data.readMode = 'immersion';
    ctx.data.lines = mockLines();
    ctx.data.detail = { id: 4, title: 'L4', words: [] };

    pageConfig.toggleLine.call(ctx, { currentTarget: { dataset: { i: 2 } } });
    expect(ctx.data.expandedIdx).toBe(-1);
    expect(ctx.data.overlay).toBeNull();

    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'just', i: 0, hasdef: true, anchor: 'w-0-3' } } });
    expect(ctx.data.expandedIdx).toBe(-1);           // 🔴 沉浸点生词不展开该句中文
    expect(ctx.data.overlay).toBeTruthy();           // 🔴 但仍出底部词卡（不再限 tap 档）
    expect(ctx.data.overlay.kind).toBe('wordtip');
    expect(wxMock.createSelectorQuery).not.toHaveBeenCalled();
  });

  it('toggleCnSection 开合 cnExpanded（默认收起）；load() 拼整篇 fullCn（按句换行）+ 空值兜底', async () => {
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
    // 2026-11-26 ①：译文与英文一样一句一行（pre-wrap 生效），不再挤成一段
    expect(ctx.data.fullCn).toBe('第一句。\n第二句。');
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
    // 2026-11-26 ①：沉浸档逐句换行（display:block），不再是 inline 连排
    expect(css).toMatch(/\.mode-immersion \.sentences \.sent\s*\{[^}]*display:\s*block/);
    expect(css).not.toMatch(/\.mode-immersion \.sentences \.sent\s*\{[^}]*display:\s*inline/);
    expect(css).toMatch(/\.mode-immersion \.sentences \.en\s*\{[^}]*display:\s*block/);
    expect(css).toMatch(/\.cn-fold-c\s*\{[^}]*white-space:\s*pre-wrap/);              // 译文按句换行
    expect(css).toMatch(/\.mode-immersion \.card\s*\{[^}]*border:\s*none/);             // 去卡片边框
    expect(css).toMatch(/\.mode-immersion \.sentences \.en\s*\{[^}]*line-height:\s*2\.05/); // 行距
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
    expect(ctx.data.overlay).toBeNull();
    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'just', i: 0, hasdef: true, anchor: 'w-0-3' } } });
    expect(ctx.data.expandedIdx).toBe(-1);           // 不 toggle
    expect(ctx.data.overlay).toBeTruthy();           // 2026-11-26：双语档也可点生词查释义
    expect(ctx.data.overlay.kind).toBe('wordtip');
    expect(wxMock.createSelectorQuery).not.toHaveBeenCalled();
  });
});

/**
 * V26′（19:11 口径 + 2026-11-26 变体 B）
 * 改写说明：原用例用 `jest.spyOn(ctx, '_anchorFloat')` 断「不为 tip 锚定」。
 * 变体 B 已把 `_anchorFloat` 整块删除 → spyOn 不存在的属性会**直接抛错**（不是断言失败），
 * 故改为「静态断言该方法不存在」+「selectorQuery 零调用」，判据强度不降：
 *   - 原来断「方法在但没被调」；
 *   - 现在断「方法根本不存在」（更强的保证），且仍断 selectorQuery 未被调用。
 */
describe('V26′ · 生词 tip 底部浮层（不再就近锚定，锚点方法已删除）', () => {
  it('tap 档 + hasDef → 底部浮层显示、内容正确、不展开该句中文、不测坐标', () => {
    const ctx = makeThis();
    ctx.data.readMode = 'tap';
    ctx.data.lines = mockLines();
    ctx.data.detail = { id: 4, title: 'L4', words: [] };
    expect(pageConfig._anchorFloat).toBeUndefined();   // 🔴 方法本体已删
    wxMock.createSelectorQuery.mockClear();
    pageConfig.onWordTap.call(ctx, {
      currentTarget: { dataset: { w: 'just', anchor: 'w-0-3', i: 0, hasdef: true } },
    });
    const w = src('pages/nce/detail/detail.wxml');
    expect(w).toMatch(/wx:if="\{\{overlay && overlay\.kind === 'wordtip'\}\}" class="word-tip/); // 底部浮层渲染
    expect(ctx.data.overlay).toBeTruthy();
    expect(ctx.data.overlay.word).toBe('just');                      // 内容正确（表外词 → none）
    expect(ctx.data.overlay.none).toBe(true);
    expect(ctx.data.expandedIdx).toBe(-1);                           // 点按生词不展开该句中文
    expect(wxMock.createSelectorQuery).not.toHaveBeenCalled();
    expect(w).not.toMatch(/class="word-tip[^"]*"\s+style="left:/);
  });

  it('再点其它生词 → 替换底部浮层内容（仍不锚定、不展开中文）', () => {
    const ctx = makeThis();
    ctx.data.readMode = 'tap';
    ctx.data.lines = mockLines();
    ctx.data.detail = { id: 4, title: 'L4', words: [{ word: 'engineer', def: '工程师' }, { word: 'firm', def: '公司' }] };
    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'engineer', i: 0, hasdef: true } } });
    expect(ctx.data.overlay.word).toBe('engineer');
    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'firm', i: 3, hasdef: true } } });
    expect(ctx.data.overlay.word).toBe('firm');
    expect(ctx.data.overlay.def).toBe('公司');
    expect(ctx.data.expandedIdx).toBe(-1);
    expect(wxMock.createSelectorQuery).not.toHaveBeenCalled();
  });

  it('非 tap 档（immersion / bilingual）点同一生词 → 也出底部词卡；不测任何坐标', () => {
    for (const m of ['immersion', 'bilingual']) {
      const ctx = makeThis();
      ctx.data.readMode = m;
      ctx.data.lines = mockLines();
      ctx.data.detail = { id: 4, title: 'L4', words: [] };
      wxMock.createSelectorQuery.mockClear();
      pageConfig.onWordTap.call(ctx, {
        currentTarget: { dataset: { w: 'just', anchor: 'w-0-3', i: 0, hasdef: true } },
      });
      expect(ctx.data.overlay).toBeTruthy();          // 2026-11-26：全档可查词
      expect(ctx.data.overlay.kind).toBe('wordtip');  // 不做就近锚定
      expect(wxMock.createSelectorQuery).not.toHaveBeenCalled();
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

  /** 判据①（2026-11-26 ② 口径）：词级按下高亮只作用于 .has-def；
   *  全局 .w:active 与废弃的 .w.hit 必须不存在 —— 否则点非生词也会变色/高亮。 */
  const onlyWordHit = (css: string): boolean =>
    !/\.w:active\s*\{/.test(css) &&
    !/\.w\.hit\s*\{/.test(css) &&
    /\.w\.has-def:active\s*\{[^}]*color:\s*#3B82F6/.test(css);
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

  it('① 正例：词级高亮只给 .has-def（点非生词无任何高亮）', () => {
    expect(onlyWordHit(wxss())).toBe(true);
  });
  it('① 反例：把全局 .w:active 加回去 → 判据失败', () => {
    const reverted = wxss() + '\n.w:active { color: #3B82F6; }\n';
    expect(reverted).not.toBe(wxss());
    expect(onlyWordHit(reverted)).toBe(false);
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
  it('③ 反例：回退成 absolute 就近锚定（并重新绑定坐标 + 调 _anchorFloat）→ 判据失败', () => {
    const revertedCss = wxss()
      .replace(/(\.word-tip\s*\{[^}]*?)position:\s*fixed/, '$1position: absolute')
      .replace(/(\.word-tip\s*\{[^}]*?)bottom:\s*0/, '$1bottom: auto');
    const revertedWxml = wxml().replace(
      'class="word-tip on"',
      'class="word-tip on" style="left:{{overlay.left}}rpx;top:{{overlay.top}}rpx"',
    );
    // 2026-11-26 变体 B：`_anchorFloat` 已删除，注入点改到 onWordTap 的查词入口
    // （原注入锚点 `const cur = this.data.tipWord;` 已随单槽位重构消失）
    const revertedTs = ts().replace(
      /(const tip = this\._lookupWord\(w\);)/,
      "this._anchorFloat('x', 'tipPos');\n    $1",
    );
    expect(revertedCss).not.toBe(wxss());
    expect(revertedWxml).not.toBe(wxml());
    expect(revertedTs).not.toBe(ts());
    expect(bottomSheet(revertedCss, wxml(), ts())).toBe(false);      // CSS 回退即失败
    expect(bottomSheet(wxss(), revertedWxml, ts())).toBe(false);      // WXML 重新绑坐标即失败
    expect(bottomSheet(wxss(), wxml(), revertedTs)).toBe(false);      // TS 重新就近锚定即失败
  });
});

// ═══════════════ 收藏错误可观测性（collectLine catch(err)：页面层责任收敛） ═══════════════
// 2026-11-20 治本（49 §5 方案 B / 用户「不做临时修补」授权 / lead 选项 2 裁决）：
//   页面层 collectLine catch 只保留 console.error 排障留痕，不再自行弹 toast、不再做
//   hasHttpResponse 判定。服务层在本文件 :91-93 被 jest.fn 全量 mock，请求层根本不进这个测试：
//   ① HTTP 400 等业务失败 → 由 utils/request.ts 统一负责「有且仅有一条 string toast」
//      （断言见 tests/request-failure-toast.test.ts + request-envelope.test.ts，台账 #8947）；页面层不重复弹。
//   ② NOT_LOGGED_IN 属登录态信号 → 页面层与请求层都不弹，由 login-gate 承接
//      （V6 门 tests/request-login-timeout.test.ts:111-122）；页面层只保留 console.error 留痕。
describe('收藏 catch · console.error 落日志 + 页面层不重复弹（业务失败归请求层 / 登录态信号静默）', () => {
  it('① reject 带 statusCode 的对象（HTTP 400）→ 页面层不重复弹、console.error 被调用', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeThis();
    ctx.data.lines = mockLines();
    ctx.data.id = 4;
    ctx.data.book = 'NCE2';
    ctx.data.detail = { id: 4, title: 'L4', words: [] };
    collectMock.mockRejectedValueOnce({ statusCode: 400, message: 'property tag should not exist' });
    wxMock.showToast.mockClear();

    // 入口随变体 B 从 collectLine 改为抽屉事件（catch 分支逻辑一字未改）
    await pageConfig.onDrawerCollectLine.call(ctx, {
      detail: { lineIndex: 0, text: 'I have just received a letter.' },
    });
    expect(errSpy).toHaveBeenCalledWith('[nce/collect]', expect.objectContaining({ statusCode: 400 }));
    expect(wxMock.showToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: '收藏失败，请重试' }));
    expect(wxMock.showToast).not.toHaveBeenCalled();   // 服务层被 mock 时页面层不弹；真实提示由 utils/request.ts 统一负责
    errSpy.mockRestore();
  });

  it('② reject 一个 NOT_LOGGED_IN Error（登录态信号）→ 页面层与请求层都不弹，由 login-gate 承接', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeThis();
    ctx.data.lines = mockLines();
    ctx.data.id = 4;
    ctx.data.book = 'NCE2';
    ctx.data.detail = { id: 4, title: 'L4', words: [] };
    collectMock.mockRejectedValueOnce(new Error('NOT_LOGGED_IN'));
    wxMock.showToast.mockClear();

    await pageConfig.onDrawerCollectLine.call(ctx, {
      detail: { lineIndex: 0, text: 'I have just received a letter.' },
    });
    expect(errSpy).toHaveBeenCalledWith('[nce/collect]', expect.any(Error));
    // NOT_LOGGED_IN 属登录态信号，页面层与请求层都不弹，由 login-gate 承接；页面层只保留 console.error 留痕
    expect(wxMock.showToast).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
