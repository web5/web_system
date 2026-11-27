/**
 * 长按动作抽屉（变体 C · 抽屉内朗读）— 纯 UI 组件
 *
 * 设计真源（不重新设计）：
 *  - 原型 `30-任务产物/2026-11-26-阅读交互调整-原型稿/原型-变体B-底部抽屉.html`
 *    sha256 前 16 位 `b039064b83b9c6e7`（D1 高度自适应 + 40vh / D2 2×2 + 标题区 /
 *    D4 关闭三通道 / D6 不透明白底 + 遮罩 .34 / D7 env(safe-area-inset-bottom) + 小屏 104rpx）
 *  - 交互变更（2026-11-26 用户拍板，变体 C）：
 *    `30-任务产物/2026-11-26-阅读交互调整-原型稿/原型-变体C-抽屉内朗读.html`
 *    → **朗读在抽屉内直接调 `speakText`，不再 triggerEvent 回页面；收藏仍回页面。**
 *  - 工程契约 `公共能力抽象方案.md` §3（事件契约）/ §4（状态机）/ §5（播放态归属）
 *
 * 🔴 四条硬红线（改这个文件前先读）：
 *  1. **组件不自己关**。收到遮罩 / 下滑 / ✕ 手势只 `triggerEvent('close')`，`visible` 由页面置 false。
 *     这样页面是唯一状态持有者（方案 §3.2 契约 1）——组件内部没有任何「关掉自己」的分支。
 *     唯一例外是「关之前先停朗读」（见 `_emitClose`）：那是**副作用**，不是关自己。
 *  2. **services 只允许 `services/tts`**（A8 收窄，2026-11-26）。朗读下沉到组件后，组件必须能调
 *     `speakText / stopSpeak / onSpeakState`；其余 services（glossary / auth / nce / account …）
 *     一律禁止 import —— 收藏、未登录守卫、payload 组装、toast 文案全部留在页面，
 *     两页的差异（详情页弹内联 modal、首页 toast）才不会在组件里被抹平。
 *     ⚠️ 注意「收藏动作下沉」与「收藏 service 下沉」是两件事：2026-11-27 收藏的**三态渲染**下沉到
 *     本组件（用户拍板方案 B），但 `collectGlossary` 仍由页面调、结果经 `onCollectDone` 回传 ——
 *     A8 红线不动。收藏态一旦要自己查接口，就只能 import services/glossary，A8 立刻红。
 *     另外两条允许的 import 都是零副作用纯函数层：`utils/line-actions`（动作表 / toast 文案）、
 *     `utils/icons`（图标路径 + 收藏三态文案）。
 *  3. **不测任何坐标**。抽屉是 `position:fixed; left/right/bottom:0`，组件内没有
 *     `createSelectorQuery` / `boundingClientRect` / `scrollOffset` / `pageX·750/windowWidth`
 *     （方案 §2.0-B：B 变体把「跨层测量」这个唯一形态级难题直接消灭）。
 *  4. **关了就不许还在念**。三条关闭通道（遮罩 / ✕ / 下滑）都必须先 `stopSpeak()` 再抛 `close`
 *     —— 抽屉一关，页面上就没有停止入口了。`pageLifetimes.hide` 与 `detached` 同样要停。
 *     🔴 **第四条通道（2026-11-27 盲测 P1 修）：页面自己关浮层**。页面侧 `closeOverlay()` 只把
 *     `visible` 置 false，**不经过**本组件任何手势分支 —— 组件唯一能感知到的是 `visible` 的
 *     observer。所以那个 observer 在 `visible` 变 false 时**必须自己先停朗读**，否则
 *     「抽屉已消失、声音还在念」，且重开时按钮带着 ■ 残留（点「朗读」实际执行的是停止，
 *     用户感知为「点了没声音」）。
 *     🔴 但**判据只能是来源标志 `_speakByDrawer`**（本实例发起的播放），不能是「有没有在播」：
 *     `playingKey` 由文本比对点亮，页面自己发起的整句朗读在抽屉打开时同样点亮它 —— 按
 *     `playingKey` 停会越权停掉页面发起的整句，与两页 `closeTip` / `closeQuoteTip`
 *     「整句在播 → 不停」的既有契约相反（详见 `DrawerInstance._speakByDrawer`）。
 *
 * 播放态（2026-11-26 变体 C 起**由组件自持**，方案 §5.2 的旧口径已作废）：
 *  - 组件订阅 `onSpeakState`：tts 推文本 → 按文本反查是哪个按钮在播（同一时刻至多一个）；
 *  - tts 推 `null`（自然播完 / 失败 / 被停）→ 按钮自动回 ▶ 态，不依赖页面镜像；
 *  - 点按本地立即切态（不等回流），tts 的权威状态到达后校正到同一值。
 *
 * 样式隔离：`index.json` 显式钉 `styleIsolation: "isolated"`。依据官方文档（组件样式 / 样式隔离）：
 * 「默认情况下，自定义组件的样式只受到自定义组件 WXSS 样式的影响」「在其他组件中，styleIsolation
 * 的默认值为 isolated」「从基础库 2.10.1 开始可通过 styleIsolation 修改」——本项目 libVersion 3.3.4
 * ≥ 2.10.1。显式写出来是为了让「页面 `.page.mode-immersion` 之类的祖先 class 不穿透进抽屉」这条
 * 不依赖默认值（D6 要求抽屉恒为不透明白底，不随阅读档变化）。
 */
import { EVT, actionsOf, type ActionItem } from '../../utils/line-actions';
import { ICONS, collectIcon, collectLabel, type CollectState } from '../../utils/icons';
/**
 * 🔴 唯一允许的 services import（A8 收窄）：朗读下沉到组件是用户 2026-11-26 拍板；
 *    收藏仍留页面以保留两页 toast / 内联 modal 的差异。静态断言在
 *    `tests/action-drawer.test.ts` 的 A8 组（其余 services 出现即红）。
 */
import { speakText, stopSpeak, onSpeakState, type SpeakState } from '../../services/tts';

