/// <reference types="node" />
/**
 * components/action-drawer 组件单测 + 硬红线静态断言
 *
 * 桩范式沿用 `tests/tabbar-highlight.test.ts:55-72`：mock 全局 Component 捕获配置，
 * 再构造最小实例手工 bind methods / lifetimes / pageLifetimes / observers 驱动。
 * （仓库 devDependency 里的 `miniprogram-simulate` 从未被使用过 → 本轮仍不引入，
 *   与方案 §7.2 U5「未验证」结论一致。）
 *
 * 覆盖方案 §3 事件契约 / §4 状态机 / §5 播放态归属，以及三条硬红线：
 *  - A8「组件内不得 import 任何 services」（静态 grep，命中即红）
 *  - 组件不测任何坐标（无 selectorQuery / boundingClientRect / scrollOffset / px→rpx 定位）
 *  - 组件不订阅播放态（不 import tts、不调 onSpeakState）
 */
import * as fs from 'fs';
import * as path from 'path';

const APP = path.resolve(__dirname, '..');
const src = (rel: string): string => fs.readFileSync(path.join(APP, rel), 'utf8');

type ComponentCfg = Record<string, any>;
let drawerCfg: ComponentCfg | null = null;

beforeAll(() => {
  (globalThis as any).Component = (cfg: ComponentCfg) => { drawerCfg = cfg; };
  require('../components/action-drawer/index');
});

const wxStub = {
  getSystemInfoSync: jest.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
};

beforeEach(() => {
  jest.clearAllMocks();
  wxStub.getSystemInfoSync.mockImplementation(() => ({ windowWidth: 375, windowHeight: 667 }));
  (globalThis as any).wx = wxStub;
});

/** 组件属性默认值 → data（真机里 properties 通过 this.data 读取） */
function propDefaults(cfg: ComponentCfg): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg.properties || {})) {
    out[k] = (v as { value?: unknown }).value;
  }
  return out;
}

/** 构造最小组件实例：data = 属性默认值 + data 默认值；方法/生命周期/observer 全部 bind */
function makeDrawer(props: Record<string, unknown> = {}): Record<string, any> {
  const cfg = drawerCfg as ComponentCfg;
  const instance: Record<string, any> = {
    data: { ...propDefaults(cfg), ...JSON.parse(JSON.stringify(cfg.data || {})), ...props },
    setData(this: Record<string, any>, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    },
    triggerEvent: jest.fn(),
  };
  const bind = (obj: Record<string, any> | undefined) => {
    Object.keys(obj || {}).forEach((k) => {
      if (typeof obj![k] === 'function') instance[k] = (obj![k] as (...a: unknown[]) => unknown).bind(instance);
    });
  };
  bind(cfg.methods);
  bind(cfg.lifetimes);
  bind(cfg.pageLifetimes);
  bind(cfg.observers);
  return instance;
}

// ─────────────────────────── 硬红线（静态） ───────────────────────────

