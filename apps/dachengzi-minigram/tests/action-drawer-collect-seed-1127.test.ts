/// <reference types="node" />
/**
 * 抽屉组件 · D7「收藏态双向同步」入口（2026-11-27 第二批 → 用户真机反馈后升级）
 *
 * 背景（用户原话）：首页今日一句卡片里点了收藏，长按打开抽屉，「收藏此句」仍是「☆ 收藏此句」。
 * 修法：页面把「当前已收藏的动作 key 集合」通过**一个** `collectedKeys` 属性交给组件
 * （元素值 = `EVT.COLLECT_LINE` / `EVT.COLLECT_WORD`，与 `data-key` 逐字同值），
 * 组件在 `visible` 变 true 与 `collectedKeys` 变化时各对齐一次。
 *
 * 🔴 A8 红线不动：`collectedKeys` 只是字符串数组，组件仍然只 import `services/tts`。
 *
 * 本文件锁四条：
 *  1. **wxml 真的渲染**：不是只断言 `data.collect`，而是把组件 wxml 的 `.ad-act` 起始标签、
 *     图标 `<image>`、文案 `<text>` 三段模板取出来，用组件 data 求值，断言渲染出来的
 *     class 含 `is-collected`、`src` 是 check.svg、文案是「已收藏」。
 *     （上一批抓到的第一个假绿就是「只断言 data 字段」——模板没接上照样绿。）
 *  2. 属性 → 打开时点亮：`visible=true` 时 key 命中的槽位直接是 `done`。
 *  3. 不覆盖在途 / 刚回传的状态：`busy` 与 `existed` 两个槽位保留原值。
 *  4. 关闭仍归零：`visible=false` 复位，换一组 key 再打开按新集合重新点亮。
 */
import * as fs from 'fs';
import * as path from 'path';

export {};

type ComponentCfg = Record<string, any>;
const APP = path.resolve(__dirname, '..');
let drawerCfg: ComponentCfg | null = null;

jest.mock('../services/tts', () => ({
  speakText: jest.fn(() => Promise.resolve(true)),
  stopSpeak: jest.fn(),
  onSpeakState: jest.fn(() => jest.fn()),
}));

beforeAll(() => {
  (globalThis as any).Component = (cfg: ComponentCfg) => { drawerCfg = cfg; };
  (globalThis as any).wx = { getSystemInfoSync: jest.fn(() => ({ windowWidth: 375, windowHeight: 667 })) };
  require('../components/action-drawer/index');
});

/* ───────────────── 极简 wxml 模板求值（真的把模板跑一遍，不是只读 data） ───────────────── */

const WXML = fs.readFileSync(path.join(APP, 'components/action-drawer/index.wxml'), 'utf8');

