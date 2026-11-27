/// <reference types="node" />
/**
 * 详情页生词卡 · D1 收藏三态 + D2 点空白关闭 + D7 收藏态回查（2026-11-27 第二批）
 *
 * 判据（用户逐条拍板，全按建议）：
 *  - D1：`.wt-tools` 里朗读圆钮与 ✕ **之间**有收藏按钮；图标/文案与首页词卡同一口径；
 *    `☆ 收藏 → ⋯ 收藏中（禁用）→ ✓ 已收藏`；重复点 `✓ 已在收藏` 1.8s 后回 `已收藏`；
 *    失败回 `☆ 收藏`；成功后**词卡不关**；未登录走本页内联 modal（不是 toast）；
 *    收藏 service 调用与抽屉**共用同一份实现**（`_collectWord` / `_collectLine`）。
 *  - D2：点词卡之外的空白 → 关闭；**点词仍然换内容**（不能被「先关再开」吃掉）；
 *    不加压暗/透明遮罩层；关闭时若正在读该词 → stopSpeak。
 *  - D7：打开词卡 / 抽屉时按**本地缓存**取初始态；缓存只当初值，点已收藏仍发真实写请求。
 *
 * 🔴 本文件刻意把「data → wxml 绑定」与「行为」分开断言：
 *    上一批的教训是「只断言 data 字段」的用例对「数据改了但图标没变」零鉴别力。
 */
export {};

/** tts 桩：只记录调用，播放态由测试显式推 */
const mockTts: any = {
  listeners: new Set<(s: any) => void>(),
  playingText: '',
  speakCalls: [] as string[],
  stopCalls: 0,
  emit(next: any) { mockTts.listeners.forEach((cb: (s: any) => void) => cb(next)); },
  speak(t: string) { mockTts.speakCalls.push(t); mockTts.playingText = t; mockTts.emit({ text: t, phase: 'playing' }); return Promise.resolve(true); },
  stop() { mockTts.stopCalls += 1; mockTts.playingText = ''; mockTts.emit(null); },
};
jest.mock('../services/tts', () => ({
  speakText: (t: string) => mockTts.speak(t),
  stopSpeak: () => mockTts.stop(),
  onSpeakState: (cb: (s: any) => void) => { mockTts.listeners.add(cb); return () => { mockTts.listeners.delete(cb); }; },
}));

const mockNce: any = { detail: null };
jest.mock('../services/nce', () => ({ getNceLesson: () => Promise.resolve(mockNce.detail) }));

const mockGlossary: any = { calls: [] as any[], resolve: null as any, reject: false };
jest.mock('../services/glossary', () => ({
  collectGlossary: (payload: any) => {
    mockGlossary.calls.push(payload);
    if (mockGlossary.reject) return Promise.reject(new Error('boom'));
    return Promise.resolve(mockGlossary.resolve || { id: 1, created: true, existed: false });
  },
}));

const mockAuth: any = { loggedIn: true };
jest.mock('../services/auth', () => ({
  isLoggedIn: () => mockAuth.loggedIn,
  loginFromGate: () => Promise.resolve(true),
}));

jest.mock('../pages/nce/books', () => ({ DEFAULT_NCE_BOOK: 'NCE2', nceBookTotal: () => 96 }));

/** storage 真的存住：D7 的缓存回查必须走真实 get/set 才测得出 */
let store: Record<string, any> = {};
const mockWx: any = {
  getStorageSync: jest.fn((k: string) => (store[k] === undefined ? '' : store[k])),
  setStorageSync: jest.fn((k: string, v: any) => { store[k] = v; }),
  removeStorageSync: jest.fn((k: string) => { delete store[k]; }),
  showToast: jest.fn(),
  getSystemInfoSync: jest.fn(() => ({ windowWidth: 375, windowHeight: 667 })),
  setNavigationBarTitle: jest.fn(),
  pageScrollTo: jest.fn(),
};

let pageConfig: any = null;
const WORD_LINE = 'He is an engineer.';

beforeAll(() => {
  (globalThis as any).wx = mockWx;
  (globalThis as any).getApp = () => ({ radiusClassOf: () => '', eventBus: { on: jest.fn(), off: jest.fn() } });
  (globalThis as any).Page = (cfg: any) => { pageConfig = cfg; };
  require('../pages/nce/detail/detail');
});

