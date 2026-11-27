/// <reference types="node" />
/**
 * 首页 · 长按动作抽屉接入（2026-11-26 step2 / 变体 B / 复用 step0 公共层）
 *
 * 本文件只锁「本轮新增的那层结构 + 新口径」，不重复既有首页测试（home-index /
 * home-greeting-wiring / home-quote-source / home-daily-quote-ux）已有的行为断言：
 *  1. **单槽位不变量**（方案 §4.1 / F1 / F2）：`data` 里只有 `overlay` 一个浮层字段，
 *     旧 `quoteTip` 彻底消失；每次 setData 的 patch 里 `overlay` 只能是「一个值」。
 *  2. **长按两个入口**：任意英文单词 → `scope='word'`（4 项，含表外词）；英文句子空白 →
 *     `scope='line'`（2 项）。4 项/2 项由组件 `actionsOf` 决定，这里用真实组件实例验证。
 *  3. **E1**：点按普通词（`hasDef=false`）不弹词卡、`overlay` 不变。
 *  4. **U1 去重**（2026-11-26）：首页**不**实现行尾 ■，停止入口只有页脚 `.dq-act`；
 *     反向断言锁死 `.sent-stop` / `stopQuoteSpeak` 不回潮（详情页 U1 不受影响）。
 *  5. **K9**（tabBar 常驻页）：`onHide` 必须把 `overlay` 归零，否则返回首页时抽屉「自己回来」。
 *  6. **不复制实现**：页面里不得出现第二份抽屉 UI / 第二份动作表（静态断言）。
 *
 * 只更新过既有断言的两处，均在 home-daily-quote-ux / home-quote-source 里注明理由
 * （旧断言锁的是已作废的渲染结构 + 已消失的 quoteTip 字段）。
 */
import * as fs from 'fs';
import * as path from 'path';

const APP = path.resolve(__dirname, '..');
const src = (rel: string): string => fs.readFileSync(path.join(APP, rel), 'utf8');
/** 去掉 wxml 注释再断言：注释会提到 `ad-*` / 「抽屉」等字面量（说明「不要在此自绘」） */
const stripWxmlComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '');

jest.mock('../services/nce', () => ({ getNceLesson: jest.fn() }));
/**
 * tts 桩：忠实模拟 `services/tts.stopSpeak()` 会向订阅者推一次 `null`（页面播放态归零
 * 依赖这条契约，而不是自己猜）。若桩里 stopSpeak 什么都不做，就测不出「切走即复位」。
 */
const mockTts: { listeners: Set<(s: any) => void>; emit: (s: any) => void } = {
  listeners: new Set(),
  emit(s) { mockTts.listeners.forEach((cb) => cb(s)); },
};
jest.mock('../services/tts', () => ({
  speakText: jest.fn(() => Promise.resolve(true)),
  stopSpeak: jest.fn(() => { mockTts.emit(null); }),
  onSpeakState: jest.fn((cb: (s: any) => void) => {
    mockTts.listeners.add(cb);
    return () => { mockTts.listeners.delete(cb); };
  }),
}));
jest.mock('../services/glossary', () => ({
  collectGlossary: jest.fn(() => Promise.resolve({ id: 1, existed: false })),
}));
jest.mock('../services/auth', () => ({ isLoggedIn: jest.fn(() => true) }));
jest.mock('../services/account', () => ({
  readLocalNickname: jest.fn(() => '橙子'),
  fetchProfile: jest.fn(() => Promise.resolve({ nickname: '橙子' })),
  isNicknameUnset: jest.fn(() => false),
}));
jest.mock('../utils/greeting', () => ({
  formatGreeting: jest.fn(() => '橙子，下午好'),
  getLocalHour: jest.fn(() => 15),
}));
jest.mock('../utils/tabbar', () => ({ setTabBarSelected: jest.fn(), TAB_INDEX: { home: 0 } }));
jest.mock('../utils/daily', () => ({
  getDailyQuote: jest.fn(() => ({ cn: '他是一名工程师。', en: 'He is an engineer.' })),
  getDailyQuoteMeta: jest.fn(() => ({ book: 'NCE2', lessonId: 4 })),
  getDailyQuoteSource: jest.fn(() => ({
    cn: '他是一名工程师。', en: 'He is an engineer.', book: 'NCE2', lessonId: 4,
  })),
  BOOK_LABEL: { NCE2: '新概念二册' },
}));