/** 下滑关闭阈值（rpx）：≥ 48rpx 松手即关，< 48rpx 回弹（AC-B.13 / V-B9） */
const SWIPE_CLOSE_RPX = 48;
/**
 * 收藏「提交中」的**安全超时**（ms）：**只用于收藏**，朗读不用它。
 *
 * 🔴 语义已从「300ms busy 锁」升级成「等页面回传的状态机」（2026-11-27 方案 B）：
 *   `busy` 现在由 `onCollectDone` 释放（页面收藏成功/失败后回传），这才是真正的防连点 ——
 *   300ms 只是「人手两次点按间隔」的近似值，接口慢于 300ms 时仍会重复写入。
 *   但「等回传」有一个新风险：页面若因异常路径忘了回传，按钮会永远停在「收藏中」。
 *   所以保留一个**远大于真实接口超时**的兜底（8s）：到点自动回 `idle`，用户可重新点。
 *   宁可让极端情况下多一次幂等写入（服务端 existed 兜住），也不让按钮变死。
 */
const COLLECT_TIMEOUT_MS = 8000;
/**
 * 朗读点按防抖（ms）：**看起来像** busy 锁但语义完全不同 —— 朗读必须「再点一下就停」，
 * 复用 300ms busy 锁会让用户在 300ms 内点停止点不动（本组件 1.0.18 之前的真实缺陷形态）。
 * 这里只吞掉「同一次触摸被派发两次」这种同帧重复（人手两次点按间隔 ≥100ms），
 * 所以窗口取 60ms：远小于真实双击间隔，又远大于一次派发的重入窗口。
 */
const SPEAK_TAP_GUARD_MS = 60;
/**
 * 动作区高度（rpx）：2 行 × 96rpx + grid `gap:16rpx` = 208rpx（AC-B.20，小屏 2 × 104rpx）。
 * 抽屉贴视口底、动作区是抽屉最底部的一块，所以「触点距视口底 ≤ 动作区高度」等价于
 * 「手指落在按钮上」—— 这一带**不起拖拽**（BB6）。
 *
 * 算术（`index.wxss` 的 `.ad-act` / `.ad-acts` / `.ad-drawer` 三处尺寸）：
 *   按钮带真实高度 = 96 + 16(gap) + 96 = **208rpx**
 *   按钮带上沿距视口底 = 208 + 24(`.ad-drawer` 的 `padding-bottom` 呼吸量) = **232rpx**
 * 取 208（而不是 232）是**保守方向**：少拦 24rpx 只会让「贴着按钮上沿那条缝」允许起拖，
 * 不会把标题区的下滑误拦掉；反过来取 232 会把分隔线下方 24rpx 也算成按钮带。
 */
const ACTS_ZONE_RPX = 208;

/**
 * 首页 tabBar 让位高度（rpx）：**107rpx** = `.tb` 内容盒 100rpx + `.tb` 的 `padding-bottom: 6rpx`
 * + `.tabbar` 的 `border-top: 1rpx`（`custom-tab-bar/index.wxss`；安全区由 CSS 的 `env()` 另叠）。
 * 只在 `liftBottom=true` 时叠加进「动作区高度带」判定 —— 抽屉被整体抬高 107rpx 后，
 * 按钮带距视口底的距离也整体增加了这 107rpx；不补上就会把按钮带的上半截误判成
 * 「可以起拖」，BB6 第 2 层逻辑兜底随之失效（第 1 层 `.ad-acts` 的 catchtouchmove 只拦 move，
 * touchstart 照常冒泡进来，全靠本判定兜住）。
 * 🔴 与 `index.wxss` 的 `.ad-lift` 规则必须同值，测试已把两处绑在一起（改一处就红）。
 */
const TABBAR_LIFT_RPX = 107;
/** 取不到 windowHeight 时的兜底逻辑高（iPhone 8 / 常见最小屏，仅用于「距底距离」换算） */
const FALLBACK_WINDOW_H = 667;
/** 取不到 windowWidth 时的兜底（与 _pxToRpx 同一口径） */
const FALLBACK_WINDOW_W = 375;

interface TouchPoint { clientY?: number; pageY?: number; }
interface TouchEventLike { touches?: TouchPoint[]; }
interface TapEventLike { currentTarget?: { dataset?: Record<string, unknown> }; }

/**
 * 收藏三态的**唯一状态载体**（按作用域分槽：句档 / 词档可以各自独立在途）。
 * 🔴 不放进 `data.collect` 之外的地方：三态要驱动渲染（文案 + 图标 + 置灰），必须走 data。
 */
interface CollectView { line: CollectState; word: CollectState; }

/** 收藏态初值（换档 / 关抽屉 / 卸载都复用它，避免各处手写四个字段） */
const IDLE_COLLECT: CollectView = Object.freeze({ line: 'idle', word: 'idle' }) as CollectView;

/** 渲染用动作项：动作表原字段 + 本组件算出的图标与置灰位（动作表本身永远不被改写） */
interface ActView extends ActionItem {
  /** 常态图标（朗读项 = play.svg；收藏项 = 三态图标） */
  ico: string;
  /** 触发态图标（朗读项 = stop.svg；收藏项与常态同值，不会被用到） */
  icoOn: string;
  /** 该项是否正在提交（收藏中）—— 驱动置灰 + 点按短路 */
  busy: boolean;
  /** 该项是否处于「已收藏 / 已在收藏」（青绿态）—— 模板不自己拼文案判断 */
  collected: boolean;
}

/**
 * 动作表 → 渲染项。🔴 每次都从 `actionsOf()` **重新取**再叠加收藏态：
 * 动作表的顺序 / key / 文案它一个字都不改（`data-key` 是四按钮命脉），
 * 只在副本上把「收藏项」的 label 换成三态文案、icon 换成三态图标。
 *
 * 🔴 图标为什么算进 item、而不是在 wxml 里写 `{{icons.play}}`：
 *   抽屉 wxml 的动作区是 `wx:for` 循环，而 `tests/wxml-for-item-scope.test.ts` 的守卫要求
 *   「循环体内出现的每个 `x.` 取值，x 必须由 wx:for-item / wx:for-index 引入」。
 *   在循环体里引用页面级 `icons` 会被它判成越界（守卫不建模页面 data 的作用域）。
 *   与其放宽那条 P0 守卫（它守护的是「英文整段不显示」那个真实缺陷），不如把图标算进 item。
 */