/** 从 anchor 反向找 `<`、正向找 `>`（跳过引号内的 `>`），取出一个起始标签 */
function tagOf(anchor: string): string {
  const at = WXML.indexOf(anchor);
  if (at < 0) throw new Error(`wxml 里找不到锚点：${anchor}（模板结构改了？本测试必须跟着改）`);
  const open = WXML.lastIndexOf('<', at);
  let i = at;
  let quote = '';
  let depth = 0;
  for (; i < WXML.length; i++) {
    const ch = WXML[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{' && WXML[i + 1] === '{') { depth++; i++; continue; }
    if (ch === '}' && WXML[i + 1] === '}' && depth > 0) { depth--; i++; continue; }
    if (ch === '>' && depth === 0) break;
  }
  return WXML.slice(open, i + 1);
}

/** 取起始标签里某个属性的**模板原串** */
function attrOf(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  if (!m) throw new Error(`标签里找不到属性 ${name}：${tag.slice(0, 120)}`);
  return m[1];
}

/** 求值 `{{…}}`（表达式是 wxml 子集，这里是原始 JS：三元 / === / 属性取值） */
function interp(tpl: string, ctx: Record<string, unknown>): string {
  return tpl.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr: string) => {
    // eslint-disable-next-line no-new-func
    const fn = new Function('ctx', `with (ctx) { return (${expr}); }`) as (c: Record<string, unknown>) => unknown;
    const v = fn(ctx);
    return v === undefined || v === null ? '' : String(v);
  });
}

interface RenderedAct { cls: string; label: string; src: string; aria: string; }

/** 用组件 data 把动作区真实渲染一遍（顺序与 wxml 的 wx:for 一致） */
function renderActs(c: Record<string, any>): RenderedAct[] {
  const actTag = tagOf('class="ad-act ');
  const imgTag = tagOf('class="ad-ico"');
  const clsTpl = attrOf(actTag, 'class');
  const ariaTpl = attrOf(actTag, 'aria-label');
  const srcTpl = attrOf(imgTag, 'src');
  const lb = WXML.match(/<text class="ad-act-lb">([\s\S]*?)<\/text>/);
  if (!lb) throw new Error('wxml 里找不到动作文案节点 .ad-act-lb');
  const lbTpl = lb[1].trim();
  return (c.data.acts as any[]).map((item) => {
    const ctx = { item, playingKey: c.data.playingKey, pressedKey: c.data.pressedKey };
    return {
      cls: interp(clsTpl, ctx),
      label: interp(lbTpl, ctx),
      src: interp(srcTpl, ctx),
      aria: interp(ariaTpl, ctx),
    };
  });
}

const renderedOf = (c: Record<string, any>, key: string): RenderedAct => {
  const idx = (c.data.acts as any[]).findIndex((a) => a.key === key);
  expect(idx).toBeGreaterThanOrEqual(0);
  return renderActs(c)[idx];
};

/* ───────────────────────────── 组件实例桩 ───────────────────────────── */

/** 组件属性默认值 → data（真机里 properties 通过 this.data 读取） */
function propDefaults(cfg: ComponentCfg): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg.properties || {})) out[k] = (v as { value?: unknown }).value;
  return out;
}

