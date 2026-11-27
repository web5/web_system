/**
 * 长按动作抽屉（变体 B · 底部抽屉）— 纯 UI 组件
 *
 * 设计真源（不重新设计）：
 *  - 原型 `30-任务产物/2026-11-26-阅读交互调整-原型稿/原型-变体B-底部抽屉.html`
 *    sha256 前 16 位 `b039064b83b9c6e7`（D1 高度自适应 + 40vh / D2 2×2 + 标题区 /
 *    D4 关闭三通道 / D6 不透明白底 + 遮罩 .34 / D7 env(safe-area-inset-bottom) + 小屏 104rpx）
 *  - 工程契约 `公共能力抽象方案.md` §3（事件契约）/ §4（状态机）/ §5（播放态归属）
 *
 * 🔴 三条硬红线（改这个文件前先读）：
 *  1. **组件不自己关**。收到遮罩 / 下滑 / ✕ 手势只 `triggerEvent('close')`，`visible` 由页面置 false。
 *     这样页面是唯一状态持有者（方案 §3.2 契约 1）——组件内部没有任何「关掉自己」的分支。
 *  2. **组件不得 import 任何 services**（方案 §3.3）。组件只做 UI + 手势 + triggerEvent；
 *     朗读 / 收藏 / 未登录守卫 / payload 组装 / toast 文案全部留在页面，两页的差异（详情页弹内联
 *     modal、首页 toast）才不会在组件里被抹平。唯一允许的 import 是 `utils/line-actions`（零副作用纯函数）。
 *  3. **不测任何坐标**。抽屉是 `position:fixed; left/right/bottom:0`，组件内没有
 *     `createSelectorQuery` / `boundingClientRect` / `scrollOffset` / `pageX·750/windowWidth`
 *     （方案 §2.0-B：B 变体把「跨层测量」这个唯一形态级难题直接消灭）。
 *
 * 播放态：组件**不持有、不订阅、不感知**（方案 §5.2）。动作触发后组件即收起，
 * 用户看到的播放反馈是页面上的句子高亮与行尾「■ 停止」（U1）。
 *
 * 样式隔离：`index.json` 显式钉 `styleIsolation: "isolated"`。依据官方文档（组件样式 / 样式隔离）：
 * 「默认情况下，自定义组件的样式只受到自定义组件 WXSS 样式的影响」「在其他组件中，styleIsolation
 * 的默认值为 isolated」「从基础库 2.10.1 开始可通过 styleIsolation 修改」——本项目 libVersion 3.3.4
 * ≥ 2.10.1。显式写出来是为了让「页面 `.page.mode-immersion` 之类的祖先 class 不穿透进抽屉」这条
 * 不依赖默认值（D6 要求抽屉恒为不透明白底，不随阅读档变化）。
 */
import { EVT, actionsOf, type ActionItem } from '../../utils/line-actions';

/** 下滑关闭阈值（rpx）：≥ 48rpx 松手即关，< 48rpx 回弹（AC-B.13 / V-B9） */
const SWIPE_CLOSE_RPX = 48;
/** 动作后 busy 锁时长（ms）：防连点重复请求（方案 §3.2 契约 2） */
const BUSY_MS = 300;
/**
 * 动作区高度（rpx）：2 行 × 96rpx（AC-B.20，小屏 2 × 104rpx 更矮的那侧取小值更保守）。
 * 抽屉贴视口底、动作区是抽屉最底部的一块，所以「触点距视口底 ≤ 动作区高度」等价于
 * 「手指落在按钮上」—— 这一带**不起拖拽**（BB6）。
 */