function actsView(scope: 'line' | 'word', collect: CollectView): ActView[] {
  return actionsOf(scope).map((a) => {
    if (a.kind !== 'collect') {
      return { ...a, ico: ICONS.play, icoOn: ICONS.stop, busy: false, collected: false };
    }
    const kind = a.key === EVT.COLLECT_LINE ? 'line' : 'word';
    const state = collect[kind];
    const ico = collectIcon(state);
    return {
      ...a,
      label: collectLabel(a.label, state),
      ico,
      icoOn: ico,
      busy: state === 'busy',
      collected: state === 'done' || state === 'existed',
    };
  });
}

/**
 * 组件实例上的**逻辑层私有字段**（不进 `data`）。
 *
 * 为什么不能放 `data`：`data` 是渲染层数据源，进 `data` 的东西会走 setData 的序列化路径 ——
 * 塞一个函数进去，渲染层拿到的只能是 `null` / 空对象，纯属噪音，还会让「data 里有哪些字段」
 * 这条自查口径失真。真机支持在 `this` 上挂与 `data` 平级的自定义字段（不参与渲染），
 * 这也是本项目页面侧 `_offSpeakState` 的既有口径。
 *
 * 🔴 `Component()` 的配置对象**没有**「自定义实例字段」这一栏（页面 `Page({...})` 才有），
 * 所以字段只能在 `attached` 里赋值，类型靠下面这个收窄视图引入 —— 不做全文件 `as any`。
 */
interface DrawerInstance {
  /** `onSpeakState` 的退订闭包（`null` = 未订阅） */
  _offSpeakState: (() => void) | null;
  /**
   * 「当前这段朗读是**抽屉自己发起的**」来源标志（逻辑层私有，不进 `data`）。
   *
   * 🔴 为什么不能用 `playingKey` 当判据（2026-11-27 盲测纠正，我第一版就写错了）：
   *    `_syncSpeakState` 是**按文本比对**点亮的 —— tts 推来的文本等于抽屉持有的 `lineText` /
   *    `word` 就把 `playingKey` 点亮。它**分辨不出来源**。所以「页面自己发起的整句朗读」
   *    （用户在抽屉外点朗读、或首页「今日一句」）在抽屉打开时同样让 `playingKey='speak-line'`。
   *    此时用户长按开抽屉 → 点「收藏」→ 页面 `closeOverlay()` → 若按 `playingKey` 非空就停，
   *    会把**页面发起的整句朗读**停掉，而两页既有判据写死的是相反的：
   *      · 详情页 `closeTip`（`pages/nce/detail/detail.ts:454-469`）「真正在播整句时不停
   *        （用户可能想继续听整句）」；
   *      · 首页 `closeQuoteTip`（`pages/home/index/index.ts:553-562`）同口径「是整句 → 不停」；
   *      · 契约测试 `tests/nce-detail-blind-d-behavior.test.ts:250-259`「页面侧不得越权停
   *        非抽屉来源的播放」。
   *    所以判据必须是**来源**，不是**有没有在播**：`_speakByDrawer` 为 true 才停。
   *
   * 写入口（谁置 true / false 都被测试钉着）：
   *   · `_onSpeakTap` 真正发起朗读（`speakText` 之前）→ true；
   *   · `_clearPlaying` / `_resetLocalState` / `detached` → false；
   *   · `_syncSpeakState` 走**文本反查**两个分支（文本命中 ≠ 抽屉发起）、以及 tts 推 `null` → false。
   */
  _speakByDrawer: boolean;
}
/** 取实例的私有字段视图：不复制对象，只做类型收窄（`self` 收成 `unknown` 才允许这样转） */
const instOf = (self: unknown): DrawerInstance => self as DrawerInstance;