beforeEach(() => {
  store = {};
  jest.clearAllMocks();
  mockTts.listeners.clear();
  mockTts.playingText = '';
  mockTts.speakCalls = [];
  mockTts.stopCalls = 0;
  mockGlossary.calls = [];
  mockGlossary.resolve = null;
  mockGlossary.reject = false;
  mockAuth.loggedIn = true;
});

const fs = require('fs');
const path = require('path');
const APP = path.resolve(__dirname, '..');
const read = (p: string): string => fs.readFileSync(path.join(APP, p), 'utf8');
const DETAIL_WXML = 'pages/nce/detail/detail.wxml';
const DETAIL_TS = 'pages/nce/detail/detail.ts';
const stripWxml = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '');
const stripJs = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
/**
 * 🔴 `collectedKeys` 是**集合**语义，不是序列语义：
 *    它的消费方只有组件里的 `includes(key)`（决定某一项渲染成 ✓ 还是 ☆），
 *    「先收句子还是先收单词」不构成契约，也会随用户操作顺序而变。
 *    用 `toEqual(['collect-line','collect-word'])` 断，是在把「push 顺序」当契约钉死 ——
 *    真机换个顺序就一条绿一条红（原型复测第二轮指出）。故统一按排序后比较。
 */
const sortedKeys = (keys: readonly string[]): string[] => [...keys].sort();

