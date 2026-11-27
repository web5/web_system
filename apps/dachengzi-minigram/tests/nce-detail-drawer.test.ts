/// <reference types="node" />
/**
 * 课文详情页 · 长按动作抽屉接入（2026-11-26 变体 B / R-READ-04）
 *
 * 这份文件只锁「本轮新增的那层结构」，不重复 v7c / playstate / word-ux 已有的行为断言：
 *  1. **单槽位不变量**（方案 §4.1 / F1 / F2）：`data` 里只有 `overlay` 一个浮层字段，
 *     旧五字段（bubbleIdx / bubblePos / wordBubble / tipWord / tipPos）彻底消失；
 *     每一次 setData 的 patch 里 `overlay` 只能是「一个值」→ 两浮层同帧并存结构上不可能。
 *  2. **组件 7 个 properties + 5 个 bind 的接线**（漏一个就是某个动作静默失效）。
 *  3. **U1 行尾 ■ 停止按钮**（2026-11-26 19:15 拍板）：只在 `readingLineIdx === si` 时渲染，
 *     点击 = stopSpeak + 播放态归零。
 *  4. **T11 / F5**：页面 onHide 必须把浮层归零（否则回页面时抽屉「自己回来」）。
 */
import * as fs from 'fs';
import * as path from 'path';

const APP = path.resolve(__dirname, '..');
const src = (rel: string): string => fs.readFileSync(path.join(APP, rel), 'utf8');

/**
 * 去掉 wxml 注释后再断言。
 * 理由（不是放宽）：注释不参与渲染，而本轮**必须**在模板里留痕说明「为什么删了旧气泡 / 为什么
 * 加行尾 ■」，留痕文本本身会提到 `word-bubble`、`♪`、`■` 这些字面量。若直接在原文上断，
 * 会把「解释性注释」误判成「节点还在」。剥注释后断言的是真正会渲染的部分，比原文更贴近事实。
 */
const stripWxmlComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '');

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

import { stopSpeak } from '../services/tts';

const stopSpeakMock = stopSpeak as unknown as jest.Mock;

