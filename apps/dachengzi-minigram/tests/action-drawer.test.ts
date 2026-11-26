/// <reference types="node" />
/**
 * components/action-drawer 组件单测 + 硬红线静态断言
 *
 * 桩范式沿用 `tests/tabbar-highlight.test.ts:55-72`：mock 全局 Component 捕获配置，
 * 再构造最小实例手工 bind methods / lifetimes / pageLifetimes / observers 驱动。
 * （仓库 devDependency 里的 `miniprogram-simulate` 从未被使用过 → 本轮仍不引入，
 *   与方案 §7.2 U5「未验证」结论一致。）
 *
 * 覆盖方案 §3 事件契约 / §4 状态机，以及 2026-11-26 变体 C 后的四条硬红线：
 *  - A8（收窄）「组件只允许 import `services/tts`，其余 services 一律禁止」（静态 grep，命中即红）
 *  - 组件不测任何坐标（无 selectorQuery / boundingClientRect / scrollOffset / px→rpx 定位）
 *  - A5（反转）组件**必须**订阅 tts 播放态：朗读已下沉到组件（用户 2026-11-26 拍板）
 *
 * 🔴 变体 C 的核心契约（本文件新增用例逐条锁住）：
 *  点朗读按钮 → 组件内直接 speakText、抽屉不关、不 emit、按钮自切 ▶/■；
 *  收藏 → 仍 emit 回页面（两页 toast / 内联 modal 差异留页面）。
 */
import * as fs from 'fs';
import * as path from 'path';

const APP = path.resolve(__dirname, '..');
const src = (rel: string): string => fs.readFileSync(path.join(APP, rel), 'utf8');

type ComponentCfg = Record<string, any>;
let drawerCfg: ComponentCfg | null = null;

/**
 * 忠实 tts 桩（口径同 `tests/nce-detail-playstate.test.ts`）：
 * speakText 同文本再调 = 停止；stopSpeak 仅在非空闲时推 null；onSpeakState 只在状态变化时回调。
 * `calls` 记录调用顺序，用于「先 stopSpeak 再 emit close」的顺序断言。
 */
const mockTts: {
  listeners: Set<(s: any) => void>;
  state: any;
  calls: string[];
  emit: (s: any) => void;
  speak: (t: string) => Promise<boolean>;
  stop: () => void;
} = {
  listeners: new Set(),
  state: null,
  calls: [],
  emit(next: any) {
    mockTts.state = next;
    mockTts.listeners.forEach((cb) => cb(next));
  },
  speak(text: string) {
    const t = String(text || '').trim();
    mockTts.calls.push(`speak:${t}`);
    mockTts.stop();
    mockTts.emit({ text: t, phase: 'loading' });
    mockTts.emit({ text: t, phase: 'playing' });
    return Promise.resolve(true);
  },
  stop() {
    mockTts.calls.push('stop');
    if (mockTts.state) mockTts.emit(null);
  },
};
jest.mock('../services/tts', () => ({
  speakText: (t: string) => mockTts.speak(t),
  stopSpeak: () => mockTts.stop(),
  onSpeakState: (cb: (s: any) => void) => {
    mockTts.listeners.add(cb);
    return () => { mockTts.listeners.delete(cb); };
  },
}));

beforeAll(() => {
  (globalThis as any).Component = (cfg: ComponentCfg) => { drawerCfg = cfg; };
  require('../components/action-drawer/index');
});