/** 页面上下文：方法走 Page 原型（与真机一致），data 独立 */
function makeCtx(patch: Record<string, unknown> = {}): any {
  const ctx: any = Object.create(pageConfig);
  ctx.data = { ...JSON.parse(JSON.stringify(pageConfig.data)), ...patch };
  ctx.setData = function (p: Record<string, unknown>) { Object.assign(this.data, p); };
  ctx._playingText = '';
  ctx._playingIdx = -1;
  ctx._speakingWord = '';
  ctx._tipCollectTimer = null;
  ctx._offSpeakState = null;
  // 真实订阅 tts 播放态（tipPlaying 由 onSpeakState 回流点亮，不是页面自己猜）
  ctx._subscribeReading();
  ctx.data.lines = [{ idx: 0, en: WORD_LINE, cn: '他是工程师。', tokens: [], stopIcon: '/assets/icons/stop.svg' }];
  ctx.data.detail = { id: 4, title: 'L4', words: [{ word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/en/' }] };
  ctx.data.book = 'NCE2';
  ctx.data.id = 4;
  return ctx;
}

/** 打开词卡（走真实 onWordTap，D7 的初值读取也在里面） */
function openCard(ctx: any, w = 'engineer') {
  ctx.onWordTap({ currentTarget: { dataset: { i: 0, w, hasdef: true } } });
}

// ═════════════════════════ D1 静态：按钮存在 + 位置 + 绑定 ═════════════════════════
describe('D1 静态：词卡收藏按钮的结构与绑定', () => {
  const w = stripWxml(read(DETAIL_WXML));

  it('按钮在 .wt-tools 内、朗读圆钮之后、✕ 之前（顺序即用户要求的位置）', () => {
    const playAt = w.indexOf('catchtap="speakTipWord"');
    const collectAt = w.indexOf('catchtap="collectTipWord"');
    const closeAt = w.indexOf('catchtap="closeTip"');
    expect(playAt).toBeGreaterThan(-1);
    expect(collectAt).toBeGreaterThan(-1);
    expect(closeAt).toBeGreaterThan(-1);
    expect(playAt).toBeLessThan(collectAt);      // 朗读 → 收藏
    expect(collectAt).toBeLessThan(closeAt);     // 收藏 → ✕（✕ 仍在最右）
  });

  it('图标与文案都绑到 data 字段（不是写死的 star / 写死的「收藏」）', () => {
    const at = w.indexOf('catchtap="collectTipWord"');
    const node = w.slice(Math.max(0, at - 400), at + 400);
    expect(node).toMatch(/class="wt-btn-ico" mode="aspectFit" src="\{\{tipCollectIcon\}\}"/);
    expect(node).toContain('{{tipCollectLabel}}');
    // 反例：恒定图标（不看状态）就是「点了没反应」的缺陷形态
    expect(node).not.toMatch(/src="\{\{icons\.star\}\}"/);
    expect(node).not.toMatch(/src="\{\{icons\.check\}\}"/);
    // busy 置灰 + done 着色都绑在同一个状态字段上
    expect(node).toMatch(/tipCollect === 'done' \|\| tipCollect === 'existed' \? 'done' : ''/);
    expect(node).toMatch(/tipCollect === 'busy' \? 'busy' : ''/);
  });

  it('三态文案/图标来自 utils/icons 的唯一实现（页面不写第二份文案表）', () => {
    const src = stripJs(read(DETAIL_TS));
    expect(src).toMatch(/tipCollectLabel:\s*collectLabel\(TIP_COLLECT_BASE, state\)/);
    expect(src).toMatch(/tipCollectIcon:\s*collectIcon\(state\)/);
    // 反例：三态文案字面量不许出现在页面代码里（那是第三份真源）
    expect(src).not.toMatch(/['"]收藏中['"]/);
    expect(src).not.toMatch(/['"]已在收藏['"]/);
  });

  it('词卡容器吞掉内部空白点击（否则点释义区会把卡片点没）', () => {
    const tipTag = (w.match(/<view wx:if="\{\{overlay && overlay\.kind === 'wordtip'\}\}"[^>]*>/) || [''])[0];
    expect(tipTag).toMatch(/^<view/);            // 防空转：真的抓到了容器标签
    expect(tipTag).toMatch(/catchtap="noop"/);
  });
});

// ═════════════════════════ D1 行为：三态机 ═════════════════════════
describe('D1 行为：未登录 / 成功 / 已存在 / 失败 / 连点', () => {
  it('未登录 → 弹本页内联 modal（guestLoginShow），不发请求、不收词卡', async () => {
    mockAuth.loggedIn = false;
    const ctx = makeCtx();
    openCard(ctx);
    await ctx.collectTipWord();
    expect(ctx.data.guestLoginShow).toBe(true);
    expect(mockGlossary.calls).toHaveLength(0);
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'engineer' }); // K10：不叠两层遮罩、不丢上下文
    expect(ctx.data.tipCollect).toBe('idle');
  });

  it('收藏成功 → ✓ 已收藏（文案 + 图标 + 状态同帧落地）+ 词卡不关', async () => {
    const ctx = makeCtx();
    openCard(ctx);
    await ctx.collectTipWord();
    expect(ctx.data.tipCollect).toBe('done');
    expect(ctx.data.tipCollectLabel).toBe('已收藏');
    expect(ctx.data.tipCollectIcon).toBe('/assets/icons/check.svg');
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'engineer' });
  });

  it('提交中（busy）→ 置灰禁用、连点只发一次请求', async () => {
    const ctx = makeCtx();
    openCard(ctx);
    const p1 = ctx.collectTipWord();
    expect(ctx.data.tipCollect).toBe('busy');
    expect(ctx.data.tipCollectLabel).toBe('收藏中');
    expect(ctx.data.tipCollectIcon).toBe('/assets/icons/star.svg'); // 提交中仍是空心星（与抽屉一致）
    const p2 = ctx.collectTipWord();                                // 连点：busy 守卫短路
    await Promise.all([p1, p2]);
    expect(mockGlossary.calls).toHaveLength(1);
  });

  it('已存在 → ✓ 已在收藏，1.8s 后回落 ✓ 已收藏', async () => {
    jest.useFakeTimers();
    try {
      mockGlossary.resolve = { id: 9, created: false, existed: true };
      const ctx = makeCtx();
      openCard(ctx);
      const p = ctx.collectTipWord();
      await Promise.resolve(); await Promise.resolve();   // 让 await 链走完
      await p;
      expect(ctx.data.tipCollect).toBe('existed');
      expect(ctx.data.tipCollectLabel).toBe('已在收藏');
      jest.advanceTimersByTime(1799);
      expect(ctx.data.tipCollect).toBe('existed');        // 未到点不回
      jest.advanceTimersByTime(1);
      expect(ctx.data.tipCollect).toBe('done');
      expect(ctx.data.tipCollectLabel).toBe('已收藏');
    } finally {
      jest.useRealTimers();
    }
  });

  it('失败 → 回 ☆ 收藏（不留假成功），且不往外抛', async () => {
    mockGlossary.reject = true;
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx();
    openCard(ctx);
    await expect(ctx.collectTipWord()).resolves.toBeUndefined();
    expect(ctx.data.tipCollect).toBe('idle');
    expect(ctx.data.tipCollectLabel).toBe('收藏');
    expect(ctx.data.tipCollectIcon).toBe('/assets/icons/star.svg');
    errSpy.mockRestore();
  });

  /**
   * 🔴 失败路径的**可恢复性**（原型复测第二轮要求）：
   *    「失败回 ☆」只证明 UI 复位，不证明用户还能再点 —— 若 busy 没释放，按钮永远灰着，
   *    表现和「卡死」一样。判据必须落在**状态字段**上（`tipCollect` / 文案），
   *    **不许**断 `rejects.toBeTruthy()` 之类的异常形态：`try/finally return idle` 与
   *    `try/catch return idle` 两种修法都合法，断异常会把实现锁死。
   *    也不许断「失败了有 toast」：`_collectWord` 故意只 `console.error`，
   *    用户可见提示归 `utils/request.ts`（49 §5 方案 B），页面层只能断**反向**。
   */
  it('🔴 失败后可重试：busy 释放 → 回「收藏」→ 再点一次真的发第 2 次请求', async () => {
    mockGlossary.reject = true;
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx();
    openCard(ctx);

    const p = ctx.collectTipWord();
    expect(ctx.data.tipCollect).toBe('busy');          // 提交中
    expect(ctx.data.tipCollectLabel).toBe('收藏中');
    await p;

    expect(ctx.data.tipCollect).toBe('idle');          // busy 已释放（不是卡死）
    expect(ctx.data.tipCollectLabel).toBe('收藏');      // 按钮回到「可再点」的样子
    expect(mockGlossary.calls).toHaveLength(1);
    // 页面层不自己弹 toast（反向断言；正向的 toast 归 utils/request.ts）
    expect(mockWx.showToast).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();                 // 但有排障留痕，不是悄悄吞掉

    mockGlossary.reject = false;                       // 服务恢复
    await ctx.collectTipWord();
    expect(mockGlossary.calls).toHaveLength(2);        // ← 真的重试了（第 2 次请求）
    expect(ctx.data.tipCollect).toBe('done');
    expect(ctx.data.tipCollectLabel).toBe('已收藏');
    errSpy.mockRestore();
  });

  it('结果回来时卡片已关 → 不改按钮态（不把结果写到下一个词上）', async () => {
    const ctx = makeCtx();
    openCard(ctx);
    const p = ctx.collectTipWord();
    ctx.closeTip();                                     // 用户中途关卡片
    await p;
    expect(ctx.data.tipCollect).toBe('idle');           // 关卡片已复位，迟到结果不许点亮
  });

  it('收藏 payload 与抽屉「收藏单词」同一份（D1 抽取后不许有第二份组装）', async () => {
    const viaCard = makeCtx();
    openCard(viaCard);
    await viaCard.collectTipWord();
    const cardPayload = mockGlossary.calls[0];

    mockGlossary.calls = [];
    const viaDrawer = makeCtx();
    viaDrawer.onWordLongPress({ currentTarget: { dataset: { i: 0, w: 'engineer', hasdef: true } } });
    await viaDrawer.onDrawerCollectWord({ detail: { word: 'engineer', lineIndex: 0, hasDef: true } });
    const drawerPayload = mockGlossary.calls[0];

    expect(cardPayload).toEqual(drawerPayload);
    // 词卡收藏也带上了「该词所在句」下标（与抽屉同一个 meta 口径）
    expect(cardPayload.meta).toMatchObject({ book: 'NCE2', lessonId: 4, lineIndex: 0, word: 'engineer', hasDef: true });
  });

  it('静态：抽屉入口只转调唯一实现，自己不组 payload', () => {
    const src = stripJs(read(DETAIL_TS));
    const fn = (src.match(/async onDrawerCollectWord\(e: DrawerEvent<CollectWordDetail>\)\s*\{([\s\S]*?)\n {2}\},/) || ['', ''])[1];
    expect(fn).not.toBe('');
    expect(fn).toMatch(/await this\._collectWord\(/);
    expect(fn).not.toMatch(/collectGlossary\(/);
    // 词卡入口同样复用（两处调用点，零份 payload 组装）
    expect(src).toMatch(/const r = await this\._collectWord\(word, hasDef, lineIndex\);/);
  });
});

// ═════════════════════════ D2 点空白关闭 ═════════════════════════
describe('D2 点空白关闭词卡（不吃点词、不加遮罩）', () => {
  it('静态：根节点 bindtap="onPageTap"（不是透明遮罩层）', () => {
    const w = stripWxml(read(DETAIL_WXML));
    const rootTag = (w.match(/<view class="page[^"]*"[^>]*>/) || [''])[0];
    expect(rootTag).toMatch(/^<view\s/);            // 防空转
    expect(rootTag).toMatch(/bindtap="onPageTap"/);
    // 反向：不许出现「盖住正文」的遮罩节点（用户已拍板 D3 不加压暗遮罩，透明遮罩同理）
    expect(w).not.toMatch(/class="[^"]*tap-mask/);
    expect(w).not.toMatch(/class="[^"]*page-mask/);
  });

  it('行为：点在空白 → closeTip（overlay 归零）；正在读该词时停朗读', () => {
    const ctx = makeCtx();
    openCard(ctx);
    ctx.speakTipWord();                            // 正在读这个词
    expect(ctx.data.tipPlaying).toBe(true);
    const before = mockTts.stopCalls;
    ctx.onPageTap({ target: { dataset: {} } });
    expect(ctx.data.overlay).toBeNull();
    expect(mockTts.stopCalls).toBeGreaterThan(before);
    expect(ctx.data.tipPlaying).toBe(false);
  });

  it('🔴 点在词上（target 带 data-w）→ 不关闭（换词不被吃掉）', () => {
    const ctx = makeCtx();
    openCard(ctx, 'engineer');
    ctx.onPageTap({ target: { dataset: { w: 'engineer', i: 0, hasdef: true } } });
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'engineer' });
  });

  /**
   * 🔴 回归口子（原型复测第二轮提醒）：词节点必须是 `catchtap`，它同时决定两件事 ——
   *  ① 冒泡被阻断 → 根节点收不到 → 不关；
   *  ② 只有它自己那个处理器会把 `overlay.word` 换掉 → **换内容**。
   * 若哪天改成 `bindtap`（比如为接埋点），①因为根节点有 `dataset.w` 兜底**照样不关**，
   * 于是「不关」测不出来、「换内容」才是唯一会露馅的判据。所以这里单独断内容已换。
   */
  it('🔴 点另一个生词 → 内容真的换了（独立断言 overlay.word，不是只断「没关」）', () => {
    const ctx = makeCtx();
    ctx.data.detail.words = [
      { word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/en/' },
      { word: 'doctor', pos: 'n.', def: '医生', phonetic: '/dr/' },
    ];
    openCard(ctx, 'engineer');
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'engineer' });
    // 模拟改成 bindtap 的双处理器顺序：词节点先跑，事件再冒泡到根节点
    ctx.onWordTap({ currentTarget: { dataset: { i: 0, w: 'doctor', hasdef: true } } });
    ctx.onPageTap({ target: { dataset: { w: 'doctor', i: 0, hasdef: true } } });
    expect(ctx.data.overlay).toMatchObject({ kind: 'wordtip', word: 'doctor' });  // ← 内容换了
    expect(ctx.data.overlay).not.toBeNull();                                       // ← 且没被关
  });

  it('行为：抽屉打开时点空白不动它（抽屉有自己的遮罩 / ✕ / 下滑三条通道）', () => {
    const ctx = makeCtx();
    ctx.onLongPress({ currentTarget: { dataset: { i: 0 } } });
    ctx.onPageTap({ target: { dataset: {} } });
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'line' });
  });

  it('行为：没有浮层时点空白什么都不做（不发多余 setData）', () => {
    const ctx = makeCtx();
    const spy = jest.spyOn(ctx, 'setData');
    ctx.onPageTap({ target: { dataset: {} } });
    ctx.onPageTap();                                  // 连事件对象都没有（合成事件防御）
    expect(spy).not.toHaveBeenCalled();
  });
});

