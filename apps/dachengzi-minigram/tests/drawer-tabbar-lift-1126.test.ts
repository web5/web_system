/// <reference types="node" />
/**
 * 2026-11-26 首页长按抽屉被自定义 tabBar 遮挡 · 修复守卫（静态 + 行为）
 *
 * 缺陷真源：用户 2026-11-26 20:49 实测反馈「toolbar 把抽屉遮挡住了」（首页抽屉底部
 * 的动作按钮看不到 / 点不到）。8 条盲测缺陷由 PR #708 修完合入 master，**本条是第 9 条**，
 * 上一轮漏做（`git show 41fd4dcd --stat` 里没有 components/action-drawer/index.wxss）。
 *
 * 根因（不是 z-index 不够）：
 *  - `custom-tab-bar/index.wxss:22-31` → `.tabbar { position: fixed; bottom: 0; z-index: 900 }`
 *    + `padding-bottom: env(safe-area-inset-bottom)`，`.tb { height: 100rpx }` ⇒ 占位 100rpx + 安全区
 *  - `components/action-drawer/index.wxss:31-49` → `.ad-drawer { bottom: 0; z-index: 1001 }`
 *  - 🔴 微信**自定义 tabBar 是框架层独立根节点**（app.json `tabBar.custom: true`），层级恒在
 *    页面内任何 `position: fixed` 元素之上 —— 抽屉 z-index 1001 > tabbar 900 也没用。
 *    唯一出路：把抽屉抬到 tabBar 高度之上（并让遮罩一起抬，露出 tabBar 可点）。
 *
 * 本文件钉住 5 件事：
 *  1. 属性选型：Boolean `liftBottom`（默认 false），不是数值 `bottomInset`；
 *  2. wxss：抽屉**与遮罩**共用一条 `bottom: calc(100rpx + env(safe-area-inset-bottom, 0px))`；
 *  3. 抬高后 `padding-bottom` 去掉安全区项（否则底部多一截空白）；
 *  4. 首页开、**详情页不开**（详情页无 tabBar；反向断言防「图省事全页抬」）；
 *  5. 行为：让位后「动作区高度带」判定同步加宽（BB6 第 2 层兜底在首页仍然成立）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

jest.mock('../utils/line-actions', () => jest.requireActual('../utils/line-actions'));

const wxMock: any = {
  getSystemInfoSync: jest.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
};

let cfg: any = null;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).Component = jest.fn((c: any) => { cfg = c; });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../components/action-drawer/index');
});

beforeEach(() => {
  wxMock.getSystemInfoSync.mockReturnValue({ windowWidth: 375, windowHeight: 667 });
});

const APP = path.join(__dirname, '..');
const read = (p: string): string => fs.readFileSync(path.join(APP, p), 'utf8');
/** 去 CSS 注释：注释里会写「为什么这么改」并引用规则原文，不去掉会污染断言 */
const stripCss = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
/** 去 wxml 注释：注释里允许提到属性名（说明「详情页为什么不传」），断言只看真实节点 */
const stripWxml = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '');

const COMP_TS = 'components/action-drawer/index.ts';
const COMP_WXML = 'components/action-drawer/index.wxml';
const COMP_WXSS = 'components/action-drawer/index.wxss';
const HOME_WXML = 'pages/home/index/index.wxml';
const DETAIL_WXML = 'pages/nce/detail/detail.wxml';

/**
 * 取「选择器单独成组」的规则体：跳过「被逗号并列在选择器列表里」的同名选择器。
 * 必要性：`.ad-lift .ad-mask,\n.ad-lift .ad-drawer { … }` 里第二行也以 `.ad-lift .ad-drawer {`
 * 开头，只按行首匹配会把「共用规则」误当成「单独规则」，导致断言看错对象。
 */
const soloRule = (css: string, sel: string): string => {
  const clean = stripCss(css);
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const before = clean.slice(0, m.index).replace(/\s+$/, '');
    if (before.endsWith(',')) continue; // 选择器列表的一员，不是单独规则
    return m[1];
  }
  return '';
};

/** 基础规则体（`.ad-mask` / `.ad-drawer` 的默认态：未开让位时的 bottom: 0） */
const baseRule = (css: string, sel: string): string => soloRule(css, sel);

/** `.ad-lift .ad-mask, .ad-lift .ad-drawer { … }` 这条规则体（两个选择器必须在同一条规则里） */
const liftPairRule = (css: string): string => {
  const m = stripCss(css).match(/\.ad-lift\s+\.ad-mask\s*,\s*\.ad-lift\s+\.ad-drawer\s*\{([^}]*)\}/);
  return m ? m[1] : '';
};

/** `.ad-lift .ad-drawer { … }` 单独规则体（= media 块之外那条 padding 修正） */
const liftDrawerRule = (css: string): string => soloRule(css, '.ad-lift .ad-drawer');

