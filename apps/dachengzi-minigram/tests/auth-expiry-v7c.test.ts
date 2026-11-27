/// <reference types="node" />
/**
 * 需求② #8901 · 登录态过期弹窗 / 三数据页订阅 / login-gate 双态（D1=C · V7-C）红灯用例
 *
 * 覆盖 `10` ④ C7/C8/C9 + `02` V9–V20 + SOP §7 B 抽样清单 #4/#5/#6/#7：
 *   - C7 登录弹窗与自动重拉（V11/V12/V16）：auth:expired → 置 authExpired + 弹 modal-auth、
 *     不裸失败；auth:logged 回调内显式 void this.load()（不得依赖 onShow）
 *   - C8 三数据页订阅退订（V13/V18）：onLoad on / onUnload off，反复 3 次只 1 订阅；
 *     🔴 login-gate 组件内不得订阅 auth 事件（否则双重响应）
 *   - C9 V7-C 反例走查（静态）：原型有 assertNoContinuous、无 #cont-btn / data-cont / .cont-btn
 *   - V9 非 401 失败保留原错误态 + onRetry；V11 authExpired 分流（不裸失败、保持骨架）
 *   - V12/V13-A 弹窗 = login-gate mode:'modal' 态、标题固定「登录已过期」、三页 .json 一致登记
 *   - V14 重新登录 loading/禁用防重复；V17 稍后→常驻提示条→再唤起、失败分支按钮复位、不 reLaunch
 *   - V15 auth:logged 全仓只一处 emit；V19 T3 主动退出不弹 modal-auth（平凡通过·代码检索）
 *   - V10/V20 禁改文件零改动回归（request.ts / auth.ts / tts.ts 关键标记仍在）
 *   - 清单 4：login-gate mode 双态 + logged 事件（唯一共享面，三 tab 页整页墙回归理由）
 *   - 清单 5/6：loginFromGate→emit('auth:logged')、request.ts 401 链路（禁改，仅回归）
 *   - 清单 7：三数据页 load() + 订阅（改）
 *
 * 🔴 生效真源：10-D1方案C冻结与技术方案.md；08 整份作废。
 * 注：tsconfig 的 types 仅 wechat-miniprogram/jest（禁改面），本文件用三斜线单独引 node 类型。
 */
import * as fs from 'fs';
import * as path from 'path';

const APP = path.resolve(__dirname, '..');
const src = (rel: string): string => fs.readFileSync(path.join(APP, rel), 'utf8');
const proto = (): string => fs.readFileSync(path.join(APP, 'prototype', '03-原型稿-NCE交互与登录过期-2026-11-17.html'), 'utf8');

/** 递归收集生产源码（排除 tests/ 断言字面量、prototype/、node_modules） */
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

// ─────────────────────── 静态护栏（C9 / V15 / V19 / V20 / V13） ───────────────────────

describe('C9/V7-C · 反例走查（静态）：无连续朗读入口、原型含 assertNoContinuous', () => {
  it('原型 03 含 assertNoContinuous 断言、真实 DOM 无 id="cont-btn" / class="cont-btn" / data-cont= 属性', () => {
    const h = proto();
    expect(h).toMatch(/assertNoContinuous/);
    expect(h).not.toMatch(/id="cont-btn"|class="cont-btn"|data-cont=/);
  });

  it('三个数据页 wxml 均无 cont-btn / data-cont / 连续朗读（V7-C 入口不存在）', () => {
    for (const rel of ['pages/nce/index/index.wxml', 'pages/nce/detail/detail.wxml', 'pages/mine/glossary/index.wxml']) {
      expect(src(rel)).not.toMatch(/cont-btn|data-cont|连续朗读|toggleContinuous|stopContinuous/);
    }
  });
});