// ═════════════════════════ D7 收藏态回查 ═════════════════════════
describe('D7 打开时的初始态读本地缓存（别只靠内存 flag）', () => {
  it('收藏过的词再点开 → 直接 ✓ 已收藏（不再变回 ☆）', async () => {
    const first = makeCtx();
    openCard(first);
    await first.collectTipWord();                   // 收藏一次（写缓存）
    expect(first.data.tipCollect).toBe('done');

    const again = makeCtx();                        // 模拟「关掉再点开」：新上下文，data 全新
    openCard(again);
    expect(again.data.tipCollect).toBe('done');
    expect(again.data.tipCollectLabel).toBe('已收藏');
    expect(again.data.tipCollectIcon).toBe('/assets/icons/check.svg');
  });

  it('没收藏过的词仍是 ☆ 收藏', () => {
    const ctx = makeCtx();
    openCard(ctx, 'engineer');
    expect(ctx.data.tipCollect).toBe('idle');
    expect(ctx.data.tipCollectIcon).toBe('/assets/icons/star.svg');
  });

  it('缓存键归一化：大小写 / 首尾空白 / 连续空白不造成「同词不同键」', async () => {
    const ctx = makeCtx();
    ctx._collectWord('  Engineer ', true, 0);       // 走真实实现写入缓存（大小写混合 + 首尾空白）
    await Promise.resolve();
    const again = makeCtx();
    openCard(again, 'engineer');
    expect(again.data.tipCollect).toBe('done');
  });

  it('🔴 缓存失效兜底：已显示 ✓ 的词再点，仍发**真实写请求**（不短路）', async () => {
    store.dachengzi_collected_words = ['engineer'];  // 缓存在，但服务器可能已被删
    mockGlossary.resolve = { id: 1, created: true, existed: false };
    const ctx = makeCtx();
    openCard(ctx);
    expect(ctx.data.tipCollect).toBe('done');        // 初值来自缓存
    await ctx.collectTipWord();
    expect(mockGlossary.calls).toHaveLength(1);      // 必须真的写一次（把被删的条目建回来）
    expect(ctx.data.tipCollect).toBe('done');
  });

  it('抽屉的已收藏 key 集合按缓存算（词档：句 + 词两个 key 都要）', () => {
    store.dachengzi_collected_lines = [WORD_LINE.toLowerCase()];
    store.dachengzi_collected_words = ['engineer'];
    const ctx = makeCtx();
    ctx.onWordLongPress({ currentTarget: { dataset: { i: 0, w: 'engineer', hasdef: true } } });
    expect(sortedKeys(ctx.data.collectedKeys)).toEqual(sortedKeys(['collect-line', 'collect-word']));
  });

  it('句档抽屉只给 line 一个 key（上一词留下的 word key 不许串进来）', () => {
    store.dachengzi_collected_lines = [WORD_LINE.toLowerCase()];
    store.dachengzi_collected_words = ['engineer'];
    const ctx = makeCtx({ collectedKeys: ['collect-word'] });
    ctx.onLongPress({ currentTarget: { dataset: { i: 0 } } });
    expect(sortedKeys(ctx.data.collectedKeys)).toEqual(sortedKeys(['collect-line']));
  });

  it('静态：key 集合经**一个**属性交给组件（组件不 import 任何 services，A8 不动）', () => {
    const w = stripWxml(read(DETAIL_WXML));
    expect(w).toContain('collected-keys="{{collectedKeys}}"');
    expect(w).not.toContain('line-collected=');   // 旧的两布尔通道已删，不留第二套判断
    expect(w).not.toContain('word-collected=');
  });
});