import { getNceLesson } from '../services/nce';
import { speakText, stopSpeak } from '../services/tts';
import { collectGlossary } from '../services/glossary';
import { isLoggedIn } from '../services/auth';

const getLessonMock = getNceLesson as unknown as jest.Mock;
const speakTextMock = speakText as unknown as jest.Mock;
const stopSpeakMock = stopSpeak as unknown as jest.Mock;
const collectMock = collectGlossary as unknown as jest.Mock;
const isLoggedInMock = isLoggedIn as unknown as jest.Mock;

const QUOTE_EN = 'He is an engineer.';

let store: Record<string, unknown> = {};
const wxMock = {
  getStorageSync: jest.fn((k: string) => (store[k] === undefined ? '' : store[k])),
  setStorageSync: jest.fn((k: string, v: unknown) => { store[k] = v; }),
  removeStorageSync: jest.fn((k: string) => { delete store[k]; }),
  showToast: jest.fn(),
  navigateTo: jest.fn(),
  switchTab: jest.fn(),
};

let pageConfig: any = null;
let drawerCfg: any = null;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).Page = jest.fn((cfg: any) => { pageConfig = cfg; });
  (globalThis as any).Component = jest.fn((cfg: any) => { drawerCfg = cfg; });
  (globalThis as any).getApp = jest.fn(() => ({
    eventBus: { on: jest.fn(), off: jest.fn() },
    radiusClassOf: () => '',
  }));
  require('../pages/home/index/index');
  require('../components/action-drawer/index');
});

beforeEach(() => {
  jest.clearAllMocks();
  store = {};
  mockTts.listeners.clear();
  isLoggedInMock.mockReturnValue(true);
  getLessonMock.mockResolvedValue({
    id: 4,
    title: 'L4',
    words: [{ word: 'engineer', pos: 'n.', def: '工程师', phonetic: '/ˌendʒɪˈnɪə/' }],
    lines: [{ en: QUOTE_EN, cn: '他是一名工程师。' }],
  });
  collectMock.mockResolvedValue({ id: 1, existed: false });
});

/** 页面上下文桩：记录每次 setData 的 patch，便于断「同帧只有一种 overlay」 */
function makeCtx() {
  const patches: Array<Record<string, unknown>> = [];
  const ctx: any = Object.create(pageConfig);
  ctx.data = JSON.parse(JSON.stringify(pageConfig.data));
  ctx.patches = patches;
  ctx.setData = function (patch: Record<string, unknown>) {
    patches.push(patch);
    Object.assign(this.data, patch);
  };
  ctx._alive = true;
  ctx._quoteSeq = 0;
  ctx._quoteWords = [];
  ctx._speakingWord = '';
  ctx._playingText = '';
  // 复刻真实订阅链（onLoad 里 onSpeakState 订阅）：否则「stopSpeak 推 null → 播放态归零」
  // 这条契约测不到，会得出「切走没复位」的假红。
  pageConfig.onLoad.call(ctx);
  return ctx;
}

/** 加载词表后取一个特定词的 token（默认取表外普通词 is） */
async function ctxWithWords(): Promise<any> {
  const ctx = makeCtx();
  await ctx.loadQuoteWords();
  return ctx;
}

/** 真实抽屉组件实例（复用 step0 组件，不是复刻） */
function makeDrawer(props: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(drawerCfg.properties || {})) {
    defaults[k] = (v as { value?: unknown }).value;
  }
  const inst: any = {
    data: { ...defaults, ...JSON.parse(JSON.stringify(drawerCfg.data || {})), ...props },
    setData(this: any, patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    triggerEvent: jest.fn(),
  };
  for (const block of [drawerCfg.methods, drawerCfg.lifetimes, drawerCfg.pageLifetimes, drawerCfg.observers]) {
    Object.keys(block || {}).forEach((k) => {
      if (typeof block[k] === 'function') inst[k] = block[k].bind(inst);
    });
  }
  return inst;
}

const tokenOf = (ctx: any, w: string) => ctx.data.quoteTokens.find((t: any) => t.w === w);

/* ─────────────────────────── 单槽位不变量 ─────────────────────────── */