describe('硬红线 · 组件不得下沉业务 / 不得测坐标 / 不得感知播放态', () => {
  const ts = () => src('components/action-drawer/index.ts');
  const wxml = () => src('components/action-drawer/index.wxml');
  const wxss = () => src('components/action-drawer/index.wxss');
  const json = () => src('components/action-drawer/index.json');

  it('A8：组件 4 个文件都不得 import services（只允许 utils/line-actions）', () => {
    for (const f of [ts(), wxml(), wxss(), json()]) {
      expect(f).not.toMatch(/from\s+['"][^'"]*services\//);
    }
    // 唯一允许的 import：纯函数层
    expect(ts()).toMatch(/from '\.\.\/\.\.\/utils\/line-actions'/);
    // 也不得反向查页面上下文（getCurrentPages / getApp）
    expect(ts()).not.toMatch(/getCurrentPages|getApp\(/);
  });

  it('组件内不得出现任何坐标测量 / px→rpx 定位链路（B 变体不测坐标）', () => {
    // 只看代码不看注释：文件头「不测任何坐标」的红线说明里会**提到**这些标识符
    const t = ts().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(t).not.toMatch(/createSelectorQuery/);
    expect(t).not.toMatch(/boundingClientRect/);
    expect(t).not.toMatch(/scrollOffset/);
    const w = wxml().replace(/<!--[\s\S]*?-->/g, '');   // 去注释：红线说明里会提到 left:{{…}}rpx
    expect(w).not.toMatch(/left:\{\{/);
    expect(w).not.toMatch(/top:\{\{/);
    expect(w).not.toMatch(/rpx/);
  });

  it('A5：组件不订阅、不感知播放态（不 import tts、不调 onSpeakState / speakText）', () => {
    const t = ts().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(t).not.toMatch(/onSpeakState|speakText|stopSpeak|services\/tts/);
  });

  it('styleIsolation 显式钉为 isolated（D6：页面档位 class 不穿透，抽屉恒不透明白底）', () => {
    const j = JSON.parse(json());
    expect(j.component).toBe(true);
    expect(j.styleIsolation).toBe('isolated');
    // 组件内禁用标签名选择器（官方：不受样式隔离限制，会对全应用生效）
    const css = wxss();
    expect(css).not.toMatch(/(^|\})\s*(view|text|button|image)\s*\{/);
  });

  it('抽屉贴底通栏 + 遮罩层级 + 安全区 + 小屏补格高（D1 / D6 / D7）', () => {
    const css = wxss();
    const drawer = (/\.ad-drawer\s*\{[^}]*\}/.exec(css) || [''])[0];
    expect(drawer).toMatch(/position:\s*fixed/);
    expect(drawer).toMatch(/left:\s*0/);
    expect(drawer).toMatch(/right:\s*0/);
    expect(drawer).toMatch(/bottom:\s*0/);
    expect(drawer).toMatch(/max-height:\s*40vh/);
    expect(drawer).toMatch(/env\(safe-area-inset-bottom/);
    expect(drawer).toMatch(/background:\s*#FFFFFF/);
    const mask = (/\.ad-mask\s*\{[^}]*\}/.exec(css) || [''])[0];
    expect(mask).toMatch(/rgba\(17,\s*24,\s*39,\s*\.34\)/);
    expect(Number((/z-index:\s*(\d+)/.exec(mask) || ['', '0'])[1])).toBeLessThan(
      Number((/z-index:\s*(\d+)/.exec(drawer) || ['', '0'])[1]),
    );
    // <360px：48vh + 104rpx 格高（44.4px ≥ 44pt）
    expect(css).toMatch(/@media \(max-width:\s*359px\)/);
    expect(css).toMatch(/max-height:\s*48vh/);
    expect(css).toMatch(/height:\s*104rpx/);
    expect(css).toMatch(/height:\s*96rpx/);        // 375 屏基准格高
  });

  it('wxml 里出现的事件名全部属于 EVT 值集合（K11：拼错即红）', () => {
    const w = wxml();
    const evtValues = new Set(['speak-line', 'speak-word', 'collect-line', 'collect-word', 'close']);
    const names = Array.from(w.matchAll(/triggerEvent\('([a-z-]+)'/g)).map((m) => m[1]);
    names.forEach((n) => expect(evtValues.has(n)).toBe(true));
    // 组件的 catch/bind 只绑定自身方法，不出现向外的自定义事件名（向外一律 triggerEvent）
    const binds = Array.from(w.matchAll(/(?:bind|catch)(?::)?([a-z-]+)=/g)).map((m) => m[1]);
    binds.forEach((b) => expect(evtValues.has(b)).toBe(false));
  });
});

// ─────────────────────────── 行为 ───────────────────────────

describe('属性 → 动作集合（scope 换档）', () => {
  it('默认（scope 空）按句档兜底：2 项', () => {
    const c = makeDrawer();
    expect(c.data.acts.map((a: any) => a.label)).toEqual(['朗读此句', '收藏此句']);
  });

  it('scope=word → 4 项，顺序固定（行=对象、列=动词）', () => {
    const c = makeDrawer({ scope: 'word' });
    c.scope('word');   // observer
    expect(c.data.acts.map((a: any) => a.label))
      .toEqual(['朗读此句', '收藏此句', '朗读单词', '收藏单词']);
  });

  it('scope 回落到 line → 只剩 2 项', () => {
    const c = makeDrawer({ scope: 'word' });
    c.scope('word');
    c.scope('line');
    expect(c.data.acts).toHaveLength(2);
  });
});

describe('动作事件 payload（方案 §3.2 契约 3：不带任何页面上下文 meta）', () => {
  function press(scope: 'line' | 'word', key: string, extra: Record<string, unknown> = {}) {
    const c = makeDrawer({
      visible: true,
      scope,
      lineText: 'He is an engineer.',
      lineIndex: 2,
      word: 'engineer',
      wordHasDef: true,
      phonetic: '/en/',
      ...extra,
    });
    c.onActionTap({ currentTarget: { dataset: { key } } });
    return c;
  }

  it('speak-line → { lineIndex, text }', () => {
    const c = press('line', 'speak-line');
    expect(c.triggerEvent).toHaveBeenCalledWith('speak-line', { lineIndex: 2, text: 'He is an engineer.' });
  });

  it('collect-line → { lineIndex, text }', () => {
    const c = press('line', 'collect-line');
    expect(c.triggerEvent).toHaveBeenCalledWith('collect-line', { lineIndex: 2, text: 'He is an engineer.' });
  });

  it('speak-word → { word, lineIndex }', () => {
    const c = press('word', 'speak-word');
    expect(c.triggerEvent).toHaveBeenCalledWith('speak-word', { word: 'engineer', lineIndex: 2 });
  });

  it('collect-word → { word, lineIndex, hasDef }', () => {
    const c = press('word', 'collect-word');
    expect(c.triggerEvent).toHaveBeenCalledWith('collect-word', { word: 'engineer', lineIndex: 2, hasDef: true });
  });

  it('payload 里不得出现 book / lessonId / sourceText / from 等页面私有上下文', () => {
    for (const key of ['speak-line', 'collect-line', 'speak-word', 'collect-word']) {
      const c = press(key.indexOf('word') >= 0 ? 'word' : 'line', key);
      const payload = c.triggerEvent.mock.calls[0][1] as Record<string, unknown>;
      for (const banned of ['book', 'lessonId', 'sourceText', 'from', 'meta']) {
        expect(banned in payload).toBe(false);
      }
    }
  });
});

describe('busy 锁 300ms（防连点重复请求）', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('同一动作连点两次只触发一次；300ms 后可再次触发', () => {
    const c = makeDrawer({ visible: true, scope: 'line', lineIndex: 0, lineText: 'A.' });
    c.onActionTap({ currentTarget: { dataset: { key: 'speak-line' } } });
    c.onActionTap({ currentTarget: { dataset: { key: 'speak-line' } } });
    expect(c.triggerEvent).toHaveBeenCalledTimes(1);
    expect(c.data.busy).toBe(true);
    jest.advanceTimersByTime(300);
    expect(c.data.busy).toBe(false);
    c.onActionTap({ currentTarget: { dataset: { key: 'speak-line' } } });
    expect(c.triggerEvent).toHaveBeenCalledTimes(2);
  });

  it('空 key 不触发任何事件（脏 dataset 防御）', () => {
    const c = makeDrawer({ visible: true, scope: 'line' });
    c.onActionTap({ currentTarget: { dataset: {} } });
    expect(c.triggerEvent).not.toHaveBeenCalled();
  });

  it('detached 后定时器到点不再 setData（防卸载后 setData 告警）', () => {
    const c = makeDrawer({ visible: true, scope: 'line' });
    c.attached();
    c.onActionTap({ currentTarget: { dataset: { key: 'speak-line' } } });
    const spy = jest.spyOn(c, 'setData');
    c.detached();
    jest.advanceTimersByTime(500);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('关闭三通道：组件只抛 signal，自己不关（契约 1）', () => {
  it('点遮罩 → close {via:"mask"}，组件不改 visible', () => {
    const c = makeDrawer({ visible: true, scope: 'line' });
    c.onMaskTap();
    expect(c.triggerEvent).toHaveBeenCalledWith('close', { via: 'mask' });
    expect(c.data.visible).toBe(true);
  });

  it('点 ✕ → close {via:"close"}', () => {
    const c = makeDrawer({ visible: true, scope: 'line' });
    c.onCloseTap();
    expect(c.triggerEvent).toHaveBeenCalledWith('close', { via: 'close' });
  });

  it('下滑 ≥48rpx 松手 → close {via:"swipe"}', () => {
    const c = makeDrawer({ visible: true, scope: 'line' });
    c.onTouchStart({ touches: [{ clientY: 100 }] });
    c.onTouchMove({ touches: [{ clientY: 130 }] });   // 30px = 60rpx（375 宽）
    expect(c.data.swipeY).toBe(30);
    c.onTouchEnd();
    expect(c.triggerEvent).toHaveBeenCalledWith('close', { via: 'swipe' });
  });

  it('下滑 <48rpx 松手 → 回弹不关（BB7）', () => {
    const c = makeDrawer({ visible: true, scope: 'line' });
    c.onTouchStart({ touches: [{ clientY: 100 }] });
    c.onTouchMove({ touches: [{ clientY: 110 }] });   // 10px = 20rpx
    c.onTouchEnd();
    expect(c.triggerEvent).not.toHaveBeenCalled();
    expect(c.data.swipeY).toBe(0);
    expect(c.data.dragging).toBe(false);
  });

  it('上滑不产生位移（抽屉不会被往上拖出屏）', () => {
    const c = makeDrawer({ visible: true, scope: 'line' });
    c.onTouchStart({ touches: [{ clientY: 200 }] });
    c.onTouchMove({ touches: [{ clientY: 120 }] });
    expect(c.data.swipeY).toBe(0);
  });

  it('touchmove/touchend 缺 touchstart 时不抛（合成事件防御）', () => {
    const c = makeDrawer({ visible: true, scope: 'line' });
    expect(() => c.onTouchMove({ touches: [{ clientY: 1 }] })).not.toThrow();
    expect(() => c.onTouchEnd()).not.toThrow();
  });

  it('windowWidth 异常（0）→ 阈值换算不得产生 NaN，按 375 兜底', () => {
    wxStub.getSystemInfoSync.mockReturnValueOnce({ windowWidth: 0, windowHeight: 0 });
    const c = makeDrawer({ visible: true, scope: 'line' });
    expect(c._pxToRpx(24)).toBeCloseTo(48, 6);   // 24px × 750/375 = 48rpx
  });
});

describe('局部态归零（visible=false / pageLifetimes.hide / 关闭共用一处）', () => {
  it('visible 变 false → swipeY / dragging / busy / pressedKey 全归零', () => {
    const c = makeDrawer({ visible: true, scope: 'line' });
    c.setData({ swipeY: 40, dragging: true, busy: true, pressedKey: 'speak-line' });
    c.visible(false);
    expect(c.data).toMatchObject({ swipeY: 0, dragging: false, busy: false, pressedKey: '' });
  });

  it('pageLifetimes.hide → 同样归零（T11：抽屉打开时切后台）', () => {
    const c = makeDrawer({ visible: true, scope: 'line' });
    c.setData({ swipeY: 40, dragging: true, busy: true, pressedKey: 'collect-line' });
    c.hide();
    expect(c.data).toMatchObject({ swipeY: 0, dragging: false, busy: false, pressedKey: '' });
  });
});