const wxMock = {
  getStorageSync: jest.fn(() => 1),
  setStorageSync: jest.fn(),
  showToast: jest.fn(),
  setNavigationBarTitle: jest.fn(),
  pageScrollTo: jest.fn(),
  getSystemInfoSync: jest.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
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

beforeEach(() => jest.clearAllMocks());

/** 页面上下文桩：记录每次 setData 的 patch，便于断「同帧只有一种 overlay」 */
function makeCtx(readMode = 'tap') {
  const patches: Array<Record<string, unknown>> = [];
  const ctx: any = {
    data: JSON.parse(JSON.stringify({ ...pageConfig.data, readMode })),
    setData(patch: Record<string, unknown>) {
      patches.push(patch);
      Object.assign(this.data, patch);
    },
    patches,
    _playingIdx: -1,
    _speakingWord: '',
    _playingText: '',
    _offSpeakState: null,
    // onHide 会依次调 stopSpeak() / _resetPlayingState() / _unsubscribeReading()；
    // 桩里 _offSpeakState 为 null，_unsubscribeReading 必须是可调用函数（与真机上
    // onLoad 里赋值的那个闭包等价：只是退订，无返回值）。
    _unsubscribeReading: jest.fn(),
  };
  for (const k of [
    '_lookupWord', '_applyLineTap', 'toggleLine', 'openOverlay', 'closeOverlay', 'closeTip',
    '_resetPlayingState', '_lineIdxOf', '_onSpeakState', 'stopLineSpeak',
    // 2026-11-27 D1：收藏 payload 抽到 `_collectLine` / `_collectWord`，词卡三态走
    // `_tipCollectPatch` / `_setTipCollect` / `_clearTipCollectTimer`（桩必须与调用面同步）
    '_collectLine', '_collectWord', '_tipCollectPatch', '_setTipCollect', '_clearTipCollectTimer',
    // 2026-11-27 D7 双向同步：抽屉已收藏 key 集合的两个算口（桩必须与调用面同步）
    '_drawerCollectedKeys', '_withCollectedKey',
  ]) {
    ctx[k] = pageConfig[k];
  }
  ctx.data.lines = [
    { idx: 0, en: 'He is an engineer.', cn: '他是工程师。', tokens: [] },
    { idx: 1, en: 'She is a doctor.', cn: '她是医生。', tokens: [] },
  ];
  ctx.data.detail = { id: 4, title: 'L4', words: [{ word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/en/' }] };
  ctx.data.book = 'NCE2';
  ctx.data.id = 4;
  return ctx;
}

// ─────────────────────────── 1. 单槽位不变量 ───────────────────────────

describe('单槽位 overlay（方案 §4.1 / F1 / F2）', () => {
  it('data 里只有 overlay 一个浮层字段，旧五字段彻底不存在', () => {
    for (const gone of ['bubbleIdx', 'bubblePos', 'wordBubble', 'tipWord', 'tipPos']) {
      expect(gone in pageConfig.data).toBe(false);
    }
    expect('overlay' in pageConfig.data).toBe(true);
    expect(pageConfig.data.overlay).toBeNull();   // 初始 idle
  });

  it('任意入口都只写 overlay 一个值：patch 里不可能出现「两个 kind 并存」', () => {
    const ctx = makeCtx();
    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'engineer', i: 0, hasdef: true } } });
    pageConfig.onWordLongPress.call(ctx, { currentTarget: { dataset: { w: 'engineer', i: 0, hasdef: true } } });
    pageConfig.onLongPress.call(ctx, { currentTarget: { dataset: { i: 1 } } });
    pageConfig.onDrawerClose.call(ctx, { detail: { via: 'mask' } });
    // 每个 patch 里最多一个 overlay 键，且没有任何旧字段
    for (const p of ctx.patches) {
      expect(Object.keys(p).filter((k) => k === 'overlay')).toHaveLength(p.overlay === undefined ? 0 : 1);
      for (const gone of ['bubbleIdx', 'bubblePos', 'wordBubble', 'tipWord', 'tipPos']) {
        expect(gone in p).toBe(false);
      }
    }
    // 任意时刻 overlay 只有一个 kind
    expect(ctx.data.overlay).toBeNull();
  });

  it('词卡 → 抽屉 → 词卡：每次都是整体替换（不会残留上一个 kind 的字段）', () => {
    const ctx = makeCtx();
    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'engineer', i: 0, hasdef: true } } });
    expect(ctx.data.overlay.kind).toBe('wordtip');
    pageConfig.onWordLongPress.call(ctx, { currentTarget: { dataset: { w: 'engineer', i: 0, hasdef: true } } });
    expect(ctx.data.overlay.kind).toBe('drawer');
    expect('none' in ctx.data.overlay).toBe(false);   // 词卡字段没有残留
    pageConfig.onWordTap.call(ctx, { currentTarget: { dataset: { w: 'engineer', i: 0, hasdef: true } } });
    expect(ctx.data.overlay.kind).toBe('wordtip');
    expect('scope' in ctx.data.overlay).toBe(false);  // 抽屉字段没有残留
  });

  it('onHide 必须把浮层归零（T11 / F5：否则回页面时抽屉自己回来）', () => {
    const ctx = makeCtx();
    pageConfig.onLongPress.call(ctx, { currentTarget: { dataset: { i: 0 } } });
    expect(ctx.data.overlay).not.toBeNull();
    pageConfig.onHide.call(ctx);
    expect(ctx.data.overlay).toBeNull();
  });
});

// ─────────────────────────── 2. 组件接线 ───────────────────────────