describe('单槽位 overlay（方案 §4.1 / F1 / F2）', () => {
  it('data 里只有 overlay 一个浮层字段：旧的 quoteTip 已删除', () => {
    expect(pageConfig.data).toHaveProperty('overlay');
    expect(pageConfig.data.overlay).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(pageConfig.data, 'quoteTip')).toBe(false);
  });

  it('所有浮层字段名里只有 overlay 一个是「浮层」语义（防再长出第二个槽位）', () => {
    const keys = Object.keys(pageConfig.data).filter((k) => /^(overlay|quoteTip|tip|drawer|bubble)/i.test(k));
    expect(keys).toEqual(['overlay']);
  });

  it('每次 setData 的 overlay 都是「一个值」：不存在同帧两个 kind 并存', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    const overlayPatches = ctx.patches.filter((p: any) => 'overlay' in p);
    expect(overlayPatches.length).toBeGreaterThanOrEqual(2);
    overlayPatches.forEach((p: any) => {
      const v = p.overlay;
      if (v !== null) expect(typeof v.kind).toBe('string');
      // 单槽位：patch 里不可能出现 drawer 与 wordtip 两个字段名
      expect('drawer' in p).toBe(false);
      expect('wordtip' in p).toBe(false);
      expect('quoteTip' in p).toBe(false);
    });
    // 最后一次是词卡（整体替换了抽屉，而不是两个字段各开一半）
    expect(ctx.data.overlay.kind).toBe('wordtip');
  });
});

/* ─────────────────────────── 长按两个入口 ─────────────────────────── */

describe('长按任意英文单词 → drawer/word（4 项，表外词同样可用）', () => {
  it('长按表外普通词（hasDef=false）→ overlay={kind:drawer,scope:word}，hasDef=false、无音标', async () => {
    const ctx = await ctxWithWords();
    expect(tokenOf(ctx, 'is').hasDef).toBe(false);   // 前置：is 不在词表里

    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'is', hasdef: false } } });

    expect(ctx.data.overlay).toMatchObject({
      kind: 'drawer',
      scope: 'word',
      word: 'is',
      hasDef: false,
      phonetic: '',
      lineIndex: 0,
      lineText: QUOTE_EN,
    });
  });

  it('表外词的抽屉仍是 4 项（动作集合与 hasDef 无关）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    // 用真实组件按页面给的作用域取动作集合：proves「overlay.scope → 4 项」这条链路
    const c = makeDrawer({ scope: ctx.data.overlay.scope, wordHasDef: ctx.data.overlay.hasDef });
    c.scope(ctx.data.overlay.scope);
    expect(c.data.acts.map((a: any) => a.label))
      .toEqual(['朗读此句', '收藏此句', '朗读单词', '收藏单词']);
  });

  it('长按生词（hasDef=true）→ 带音标（音标只进标题区，不影响动作）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    expect(ctx.data.overlay).toMatchObject({
      kind: 'drawer', scope: 'word', word: 'engineer', hasDef: true, phonetic: '/ˌendʒɪˈnɪə/',
    });
    const c = makeDrawer({ scope: 'word' });
    c.scope('word');
    expect(c.data.acts).toHaveLength(4);
  });

  it('脏 token（空 data-w）不产生浮层', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: '' } } });
    expect(ctx.data.overlay).toBeNull();
  });

  it('dataset 里布尔值以字符串 "true" 传上来也认（不同基础库形态）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'engineer', hasdef: 'true' } } });
    expect(ctx.data.overlay.hasDef).toBe(true);
  });
});

describe('长按英文句子空白 → drawer/line（2 项）', () => {
  it('overlay={kind:drawer,scope:line}，2 项恰为四项前两项', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteLineLongPress();
    expect(ctx.data.overlay).toMatchObject({
      kind: 'drawer', scope: 'line', lineIndex: 0, lineText: QUOTE_EN,
    });
    const c = makeDrawer({ scope: 'line' });
    c.scope('line');
    expect(c.data.acts.map((a: any) => a.label)).toEqual(['朗读此句', '收藏此句']);
  });

  it('句子长按 handler 只挂在英文容器上，不挂整张 .daily 卡（否则中文行/按钮也会触发）', () => {
    const w = stripWxmlComments(src('pages/home/index/index.wxml'));
    expect(w).toMatch(/class="daily-en"[^>]*catchlongpress="onQuoteLineLongPress"/);
    // `class="daily"` 那个节点上不得出现 longpress
    const dailyTag = (/<view class="daily"[^>]*>/.exec(w) || [''])[0];
    expect(dailyTag).not.toMatch(/longpress/);
    expect(w.split('catchlongpress="onQuoteLineLongPress"').length - 1).toBe(1);
  });
});