// ═════════════════════════ 附加项：行尾停止入口换 SVG ═════════════════════════
describe('附加项：.sent-stop 由字符 ■ 换 stop.svg', () => {
  it('渲染层没有任何 ■ 字符；行项带 stopIcon（循环作用域限制）', () => {
    const w = stripWxml(read(DETAIL_WXML));
    expect(w).not.toMatch(/■/);
    expect(w).toMatch(/<image class="sent-stop-ico" mode="aspectFit" src="\{\{line\.stopIcon\}\}" \/>/);
    // 行视图必须带这个字段，否则图标 src 为空、真机渲染成空白方块
    const src = stripJs(read(DETAIL_TS));
    expect(src).toMatch(/stopIcon:\s*ICONS\.stop/);
  });

  it('尺寸 24rpx + 行内对齐（inline-block，别把整行撑成块）', () => {
    const css = read('pages/nce/detail/detail.wxss').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (css.match(/\.sent-stop\s*\{([^}]*)\}/) || ['', ''])[1];
    expect(rule).toMatch(/display:\s*inline-block/);
    const ico = (css.match(/\.sent-stop-ico\s*\{([^}]*)\}/) || ['', ''])[1];
    expect(Number((ico.match(/width:\s*([\d.]+)rpx/) || [])[1])).toBe(24);
    expect(Number((ico.match(/height:\s*([\d.]+)rpx/) || [])[1])).toBe(24);
  });
});