const ACTS_ZONE_RPX = 192;
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
  },

  data: {
    /** 当前作用域下的动作集合（唯一真源在 utils/line-actions.actionsOf） */
    acts: actionsOf('line') as ActionItem[],
    /** 下滑位移（px）：仅手势过程中非 0，驱动 transform: translateY */
    swipeY: 0,
    /** 拖拽中：关掉 transition 让抽屉跟手（松手后再开回来做回弹 / 收起动画） */
    dragging: false,
    /** 动作 busy 锁：300ms 内忽略后续点击 */
    busy: false,
    /** 当前按下的动作 key（按下高亮 = E4 的「反馈」，不是「暗示」） */
    pressedKey: '',
    /** 手势起点 Y（px）。逻辑层私有，不进渲染 —— 直接赋值，不 setData */
    _startY: 0,
    /** 本次触摸是否已记录起点（touchmove/end 的护栏） */
    _hasStart: false,
    /** busy 锁定时器句柄（逻辑层私有，不 setData） */
    _busyTimer: 0,
    /** 组件是否仍挂载（detached 后禁止 setData）。默认 true：实例一旦存在就是活的，
     *  只有显式 detached 才置 false —— 这样「从未 attached 的实例」也不会被误判成已卸载。 */
    _alive: true,
  },

  observers: {
    /** 换档重算动作集合：line → 2 项、word → 4 项（顺序由 actionsOf 固定） */
    scope(scope: string) {
      this.setData({ acts: actionsOf(scope === 'word' ? 'word' : 'line') });
    },
    /** 关掉时把局部态归零：下次打开不残留上次的下滑位移 / 按下高亮 */
    visible(visible: boolean) {
      if (!visible) this._resetLocalState();
    },
  },

  lifetimes: {
    attached() {
      this.data._alive = true;
      // 首帧对齐一次：父组件可能在 attached 前就传了 scope
      this.setData({ acts: actionsOf(this.data.scope === 'word' ? 'word' : 'line') });
    },
    detached() {
      this.data._alive = false;
      if (this.data._busyTimer) {
        clearTimeout(this.data._busyTimer);
        this.data._busyTimer = 0;
      }
    },
  },

  pageLifetimes: {
    /**
     * 抽屉打开时切后台 → 内部局部态归零（方案 §5.3）。
     * 官方顺序：组件 `pageLifetimes.hide`（组件树自顶向下）**早于** `Page.onHide`，
     * 所以这里归零不会被页面的 onHide 覆盖；浮层本身的 `overlay = null` 由页面负责
     * （组件不持有业务态，见 §5.3 归零责任矩阵）。
     */
    hide() {
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

    /** 点动作：busy 锁 + 按下高亮 + 按 key 抛对应事件（组件不知道业务怎么做） */
    onActionTap(e: TapEventLike) {
      const ds = (e.currentTarget && e.currentTarget.dataset) || {};
      const key = String(ds.key || '');
      if (!key || this.data.busy) return;
      this.setData({ busy: true, pressedKey: key });
      this._emitAction(key);
      this._armBusyRelease();
    },

    // ------------------------------------------------------------------
    // 内部方法
    // ------------------------------------------------------------------

    /** 事件分流：只映射「key → 事件名 + payload」，不碰任何业务 */
    _emitAction(key: string) {
      const lineIndex = Number(this.data.lineIndex);
      const text = String(this.data.lineText || '');
      const word = String(this.data.word || '');
      if (key === EVT.SPEAK_LINE) {
        this.triggerEvent(EVT.SPEAK_LINE, { lineIndex, text });
        return;
      }
      if (key === EVT.COLLECT_LINE) {
        this.triggerEvent(EVT.COLLECT_LINE, { lineIndex, text });
        return;
      }
      if (key === EVT.SPEAK_WORD) {
        this.triggerEvent(EVT.SPEAK_WORD, { word, lineIndex });
        return;
      }
      if (key === EVT.COLLECT_WORD) {
        // hasDef 只随事件回传（页面决定 meta 里放不放音标），**不参与动作可用性判定**
        this.triggerEvent(EVT.COLLECT_WORD, { word, lineIndex, hasDef: !!this.data.wordHasDef });
      }
    },

    _emitClose(via: 'mask' | 'swipe' | 'close') {
      this.triggerEvent(EVT.CLOSE, { via });
    },

    /** busy 锁 300ms：页面可能在 await 收藏接口，期间连点会重复请求 */
    _armBusyRelease() {
      if (this.data._busyTimer) clearTimeout(this.data._busyTimer);
      this.data._busyTimer = setTimeout(() => {
        this.data._busyTimer = 0;
        if (!this.data._alive) return;
        this.setData({ busy: false, pressedKey: '' });
      }, BUSY_MS) as unknown as number;
    },

    /** 局部态归零（隐藏 / 关闭 / 页面切后台共用一处，避免各处漏字段） */
    _resetLocalState() {
      this.data._hasStart = false;
      this.data._startY = 0;
      if (this.data._busyTimer) {
        clearTimeout(this.data._busyTimer);
        this.data._busyTimer = 0;
      }
      this.setData({ swipeY: 0, dragging: false, busy: false, pressedKey: '' });
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