/* ─────────────────────────── E1：点按普通词无反应 ─────────────────────────── */

describe('E1：点按普通词无反应（不弹词卡、不朗读）', () => {
  it('点表外普通词 → overlay 保持 null，且不朗读整句', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    expect(ctx.data.overlay).toBeNull();
    expect(speakTextMock).not.toHaveBeenCalled();
  });

  it('点普通词不改动已有浮层（不会顺手把词卡换掉）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    const before = JSON.parse(JSON.stringify(ctx.data.overlay));
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    expect(ctx.data.overlay).toEqual(before);
  });

  it('点生词仍出词卡（守卫只挡普通词）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    expect(ctx.data.overlay.kind).toBe('wordtip');
    expect(ctx.data.overlay.def).toBe('工程师');
  });
});

/* ─────────────────────────── K9：生命周期归零 ─────────────────────────── */

describe('K9：tab 页返回时抽屉不得自己回来', () => {
  it('onHide → overlay 归零（测试原型：开着抽屉切到「我的」tab）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    expect(ctx.data.overlay).not.toBeNull();

    ctx.onHide();

    expect(ctx.data.overlay).toBeNull();
  });

  it('onHide 顺带停播 + 播放态归零（原有行为不回退）', async () => {
    const ctx = await ctxWithWords();
    ctx._onSpeakState({ text: QUOTE_EN, phase: 'playing' });
    expect(ctx.data.quotePlaying).toBe(true);
    ctx.onHide();
    expect(stopSpeakMock).toHaveBeenCalled();
    expect(ctx.data.quotePlaying).toBe(false);
    expect(ctx.data.quoteWordPlaying).toBe('');
  });

  it('overlay 已为 null 时 onHide 不发多余的浮层 setData（避免无谓重绘）', async () => {
    const ctx = await ctxWithWords();
    ctx.patches.length = 0;
    ctx.onHide();
    // 只数「含 overlay 的 patch」：onHide 里 stopSpeak 推 null 会带来一次播放态复位 setData，
    // 那是既有行为、与浮层无关。
    expect(ctx.patches.filter((p: any) => 'overlay' in p)).toEqual([]);
  });

  it('组件侧 pageLifetimes.hide 归零局部态（与页面归零是两道，互补不互替）', () => {
    const c = makeDrawer({ visible: true, scope: 'word' });
    c.setData({ swipeY: 40, dragging: true, busy: true, pressedKey: 'speak-word' });
    c.hide();
    expect(c.data).toMatchObject({ swipeY: 0, dragging: false, busy: false, pressedKey: '' });
    // 🔴 但组件**不清业务态**：visible 仍由页面 overlay 驱动（组件不持有业务状态）
    expect(c.data.visible).toBe(true);
  });
});

/* ──────── 首页停止朗读入口去重（U1 行尾 ■ 与页脚 .dq-act 冗余 → 保留页脚） ──────── */