/** `@media (max-width: 359px)` 块内部（小屏尺寸另有一套值） */
const smallScreenBlock = (css: string): string => {
  const clean = stripCss(css);
  const i = clean.indexOf('@media (max-width: 359px)');
  return i < 0 ? '' : clean.slice(i);
};

/** 取 wxml 里 `<action-drawer … />` 这个标签的原文（已去注释） */
const drawerTag = (wxml: string): string => {
  const m = stripWxml(wxml).match(/<action-drawer[\s\S]*?\/>/);
  return m ? m[0] : '';
};

/** 造组件实例：properties 的默认值 → data（真机里 properties 通过 this.data 读取） */
function makeInst(props: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg.properties || {})) {
    defaults[k] = (v as { value?: unknown }).value;
  }
  const inst: any = {
    data: { ...JSON.parse(JSON.stringify(cfg.data || {})), ...defaults, visible: true, ...props },
    triggerEvent: jest.fn(),
    setData: jest.fn(function (this: any, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    }),
  };
  for (const [k, v] of Object.entries(cfg.methods || {})) {
    inst[k] = (v as Function).bind(inst);
  }
  return inst;
}

/* ═════════════════ 1. 属性选型 ═════════════════ */

describe('属性选型：Boolean `liftBottom`（默认 false），不是数值 bottomInset', () => {
  it('properties.liftBottom 是 Boolean 且默认 false（详情页不传即保持原样）', () => {
    expect(cfg.properties.liftBottom).toBeDefined();
    expect(cfg.properties.liftBottom.type).toBe(Boolean);
    expect(cfg.properties.liftBottom.value).toBe(false);
  });

  it('没有退化成数值型 bottomInset（几何量不许散落到调用点）', () => {
    const stripJs = (s: string): string =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // 反向：一旦有人改成 bottomInset: Number，调用点就得各传一个 rpx 值，改 tabBar 高度必漏改
    // （注释里提到该名字是选型说明，去注释后再断言，避免自证）
    expect(read(COMP_TS)).not.toMatch(/bottomInset\s*:/);
    expect(stripJs(read(COMP_TS))).not.toMatch(/bottomInset/);
    expect(cfg.properties.bottomInset).toBeUndefined();
  });

  it('组件 wxml 只切 class，不写内联坐标（不破红线 3）', () => {
    const w = stripWxml(read(COMP_WXML));
    expect(w).toMatch(/class="ad \{\{liftBottom \? 'ad-lift' : ''\}\}"/);
    // 数值属性落地的唯一方式就是内联 style，这里必须一条都没有
    expect(w).not.toMatch(/style="[^"]*bottom/);
    expect(w).not.toMatch(/left:\{\{|top:\{\{|bottom:\{\{/);
  });
});

/* ═════════════════ 2. wxss 抬高规则（抽屉 + 遮罩一起抬） ═════════════════ */

describe('wxss：抽屉与遮罩共用一条抬高规则（遮罩也必须抬）', () => {
  it('遮罩与抽屉在同一条规则里 bottom: calc(100rpx + env(safe-area-inset-bottom, 0px))', () => {
    const rule = liftPairRule(read(COMP_WXSS));
    // 两个选择器必须在同一条规则里：分开写就很容易「只抬抽屉忘了遮罩」
    expect(rule).toMatch(/bottom:\s*calc\(100rpx \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
  });

  it('未开启（详情页）时仍是 bottom: 0 —— 基线未被改动', () => {
    const css = read(COMP_WXSS);
    expect(baseRule(css, '.ad-mask')).toMatch(/bottom:\s*0;/);
    expect(baseRule(css, '.ad-drawer')).toMatch(/bottom:\s*0;/);
  });

  it('抬高量 100rpx 与自定义 tabBar 高度同源（改 tabBar 高度必须同步这条）', () => {
    const tabbarCss = stripCss(fs.readFileSync(path.join(APP, 'custom-tab-bar/index.wxss'), 'utf8'));
    // tabBar：.tb { height: 100rpx } + .tabbar { padding-bottom: env(safe-area-inset-bottom) }
    expect(tabbarCss).toMatch(/\.tb\s*\{[^}]*height:\s*100rpx/);
    expect(tabbarCss).toMatch(/\.tabbar\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom\)/);
    // 抽屉抬高量必须等于 .tb 高度，否则会盖住 tabBar 顶部或留缝
    const lift = liftPairRule(read(COMP_WXSS)).match(/calc\((\d+)rpx \+ env/);
    const tbH = tabbarCss.match(/\.tb\s*\{[^}]*height:\s*(\d+)rpx/) as RegExpMatchArray;
    expect(Number(lift && lift[1])).toBe(Number(tbH[1]));
  });

  it('抬高后 padding-bottom 去掉 env()（安全区已由 tabBar 让出，只留 24rpx 呼吸量）', () => {
    const rule = liftDrawerRule(read(COMP_WXSS));
    expect(rule).toMatch(/padding-bottom:\s*24rpx/);
    // 关键：不许原样留着 calc(24rpx + env(...))，否则底部多一截空白
    expect(rule).not.toMatch(/env\(/);
  });

  it('小屏（<360px）同样去掉 env()，且保留小屏自己的 20rpx', () => {
    const block = smallScreenBlock(read(COMP_WXSS));
    const m = block.match(/\.ad-lift\s+\.ad-drawer\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    const rule = (m as RegExpMatchArray)[1];
    expect(rule).toMatch(/padding:\s*0\s+28rpx\s+20rpx/);
    expect(rule).not.toMatch(/env\(/);
  });
});

/* ═════════════════ 3. 页面区分：首页开，详情页不开 ═════════════════ */

describe('首页开 / 详情页不开（反向断言防「图省事全页抬」）', () => {
  const appJson = JSON.parse(read('app.json'));
  const tabbarPaths: string[] = ((appJson.tabBar && appJson.tabBar.list) || []).map((i: any) => i.pagePath);

  it('客观依据：首页在 app.json tabBar.list 里，详情页不在（自定义 tabBar 已开启）', () => {
    expect(appJson.tabBar.custom).toBe(true);
    expect(tabbarPaths).toContain('pages/home/index/index');
    expect(tabbarPaths).not.toContain('pages/nce/detail/detail');
  });

  it('首页 <action-drawer> 带 lift-bottom="{{true}}"', () => {
    const tag = drawerTag(read(HOME_WXML));
    expect(tag).not.toBe('');
    expect(tag).toMatch(/lift-bottom="\{\{true\}\}"/);
    // 其余 7 个属性一个都不能丢（漏一个就是某个动作静默失效）
    for (const prop of ['visible', 'scope', 'line-text', 'line-index', 'word', 'word-has-def', 'phonetic']) {
      expect(tag).toContain(`${prop}="{{`);
    }
    for (const evt of ['speak-line', 'speak-word', 'collect-line', 'collect-word', 'close']) {
      expect(tag).toContain(`bind:${evt}="`);
    }
  });

  it('详情页 <action-drawer> **不带** 让位属性（无 tabBar，抬了只会多一条空白）', () => {
    const tag = drawerTag(read(DETAIL_WXML));
    expect(tag).not.toBe('');
    expect(tag).not.toMatch(/lift-bottom/);
    // 更强的一条：整个详情页 wxml（去注释后）都不许出现该属性，避免有人在祖先节点上补一刀
    expect(stripWxml(read(DETAIL_WXML))).not.toMatch(/lift-bottom/);
    // 详情页原有 7 属性 + 5 事件仍齐全
    for (const prop of ['visible', 'scope', 'line-text', 'line-index', 'word', 'word-has-def', 'phonetic']) {
      expect(tag).toContain(`${prop}="{{`);
    }
  });
});

/* ═════════════════ 4. 行为：动作区判定带随让位加宽（BB6 第 2 层） ═════════════════ */

describe('行为：让位后动作区高度带同步加宽（BB6 逻辑兜底在首页仍成立）', () => {
  // 口径：windowHeight 667 / windowWidth 375 ⇒ 1rpx = 0.5px
  //   详情页（不抬）：带 = 192rpx = 96px
  //   首页（抬 100rpx）：带 = 292rpx = 146px
  const WH = 667;

  it('未开启：距底 120px（按钮带外）允许起拖（= 修前行为，未回退）', () => {
    const inst = makeInst({ liftBottom: false });
    expect(inst._startedInActsZone(WH - 120)).toBe(false);
    expect(inst._startedInActsZone(WH - 60)).toBe(true); // 带内
  });

  it('开启：同一坐标 120px 落进「按钮带上半截」→ 拒绝起拖', () => {
    const inst = makeInst({ liftBottom: true });
    expect(inst._startedInActsZone(WH - 120)).toBe(true);
    expect(inst._startedInActsZone(WH - 140)).toBe(true); // 292rpx = 146px 的边界内
    expect(inst._startedInActsZone(WH - 160)).toBe(false); // 已到标题区，允许起拖
  });

  it('脏坐标一律放行（0 / NaN / 负 → 不拦，保证下滑关永远可用）', () => {
    const inst = makeInst({ liftBottom: true });
    [0, NaN, -1, Infinity].forEach((y) => expect(inst._startedInActsZone(y as number)).toBe(false));
  });

  it('让位常量与 wxss 的 100rpx 同源（防止 TS 里写 100、CSS 里写别的）', () => {
    const src = read(COMP_TS);
    expect(src).toMatch(/TABBAR_LIFT_RPX\s*=\s*100/);
    const lift = liftPairRule(read(COMP_WXSS)).match(/calc\((\d+)rpx \+ env/);
    expect(Number(lift && lift[1])).toBe(100);
  });
});