describe('抽屉组件接线（properties / events 一个都不能少）', () => {
  const wxml = () => src('pages/nce/detail/detail.wxml');
  const wxmlNode = () => stripWxmlComments(wxml());
  const json = () => JSON.parse(src('pages/nce/detail/detail.json'));

  it('detail.json 注册 action-drawer 组件', () => {
    expect(json().usingComponents['action-drawer']).toBe('/components/action-drawer/index');
  });

  it('wxml 传齐 7 个 properties 与 3 个 bind 事件', () => {
    const w = wxml();
    for (const prop of ['visible', 'scope', 'line-text', 'line-index', 'word', 'word-has-def', 'phonetic']) {
      expect(w).toContain(`${prop}="{{`);
    }
    // 2026-11-26 变体 C（用户拍板）：朗读下沉到组件 → speak-line / speak-word 两个 bind 已删除，
    // 只剩「收藏两项 + close」。反向断言防止有人把朗读绑定加回来（会与组件本地朗读重复触发）。
    for (const evt of ['collect-line', 'collect-word', 'close']) {
      expect(w).toContain(`bind:${evt}="`);
    }
    expect(w).not.toContain('bind:speak-line');
    expect(w).not.toContain('bind:speak-word');
    // 三个 handler 都必须真实存在（漏实现 = 运行时静默失效）
    for (const fn of ['onDrawerCollectLine', 'onDrawerCollectWord', 'onDrawerClose']) {
      expect(typeof pageConfig[fn]).toBe('function');
    }
  });

  it('旧长按气泡节点与锚点绑定已从 wxml 删除', () => {
    const w = wxmlNode();
    expect(w).not.toMatch(/class="bubble/);
    expect(w).not.toMatch(/class="bi"/);
    expect(w).not.toMatch(/word-bubble/);
    expect(w).not.toMatch(/data-bubble-act|data-word-act/);
    expect(w).not.toMatch(/closeBubble|closeWordBubble|onBubbleSpeak|onWordBubbleSpeak|collectLine|collectWord/);
    // 旧气泡靠内联坐标定位；抽屉靠 position:fixed，节点里不允许出现任何锚点几何量
    expect(w).not.toMatch(/pageX|pageY|clientX|clientY|bubblePos|tipPos|left:\{\{|top:\{\{/);
  });
});

// ─────────────────────────── 3. U1 行尾 ■ 停止按钮 ───────────────────────────

describe('U1（2026-11-26 19:15 拍板）：句子行尾停止按钮', () => {
  /**
   * 🔴 2026-11-27 附加项改写（不是放松）：字符 ■ 换成 `assets/icons/stop.svg`
   * （上一批统一三处播放图标后，这里成了唯一的字符残留）。`<text>` 装不下 `<image>`，
   * 外层由 `<text>` 改成 `<view>`（display:inline-block 保持行内）。
   * 判据改为：渲染条件 + 点击 handler + 图标来源（循环体内取行项上的 `line.stopIcon`），
   * 并反向禁止 ■ 回潮。
   */
  it('静态：停止入口只在 readingLineIdx === si 时渲染（不播放时节点不存在），图标 = stop.svg', () => {
    const w = stripWxmlComments(src('pages/nce/detail/detail.wxml'));
    const at = w.indexOf('class="sent-stop"');
    expect(at).toBeGreaterThan(-1);   // 防空转：真的抓到了节点
    const node = w.slice(Math.max(0, at - 120), at + 260);
    expect(node).toMatch(/wx:if="\{\{readingLineIdx === si\}\}"/);
    expect(node).toMatch(/catchtap="stopLineSpeak"/);
    expect(node).toMatch(/<image class="sent-stop-ico" mode="aspectFit" src="\{\{line\.stopIcon\}\}" \/>/);
    // 渲染层不再出现任何 ■（字符形态回潮即红）
    expect(w).not.toMatch(/■/);
  });

  it('行为：点它 = stopSpeak + 播放态归零', () => {
    const ctx = makeCtx();
    ctx.data.readingLineIdx = 1;
    ctx.data.readingPhase = 'playing';
    ctx.data.wordPlaying = 'engineer';
    ctx.data.tipPlaying = true;
    const before = stopSpeakMock.mock.calls.length;
    pageConfig.stopLineSpeak.call(ctx);
    expect(stopSpeakMock.mock.calls.length).toBeGreaterThan(before);
    expect(ctx.data).toMatchObject({
      readingLineIdx: -1, readingPhase: 'idle', wordPlaying: '', tipPlaying: false,
    });
  });

  it('静态：句子区仍无常驻 ♪/☆ 控件（V7-C 口径未被 U1 破坏）', () => {
    const w = stripWxmlComments(src('pages/nce/detail/detail.wxml'));
    expect(w).not.toMatch(/class="acts"|class="play"|class="fav"/);
    expect(w).not.toMatch(/♪|☆/);
    // U1 的 ■ 必须挂在「行尾」也就是 .en 内部，且必须带 wx:if（不是常驻）
    const enBlock = /<view class="en">([\s\S]*?)<\/view>/.exec(w);
    expect(enBlock).not.toBeNull();
    expect(enBlock![1]).toMatch(/wx:if="\{\{readingLineIdx === si\}\}"/);
  });

  it('代码注释里写清了 U1 与 V7-C 不冲突的理由（给后来人）', () => {
    const ts = src('pages/nce/detail/detail.ts');
    const doc = /stopLineSpeak/.exec(ts) ? ts : '';
    expect(doc).toMatch(/只在播放中渲染/);
    expect(doc).toMatch(/V7-C/);
    expect(doc).toMatch(/停止/);
  });
});