describe('首页停止入口只有一处：页脚 .dq-act（U1 行尾 ■ 已去重）', () => {
  /**
   * 🔴 反向断言，不是「把断言删掉」：将来有人把行尾 ■ 加回首页 → 这条必须变红。
   * 裁决（用户 2026-11-26 拍板 U1；home 侧判定冗余）：U1 的初衷是补详情页「关掉抽屉后
   * 没有任何停止入口」这个空洞；首页页脚本来就有「▶ 朗读 / ■ 停止」+「☆ 收藏」，再叠
   * 一个行尾 ■ 会让用户同屏看到两个 ■。详情页 pages/nce/detail/ 的 U1 保留
   * （由 tests/nce-detail-drawer.test.ts 守护）。
   */
  it('首页 wxml 不得出现 .sent-stop 行尾节点 / stopQuoteSpeak 绑定', () => {
    const w = src('pages/home/index/index.wxml');
    expect(w).not.toMatch(/class="sent-stop"/);
    expect(w).not.toContain('stopQuoteSpeak');
  });

  it('index.ts 不得再定义 stopQuoteSpeak（去重后无调用方，留着即死代码）', () => {
    expect(src('pages/home/index/index.ts')).not.toContain('stopQuoteSpeak');
  });

  /**
   * 🔴 2026-11-27 改写（用户真机反馈②）：页脚的 ▶/■/☆/✓ 由**正文字符**改成一套 SVG 图标
   * （`assets/icons/*.svg`，经 utils/icons 取路径）。断言对象从「字符文案」换成
   * 「同一个 .dq-act 节点上的 image src 三元 + 文案二态」，强度不降：仍钉住
   * ① 只有一个停止入口；② 播放态高亮 .on；③ 点按走同一个 speakQuote handler。
   */
  it('页脚保留唯一停止入口：.dq-act 一个节点，图标 ▶/■ + 文案「停止 / 朗读」二态', () => {
    const w = stripWxmlComments(src('pages/home/index/index.wxml'));
    const footOpen = w.indexOf('class="daily-foot"');
    expect(footOpen).toBeGreaterThan(-1);
    const foot = w.slice(footOpen);
    // 同一节点：播放态高亮 .on + 点按走 speakQuote（同句 same-text → tts 停止）
    expect(foot).toContain('class="dq-act {{quotePlaying ? \'on\' : \'\'}}" catchtap="speakQuote"');
    // 图标 = 同一套 SVG（play/stop），而不是正文字符 ▶ / ■
    expect(foot).toContain('src="{{quotePlaying ? icons.stop : icons.play}}"');
    expect(foot).toContain("{{quotePlaying ? '停止' : '朗读'}}");
    // 反例：页脚不得再出现「▶ / ■」字符形态（回潮即红）
    expect(foot).not.toMatch(/[▶■]/);
  });

  it('页脚「停止」走 speakQuote → speakText(整句)，与整句点按同一 handler', async () => {
    const ctx = await ctxWithWords();
    ctx._onSpeakState({ text: QUOTE_EN, phase: 'playing' });
    expect(ctx.data.quotePlaying).toBe(true);

    stopSpeakMock.mockClear();
    ctx.speakQuote();
    expect(speakTextMock).toHaveBeenCalledWith(QUOTE_EN);
    // 不再有独立的 stopQuoteSpeak 路径：停止语义由 speakText 的 same-text 负责（tts 侧契约）
    expect((ctx as any).stopQuoteSpeak).toBeUndefined();
  });
});

/* ─────────────────────────── 抽屉 3 个 handler ─────────────────────────── */