Component({
  properties: {
    /** 抽屉 + 遮罩同开同关（单 overlay 槽位，D3）。页面是唯一控制方 */
    visible: { type: Boolean, value: false },
    /** 'line' → 2 动作；'word' → 4 动作（E5 两页同口径）。空串 = 未开，按 line 兜底 */
    scope: { type: String, value: '' },
    /** 标题区显示的**原文**（D5：不显示释义）；句档是整句，词档是该词所在句 */
    lineText: { type: String, value: '' },
    /** 句下标，从 0 起；标题区「第 N 句」= lineIndex + 1，同时随事件回传 */
    lineIndex: { type: Number, value: -1 },
    /** 小写词形（朗读 / 收藏 / 标题区共用同一份）；scope='line' 时为空 */
    word: { type: String, value: '' },
    /** E2：true → 标题区元信息显示 phonetic；false → 显示「暂无释义」灰字（同一行，不增高） */
    wordHasDef: { type: Boolean, value: false },
    /** wordHasDef=true 时显示的音标 */
    phonetic: { type: String, value: '' },
    /**
     * 首页（tabBar 页）让位开关：true → 抽屉与遮罩整体抬到自定义 tabBar 之上。默认 false。
     *
     * 🔴 为什么必须让位：微信**自定义 tabBar 是框架层独立根节点**（`custom-tab-bar/` 由框架
     * 单独挂载，不在本页面节点树里），层级恒在页面内任何 `position: fixed` 元素之上 ——
     * z-index 提到多少都压不过它。所以「抽屉底部按钮被遮住 / 点不到」只能靠把抽屉抬到
     * tabBar 高度之上来解决，不能靠调 z-index。
     *
     * 🔴 属性选型：Boolean `liftBottom`，**不用**数值型 `bottomInset`（rpx）。三条理由：
     *  1. 要表达的是「本页有自定义 tabBar」这一**页面事实**，不是「抬多少」这个**几何量**。
     *     107rpx（= `.tb` 100rpx + `padding-bottom` 6rpx + `.tabbar` 的 `border-top` 1rpx）
     *     这个值来自 tabBar 自身样式，是项目级不变量；做成数值属性等于把这个不变量复制到
     *     每个调用点，将来改 tabBar 尺寸必然漏改，也没有任何东西拦得住某页传个 300rpx。
     *  2. 不破本组件红线 3（`index.wxml` 顶部：「不要出现 left:{{…}}rpx / top:{{…}}rpx 之类
     *     坐标绑定」）。数值属性只能靠内联 `style="bottom: {{bottomInset}}rpx"` 落地，正好踩线；
     *     Boolean 走 class 切换（`.ad-lift`），几何量全部留在 wxss 一处。
     *  3. 可测：抬高规则在 wxss 里只有一条字面量，测试能对它做正/反向字符串断言（见
     *     `tests/drawer-tabbar-lift-1126.test.ts`）。
     *
     * 🔴 只有 tabBar 页能传：详情页（`pages/nce/detail/detail`）是 `navigateTo` 打开的普通页，
     * 没有 tabBar —— 传了会凭空多出一条 107rpx 空白，且遮罩盖不到那条带。
     */
    liftBottom: { type: Boolean, value: false },
    /**
     * 🔴 2026-11-27 D7「收藏态双向同步」的**唯一通道**（两页共用）。
     *
     * 值是**已收藏的动作 key 数组**，元素取自 `EVT.COLLECT_LINE` / `EVT.COLLECT_WORD`
     * （= 现有的 `data-key` 值，一个字不改）。页面在「开抽屉那一刻」和「自己收藏成功后」
     * 各算一次传进来，组件只负责把命中的槽位渲染成 ✓ 已收藏。
     *
     * 🔴 为什么用**数组**而不是两个布尔（`lineCollected` / `wordCollected`）：
     *   同一份「已收藏」事实只能有一个表达 —— 两个布尔会让「句有、词无」「句无、词有」这类
     *   组合散成 4 个状态位，页面侧稍微漏写一处就出现「卡片说已收藏、抽屉说没收藏」的裂缝。
     *   数组把「哪些 key 已收藏」当成集合，页面每次整体重算，不会漏字段。
     *
     * 🔴 为什么必须是属性、而不是组件自己去查：
     *   ① A8 红线：组件只允许 import `services/tts`，收藏相关的一切（含「查是否已收藏」）
     *      留在页面 —— 组件一旦碰 services/glossary，两页的授权形态差异就会被抹平；
     *   ② 组件不知道「页面用的是哪个缓存口径 / 哪一课的 meta」，属性是唯一不引入耦合的通道。
     *   ⇒ 组件收到的只是**渲染用 key 集合**，它既不持久化、也不回写页面（真状态由页面持有）。
     *
     * ⚠️ 与 `onCollectDone` 的分工：点完收藏后组件走自己的三态机，页面随后把 key 加进本属性，
     *   observer 再对齐一次（命中的槽位已是 done/existed，值相同则不做任何 setData）。
     */
    collectedKeys: { type: Array, value: [] as string[] },
  },

  data: {
    /**
     * 当前作用域下的动作集合（唯一真源在 utils/line-actions.actionsOf）。
     * 🔴 2026-11-27 起这是「动作表副本 + 收藏三态」的渲染视图（`ActView`）：
     *    朗读项的 label/stopLabel 原样保留；收藏项的 label/ico 随 `collect` 变化。
     */
    acts: actsView('line', IDLE_COLLECT),
    /** 收藏三态（句档 / 词档各一格）。写入口只有 `_setCollect` 一处 */
    collect: { ...IDLE_COLLECT } as CollectView,
    /** 下滑位移（px）：仅手势过程中非 0，驱动 transform: translateY */
    swipeY: 0,
    /** 拖拽中：关掉 transition 让抽屉跟手（松手后再开回来做回弹 / 收起动画） */
    dragging: false,
    /** 动作 busy 锁：任一收藏项在途时为 true（**只锁收藏**，朗读走 SPEAK_TAP_GUARD_MS） */
    busy: false,
    /** 当前按下的动作 key（按下高亮 = E4 的「反馈」，不是「暗示」）。只由收藏分支置位 */
    pressedKey: '',
    /**
     * 播放中的朗读动作 key（'' = 无）。
     * wxml 用它决定「▶ 还是 ■ / 文案是 label 还是 stopLabel / 整卡是否品牌浅底」。
     * 写入口只有两处：点按时的本地立即切态、`onSpeakState` 的权威校正。
     */
    playingKey: '',
    /** 手势起点 Y（px）。逻辑层私有，不进渲染 —— 直接赋值，不 setData */
    _startY: 0,
    /** 本次触摸是否已记录起点（touchmove/end 的护栏） */
    _hasStart: false,
    /** busy 锁定时器句柄（逻辑层私有，不 setData） */
    _busyTimer: 0,
    /** 上一次朗读点按的 key / 时间戳：只用于吞掉同帧重复派发（逻辑层私有） */
    _speakTapKey: '',
    _speakTapAt: 0,
    /** 组件是否仍挂载（detached 后禁止 setData）。默认 true：实例一旦存在就是活的，
     *  只有显式 detached 才置 false —— 这样「从未 attached 的实例」也不会被误判成已卸载。 */
    _alive: true,
    /**
     * 🔴 退订闭包 `_offSpeakState` **不在 data 里**（2026-11-27 清理）：函数不是渲染层数据。
     * 它挂在组件实例上，类型见文件顶部的 `DrawerInstance` / `instOf`。
     */
  },

  observers: {
    /** 换档重算动作集合：line → 2 项、word → 4 项（顺序由 actionsOf 固定；收藏态按槽位各自保留） */
    scope(scope: string) {
      // 🔴 换档不重置收藏态：句档 / 词档是两个独立槽位，同一抽屉里「收藏此句」成功后
      //    切到词档再切回来，不该把已收藏态抹掉（用户就在同一个抽屉里连续操作）。
      this.setData({ acts: actsView(scope === 'word' ? 'word' : 'line', this.data.collect) });
    },
    /**
     * 关掉时把局部态归零：下次打开不残留上次的下滑位移 / 按下高亮 / 播放态。
     *
     * 🔴 2026-11-27 盲测 P1（「关了还在念」）：**页面也能关浮层** —— 页面侧 `closeOverlay()`
     * 只把 `visible` 置 false，不经过本组件的遮罩 / ✕ / 下滑三条通道。此时组件唯一能收到的
     * 信号就是这个 observer，所以「停朗读」必须在这里也做一次，否则：
     *   · 抽屉已消失、音频继续念（页面上再无停止入口）；
     *   · 重开抽屉时按钮带着 ■ 残留 → 点「朗读」走的是「停止」分支，用户以为「点了没声音」。
     *
     * 🔴 判据是**来源标志** `_speakByDrawer`（本实例自己发起的播放），**不是** `playingKey`
     * 非空：`playingKey` 由文本比对点亮，页面自己发起的整句朗读在抽屉打开时也会点亮它 ——
     * 按 `playingKey` 停会把页面发起的整句朗读一起停掉，与两页既有判据（「整句在播 → 不停，
     * 用户可能想继续听」：`closeTip` / `closeQuoteTip`）正好相反。详见 `DrawerInstance` 注释。
     * 顺序也是被断言的：**先 stopSpeak 再清 playingKey**（stopSpeak 推回的 null 可能同步到达，
     * 先清态会让「谁在播」这条信息在 stop 之前就丢了）。
     *
     * 三条手势通道（`_emitClose`）里的 `stopSpeak()` 保留 —— 幂等，重复调用无害，
     * 且「关了就不许还在念」这条红线不能只押在一个 observer 上。
     */
    visible(visible: boolean) {
      if (!visible) {
        if (instOf(this)._speakByDrawer) stopSpeak();
        this._resetLocalState();   // 内含 setData({ playingKey: '' }) + 来源标志复位
        return;
      }
      /**
       * 🔴 D7（2026-11-27）：**打开时**按页面给的初值点亮「已收藏」。
       * 顺序上必须在 `_resetLocalState` 之后（关闭时它已经把 collect 归零），
       * 所以放在 true 分支里做。
       * 入参传 `visible` 而不是让 `_seedCollect` 自己读 `this.data.visible`：observer 的
       * 参数才是这一次的权威值（真机上 data 会先更新，但依赖这个时序属于「靠框架实现细节」；
       * 单测桩里也不会替我们更新 data —— 让调用方把值交进来，两条路都成立）。
       */
      this._seedCollect(true);
    },
    /**
     * 页面在抽屉**开着的时候**也可能改这个集合（本页收藏成功后把 key 加进来）。
     * 🔴 数组属性按**引用**比较：页面必须整体换成新数组（`[...keys, k]`），
     *    `push` 原地改不会触发 observer —— 这条已写进 `_seedCollect` 的注释与测试。
     */
    collectedKeys() { this._seedCollect(); },
  },

  lifetimes: {
    attached() {
      this.data._alive = true;
      this.data._speakTapKey = '';
      this.data._speakTapAt = 0;
      // 订阅 tts 权威状态：自然播完 / 失败 / 被页面停掉 → 按钮自动回 ▶（契约 5）
      // 🔴 退订闭包挂实例字段（不进 data），见文件顶部 DrawerInstance 的注释
      instOf(this)._offSpeakState = onSpeakState((s) => this._syncSpeakState(s));
      // 来源标志初值：刚挂载时本实例没发起过任何朗读（不能留 undefined 让判据依赖隐式转换）
      instOf(this)._speakByDrawer = false;
      // 首帧对齐一次：父组件可能在 attached 前就传了 scope
      this.setData({ acts: actsView(this.data.scope === 'word' ? 'word' : 'line', this.data.collect) });
      // D7：若页面在**创建时**就带着 visible=true（初始值不触发 observer），这里补一次初值对齐
      this._seedCollect();
    },
    detached() {
      this.data._alive = false;
      // 先退订再停：退订后 stopSpeak 推的 null 不会再回到本实例（避免卸载后 setData 告警）
      const inst = instOf(this);
      if (inst._offSpeakState) {
        inst._offSpeakState();
        inst._offSpeakState = null;
      }
      stopSpeak(); // 组件销毁 = 抽屉不可能再被打开：绝不允许「关了还在念」
      inst._speakByDrawer = false;
      this.data.playingKey = '';
      if (this.data._busyTimer) {
        clearTimeout(this.data._busyTimer);
        this.data._busyTimer = 0;
      }
    },
  },

  pageLifetimes: {
    /**
     * 抽屉打开时切后台 → 停朗读 + 内部局部态归零（方案 §5.3）。
     * 官方顺序：组件 `pageLifetimes.hide`（组件树自顶向下）**早于** `Page.onHide`，
     * 所以这里归零不会被页面的 onHide 覆盖；浮层本身的 `overlay = null` 由页面负责
     * （组件不持有业务态，见 §5.3 归零责任矩阵）。
     * 🔴 必须先 stopSpeak：切后台时抽屉可能还开着，回来时若还在念就没人能停（契约 8）。
     */
    hide() {
      stopSpeak();
      this._resetLocalState();
    },
  },

  methods: {
    /** 遮罩上的 touchmove 空处理：用于拦页面滚动穿透（K4，方案标「未验证」） */
    noop() { /* 故意留空：catchtouchmove 只为消费事件 */ },

    /** 点遮罩 → 只抛信号，自己不关（契约 1） */
    onMaskTap() { this._emitClose('mask'); },

    /** 点右上 ✕ → 只抛信号 */
    onCloseTap() { this._emitClose('close'); },

    /**
     * 下滑手势起点。🔴 BB6（盲测 D-6）：**触点落在动作按钮区时不起拖拽** ——
     * 「想点按却把抽屉拖走」比「拖不动抽屉」糟得多（前者误关，后者只是少一条手势通道，
     * 下滑之外还有遮罩 / ✕ 两个关闭通道，D4 三通道不受影响）。
     * 第 1 层是 wxml 结构的 `.ad-acts` 上的 `catchtouchmove`（拦住 move，抽屉拖不动）；
     * 🔴 那个容器上**不许**再写 `catchtouchstart` —— 父节点 catch 掉 touchstart 会让子按钮的
     * tap 失效（真机缺陷根因，详见 index.wxml 里 `.ad-acts` 上方的长注释）。
     * 这里是第 2 层逻辑兜底：只靠 move 拦截不够（touchstart 会冒泡上来把 `dragging` 打开）。
     */
    onTouchStart(e: TouchEventLike) {
      const t = (e.touches && e.touches[0]) || null;
      if (!t) return;
      const startY = Number(t.clientY !== undefined ? t.clientY : t.pageY) || 0;
      if (this._startedInActsZone(startY)) return;
      this.data._startY = startY;
      this.data._hasStart = true;
      this.setData({ dragging: true, swipeY: 0 });
    },

    onTouchMove(e: TouchEventLike) {
      if (!this.data._hasStart) return;
      const t = (e.touches && e.touches[0]) || null;
      if (!t) return;
      const y = Number(t.clientY !== undefined ? t.clientY : t.pageY) || 0;
      const dy = y - this.data._startY;
      // 只跟「下拉」：上滑不产生位移，避免抽屉被往上拖出屏
      this.setData({ swipeY: dy > 0 ? dy : 0 });
    },

    onTouchEnd() {
      if (!this.data._hasStart) return;
      this.data._hasStart = false;
      const dyRpx = this._pxToRpx(this.data.swipeY);
      if (dyRpx >= SWIPE_CLOSE_RPX) {
        // 够阈值：保持当前位移（开回 transition，视觉上继续往下滑出），然后抛 close
        this.setData({ dragging: false });
        this._emitClose('swipe');
        return;
      }
      // 不够阈值：回弹到原位（BB7）
      this.setData({ dragging: false, swipeY: 0 });
    },

    /**
     * 点动作：按 kind 分流（speak = 本地调 tts；collect = 进「收藏中」+ 抛事件）。
     *
     * 🔴 收藏（2026-11-27 方案 B）：点下去只做两件事 —— 本地切「收藏中」、把事件抛给页面；
     *    页面调完 `collectGlossary` 后通过 `onCollectDone(kind, ok, existed)` 回传结果，
     *    组件据此切「已收藏 / 已在收藏 / 回原态」。**收不收藏不由组件判断**（A8 红线的边界）。
     */
    onActionTap(e: TapEventLike) {
      const ds = (e.currentTarget && e.currentTarget.dataset) || {};
      const key = String(ds.key || '');
      if (!key) return;
      if (this._kindOf(key, ds.kind) === 'speak') {
        this._onSpeakTap(key);
        return;
      }
      // 收藏：任一档在途时整体短路 —— 既防连点重复写入，也防两档同时在途时状态互相覆盖
      if (this.data.busy) return;
      const kind = this._collectKindOf(key);
      this._setCollect(kind, 'busy', { pressedKey: key });
      this._emitAction(key);
      this._armCollectTimeout(kind);
    },

    /**
     * 收藏结果回传（**页面调，唯一入口**）。两页都是在 service 调用落地后调一次：
     *   `this.selectComponent('#drawer').onCollectDone('line', ok, existed)`
     *
     * 参数语义：
     *  - `ok=false` → 回 `idle`（错误提示由 utils/request.ts 统一弹，组件不弹任何东西）；
     *  - `ok=true, existed=false` → `done`（✓ 已收藏）；
     *  - `ok=true, existed=true` → `existed`（✓ 已在收藏，沿用 collectToastText 的口径）。
     *
     * 🔴 三道守卫，缺一条都会出脏状态：
     *  ① `_alive`：卸载后不许 setData；
     *  ② `visible`：抽屉已关（未登录路径会先关抽屉 / 用户自己关掉）则整体忽略 ——
     *     状态在 `visible=false` 时已复位，迟到的回传不许把「已收藏」写到下一次打开上；
     *  ③ 当前槽位必须仍在 `busy`：挡重复回传与两页串台（不是本轮发起的，不改状态）。
     */
    onCollectDone(kind: string, ok: boolean, existed = false) {
      if (!this.data._alive) return;
      if (!this.data.visible) return;
      const k: 'line' | 'word' = kind === 'word' ? 'word' : 'line';
      if (this.data.collect[k] !== 'busy') return;
      this._clearCollectTimer();
      const next: CollectState = !ok ? 'idle' : (existed ? 'existed' : 'done');
      this._setCollect(k, next, { pressedKey: '' });
    },

    // ------------------------------------------------------------------
    // 内部方法
    // ------------------------------------------------------------------

    /** 动作种类：优先信 wxml 的 `data-kind`，缺失/脏值时回落到动作表（不做业务判断） */
    _kindOf(key: string, kindFromDataset?: unknown): 'speak' | 'collect' {
      const k = String(kindFromDataset || '');
      if (k === 'speak' || k === 'collect') return k;
      const items = (this.data.acts || []) as ActionItem[];
      for (let i = 0; i < items.length; i++) {
        if (items[i] && items[i].key === key && items[i].kind === 'speak') return 'speak';
      }
      return 'collect';
    },

    /** 该动作要朗读的原文（抽屉已持有，正是本文原文 —— 无需回页面取） */
    _textOf(key: string): string {
      if (key === EVT.SPEAK_WORD) return String(this.data.word || '').trim();
      if (key === EVT.SPEAK_LINE) return String(this.data.lineText || '').trim();
      return '';
    },

    /**
     * 朗读点按（契约 2/3/4）：
     *  - 同一个播放中的按钮再点 → `stopSpeak()` + 按钮回 ▶（**不关抽屉**）；
     *  - 另一个朗读按钮 → 停掉当前、起新的（同一时刻只能有一个按钮是播放态）；
     *  - 全程**不 emit 任何事件**（朗读已下沉，页面不需要知道）。
     * 🔴 不复用 `busy` 锁：300ms 内点停止必须立刻生效。防抖只吞同帧重复派发。
     */
    _onSpeakTap(key: string) {
      const now = Date.now();
      if (this.data._speakTapKey === key && now - this.data._speakTapAt < SPEAK_TAP_GUARD_MS) return;
      this.data._speakTapKey = key;
      this.data._speakTapAt = now;

      const text = this._textOf(key);
      if (!text) {
        // 没有原文（脏属性 / 时机不对）：不亮、不念，保持静止态
        this._clearPlaying();
        return;
      }

      if (this.data.playingKey === key) {
        // 契约 3：再点同一个 = 停。先清态再停（不依赖 stopSpeak 的 null 一定被收到）
        this._clearPlaying();
        stopSpeak();
        return;
      }

      // 契约 4：换一个朗读按钮 → 先停当前（显式停：起不来时也不残留旧播放），再起新的
      if (this.data.playingKey) stopSpeak();
      // 本地立即切态（不等回流）；tts 同步推的 loading 会把它校正成同一个值
      this.setData({ playingKey: key });
      // 🔴 来源标志：从这一行起这段朗读是**本实例发起**的（页面侧关抽屉时才有权停它）。
      //    必须在 speakText 之前置位 —— tts 可能同步回流，回流走的是「沿用当前 key」分支，
      //    那里不改标志，靠的就是这里先置 true。
      instOf(this)._speakByDrawer = true;
      void speakText(text).then((ok) => {
        // 起不来（未登录 / 文本超长 / 空文本）：把乐观态收回，不留「永远在播」的死按钮
        if (ok || !this.data._alive) return;
        if (this.data.playingKey === key) this._clearPlaying();
      }).catch(() => {
        // speakText 理论上不外抛（内部已兜底）；万一抛，也别让按钮卡在播放态
        if (this.data._alive && this.data.playingKey === key) this._clearPlaying();
      });
    },

    /** 清播放态（逻辑层 + 渲染层同一处）。🔴 同时把「来源」清掉：没有播放态，就没有「抽屉发起的播放」 */
    _clearPlaying() {
      instOf(this)._speakByDrawer = false;   // 先清来源（无播放态即无来源，早退也不能漏）
      if (!this.data.playingKey) return;
      this.setData({ playingKey: '' });
    },

    /**
     * tts 权威状态 → 按钮态（契约 5）。文本落到哪个动作就亮哪个，落不到（页面在播别的）就全灭。
     * 🔴 先认「当前正在播的 key」再反查：词档下 `word` 与 `lineText` 可能同文（单词句），
     *    此时应保持用户刚点的那个按钮，而不是跳到另一个同文按钮。
     *
     * 🔴 来源标志（2026-11-27 盲测纠正）：**只有第一个分支（沿用当前 key）保留来源不变** ——
     *    那说明这次回流是在续报本实例刚发起的那段播放。后两个分支是**文本反查**点亮的，
     *    文本命中 ≠ 抽屉发起（页面自己发起的整句朗读同文时也会命中），必须显式把
     *    `_speakByDrawer` 置回 false；tts 推 `null`（自然播完 / 被停 / 失败）同样置 false ——
     *    那时已经没有任何播放，来源标志留着只会在下次关抽屉时误停别人的朗读。
     */
    _syncSpeakState(s: SpeakState | null) {
      if (!this.data._alive) return;
      const text = s ? String(s.text || '').trim() : '';
      let next = '';
      /** 本次点亮是否为「沿用本实例当前播放中的 key」（唯一能保住来源标志的分支） */
      let keepSource = false;
      if (text) {
        const cur = String(this.data.playingKey || '');
        if (cur && this._textOf(cur) === text) {
          next = cur;
          keepSource = true;
        } else if (this.data.scope === 'word' && String(this.data.word || '').trim() === text) {
          next = EVT.SPEAK_WORD;
        } else if (String(this.data.lineText || '').trim() === text) {
          next = EVT.SPEAK_LINE;
        }
      }
      if (!keepSource) instOf(this)._speakByDrawer = false;
      if (next === this.data.playingKey) return;
      this.setData({ playingKey: next });
    },

    /**
     * 事件分流：只映射「key → 事件名 + payload」，不碰任何业务。
     * 🔴 朗读动作**不在这里**：它们已在 `_onSpeakTap` 里本地消化（不 emit、不关抽屉）。
     */
    _emitAction(key: string) {
      const lineIndex = Number(this.data.lineIndex);
      const text = String(this.data.lineText || '');
      const word = String(this.data.word || '');
      if (key === EVT.COLLECT_LINE) {
        this.triggerEvent(EVT.COLLECT_LINE, { lineIndex, text });
        return;
      }
      if (key === EVT.COLLECT_WORD) {
        // hasDef 只随事件回传（页面决定 meta 里放不放音标），**不参与动作可用性判定**
        this.triggerEvent(EVT.COLLECT_WORD, { word, lineIndex, hasDef: !!this.data.wordHasDef });
      }
    },

    /**
     * 抛关闭信号。🔴 **先 `stopSpeak()` 再 emit**（契约 6）：
     * 三条通道（遮罩 / ✕ / 下滑）关掉抽屉后，页面上没有任何停止入口了，
     * 所以「关了还在念」是硬缺陷 —— 停朗读必须发生在 close 之前（顺序本身也是被断言的）。
     *
     * 🔴 这三条通道是**用户对抽屉本身下指令**（点遮罩 / 点 ✕ / 下滑），语义是「连朗读一起关」，
     *    所以这里无条件停、不看 `_speakByDrawer`（与页面侧 `closeOverlay()` 的 observer 判据不同：
     *    那边可能是页面在播整句、顺手关了个抽屉，不能越权停别人的朗读）。
     *    `_clearPlaying()` 会顺带把来源标志置 false。
     */
    _emitClose(via: 'mask' | 'swipe' | 'close') {
      stopSpeak();
      this._clearPlaying();
      this.triggerEvent(EVT.CLOSE, { via });
    },

    /** 收藏动作的槽位：`collect-line` → line、`collect-word` → word（其余按 line 兜底） */
    _collectKindOf(key: string): 'line' | 'word' {
      return key === EVT.COLLECT_WORD ? 'word' : 'line';
    },

    /**
     * 页面传来的 key 集合里是否含某个动作 key（脏值一律当「没有」）。
     *
     * 🔴 只认**字符串**：属性是 `Array`，页面传 `null` / `undefined` / 数字都会走到这里。
     *    不做隐式转换（`String(null)` 会变成 `'null'`），免得某天出现一个 `'null'` key 被当成命中。
     */
    _hasCollectedKey(key: string): boolean {
      const keys = this.data.collectedKeys;
      if (!Array.isArray(keys)) return false;
      for (let i = 0; i < keys.length; i++) {
        if (typeof keys[i] === 'string') {
          const v = String(keys[i]);
          if (v === key) return true;
        }
      }
      return false;
    },

    /**
     * 🔴 D7（2026-11-27）：按页面给的 `collectedKeys` 点亮「已收藏」（**只看显示态，不查任何接口**）。
     *
     * `opened` 由 `visible` observer 显式传入（那是这一次的权威值）；`collectedKeys` observer
     * 不带参数，退回读 `this.data.visible`（它在抽屉开着时才会改变状态）。
     *
     * 两道守卫：
     *  ① 抽屉没开不开工（属性在页面 data 里长期存在，关闭期间的变化不该改任何状态）；
     *  ② 槽位在 `busy` / `existed` 时**保留原值**：
     *     · `busy` = 收藏请求在途，用初值覆盖会让按钮从「收藏中」跳回「已收藏」（假成功）；
     *     · `existed` = 刚回传的「✓ 已在收藏」一次性提示，页面此时会同步把 key 加进集合，
     *       若被初值覆盖成 `done`，用户就看不到「已在收藏」这条反馈了（回归方案 B 的判据）。
     * 值没变就不 setData（避免无意义重绘，也让「打开即已收藏」那一帧不闪）。
     */
    _seedCollect(opened = false) {
      if (!opened && !this.data.visible) return;
      const cur: CollectView = this.data.collect || IDLE_COLLECT;
      const seeded = (state: CollectState, collected: boolean): CollectState => {
        if (state === 'busy' || state === 'existed') return state;
        return collected ? 'done' : 'idle';
      };
      const next: CollectView = {
        line: seeded(cur.line, this._hasCollectedKey(EVT.COLLECT_LINE)),
        word: seeded(cur.word, this._hasCollectedKey(EVT.COLLECT_WORD)),
      };
      if (next.line === cur.line && next.word === cur.word) return;
      this.setData({
        collect: next,
        acts: actsView(this.data.scope === 'word' ? 'word' : 'line', next),
        busy: next.line === 'busy' || next.word === 'busy',
      });
    },

    /**
     * 收藏态唯一写入口：同时刷新 `collect`（状态）与 `acts`（渲染视图）+ `busy`（全局短路位）。
     * 🔴 三者必须在**同一次** setData 里落地：先改一个再改另一个会闪一帧「文案变了图标没变」。
     */
    _setCollect(kind: 'line' | 'word', state: CollectState, extra: Record<string, unknown> = {}) {
      const collect: CollectView = { line: this.data.collect.line, word: this.data.collect.word };
      collect[kind] = state;
      this.setData({
        collect,
        acts: actsView(this.data.scope === 'word' ? 'word' : 'line', collect),
        busy: collect.line === 'busy' || collect.word === 'busy',
        ...extra,
      });
    },

    /**
     * 提交中的安全超时（见 COLLECT_TIMEOUT_MS 的注释）：页面忘了回传时把按钮救回 `idle`。
     * 只对**同一个槽位**生效：两句/两词并发时，先到点的那个不许把另一个也重置。
     */
    _armCollectTimeout(kind: 'line' | 'word') {
      this._clearCollectTimer();
      this.data._busyTimer = setTimeout(() => {
        this.data._busyTimer = 0;
        if (!this.data._alive) return;
        if (this.data.collect[kind] !== 'busy') return;
        this._setCollect(kind, 'idle', { pressedKey: '' });
      }, COLLECT_TIMEOUT_MS) as unknown as number;
    },

    /** 清安全超时（回传到达 / 关闭 / 卸载 都要清，避免迟到的定时器改状态） */
    _clearCollectTimer() {
      if (this.data._busyTimer) {
        clearTimeout(this.data._busyTimer);
        this.data._busyTimer = 0;
      }
    },

    /** 局部态归零（隐藏 / 关闭 / 页面切后台共用一处，避免各处漏字段） */
    _resetLocalState() {
      this.data._hasStart = false;
      this.data._startY = 0;
      this.data._speakTapKey = '';
      this.data._speakTapAt = 0;
      // 来源标志也在这里归零：调用方（visible observer / pageLifetimes.hide）都是「本次播放结束」
      instOf(this)._speakByDrawer = false;
      this._clearCollectTimer();
      /**
       * 🔴 收藏态**关闭即复位**（交互原型的「待定项」在这里定死）。
       * 原型留了两个选项：「关抽屉保留已收藏态」vs「按真实数据重查」。本实现选**复位**：
       * 页面没有任何「这句/这个词是否已收藏」的查询接口，保留一个客户端记的「已收藏」
       * 会在收藏记录被别处删掉后长期显示假状态；而复位只让用户多点一次（服务端幂等，不会重复写）。
       * 代价明说：同一句收藏一次后关掉抽屉再打开，按钮回到「☆ 收藏此句」，再点会提示「已在收藏」。
       */
      const collect: CollectView = { ...IDLE_COLLECT };
      this.setData({
        swipeY: 0, dragging: false, busy: false, pressedKey: '', playingKey: '',
        collect,
        acts: actsView(this.data.scope === 'word' ? 'word' : 'line', collect),
      });
    },

    /**
     * 触点是否落在「动作按钮带」里（BB6）。判据：距视口底部 ≤ 动作区高度（px）。
     * 抽屉 `position:fixed; bottom:0` + 动作区在最底部 ⇒ 这一带就是按钮所在带（含安全区时会略窄，
     * 保守方向是「少拦一点」，不会把标题区的下滑误拦掉）。
     * 首页开了 `liftBottom` 时抽屉整体上移，按钮带距视口底的距离同步 +`TABBAR_LIFT_RPX`，
     * 判定带必须跟着加宽，否则按钮带的上半截会被当成可起拖区（BB6 第 2 层失效）。
     * 坐标脏值（0 / NaN / 负）一律**放行**：宁可允许拖拽（阈值/回弹仍然生效），也不让下关闭失灵。
     */
    _startedInActsZone(clientY: number): boolean {
      const y = Number(clientY);
      if (!isFinite(y) || y <= 0) return false;
      const wh = this._windowSize('windowHeight', FALLBACK_WINDOW_H);
      const zoneRpx = ACTS_ZONE_RPX + (this.data.liftBottom ? TABBAR_LIFT_RPX : 0);
      return wh - y <= this._rpxToPx(zoneRpx);
    },

    /** 读 getSystemInfoSync 的某个尺寸；取值异常时返回兜底值（绝不让 NaN 进入判定） */
    _windowSize(key: 'windowWidth' | 'windowHeight', fallback: number): number {
      let v = 0;
      try {
        v = Number((wx.getSystemInfoSync() as unknown as Record<string, unknown>)[key]) || 0;
      } catch {
        v = 0;
      }
      return v > 0 && isFinite(v) ? v : fallback;
    },

    /** rpx → px（与 _pxToRpx 反向，同一套 windowWidth 兜底口径） */
    _rpxToPx(rpx: number): number {
      return (Number(rpx) || 0) * this._windowSize('windowWidth', FALLBACK_WINDOW_W) / 750;
    },

    /**
     * px → rpx。下滑阈值口径是 48rpx（AC-B.13），而原生 touch 给的是 px，必须换算。
     * 兜底：windowWidth 异常（0 / NaN / 取值抛错）时按 375 算，**不得算出 NaN/Infinity**
     * （否则阈值判定永远为假 → 下滑关不掉）。
     */
    _pxToRpx(px: number): number {
      return (Number(px) || 0) * 750 / this._windowSize('windowWidth', FALLBACK_WINDOW_W);
    },
  },
});