/** 最小组件实例（与 tests/action-drawer.test.ts 同一套桩范式） */
function makeDrawer(props: Record<string, unknown> = {}): Record<string, any> {
  const cfg = drawerCfg as ComponentCfg;
  const inst: Record<string, any> = {
    data: { ...propDefaults(cfg), ...JSON.parse(JSON.stringify(cfg.data || {})), ...props },
    setData(this: Record<string, any>, patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    triggerEvent: jest.fn(),
  };
  for (const block of [cfg.methods, cfg.lifetimes, cfg.pageLifetimes, cfg.observers]) {
    Object.keys(block || {}).forEach((k) => {
      if (typeof block[k] === 'function') inst[k] = (block[k] as (...a: unknown[]) => unknown).bind(inst);
    });
  }
  return inst;
}

const labelOf = (c: Record<string, any>, key: string) =>
  (c.data.acts as any[]).find((a) => a.key === key).label;
const icoOf = (c: Record<string, any>, key: string) =>
  (c.data.acts as any[]).find((a) => a.key === key).ico;

/**
 * 模拟框架的「属性变化」：真机上框架**先把新值写进 data、再调 observer**。
 * 桩里手动补上这一步，否则 `onCollectDone` 的 `visible` 守卫会误判成「抽屉已关」
 * （那不是本文件要测的东西，是桩与框架的差异）。
 */
function setProp(c: Record<string, any>, prop: string, value: unknown) {
  c.data[prop] = value;
  c[prop](value);
}

describe('D7 组件入口：collectedKeys（唯一通道）', () => {
  it('属性默认是空数组（不传就是未收藏，行为与改动前一致）；类型是 Array 而不是布尔', () => {
    const cfg = drawerCfg as ComponentCfg;
    expect(cfg.properties.lineCollected).toBeUndefined();   // 旧的两布尔通道已删除，不留第二套判断
    expect(cfg.properties.wordCollected).toBeUndefined();
    expect(cfg.properties.collectedKeys.type).toBe(Array);
    expect(cfg.properties.collectedKeys.value).toEqual([]);
  });

  it('🔴 页面传入 collectedKeys 后 **wxml 真的渲染出 done 态**（class / 图标 / 文案三处）', () => {
    const c = makeDrawer({ visible: false, scope: 'line', lineText: 'A.', collectedKeys: ['collect-line'] });
    c.scope('line');
    setProp(c, 'visible', true);                      // 页面开抽屉：visible false → true
    expect(c.data.collect.line).toBe('done');
    expect(labelOf(c, 'collect-line')).toBe('已收藏');
    expect(icoOf(c, 'collect-line')).toBe('/assets/icons/check.svg');
    // ↓ 这里是本文件相对「只断言 data」的升级：把模板跑一遍
    const r = renderedOf(c, 'collect-line');
    expect(r.cls).toContain('is-collected');
    expect(r.label).toBe('已收藏');
    expect(r.src).toBe('/assets/icons/check.svg');
    expect(r.aria).toBe('已收藏');
  });

  it('未命中 key 的槽位渲染成 ☆ 收藏（不是只把 collect 置 idle 就完事）', () => {
    const c = makeDrawer({ visible: false, scope: 'line', lineText: 'A.', collectedKeys: [] });
    c.scope('line');
    setProp(c, 'visible', true);
    const r = renderedOf(c, 'collect-line');
    expect(r.cls).not.toContain('is-collected');
    expect(r.label).toBe('收藏此句');
    expect(r.src).toBe('/assets/icons/star.svg');
  });

  it('key 只命中 word：词档两项各按自己的槽位点亮（并不同步串台）', () => {
    const c = makeDrawer({
      visible: false, scope: 'word', lineText: 'A.', word: 'w', collectedKeys: ['collect-word'],
    });
    c.scope('word');
    setProp(c, 'visible', true);
    expect(c.data.collect.line).toBe('idle');         // 句子没收藏过
    expect(c.data.collect.word).toBe('done');         // 单词收藏过
    expect(renderedOf(c, 'collect-line').label).toBe('收藏此句');
    expect(renderedOf(c, 'collect-word').label).toBe('已收藏');
    expect(renderedOf(c, 'collect-word').cls).toContain('is-collected');
  });

  it('两个 key 都命中 → 两个槽位都 ✓；busy 位保持 false（初值不是「提交中」）', () => {
    const c = makeDrawer({
      visible: false, scope: 'word', lineText: 'A.', word: 'w',
      collectedKeys: ['collect-line', 'collect-word'],
    });
    c.scope('word');
    setProp(c, 'visible', true);
    expect(c.data.collect).toEqual({ line: 'done', word: 'done' });
    expect(c.data.busy).toBe(false);
  });

  it('🔴 抽屉**开着**时页面把 key 加进来 → observer 立即对齐（不靠重开抽屉、不靠 visible 变化）', () => {
    const c = makeDrawer({ visible: false, scope: 'line', lineText: 'A.', collectedKeys: [] });
    c.scope('line');
    setProp(c, 'visible', true);                       // 打开：页面说没收藏 → ☆
    expect(c.data.collect.line).toBe('idle');
    setProp(c, 'collectedKeys', ['collect-line']);      // 页面侧同步（框架只改属性，不动 visible）
    expect(c.data.collect.line).toBe('done');
    expect(renderedOf(c, 'collect-line').label).toBe('已收藏');
    expect(renderedOf(c, 'collect-line').cls).toContain('is-collected');
  });

  it('关掉时把 key 拿走 → 再打开仍是 ☆（集合与关闭复位不打架）', () => {
    const c = makeDrawer({ visible: false, scope: 'line', lineText: 'A.', collectedKeys: ['collect-line'] });
    c.scope('line');
    setProp(c, 'visible', true);
    expect(c.data.collect.line).toBe('done');
    setProp(c, 'visible', false);
    setProp(c, 'collectedKeys', []);
    setProp(c, 'visible', true);
    expect(c.data.collect.line).toBe('idle');
  });

  it('脏集合不崩也不误亮：null / 数字 / 非 EVT 值一律当「没收藏」', () => {
    for (const bad of [null, [1, 2], ['collect-whatever'], 'collect-line', {}]) {
      const c = makeDrawer({ visible: false, scope: 'line', lineText: 'A.', collectedKeys: bad });
      c.scope('line');
      setProp(c, 'visible', true);
      expect(c.data.collect.line).toBe('idle');
    }
  });

  it('observer 直接带着 true 调用也能点亮（不依赖「框架先写 data」这条时序）', () => {
    const c = makeDrawer({ visible: false, scope: 'line', lineText: 'A.', collectedKeys: ['collect-line'] });
    c.scope('line');
    c.visible(true);                                  // 不预写 data.visible：走 `_seedCollect(true)` 那条
    expect(c.data.collect.line).toBe('done');
    expect(renderedOf(c, 'collect-line').label).toBe('已收藏');
  });

  it('关闭仍归零（既有契约不变）；换一组 key 再打开按新集合重新点亮', () => {
    const c = makeDrawer({ visible: false, scope: 'line', lineText: 'A.', collectedKeys: ['collect-line'] });
    c.scope('line');
    setProp(c, 'visible', true);
    expect(c.data.collect.line).toBe('done');
    setProp(c, 'visible', false);
    expect(c.data.collect.line).toBe('idle');         // 关 = 复位（原型待定项，本实现选复位）
    setProp(c, 'collectedKeys', []);
    setProp(c, 'visible', true);
    expect(c.data.collect.line).toBe('idle');         // 换个对象打开：集合空 → ☆
    setProp(c, 'visible', false);
    setProp(c, 'collectedKeys', ['collect-line']);
    setProp(c, 'visible', true);
    expect(c.data.collect.line).toBe('done');         // 再打开：集合命中 → ✓
  });
});

describe('D7 初值不许覆盖「在途 / 刚回传」的状态', () => {
  function tap(c: Record<string, any>, key: string) {
    const item = (c.data.acts as any[]).find((a) => a.key === key);
    c.onActionTap({ currentTarget: { dataset: { key, kind: item ? item.kind : '' } } });
  }

  it('提交中（busy）：页面把 key 加进来也不许跳成「已收藏」', () => {
    const c = makeDrawer({ visible: false, scope: 'line', lineText: 'A.', collectedKeys: [] });
    c.scope('line');
    setProp(c, 'visible', true);
    tap(c, 'collect-line');                            // busy
    expect(c.data.collect.line).toBe('busy');
    setProp(c, 'collectedKeys', ['collect-line']);     // 页面拿到成功回执后同步 → observer
    expect(c.data.collect.line).toBe('busy');          // 仍在途（不许假成功）
    expect(renderedOf(c, 'collect-line').label).toBe('收藏中');
  });

  it('刚回传 existed（✓ 已在收藏提示）：集合对齐不许把它抹成「已收藏」', () => {
    const c = makeDrawer({ visible: false, scope: 'line', lineText: 'A.', collectedKeys: [] });
    c.scope('line');
    setProp(c, 'visible', true);
    tap(c, 'collect-line');
    c.onCollectDone('line', true, true);               // 页面回传：已存在
    expect(c.data.collect.line).toBe('existed');
    setProp(c, 'collectedKeys', ['collect-line']);
    expect(c.data.collect.line).toBe('existed');       // 提示保留（方案 B 的反馈不能被初值吃掉）
    expect(renderedOf(c, 'collect-line').label).toBe('已在收藏');
    expect(renderedOf(c, 'collect-line').cls).toContain('is-collected');
  });

  it('抽屉没开时改集合不改任何状态（属性在页面 data 里长期存在）', () => {
    const c = makeDrawer({ visible: false, scope: 'line', lineText: 'A.', collectedKeys: [] });
    c.scope('line');
    const spy = jest.spyOn(c, 'setData');
    setProp(c, 'collectedKeys', ['collect-line']);
    expect(spy).not.toHaveBeenCalled();
    expect(c.data.collect.line).toBe('idle');
  });

  it('值没变就不 setData（避免无意义重绘，打开那一帧不闪）', () => {
    const c = makeDrawer({ visible: false, scope: 'line', lineText: 'A.', collectedKeys: ['collect-line'] });
    c.scope('line');
    setProp(c, 'visible', true);                       // 首次对齐：done
    const spy = jest.spyOn(c, 'setData');
    setProp(c, 'collectedKeys', ['collect-line']);     // 同样的集合再来一次（页面换成等值新数组）
    expect(spy).not.toHaveBeenCalled();
  });
});