describe('抽屉 3 个 handler（组件只 triggerEvent，页面调 services）', () => {
  /**
   * 🔴 2026-11-26 变体 C（用户拍板）：朗读下沉到抽屉组件 ——
   * 组件内直接 `speakText`、抽屉不关、按钮自切 ▶/■；页面不再有
   * `onDrawerSpeakLine / onDrawerSpeakWord`。原两条朗读用例的判据对象已消失，
   * 反转成「不得回潮」断言；行为侧见 `tests/action-drawer.test.ts`「变体 C · 朗读下沉」。
   */
  it('朗读不再经过页面：两个 speak handler 都不存在，长按抽屉保持打开、不调 speakText', async () => {
    const ctx = await ctxWithWords();
    expect((ctx as any).onDrawerSpeakLine).toBeUndefined();
    expect((ctx as any).onDrawerSpeakWord).toBeUndefined();
    ctx.onQuoteLineLongPress();
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'line' });
    expect(speakTextMock).not.toHaveBeenCalled();
  });

  /**
   * 🔴 2026-11-27 方案 B 改写：收藏**成功不再收抽屉**（原断言 `overlay` 为 null），
   * 改为「抽屉留在原地 + 结果经 selectComponent('#drawer').onCollectDone 回传组件渲染三态」。
   * `validate` 侧再多验一条：回传参数必须与 collectGlossary 的 existed 口径一致。
   */
  /** 真机链路复刻：先让组件进「收藏中」（点按 → busy），再由页面回传结果 */
  function tapCollect(drawer: any, key: string) {
    drawer.onActionTap({ currentTarget: { dataset: { key, kind: 'collect' } } });
    expect(drawer.data.collect[key === 'collect-word' ? 'word' : 'line']).toBe('busy');
  }

  it('collect-line → tag=nce（payload 不变）+ 抽屉不关 + 回传 onCollectDone(line, ok, existed)', async () => {
    const ctx = await ctxWithWords();
    const drawer = makeDrawer({ visible: true, scope: 'line' });
    ctx.selectComponent = (sel: string) => (sel === '#drawer' ? drawer : null);
    ctx.onQuoteLineLongPress();
    tapCollect(drawer, 'collect-line');
    await ctx.onDrawerCollectLine({ detail: { lineIndex: 0, text: QUOTE_EN } });
    const p = collectMock.mock.calls[0][0];
    expect(p.tag).toBe('nce');
    expect(p.enMain).toBe(QUOTE_EN);
    expect(p.note).toBe('他是一名工程师。');
    expect(p.meta).toEqual({ book: 'NCE2', lessonId: 4, from: 'daily' });
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已收藏', icon: 'none' });
    // 🔴 抽屉不关（方案 B 的核心）
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer', scope: 'line' });
    // 结果回传：组件据此切「✓ 已收藏」
    expect(drawer.data.collect.line).toBe('done');
    expect(ctx.data.quoteCollected).toBe(true);      // 页脚「收藏」按钮同步点亮
  });

  it('collect-line 重复收藏 → 「已在收藏中」+ 回传 existed=true → 组件显示「已在收藏」', async () => {
    const ctx = await ctxWithWords();
    const drawer = makeDrawer({ visible: true, scope: 'line' });
    ctx.selectComponent = () => drawer;
    collectMock.mockResolvedValue({ id: 1, existed: true });
    ctx.onQuoteLineLongPress();
    tapCollect(drawer, 'collect-line');
    await ctx.onDrawerCollectLine({ detail: { lineIndex: 0, text: QUOTE_EN } });
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已在收藏中', icon: 'none' });
    expect(drawer.data.collect.line).toBe('existed');
  });

  it('收藏失败 → 抽屉不关 + 回传 ok=false（组件回原态）+ 不往外抛', async () => {
    const ctx = await ctxWithWords();
    const drawer = makeDrawer({ visible: true, scope: 'line' });
    ctx.selectComponent = () => drawer;
    collectMock.mockRejectedValue(new Error('boom'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    ctx.onQuoteLineLongPress();
    tapCollect(drawer, 'collect-line');
    await expect(ctx.onDrawerCollectLine({ detail: { lineIndex: 0, text: QUOTE_EN } })).resolves.toBeUndefined();
    expect(ctx.data.overlay).toMatchObject({ kind: 'drawer' });   // 失败也不关抽屉
    expect(drawer.data.collect.line).toBe('idle');                // 回「☆ 收藏此句」
    expect(ctx.data.quoteCollected).toBe(false);
    errSpy.mockRestore();
  });

  it('取不到抽屉实例（真机首帧 / 单测桩）→ 收藏照常写完，不抛', async () => {
    const ctx = await ctxWithWords();
    ctx.selectComponent = () => null;
    ctx.onQuoteLineLongPress();
    await expect(ctx.onDrawerCollectLine({ detail: { lineIndex: 0, text: QUOTE_EN } })).resolves.toBeUndefined();
    expect(collectMock).toHaveBeenCalledTimes(1);
  });

  it('页脚收藏按钮：成功后 quoteCollected=true（☆ → ✓ 已收藏），重复点保持 true', async () => {
    const ctx = await ctxWithWords();
    expect(ctx.data.quoteCollected).toBe(false);       // 初值就是未收藏（首帧不许闪已收藏）
    await ctx.collectQuote();
    expect(ctx.data.quoteCollected).toBe(true);
    collectMock.mockResolvedValue({ id: 1, existed: true });
    await ctx.collectQuote();                          // 重复点：服务端幂等 + toast 已在收藏中
    expect(ctx.data.quoteCollected).toBe(true);
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '已在收藏中', icon: 'none' });
  });

  it('页脚收藏失败 → 不点亮已收藏（不许假成功）', async () => {
    const ctx = await ctxWithWords();
    collectMock.mockRejectedValue(new Error('boom'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await ctx.collectQuote();
    expect(ctx.data.quoteCollected).toBe(false);
    errSpy.mockRestore();
  });

  it('词卡收藏按钮：成功后 quoteWordCollected=true；换词 / 关词卡复位', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordTap({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    expect(ctx.data.quoteWordCollected).toBe(false);
    await ctx.collectQuoteWord();
    expect(ctx.data.quoteWordCollected).toBe(true);
    ctx.closeQuoteTip();                               // 关词卡 → 复位
    expect(ctx.data.quoteWordCollected).toBe(false);
  });

  it('collect-word（普通词）→ hasDef:false 写进 meta（收藏页 E3 灰标的判据）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    await ctx.onDrawerCollectWord({ detail: { word: 'is', lineIndex: 0, hasDef: false } });
    const p = collectMock.mock.calls[0][0];
    expect(p.tag).toBe('word');
    expect(p.enMain).toBe('is');
    expect(p.note).toBe('');                        // 表外词无词性/释义 → 允许空串，不拒收
    expect(p.meta).toMatchObject({ book: 'NCE2', lessonId: 4, word: 'is', hasDef: false, from: 'daily' });
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已收藏', icon: 'none' });
  });

  it('collect-word（生词）→ note=词性+释义、hasDef:true、带音标', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'engineer', hasdef: true } } });
    await ctx.onDrawerCollectWord({ detail: { word: 'engineer', lineIndex: 0, hasDef: true } });
    const p = collectMock.mock.calls[0][0];
    expect(p.note).toBe('n. 工程师');
    expect(p.meta).toMatchObject({ word: 'engineer', phonetic: '/ˌendʒɪˈnɪə/', hasDef: true });
  });

  it('未登录收藏 → 首页既有形态：toast 请先登录 + 不发请求 + 抽屉先收起', async () => {
    isLoggedInMock.mockReturnValue(false);
    const ctx = await ctxWithWords();
    ctx.onQuoteWordLongPress({ currentTarget: { dataset: { w: 'is', hasdef: false } } });
    await ctx.onDrawerCollectWord({ detail: { word: 'is', lineIndex: 0, hasDef: false } });
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '请先登录', icon: 'none' });
    expect(collectMock).not.toHaveBeenCalled();
    expect(ctx.data.overlay).toBeNull();
  });

  it('close → overlay 归零（遮罩/下滑/✕ 三通道共用）', async () => {
    const ctx = await ctxWithWords();
    ctx.onQuoteLineLongPress();
    ctx.onDrawerClose({ detail: { via: 'mask' } });
    expect(ctx.data.overlay).toBeNull();
  });
});