describe('V15/V19/V20/清单 5/6 · auth.ts / request.ts / tts.ts 零改动回归', () => {
  it('V15: 全仓生产源码 emit("auth:logged") 恰好 1 处（仅 services/auth.ts:143）', () => {
    let n = 0;
    for (const f of walk(APP)) {
      if (!/\.ts$/.test(f)) continue;
      n += (fs.readFileSync(f, 'utf8').match(/emit\(['"]auth:logged['"]\)/g) || []).length;
    }
    expect(n).toBe(1);
  });

  it('V20/清单 6: request.ts 仍有 handleUnauthorized + emit("auth:expired") + silent 分支（禁改）', () => {
    const t = src('utils/request.ts');
    expect(t).toMatch(/handleUnauthorized/);
    expect(t).toMatch(/emit\(['"]auth:expired['"]\)/);
    expect(t).toMatch(/options\.silent/);
    expect(t).toMatch(/isRelogging/);
  });

  it('V20/清单 5: auth.ts 仍有 loginFromGate() 且 auth:logged 唯一 emit 在此', () => {
    const t = src('services/auth.ts');
    expect(t).toMatch(/export async function loginFromGate/);
    expect(t).toMatch(/emit\(['"]auth:logged['"]\)/);
  });

  it('V20/清单 1/2/3: tts.ts 4 个导出签名不变（零改动）', () => {
    const t = src('services/tts.ts');
    expect(t).toMatch(/export async function speakText\(text: string\)/);
    expect(t).toMatch(/export function stopSpeak\(\)/);
    expect(t).toMatch(/export function onSpeakState\(cb: SpeakStateListener\)/);
    expect(t).toMatch(/export interface SpeakState/);
  });

  it('V19: 三数据页不直接处理 T3（无 isLoggedOut / 无 reLaunch / 不 emit auth:expired）', () => {
    for (const rel of ['pages/nce/index/index.ts', 'pages/nce/detail/detail.ts', 'pages/mine/glossary/index.ts']) {
      const t = src(rel);
      expect(t).not.toMatch(/isLoggedOut|reLaunch|emit\(['"]auth:expired['"]\)/);
    }
  });
});

// ─────────────────────── 页面/组件配置捕获 ───────────────────────

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
  listGlossary: jest.fn(() => Promise.resolve({ list: [], total: 0 })),
  removeGlossary: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../services/auth', () => ({
  isLoggedIn: jest.fn(() => true),
  loginFromGate: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../pages/nce/books', () => ({
  DEFAULT_NCE_BOOK: 'NCE2',
  NCE_BOOKS: [{ book: 'NCE2', label: '新概念2' }],
  nceBookTotal: jest.fn(() => 96),
  buildNceGroupRanges: jest.fn(() => []),
}));

import { getNceLesson, getNceMeta, listNceLessons } from '../services/nce';
import { listGlossary } from '../services/glossary';
import { loginFromGate } from '../services/auth';

const getNceLessonMock = getNceLesson as unknown as jest.Mock;
const getNceMetaMock = getNceMeta as unknown as jest.Mock;
const listNceLessonsMock = listNceLessons as unknown as jest.Mock;
const listGlossaryMock = listGlossary as unknown as jest.Mock;
const loginFromGateMock = loginFromGate as unknown as jest.Mock;

const listeners: Record<string, Array<(p?: unknown) => void>> = {};
const bus = {
  on: jest.fn((e: string, h: (p?: unknown) => void) => { (listeners[e] ||= []).push(h); }),
  off: jest.fn((e: string, h: (p?: unknown) => void) => {
    listeners[e] = (listeners[e] || []).filter((x) => x !== h);
  }),
  emit: jest.fn((e: string, p?: unknown) => { (listeners[e] || []).slice().forEach((h) => h(p)); }),
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
  reLaunch: jest.fn(),
};

const pageCfgs: Record<string, any> = {};
let compCfg: any = null;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).getApp = () => ({ eventBus: bus, radiusClassOf: () => '', globalData: {} });
  let key = '';
  (globalThis as any).Page = jest.fn((cfg: any) => { pageCfgs[key] = cfg; });
  key = 'nce/index'; require('../pages/nce/index/index');
  key = 'nce/detail'; require('../pages/nce/detail/detail');
  key = 'mine/glossary'; require('../pages/mine/glossary/index');
  (globalThis as any).Component = jest.fn((cfg: any) => { compCfg = cfg; });
  require('../components/login-gate/index');
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(listeners)) delete listeners[k];
  getNceLessonMock.mockResolvedValue({ id: 4, title: 'L4', lines: [], words: [] });
  getNceMetaMock.mockResolvedValue({ book: 'NCE2', total: 96, downloaded: 96, bookTitle: 'NCE2' });
  listNceLessonsMock.mockResolvedValue({ items: [], total: 0 });
  listGlossaryMock.mockResolvedValue({ list: [], total: 0 });
  loginFromGateMock.mockResolvedValue(true);
});

function makeThis(cfg: any): any {
  return {
    data: JSON.parse(JSON.stringify(cfg.data)),
    _offAuthExpired: null,
    _offAuthLogged: null,
    _offSpeakState: null,
    _playingIdx: -1,
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    load: jest.fn(),
    applyFilter: jest.fn(),
    apply: jest.fn(),
    onShow: jest.fn(),
    _unsubscribeReading: jest.fn(),  // detail.onUnload/onHide 既有调用（朗读退订），测试桩需提供
    _subscribeReading: jest.fn(),
    // 2026-11-27 D1：detail.onUnload 会清「词卡收藏态回落定时器」，桩必须与调用面同步
    // （上一批同类问题：桩少挂一个方法 → TypeError 把整条用例打红，看起来像生产缺陷）
    _clearTipCollectTimer: jest.fn(),
  };
}

interface PageSpec {
  key: string;
  rel: string;
  wxml: string;
  json: string;
  reject: () => void;
  /** 失败态字段：nce/index、nce/detail 用 error；mine/glossary 用 empty（empty/error 共用态，须特判） */
  errorField: 'error' | 'empty';
  /** V9「点击重试」：仅 nce/index、nce/detail 既有 onRetry；glossary 无重试入口，只验保留原失败态 */
  hasRetry: boolean;
}

const PAGES: PageSpec[] = [
  {
    key: 'nce/index', rel: 'pages/nce/index/index.ts', wxml: 'pages/nce/index/index.wxml', json: 'pages/nce/index/index.json',
    reject: () => { getNceMetaMock.mockRejectedValue(new Error('401')); }, errorField: 'error', hasRetry: true,
  },
  {
    key: 'nce/detail', rel: 'pages/nce/detail/detail.ts', wxml: 'pages/nce/detail/detail.wxml', json: 'pages/nce/detail/detail.json',
    reject: () => { getNceLessonMock.mockRejectedValue(new Error('401')); }, errorField: 'error', hasRetry: true,
  },
  {
    key: 'mine/glossary', rel: 'pages/mine/glossary/index.ts', wxml: 'pages/mine/glossary/index.wxml', json: 'pages/mine/glossary/index.json',
    reject: () => { listGlossaryMock.mockRejectedValue(new Error('401')); }, errorField: 'empty', hasRetry: false,
  },
];

// ─────────────────────── V13/V12-A · 三页 .json 一致登记 + 弹窗形态 ───────────────────────

describe('V13/V12-A/清单 4 · 三数据页 .json 一致登记 login-gate + 弹窗不整页替换', () => {
  for (const p of PAGES) {
    it(`${p.key}.json 登记 login-gate（V13 可测项）`, () => {
      const j = JSON.parse(src(p.json));
      expect(j.usingComponents['login-gate']).toBe('/components/login-gate/index');
    });

    it(`${p.key}.wxml 弹窗为 wx:if 叠加层（非整页替换），含常驻提示条 showReloginTip`, () => {
      const w = src(p.wxml);
      expect(w).toMatch(/<login-gate/);
      expect(w).toMatch(/mode="modal"/);
      expect(w).toMatch(/wx:if="\{\{showAuthModal\}\}"/);
      expect(w).not.toMatch(/wx:elif="\{\{showAuthModal\}\}"/); // 非整页替换
      expect(w).toMatch(/showReloginTip/);                        // V17 常驻提示条
    });
  }

  it('清单 4 回归理由：三 tab 页 .wxml 仍用 <login-gate> 且不传 mode="modal"（默认 page 整页墙不变，NG5）', () => {
    for (const t of ['home', 'discover', 'mine']) {
      const w = src(`pages/${t}/index/index.wxml`);
      expect(w).toMatch(/<login-gate/);
      expect(w).not.toMatch(/mode="modal"/);
    }
  });
});

// ─────────────────────── C7/C8 · 页面级订阅与重拉（行为） ───────────────────────

describe('C7/V11/V12/V16 · auth 事件链（弹窗 + 自动重拉）', () => {
  for (const p of PAGES) {
    it(`${p.key}: onLoad 订阅 auth:expired / auth:logged；auth:expired 置 authExpired + 弹 modal-auth`, () => {
      const cfg = pageCfgs[p.key];
      const ctx = makeThis(cfg);
      expect(typeof cfg.onLoad).toBe('function');   // glossary 现状无 → 红灯
      cfg.onLoad.call(ctx, { id: 4, book: 'NCE2' });
      expect(bus.on).toHaveBeenCalledWith('auth:expired', expect.any(Function));
      expect(bus.on).toHaveBeenCalledWith('auth:logged', expect.any(Function));

      bus.emit('auth:expired');
      expect(ctx.data.authExpired).toBe(true);       // 页面级标志置位
      expect(ctx.data.showAuthModal).toBe(true);     // 弹 modal-auth（非裸失败）
    });

    it(`${p.key}: auth:logged 回调内显式 void this.load()（V16，不依赖 onShow），并收起弹窗/提示条`, () => {
      const cfg = pageCfgs[p.key];
      const ctx = makeThis(cfg);
      expect(typeof cfg.onLoad).toBe('function');
      cfg.onLoad.call(ctx, { id: 4, book: 'NCE2' });
      ctx.load.mockClear();                  // 清掉 onLoad 自身的首次 load
      ctx.onShow.mockClear();
      bus.emit('auth:logged');
      expect(ctx.load).toHaveBeenCalledTimes(1);   // 显式重拉
      expect(ctx.onShow).not.toHaveBeenCalled();    // 🔴 不依赖 onShow
      expect(ctx.data.showAuthModal).toBe(false);
      expect(ctx.data.showReloginTip).toBe(false);
      expect(ctx.data.authExpired).toBe(false);
    });

    it(`${p.key}.ts 源码：auth:logged 订阅存在、含显式 void this.load()、无 options.silent、无 reLaunch`, () => {
      const t = src(p.rel);
      expect(t).toMatch(/on\(['"]auth:logged['"]/);
      expect(t).toMatch(/void this\.load\(\)/);
      expect(t).not.toMatch(/silent/);       // 🔴 load() 不得带 options.silent
      expect(t).not.toMatch(/reLaunch/);     // V17 不 reLaunch
    });
  }
});

describe('C8/V13/V18 · 订阅退订成对（反复进出 3 次只 1 订阅）', () => {
  for (const p of PAGES) {
    it(`${p.key}: onUnload 以同一 handler 引用 off 两个事件，反复 3 次后仍只 1 订阅`, () => {
      const cfg = pageCfgs[p.key];
      const ctx = makeThis(cfg);
      expect(typeof cfg.onUnload).toBe('function');   // 现状 index/glossary 无 → 红灯
      for (let i = 0; i < 3; i++) {
        cfg.onLoad.call(ctx, { id: 4, book: 'NCE2' });
        cfg.onUnload.call(ctx);
      }
      cfg.onLoad.call(ctx, { id: 4, book: 'NCE2' });
      expect((listeners['auth:expired'] || []).length).toBe(1);
      expect((listeners['auth:logged'] || []).length).toBe(1);
      expect(bus.off).toHaveBeenCalledWith('auth:expired', expect.any(Function));
      expect(bus.off).toHaveBeenCalledWith('auth:logged', expect.any(Function));
    });
  }

  it('🔴 V18: login-gate 组件内不得订阅 auth 事件（否则 auth:logged 双重响应 → 两次重拉）', () => {
    const t = src('components/login-gate/index.ts');
    expect(t).not.toMatch(/auth:expired|auth:logged|eventBus/);
  });
});

// ─────────────────────── V9/V11 · load() catch 分流 ───────────────────────

describe('V9/V11 · load() catch 依 authExpired 分流（不读 statusCode / 不带 silent）', () => {
  for (const p of PAGES) {
    it(`${p.key}: authExpired=true → 不裸失败（不置失败态）、保持骨架 loading`, async () => {
      p.reject();
      const cfg = pageCfgs[p.key];
      const ctx = makeThis(cfg);
      ctx.data.authExpired = true;
      await cfg.load.call(ctx);
      if (p.errorField === 'empty') expect(ctx.data.empty).not.toBe(true);  // glossary 特判：不误判空态
      else expect(ctx.data.error).toBeFalsy();                                // 不置 error
      expect(ctx.data.loading).toBe(true);                                    // 骨架可见（V12 底层 ≥1）
    });

    it(`${p.key}: authExpired=false → 按 V9 保留原失败态${p.hasRetry ? ' + onRetry 可重试' : '（glossary 无重试入口，仅保留失败态）'}`, async () => {
      p.reject();
      const cfg = pageCfgs[p.key];
      const ctx = makeThis(cfg);
      ctx.data.authExpired = false;
      await cfg.load.call(ctx);
      if (p.errorField === 'empty') expect(ctx.data.empty).toBe(true);
      else expect(ctx.data.error).toBeTruthy();
      if (p.hasRetry) {
        ctx.data.loading = false;
        ctx.load.mockClear();
        expect(typeof cfg.onRetry).toBe('function');
        cfg.onRetry.call(ctx);
        expect(ctx.load).toHaveBeenCalled();
      }
    });
  }
});

// ─────────────────────── V17 · 稍后 / 常驻提示条 / 再唤起 ───────────────────────

describe('V17 · 稍后→常驻提示条→点条再次唤起同一 modal-auth（登录成功前不消失）', () => {
  for (const p of PAGES) {
    it(`${p.key}: onAuthDefer 收起弹窗+显示提示条；onReopenAuth 再唤起且提示条不消失`, () => {
      const cfg = pageCfgs[p.key];
      const ctx = makeThis(cfg);
      expect(typeof cfg.onAuthDefer).toBe('function');    // 现状无 → 红灯
      expect(typeof cfg.onReopenAuth).toBe('function');  // 现状无 → 红灯
      ctx.data.showAuthModal = true;
      cfg.onAuthDefer.call(ctx);
      expect(ctx.data.showAuthModal).toBe(false);
      expect(ctx.data.showReloginTip).toBe(true);
      cfg.onReopenAuth.call(ctx);
      expect(ctx.data.showAuthModal).toBe(true);
      expect(ctx.data.showReloginTip).toBe(true);         // 登录成功前不消失
    });
  }
});

// ─────────────────────── 清单 4 · login-gate 双态（行为） ───────────────────────

describe('清单 4/V12/V14/V17 · login-gate mode 双态 + logged/defer 事件', () => {
  const cctx = (): any => ({
    data: JSON.parse(JSON.stringify(compCfg.data || {})),
    properties: compCfg.properties,
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    triggerEvent: jest.fn(),
  });

  it('mode 属性默认 page（tab 页整页墙零回归），wxml 含 modal 态固定标题「登录已过期」与两按钮', () => {
    expect(compCfg.properties.mode).toBeDefined();          // 现状无 → 红灯
    expect(compCfg.properties.mode.value).toBe('page');
    const w = src('components/login-gate/index.wxml');
    expect(w).toMatch(/mode === 'modal'|mode==='modal'|mode === "modal"/);
    expect(w).toMatch(/登录已过期/);                        // V12 标题固定
    expect(w).toMatch(/重新登录/);
    expect(w).toMatch(/稍后/);
    expect(w).not.toMatch(/cont-btn|连续朗读/);
  });

  it('清单 4 回归：onLogin() 成功仍复用 loginFromGate() 并只 triggerEvent("logged")', async () => {
    const ctx = cctx();
    loginFromGateMock.mockResolvedValue(true);
    await compCfg.methods.onLogin.call(ctx);
    expect(loginFromGateMock).toHaveBeenCalled();
    expect(ctx.triggerEvent).toHaveBeenCalledWith('logged');
  });

  it('V14/V17: 失败不 emit logged、logging 复位可再点、不 reLaunch、不吞错', async () => {
    const ctx = cctx();
    loginFromGateMock.mockResolvedValue(false);
    await compCfg.methods.onLogin.call(ctx);
    expect(ctx.triggerEvent).not.toHaveBeenCalledWith('logged');  // 弹窗仍在
    expect(ctx.data.logging).toBe(false);                         // 现状无 logging → 红灯
    expect(wxMock.reLaunch).not.toHaveBeenCalled();
    expect(src('components/login-gate/index.ts')).toMatch(/logging/);  // V14 防重复
  });

  it('V17: 稍后触发 defer 事件（由页面置常驻提示条，组件不自行 close 整页）', () => {
    const ctx = cctx();
    expect(typeof compCfg.methods.onDefer).toBe('function');   // 现状无 → 红灯
    compCfg.methods.onDefer.call(ctx);
    expect(ctx.triggerEvent).toHaveBeenCalledWith('defer');
  });
});