const wxStub = {
  getSystemInfoSync: jest.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTts.listeners.clear();
  mockTts.state = null;
  mockTts.calls = [];
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

describe('硬红线 · 组件不得下沉业务 / 不得测坐标 / 必须订阅播放态', () => {
  const ts = () => src('components/action-drawer/index.ts');
  const wxml = () => src('components/action-drawer/index.wxml');
  const wxss = () => src('components/action-drawer/index.wxss');
  const json = () => src('components/action-drawer/index.json');

  /**
   * 🔴 A8 收窄（2026-11-26）—— 原断言是「组件 4 个文件都不得 import services」。
   *
   * 依据：**朗读下沉到组件是用户 2026-11-26 拍板**（设计真源
   * `30-任务产物/2026-11-26-阅读交互调整-原型稿/原型-变体C-抽屉内朗读.html`：
   * 抽屉已持有原文，朗读不再 triggerEvent 回页面，而是在抽屉内直接切 ▶/■、不关抽屉）。
   * 下拉一层 ls 就知道为什么只能放 `services/tts` 一个：朗读是**纯副作用 + 自有播放态**，
   * 组件自持不会污染两页差异；而**收藏仍留页面**，为的是保留两页的 toast / 内联 modal 差异
   * （首页 `wx.showToast('请先登录')`、详情页 `modal-login`）—— 那部分一旦进组件，
   * 两页的授权形态就会被抹平成一种。
   * 所以红线收窄成：**只允许 `services/tts`，其余 services 一律禁止**（逐个 import 白名单比对，
   * 而不是「出现 services 就红」，否则朗读下沉这条拍板无法落地）。
   */
  it('A8（收窄）：组件只允许 import services/tts，其余 services 一律禁止', () => {
    const imports = Array.from(ts().matchAll(/from\s+['"]([^'"]*services\/[^'"]*)['"]/g)).map((m) => m[1]);
    expect(imports).toEqual(['../../services/tts']);
    // wxml / wxss / json 三个文件仍不得出现任何 services 引用（只有逻辑层允许 tts）
    for (const f of [wxml(), wxss(), json()]) {
      expect(f).not.toMatch(/services\//);
    }
    // 唯一允许的纯函数层 import 仍在（动作表真源）
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

  /**
   * 🔴 A5 反转（2026-11-26）：原断言是「组件不订阅、不感知播放态（不 import tts）」。
   * 变体 C 把播放态**归属**改成了组件（方案 §5.2 旧口径作废），所以断言方向必须反过来：
   * 组件**必须**订阅 `onSpeakState`（否则自然播完 / 失败后按钮永远回不到 ▶），
   * 并且只能用 tts 的三个公开出口（多一个就是绕过服务层）。
   */
  it('A5（反转）：组件必须订阅 tts 播放态，且只用 speakText / stopSpeak / onSpeakState', () => {
    const t = ts().replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(t).toMatch(/import\s*\{[^}]*speakText[^}]*\}\s*from\s*'\.\.\/\.\.\/services\/tts'/);
    expect(t).toMatch(/onSpeakState\(/);
    expect(t).toMatch(/speakText\(/);
    expect(t).toMatch(/stopSpeak\(/);
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
  /** 开一个抽屉并按 wxml 的口径点按钮（`data-key` + `data-kind`，两者都由 actionsOf 提供） */
  function opened(scope: 'line' | 'word') {
    const c = makeDrawer({
      visible: true,
      scope,
      lineText: 'He is an engineer.',
      lineIndex: 2,
      word: 'engineer',
      wordHasDef: true,
      phonetic: '/en/',
    });
    c.scope(scope);   // observer：把 acts 切成该档的 2/4 项
    return c;
  }
  function tap(c: Record<string, any>, key: string) {
    const item = (c.data.acts as any[]).find((a) => a.key === key);
    c.onActionTap({ currentTarget: { dataset: { key, kind: item ? item.kind : '' } } });
  }

  it('collect-line → { lineIndex, text }', () => {
    const c = opened('line');
    tap(c, 'collect-line');
    expect(c.triggerEvent).toHaveBeenCalledWith('collect-line', { lineIndex: 2, text: 'He is an engineer.' });
  });

  it('collect-word → { word, lineIndex, hasDef }', () => {
    const c = opened('word');
    tap(c, 'collect-word');
    expect(c.triggerEvent).toHaveBeenCalledWith('collect-word', { word: 'engineer', lineIndex: 2, hasDef: true });
  });

  it('反例（契约：朗读不 emit）：speak-line / speak-word 一个事件都不许抛', () => {
    const line = opened('line');
    tap(line, 'speak-line');
    const word = opened('word');
    tap(word, 'speak-word');
    expect(line.triggerEvent).not.toHaveBeenCalled();
    expect(word.triggerEvent).not.toHaveBeenCalled();
  });

  it('payload 里不得出现 book / lessonId / sourceText / from 等页面私有上下文', () => {
    for (const key of ['collect-line', 'collect-word']) {
      const c = opened(key.indexOf('word') >= 0 ? 'word' : 'line');
      tap(c, key);
      const payload = c.triggerEvent.mock.calls[0][1] as Record<string, unknown>;
      for (const banned of ['book', 'lessonId', 'sourceText', 'from', 'meta']) {
        expect(banned in payload).toBe(false);
      }
    }
  });
});

describe('busy 锁 300ms（防连点重复请求 · **只锁收藏**）', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('同一动作连点两次只触发一次；300ms 后可再次触发', () => {
    const c = makeDrawer({ visible: true, scope: 'line', lineIndex: 0, lineText: 'A.' });
    c.onActionTap({ currentTarget: { dataset: { key: 'collect-line' } } });
    c.onActionTap({ currentTarget: { dataset: { key: 'collect-line' } } });
    expect(c.triggerEvent).toHaveBeenCalledTimes(1);
    expect(c.data.busy).toBe(true);
    jest.advanceTimersByTime(300);
    expect(c.data.busy).toBe(false);
    c.onActionTap({ currentTarget: { dataset: { key: 'collect-line' } } });
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
    c.onActionTap({ currentTarget: { dataset: { key: 'collect-line' } } });
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
  it('visible 变 false → swipeY / dragging / busy / pressedKey / playingKey 全归零', () => {
    const c = makeDrawer({ visible: true, scope: 'line' });
    c.setData({ swipeY: 40, dragging: true, busy: true, pressedKey: 'collect-line', playingKey: 'speak-line' });
    c.visible(false);
    expect(c.data).toMatchObject({
      swipeY: 0, dragging: false, busy: false, pressedKey: '', playingKey: '',
    });
  });

  it('pageLifetimes.hide → 同样归零 + **先停朗读**（T11：抽屉打开时切后台）', () => {
    const c = makeDrawer({ visible: true, scope: 'line' });
    c.attached();   // 订阅 tts（真机里 hide 一定发生在 attached 之后）
    c.setData({ swipeY: 40, dragging: true, busy: true, pressedKey: 'collect-line', playingKey: 'speak-line' });
    mockTts.calls = [];
    c.hide();
    expect(mockTts.calls).toContain('stop');   // 契约 8：切后台必须停朗读，不留「回来还在念」
    expect(c.data).toMatchObject({
      swipeY: 0, dragging: false, busy: false, pressedKey: '', playingKey: '',
    });
  });

  it('detached → 退订 + 停朗读 + 清播放态（组件销毁后不许还在念）', () => {
    const c = makeDrawer({ visible: true, scope: 'word' });
    c.attached();
    expect(mockTts.listeners.size).toBe(1);
    mockTts.calls = [];
    c.detached();
    expect(mockTts.listeners.size).toBe(0);    // 退订：卸载后不再 setData
    expect(mockTts.calls).toContain('stop');
    expect(c.data.playingKey).toBe('');
  });
});

// ═══════════════ 变体 C：朗读下沉到组件（用户 2026-11-26 拍板的核心行为）═══════════════
//
// 设计真源：`30-任务产物/2026-11-26-阅读交互调整-原型稿/原型-变体C-抽屉内朗读.html`
//   · 朗读卡点按 = 组件内直接 `speakText`（抽屉已持有原文），**不 emit、不关抽屉**；
//   · 按钮自切播放态：▶ → ■、`朗读此句`→`停止此句`、`朗读单词`→`停止单词`、整卡品牌浅底；
//   · 再点同一个 = `stopSpeak()` 回 ▶；点另一个 = 停当前、起新的（同时只能一个在播）；
//   · 收藏卡行为完全不变（仍 emit 回页面）；
//   · 关闭（遮罩 / ✕ / 下滑）必须先 `stopSpeak()` 再 emit `close`。
describe('变体 C · 朗读下沉：本地调 tts、不 emit、不关抽屉、按钮自切播放态', () => {
  function opened(scope: 'line' | 'word' = 'word') {
    const c = makeDrawer({
      visible: true,
      scope,
      lineText: 'He is an engineer.',
      lineIndex: 2,
      word: 'engineer',
      wordHasDef: true,
      phonetic: '/en/',
    });
    c.scope(scope);
    return c;
  }
  function tap(c: Record<string, any>, key: string) {
    const item = (c.data.acts as any[]).find((a) => a.key === key);
    c.onActionTap({ currentTarget: { dataset: { key, kind: item ? item.kind : '' } } });
  }

  it('点「朗读单词」→ speakText(该词) + playingKey=speak-word + 不 emit + 抽屉不关', () => {
    const c = opened('word');
    tap(c, 'speak-word');
    expect(mockTts.calls).toContain('speak:engineer');   // 参数就是抽屉持有的那个词
    expect(c.data.playingKey).toBe('speak-word');
    expect(c.triggerEvent).not.toHaveBeenCalled();       // 契约 2：不 emit
    expect(c.data.visible).toBe(true);                   // 契约 2：抽屉不关
  });

  it('点「朗读此句」→ speakText(整句原文) + playingKey=speak-line', () => {
    const c = opened('line');
    tap(c, 'speak-line');
    expect(mockTts.calls).toContain('speak:He is an engineer.');
    expect(c.data.playingKey).toBe('speak-line');
    expect(c.triggerEvent).not.toHaveBeenCalled();
  });

  it('再点同一个播放中的按钮 → stopSpeak() 且按钮回 ▶（文案复原）', () => {
    jest.useFakeTimers();
    const c = opened('word');
    tap(c, 'speak-word');
    expect(c.data.playingKey).toBe('speak-word');
    jest.advanceTimersByTime(200);   // 越过 60ms 同帧防抖（真实双击间隔 ≥100ms）
    mockTts.calls = [];
    tap(c, 'speak-word');
    expect(mockTts.calls).toContain('stop');     // 契约 3
    expect(c.data.playingKey).toBe('');          // 文案回到 item.label（wxml 按 playingKey 插值）
    expect(c.triggerEvent).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('点另一个朗读按钮 → 停掉当前、开新的（同一时刻只有一个按钮播放态）', () => {
    jest.useFakeTimers();
    const c = opened('word');
    tap(c, 'speak-word');
    jest.advanceTimersByTime(200);
    mockTts.calls = [];
    tap(c, 'speak-line');
    expect(mockTts.calls).toContain('stop');                // 当前那个先停
    expect(mockTts.calls).toContain('speak:He is an engineer.');
    expect(c.data.playingKey).toBe('speak-line');           // 只剩新的那个是播放态
    jest.useRealTimers();
  });

  it('点「收藏单词」→ 仍 emit collect-word，且不调 speakText', () => {
    const c = opened('word');
    tap(c, 'collect-word');
    expect(c.triggerEvent).toHaveBeenCalledWith('collect-word', { word: 'engineer', lineIndex: 2, hasDef: true });
    expect(mockTts.calls.filter((x) => x.indexOf('speak:') === 0)).toEqual([]);
    expect(c.data.playingKey).toBe('');
  });

  it('onSpeakState(null)（自然播完 / 失败）→ 播放态自动复位', () => {
    const c = opened('word');
    c.attached();   // 订阅
    tap(c, 'speak-word');
    expect(c.data.playingKey).toBe('speak-word');
    mockTts.emit(null);   // 等价于 tts 播完 / 播放失败推 null
    expect(c.data.playingKey).toBe('');
  });

  it('onSpeakState 推来「不属于本抽屉」的文本 → 不点亮任何按钮（页面在播别的东西）', () => {
    const c = opened('word');
    c.attached();
    mockTts.emit({ text: 'some other sentence.', phase: 'playing' });
    expect(c.data.playingKey).toBe('');
  });

  it('原文为空（脏属性）→ 不亮播放态、也不调 speakText', () => {
    const c = makeDrawer({ visible: true, scope: 'word', lineText: '', word: '', lineIndex: 2 });
    c.scope('word');
    tap(c, 'speak-word');
    expect(mockTts.calls).toEqual([]);
    expect(c.data.playingKey).toBe('');
  });
});

describe('契约 6：关闭三通道都必须「先停朗读，再抛 close」（关了就不许还在念）', () => {
  function seqOf(c: Record<string, any>) {
    // 把 triggerEvent 也记进同一条时间线，才能断言「stop 在 emit 之前」
    c.triggerEvent = jest.fn((name: string) => { mockTts.calls.push(`emit:${name}`); });
    return mockTts.calls;
  }

  it('遮罩：stop → emit close{mask}', () => {
    const c = makeDrawer({ visible: true, scope: 'word', lineText: 'S.', word: 's' });
    c.scope('word');
    c.onActionTap({ currentTarget: { dataset: { key: 'speak-word', kind: 'speak' } } });
    const seq = seqOf(c);
    seq.length = 0;
    c.onMaskTap();
    expect(seq).toEqual(['stop', 'emit:close']);
  });

  it('✕：stop → emit close{close}', () => {
    const c = makeDrawer({ visible: true, scope: 'line', lineText: 'S.' });
    const seq = seqOf(c);
    seq.length = 0;
    c.onCloseTap();
    expect(seq).toEqual(['stop', 'emit:close']);
    expect(c.triggerEvent).toHaveBeenCalledWith('close', { via: 'close' });
  });

  it('下滑 ≥48rpx：stop → emit close{swipe}', () => {
    const c = makeDrawer({ visible: true, scope: 'line', lineText: 'S.' });
    const seq = seqOf(c);
    c.onTouchStart({ touches: [{ clientY: 100 }] });
    c.onTouchMove({ touches: [{ clientY: 130 }] });
    seq.length = 0;
    c.onTouchEnd();
    expect(seq).toEqual(['stop', 'emit:close']);
    expect(c.triggerEvent).toHaveBeenCalledWith('close', { via: 'swipe' });
  });

  it('关闭后播放态归零（不会带着 ■ 重新打开）', () => {
    const c = makeDrawer({ visible: true, scope: 'word', lineText: 'S.', word: 's' });
    c.scope('word');
    c.onActionTap({ currentTarget: { dataset: { key: 'speak-word', kind: 'speak' } } });
    expect(c.data.playingKey).toBe('speak-word');
    c.onMaskTap();
    expect(c.data.playingKey).toBe('');
  });
});