/* ─────────────────────────── 不复制实现（静态） ─────────────────────────── */

describe('不复制实现：页面只挂载组件，不自绘抽屉、不重定义动作表', () => {
  it('index.wxml 不含抽屉自绘结构（ad-* 类名一个都不许出现）', () => {
    const w = stripWxmlComments(src('pages/home/index/index.wxml'));
    ['ad-mask', 'ad-drawer', 'ad-grab', 'ad-head', 'ad-acts', 'ad-act'].forEach((cls) => {
      expect(w).not.toContain(cls);
    });
  });

  it('index.ts 不重定义动作集合（无 actionsOf / ACTIONS / 动作文案字面量）', () => {
    const t = src('pages/home/index/index.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(t).not.toMatch(/function\s+actionsOf/);
    expect(t).not.toMatch(/const\s+ACTIONS/);
    ['朗读此句', '收藏此句', '朗读单词', '收藏单词'].forEach((label) => {
      expect(t).not.toContain(label);
    });
    // 反向：必须 import 公共层的纯函数（收藏 toast 文案只有那一份）
    expect(t).toContain("from '../../../utils/line-actions'");
  });

  it('index.json 挂载公共组件（路径指向 components/action-drawer）', () => {
    const j = JSON.parse(src('pages/home/index/index.json'));
    expect(j.usingComponents['action-drawer']).toBe('/components/action-drawer/index');
    // 既有 login-gate 不许被覆盖
    expect(j.usingComponents['login-gate']).toBe('/components/login-gate/index');
  });

  it('组件 7 个属性 + 3 个事件全部接上（漏一个就是某个动作静默失效）', () => {
    const w = src('pages/home/index/index.wxml');
    ['visible', 'scope', 'line-text', 'line-index', 'word', 'word-has-def', 'phonetic'].forEach((p) => {
      expect(w).toContain(`${p}="{{overlay`);
    });
    // 2026-11-26 变体 C：朗读下沉组件 → speak 两个 bind 已删，只剩收藏两项 + close
    ['collect-line', 'collect-word', 'close'].forEach((evt) => {
      expect(w).toContain(`bind:${evt}="onDrawer`);
    });
    expect(w).not.toContain('bind:speak-line');
    expect(w).not.toContain('bind:speak-word');
  });

  it('公共层对外契约（A8 收窄后：组件只许 import utils/line-actions + services/tts）', () => {
    const comp = src('components/action-drawer/index.ts');
    expect(comp).toMatch(/from '\.\.\/\.\.\/utils\/line-actions'/);
    // 2026-11-26 变体 C：朗读下沉 → 唯一新增的 services 依赖是 tts（用户在原型评审时拍板）
    const imports = Array.from(comp.matchAll(/from\s+['"]([^'"]*services\/[^'"]*)['"]/g)).map((m) => m[1]);
    expect(imports).toEqual(['../../services/tts']);
    // 4 项顺序真源：行=对象、列=动词。去掉注释后只看真正会渲染的 label 字面量顺序，
    // 防止「将来有人为了凑首页顺手改了公共层顺序」。
    const actions = src('utils/line-actions.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const labels = Array.from(actions.matchAll(/label:\s*'([^']+)'/g)).map((m) => m[1]);
    expect(labels).toEqual(['朗读此句', '收藏此句', '朗读单词', '收藏单词']);
  });
});

/**
 * 🔴 2026-11-27 新增组（真机反馈 ①②）：**「页面 data → 视图」这一段以前没有任何断言**。
 *
 * 缺口形态：上面的用例全都只断言 `ctx.data.quoteCollected === true`（页面状态改了），
 * 但没有一条断言 wxml 真的**把状态渲染出来**。于是「数据已经 true、图标还是 ☆」这种缺陷
 * （正是用户真机反馈 ①：点完收藏 icon 状态没变）可以一路全绿地发到用户手里。
 * 这一组把「状态字段 ↔ 渲染表达式」逐字钉住，并反向锁死字符/字符画形图标（反馈 ②）。
 */
describe('首页收藏/播放的「data → 视图」绑定（真机反馈 ①② 的静态守卫）', () => {
  const wxml = stripWxmlComments(src('pages/home/index/index.wxml'));

  it('页脚收藏按钮：icon / 文案 / done class 三者都必须随 quoteCollected 变', () => {
    // 反例优先：恒定表达式（不看状态）就是缺陷形态
    expect(wxml).not.toMatch(/class="dq-ico"[^>]*src="\{\{icons\.star\}\}"/);
    expect(wxml).not.toMatch(/class="dq-ico"[^>]*src="\{\{icons\.check\}\}"/);

    expect(wxml).toContain('src="{{quoteCollected ? icons.check : icons.star}}"');
    expect(wxml).toContain("{{quoteCollected ? '已收藏' : '收藏'}}");
    expect(wxml).toContain('class="dq-act {{quoteCollected ? \'done\' : \'\'}}"');
  });

  it('词卡收藏按钮：icon / 文案 / done class 三者都必须随 quoteWordCollected 变', () => {
    expect(wxml).not.toMatch(/class="q-tip-btn-ico"[^>]*src="\{\{icons\.star\}\}"/);
    expect(wxml).toContain('src="{{quoteWordCollected ? icons.check : icons.star}}"');
    expect(wxml).toContain("{{quoteWordCollected ? '已收藏' : '收藏'}}");
    expect(wxml).toContain('class="q-tip-btn {{quoteWordCollected ? \'done\' : \'\'}}"');
  });

  it('页脚朗读按钮：icon 随 quotePlaying 在 play/stop 间切换（反馈 ② 的一半）', () => {
    expect(wxml).toContain('src="{{quotePlaying ? icons.stop : icons.play}}"');
  });

  it('反例：首页 wxml 不许再出现字符/字符画图标（▶ ■ ☆ ★ ✓ 是反馈 ② 的原始形态）', () => {
    // 只看真正会渲染的文本，注释里可以写「原来用 ▶」这类说明
    expect(wxml).not.toMatch(/[▶◀■□☆★✓✔]/);
  });

  it('三处图标 <image> 全部带 mode="aspectFit"（防真机拉伸变形）', () => {
    const imgs = Array.from(wxml.matchAll(/<image\b[^>]*>/g)).map((m) => m[0]);
    expect(imgs.length).toBeGreaterThanOrEqual(4);   // 页脚 2 + 词卡 2
    imgs.forEach((tag) => {
      expect(tag).toContain('mode="aspectFit"');
      expect(tag).toMatch(/src="\{\{/);              // 路径必须走 data（utils/icons 注入），不许写死
    });
  });

  it('图标路径不写死在 wxml 里（真机若需切 base64，只改 utils/icons 一处）', () => {
    expect(wxml).not.toContain('/assets/icons/');
  });
});
