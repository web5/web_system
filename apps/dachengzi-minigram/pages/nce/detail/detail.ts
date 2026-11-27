/**
 * 新概念英语 · 课文详情（D1=C / V7-C 生效 · 通篇阅读视图）
 *
 * 生效真源：10-D1方案C冻结与技术方案.md（08 整份作废）。
 *
 * 需求①（V1–V8）：
 * - V1/V7-C：顶部工具条不存在「连续朗读」入口；无整篇/连播调度；进页不自动播；
 *   句子区无常驻 ♪/☆ 控件。C ≠ 删掉所有朗读 —— V5 单句朗读仍可用。
 * - V2 点句就地展开该句中文（再点收起、同时至多 1 句、不触发 speakText）。
 * - V3 点词中文 tip：封闭规则表 R3（V3-A）查 d.words[]；表外词「暂无释义」且保留可点。
 * - V4 平台原生 bindlongpress 长按句子出自绘气泡（含且仅含「朗读此句」「收藏」）。
 * - V5 气泡「朗读此句」= 恰好一次 speakText(line.en)、仅该句高亮；再点同句停止。
 * - V6 收藏沿用 collectGlossary({tag:'nce', …}) 契约；T1 未登录弹 modal-login「请先登录」。
 * - V8 字号三级 + S0–S5 逐态无常驻控件。
 *
 * 需求②（V9–V20，本页面也是三数据页之一）：
 * - V11 页面级 authExpired 标志 + load() catch 分流（会话过期不裸失败、保持骨架准备弹窗）。
 * - V12/V13/V18 login-gate modal 态弹窗 + 页面级订阅（onLoad on / onUnload off）。
 * - V16 auth:logged 回调内显式 void this.load()，不依赖 onShow()。
 * - V17 稍后→常驻提示条→再唤起；登录成功前不消失。
 *
 * 选项 A（18 §5，2026-11-18）：仅对齐 D-01/D-02 锚定浮层、D-03 配色反相、
 * D-04/D-11 信息结构与操作提示、D-06 词点线、D-07 展开态蓝系、D-09 句序号；
 * D-05（.head 保留）/ D-08 / D-10 / D-1 / D-2 均不在本轮范围。
 *
 * 2026-11-19 19:11 口径变更：生词 tip 作废「就近锚定」，改移动端底部统一浮层。
 * onWordTap 不再为 tip 调用 _anchorFloat；tipPos 字段保留但不得驱动 word-tip。
 * ~~🔴 _anchorFloat 函数本体与 bubblePos 长按气泡锚定逻辑完全保留、行为不变。~~
 *   ⚠️ 上面这条已被 2026-11-26 变体 B 覆盖作废（留痕不静默删除）：选 B 后长按气泡整体退役，
 *   `_anchorFloat` / `bubblePos` / `tipPos` / `bubbleIdx` / `wordBubble` / `tipWord` **全部删除**，
 *   改单槽位 `overlay` + 公共抽屉组件。详见下方 2026-11-26 段落。
 *
 * 2026-11-20 治本授权（用户原话「不做临时修补，要从合理的实现方案去改」）：
 *    原「utils/request.ts 一律不改」红线就此解除 —— 依据 49 §5 方案 B，在
 *    utils/request.ts 建立失败提示统一错误契约（常规失败必有且仅有一条中文 string toast），
 *    页面层不再自行弹失败 toast / 不再做 hasHttpResponse 判定，只保留 console.error 排障留痕。
 *    services/tts.ts / services/auth.ts 仍零改动；speakText/stopSpeak/onSpeakState、
 *    loginFromGate、collectGlossary 既有契约不变。
 *
 * 2026-11-26 阅读体验 5 项（用户口径，cli-preview 可验）：
 *  - ① 沉浸档由「整段连排」改为「逐句一行」（仍整篇连续阅读），文末参考译文同步逐句换行；
 *  - ② 非课文生词点击不再有任何词级高亮（.w:active 只对 .has-def 生效），
 *       事件也只在生词节点上挂 —— 点非生词等同点句子空白（点按档仍展开该句中文）；
 *  - ③ 新增长按生词 → 自绘气泡「朗读单词 / 收藏单词」（长按句子气泡两项行为不变）；
 *  - ④ 底部生词词卡新增「朗读」按钮（读该词，再点停止）。
 *  - 生词点按开词卡的档位由「仅 tap 档」放宽为全档（沉浸/双语也可查词），
 *    非生词在任何档位都不出词卡。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 2026-11-26 19:00 用户拍板「变体 B · 底部抽屉」+ D1–D8 / E1–E5 全按推荐；
 * 19:15 追加拍板 U1「句子朗读中，在正在朗读的那一句行尾显示极小的 ■ 停止按钮」。
 * 设计真源：`原型-变体B-底部抽屉.html`（sha256 前 16 位 b039064b83b9c6e7）；
 * 工程契约：`公共能力抽象方案.md`（sha256 前 16 位 e7649e525498575b）。
 *
 * 本页本轮改动（**长按气泡整体退役，改走公共抽屉组件**）：
 *  A. 渲染结构（AC-B.28 / V-B17，本轮唯一有风险的增量）：
 *     所有 `tk.w` 的单词都渲染成 `<text class="w">`（原来非生词走 wx:else 纯文本、没有节点
 *     → 普通词物理上无法长按）；`.has-def` 点线只给 hasDef；`catchlongpress` 与 `catchtap`
 *     挂**全部**单词，`onWordTap` 首行用 hasDef 守卫回落成「点句子」（E1：点普通词不弹词卡）。
 *  B. 单槽位 overlay（方案 §4.1）：`bubbleIdx / bubblePos / wordBubble / tipWord / tipPos`
 *     五个字段收敛成**一个** `overlay`：
 *       `null | {kind:'drawer',…} | {kind:'wordtip',…}`
 *     一个字段 = 物理上不可能两开（F1/F2 结构级保证）；所有 open 入口走 `openOverlay()` 整体替换。
 *  C. 锚点链路整块删除（方案 §2.0-B）：`_anchorFloat` / `boundingClientRect` / `scrollOffset` /
 *     `pageX·750/windowWidth` / `clamp(750-340)` / `tipPos` 全部消失 —— 抽屉贴底通栏不测任何坐标。
 *  D. 三个抽屉 handler（组件只 triggerEvent，页面调 services）：
 *     `onDrawerCollectLine / onDrawerCollectWord / onDrawerClose`。未登录守卫仍是本页的内联 modal
 *     （首页是 toast，差异不上沉到组件）。
 *     🔴 2026-11-26 变体 C（用户拍板）：`onDrawerSpeakLine / onDrawerSpeakWord` **已删除** ——
 *     朗读下沉到组件（组件内直接 speakText、抽屉不关、按钮自切 ▶/■）。别加回来：
 *     ① 会与组件本地朗读重复朗读一次；② 页面 U1 的「行尾 ■」与抽屉按钮会成为两条互相打架的停止入口。
 *     `_lineHint`（D-8 重复句定位）因此不再由抽屉朗读写入，只在读词 / 换课 / 卸载时复位为 -1，
 *     抽屉朗读的「哪一句在播」由 tts 推来的文本反查（`_resolveLineIdx` 的回退分支）。
 *  E. U1 停止按钮：`readingLineIdx === si` 时该句行尾渲染一个极小的 `■`，点击 = `stopSpeak()`。
 *     🔴 这与 V7-C「句子区无常驻 ♪/☆ 控件」**不冲突**：①只在该句正在朗读时渲染（不播放时不存在）；
 *     ②它是「停止」而不是「播放 / 收藏」入口，不具备可发现性引导作用；③它替代的正是被 B 变体
 *     删掉的「长按气泡再点『朗读此句』= 停」这条唯一停止路径（方案 §3.5 U1）。
 *     ⚠️ 变体 C 之后它只剩「非抽屉来源的整句朗读」一个场景（目前没有这种入口），
 *     保留是因为删除它属于另一轮范围（见本轮回执的「遗留」）。
 *  F. 播放态权威源不变：仍只由 tts 的 `onSpeakState` 回流反推（P2-1/P2-2/P2-3 刚修的三处
 *     缺陷不得回退）；`onHide` 仍是「stopSpeak → 显式归零 → 退订」，`onShow` 先归零再订阅。
 * ═══════════════════════════════════════════════════════════════════════════
 * 2026-11-27 第二批（用户逐条拍板 D1 / D2 / D7 + 附加项，全按建议）：
 *
 *  D1 词卡补收藏按钮（本轮最重要）：
 *    · `.wt-tools` 里在朗读圆钮与 ✕ **之间**加一个胶囊按钮，图标/文案口径与首页词卡
 *      `.q-tip-btn` 逐字一致（`star.svg` / `check.svg` +「收藏 / 已收藏」）；
 *    · 三态：`☆ 收藏 → ⋯ 收藏中（禁用）→ ✓ 已收藏`；重复点显示 `✓ 已在收藏`，1.8s 后回
 *      `已收藏`；失败回 `☆ 收藏`（错误提示由 utils/request.ts 统一，页面不弹）；
 *      成功后**词卡不关**（与抽屉「收藏不关」同口径）；
 *    · 🔴 未登录走本页既有形态 `setData({ guestLoginShow: true })`（内联 modal-login），
 *      **不改 toast** —— 这是 K10 拍板保留的两页差异（首页 toast / 本页内联 modal）；
 *    · 🔴 收藏 service 调用与抽屉**共用同一份实现**（`_collectWord` / `_collectLine`），
 *      不写第二份 payload 组装（否则 meta / toast 文案必然漂移）。
 *
 *  D2 点空白关闭词卡（两页同口径；抽屉不动 —— 它本来就有遮罩 / ✕ / 下滑三条通道）：
 *    · 页面根节点 `bindtap="onPageTap"`：点在**词**上（`e.target.dataset.w` 非空）→ 什么都不做，
 *      把「换词」留给词节点自己的 `catchtap` → **不会**出现「先关再开」或「误关」；
 *      点在别处（含句子空白 / 标题 / 分页条）→ `closeTip()`；
 *    · 🔴 不用绝对定位的透明遮罩层：那会盖住正文、破坏词的可点性（用户明确否掉压暗遮罩）；
 *    · 词卡自身容器 `catchtap="noop"` 吞掉卡片内的空白点击（否则点释义区会把卡片点没）；
 *    · 关卡片仍走 `closeTip()`，其中「正在读这个词 → stopSpeak」的判据一个字没改。
 *
 *  D7 收藏态跨界面回查（别只靠内存 flag）：
 *    · 后端没有「是否已收藏」存在性接口（只有分页列表 + keyword 模糊匹配），
 *      静默回查会给出**假否定**，故走**本地缓存**作初值（`utils/collect-cache`，唯一真源）；
 *    · 🔴 缓存只当初值：收藏入口**永不因「已收藏」短路**，点一下就发真实写请求
 *      （`collectGlossary` 幂等返回 `existed:true`）→ 用户在收藏页删过的条目会被这次写请求
 *      重新建回来，UI 不再长期撒谎；成功后一律 `rememberCollected` 刷缓存；
 *    · 覆盖：词卡（`tipCollect` 初值）+ 抽屉（经 `collectedKeys` 一个属性把页面算好的
 *      「已收藏动作 key 集合」交给组件，组件仍不 import 任何 services —— A8 不动）。
 *    · 🔴 双向同步（2026-11-27 第二批，用户真机反馈「卡片收藏了、抽屉没同步」）：
 *      方向①卡片/词卡 → 抽屉：开抽屉那一刻按缓存整体重算 key 集合；
 *      方向②抽屉 → 卡片/词卡：抽屉收藏成功后 `_withCollectedKey` 加 key + 页面按钮 setData 点亮。
 *      两个方向共用同一份 `collectedKeys` / 同一份缓存，不写第二套判断。
 *
 *  附加项：行尾停止入口 `.sent-stop` 的字符 `■` 换 `assets/icons/stop.svg`（24rpx，行内对齐）。
 *    上一批把三处播放图标换成 SVG 后，这里成了唯一的字符残留（真机字形随系统变，观感不一致）。
 *    `<text>` 内不能放 `<image>`（官方只支持 text 嵌套）→ 外层改 `<view>` + `display:inline-block`。
 */
import { getNceLesson, type NceLessonDetail } from '../../../services/nce';
import { DEFAULT_NCE_BOOK, nceBookTotal } from '../books';
import { speakText, onSpeakState, stopSpeak, type SpeakState } from '../../../services/tts';
import { collectGlossary } from '../../../services/glossary';
import { isLoggedIn, loginFromGate } from '../../../services/auth';
import { tokenize, buildKnown, type WordToken } from '../../../utils/tokenize';
import { lookupWord, type WordLookup } from '../../../utils/lexicon';
import { collectToastText, EVT, ARIA_WORD_PLAY, ARIA_WORD_STOP } from '../../../utils/line-actions';
// 图标路径 + 收藏三态文案/图标单一真源（三处播放/收藏图标共用一套 SVG）
import { ICONS, collectIcon, collectLabel, type CollectState } from '../../../utils/icons';
// D7 收藏态跨界面回查：本地缓存只作初值，收藏入口永不短路（详见文件头 2026-11-27 D7 段）
import { isCollectedCached, rememberCollected } from '../../../utils/collect-cache';

interface NceLineView {
  /** 稳定 key（wx:key），避免嵌套 wx:for 下默认 index 遮蔽 */
  idx: number;
  en: string;
  cn: string;
  tokens: WordToken[];
  /**
   * 行尾停止按钮的图标路径（U1，2026-11-27 由字符 ■ 改 stop.svg）。
   *
   * 🔴 为什么把常量塞进**每个行项**、而不是在 wxml 里写 `{{icons.stop}}`：
   *   `tests/wxml-for-item-scope.test.ts` 的守卫要求「循环体内每个 `{{x.…}}` 的根标识符
   *   x 必须由 wx:for-item / wx:for-index 引入」（它不建模页面 data 的作用域）。
   *   `.sent` 是 `wx:for="{{lines}}"` 的循环体，在里面取 `icons.stop` 会被判越界。
   *   抽屉组件当初遇到同一条限制，处理方式也是「把图标算进 item」（见 components/action-drawer
   *   的 `actsView`）—— 这里沿用同一套口径，别为了省一个字段去改那条 P0 守卫。
   */
  stopIcon: string;
}

/** 词卡视图 = utils/lexicon 的查词结果（详情页与首页共用同一形状） */
type WordTipView = WordLookup;

/**
 * 单槽位浮层（方案 §4.1 / D3）：`data.overlay` 是**唯一**的浮层字段。
 * 一个字段 = 物理上不可能两开 —— 抽屉与词卡互斥不靠「两处显隐逻辑互相记得关」，
 * 而靠「同一时刻只有一个值」（F1/F2 结构级保证）。
 */
interface DrawerLineOverlay {
  kind: 'drawer';
  scope: 'line';
  lineIndex: number;
  /** 该句英文原文（标题区展示 + 朗读/收藏的目标文本） */
  lineText: string;
}
interface DrawerWordOverlay {
  kind: 'drawer';
  scope: 'word';
  lineIndex: number;
  /** 该词所在句原文（标题区展示 + 「朗读此句」的目标文本） */
  lineText: string;
  /** 小写词形（朗读 / 收藏 / 标题区共用同一份） */
  word: string;
  /** 是否课文词汇表直收词：只影响标题区音标 /「暂无释义」，不影响任何动作可用性 */
  hasDef: boolean;
  /** hasDef=true 时的音标（查表得到；缺失为空串） */
  phonetic: string;
}
/**
 * 底部生词词卡（点生词弹出）：沿用 WordLookup 字段 + kind 判别位，行为与迁移前完全一致。
 * 2026-11-27 D1：新增 `lineIndex`（该词所在句下标）—— 词卡收藏也要落 `meta.lineIndex`，
 * 与抽屉「收藏单词」同一个字段口径；缺失时收藏取 -1（老调用方 / 单测手工造 overlay）。
 */
interface WordTipOverlay extends WordLookup { kind: 'wordtip'; lineIndex?: number; }
type Overlay = DrawerLineOverlay | DrawerWordOverlay | WordTipOverlay | null;

/** 抽屉组件 triggerEvent 的事件对象（detail 里已解构，只用到 detail） */
interface DrawerEvent<T> { detail?: T; }
interface SpeakLineDetail { lineIndex?: number; text?: string; }
interface SpeakWordDetail { word?: string; lineIndex?: number; }
interface CollectWordDetail extends SpeakWordDetail { hasDef?: boolean; }

/**
 * 抽屉组件实例（用于回传收藏结果）。**模块级纯函数，不做页面方法** ——
 * 单测里的页面上下文是手搓对象（只挂被调用的那几个方法），写成 `this._drawerRef()`
 * 会在任何「只调收藏 handler」的用例里 `not a function`。
 *
 * 防御式取：`selectComponent` 不存在（单测桩）/ 首次打开前取不到 / 组件已销毁 → 返回 null，
 * 调用方跳过回传即可（收藏态在抽屉关闭时会整体复位，不会停在「收藏中」）。
 */
function drawerOf(self: unknown): { onCollectDone: (kind: string, ok: boolean, existed: boolean) => void } | null {
  try {
    const s = self as { selectComponent?: (sel: string) => unknown };
    const comp = (typeof s.selectComponent === 'function'
      ? s.selectComponent('#drawer')
      : null) as unknown as { onCollectDone?: (kind: string, ok: boolean, existed: boolean) => void } | null;
    return comp && typeof comp.onCollectDone === 'function'
      ? (comp as { onCollectDone: (kind: string, ok: boolean, existed: boolean) => void })
      : null;
  } catch {
    return null;
  }
}

interface NceTapEvent {
  currentTarget: { dataset: Record<string, string | number | boolean | undefined> };
}

/** V21+ 阅读三档：沉浸（连排通读）/ 双语（中文常显）/ 点按=精读（逐句展开 + 生词 tip）。默认沉浸。 */
type ReadMode = 'immersion' | 'bilingual' | 'tap';
const READ_MODES: ReadMode[] = ['immersion', 'bilingual', 'tap'];
/** 把任意 storage / dataset 值收敛到合法档，非法/缺失一律回落默认档 immersion。 */
function normalizeMode(v: unknown): ReadMode {
  return typeof v === 'string' && (READ_MODES as string[]).includes(v) ? (v as ReadMode) : 'immersion';
}

/**
 * 词卡收藏按钮的**未收藏文案**（`CollectState='idle'` 时显示它）。
 * 🔴 其余三态文案来自 `utils/icons.collectLabel`（与抽屉共用一份），这里只给基准词，
 *    页面不另写「收藏中 / 已收藏 / 已在收藏」——那会是第二份真源。
 */
const TIP_COLLECT_BASE = '收藏';

/**
 * 词卡「已在收藏」提示的停留时长（ms）：1.8s 后回落到 `已收藏`。
 *
 * 为什么要回落：`已在收藏` 是「你刚点的这一下没有新建」的**一次性提示**，
 * 留着它会让人以为这是个不同的状态（其实是同一个「已收藏」）。抽屉里那个提示靠
 * 下一次点按自然覆盖，词卡没有「下一次」，只能定时回落。
 * 1.8s ≈ 一次 wx.showToast 的默认时长（1500ms）再宽一点，用户读完就回到稳定态。
 */
const TIP_COLLECT_EXISTED_MS = 1800;

/**
 * 切词与查表已抽到 utils/tokenize.ts / utils/lexicon.ts（2026-11-26）：
 * 首页「今日一句」与详情页共用同一套 hasDef 判定与 R3 规则表，避免两处口径漂移。
 */

Page({
  /** 朗读状态订阅的退订函数（onHide / onUnload 时调用） */
  _offSpeakState: null as null | (() => void),
  /** 当前正在朗读的句下标（-1 = 无）—— 仅作「事件未携带文本」时的兜底意图标记 */
  _playingIdx: -1,
  /** 当前正在朗读的单词（'' = 本次朗读不是单词）—— 同上，仅作兜底意图标记 */
  _speakingWord: '' as string,
  /**
   * 🟢 2026-11-26 盲测 D-8（U1 重复句）修：**「朗读此句」发起时的句下标**。
   *
   * 为什么需要它：`_onSpeakState` 拿到的只有 tts 回流的**文本**，`_lineIdxOf(text)` 反查必然
   * 返回**首个**匹配句。课文里出现两句完全同文时（如第 3 句 = 第 1 句），朗读第 3 句 → ■ 跑到第 1 句
   * 行尾：用户在第 1 句点 ■，停掉的是第 3 句的朗读，停止按钮位置是错的。
   *
   * 口径：**以发起时的 lineIndex 为准**，文本只用于校验（`lines[hint].en === text` 才认）。
   * 校验不通过（用户改课文 / 事件带的是别的文本）→ 退回 `_lineIdxOf` 反查，行为与改动前一致。
   * 生命周期：只在「朗读此句」入口写值；单词朗读 / 换课 / 卸载写 -1。
   * 🔴 **不放进 `_resetPlayingState()`**：speakText 内部会先 `stopSpeak()` 推一次 null（意图标记清零），
   *    紧随其后的 loading/playing 才带文本 —— 若随 null 一起清掉，提示等于没写。
   */
  _lineHint: -1,

  /** 真实播放文本（'' = 空闲）：只由 tts 的 onSpeakState 回流，页面不自己猜（P2-1/P2-2/P2-3） */
  _playingText: '' as string,
  /** auth 事件订阅退订（V18 成对，页面级；组件内不订阅） */
  _offAuthExpired: null as null | (() => void),
  _offAuthLogged: null as null | (() => void),
  /**
   * 词卡「已在收藏」→「已收藏」的回落定时器（D1）。
   * 🔴 凡是会让词卡内容换掉 / 消失 / 页面离开的路径都必须 clear（closeTip / 换词 / 换课 /
   *    setReadMode / onHide / onUnload）：定时器到点时卡片可能已经不是那个词了，
   *    补一次 `setData` 会把新词的按钮改回 `已收藏`（脏状态）。清定时器比加判据更不容易漏。
   */
  _tipCollectTimer: null as null | ReturnType<typeof setTimeout>,

  data: {
    id: 0,
    /** 当前书册（默认 NCE2） */
    book: DEFAULT_NCE_BOOK,
    detail: null as NceLessonDetail | null,
    lines: [] as NceLineView[],
    loading: true,
    error: '',
    /** 字号档位：0=A- / 1=A / 2=A+（持久化 nce-font） */
    fontStep: 1,
    /** V21+ 阅读档（持久化 nce-mode，默认 immersion）；与 fontStep 正交，切档互不复位 */
    readMode: 'immersion' as ReadMode,
    /** V24 文末「参考译文 / 中文解释」折叠区（默认收起） */
    cnExpanded: false,
    /** V24 整篇 lines[].cn 拼接（load 时生成，含空值兜底） */
    fullCn: '',
    /** 页面根节点叠加的圆角 class */
    radiusClass: '',
    /** V5 单句朗读高亮句下标（-1 = 无） */
    readingLineIdx: -1,
    readingPhase: 'idle',
    /** V2 点句展开中文下标（-1 = 无；至多 1 句） */
    expandedIdx: -1,
    /**
     * 🔴 唯一浮层槽位（本轮由 bubbleIdx / bubblePos / wordBubble / tipWord / tipPos 收敛而来）。
     * `null` = 无浮层；`kind:'drawer'` = 底部动作抽屉；`kind:'wordtip'` = 生词词卡。
     * 两浮层同帧并存从结构上不可能（同一个字段只能有一个值）。
     */
    overlay: null as Overlay,
    /** 2026-11-26 ④：词卡「朗读」按钮播放态（true = 正在朗读该词） */
    tipPlaying: false,
    /**
     * E4 后半（盲测 D-4）：当前**按下的词**的复合 key（`si*1000 + token.idx`，-1 = 没有）。
     * 驱动词节点 `w-pressed` 浅蓝底 —— 长按 350ms 期间用户要看到「按住了」。
     * 为什么不用 CSS：`<text>` 不支持 hover-class（官方仅 view/button/navigator），
     * 裸 `.w:active` 被「点非生词无词级高亮」的既有守卫禁止，故走长按态 class。
     */
    pressedWordKey: -1,
    /**
     * 词卡朗读按钮的 `aria-label`（AC-3.4：随形态在「朗读单词 / 停止朗读」间切换）。
     * 文案真源在 `utils/line-actions`（两页共用一份，页面里不写动作文案字面量）。
     */
    ariaPlayWord: ARIA_WORD_PLAY,
    ariaStopWord: ARIA_WORD_STOP,
    /**
     * 图标路径（wxml 不能 import ts，只能经 data 插值）。2026-11-27：词卡 ▶/■ 改 SVG，
     * 与首页卡片 / 抽屉共用 `assets/icons/*.svg`，路径唯一真源 utils/icons。
     * 🔴 star / check 是本轮 D1 词卡收藏按钮用的两个（与首页词卡同一套，不新画）。
     */
    icons: { play: ICONS.play, stop: ICONS.stop, star: ICONS.star, check: ICONS.check },
    /**
     * 🔴 D1 词卡收藏三态（`utils/icons.CollectState`：idle / busy / done / existed）。
     * 写入口只有 `_setTipCollect()`；**文案与图标也一并写进 data**（`tipCollectLabel` /
     * `tipCollectIcon`），因为它们由 `collectLabel` / `collectIcon` 这**唯一一份**纯函数算出 ——
     * 在 wxml 里再写一遍三元文案就是第二份真源，抽屉/词卡/首页三处必然漂移。
     */
    tipCollect: 'idle' as CollectState,
    tipCollectLabel: collectLabel(TIP_COLLECT_BASE, 'idle'),
    tipCollectIcon: collectIcon('idle'),
    /**
     * 🔴 D7（2026-11-27 第二批）抽屉「已收藏」态的**唯一通道**：已收藏的动作 key 数组
     * （`EVT.COLLECT_LINE` / `EVT.COLLECT_WORD`，与组件 `data-key` 逐字同值）。
     *
     * 双向同步都落在这一个字段上（组件 observer `collectedKeys` → `_seedCollect`）：
     *  · 词卡/抽屉 → 抽屉：开抽屉那一刻按本地缓存重算（`_drawerCollectedKeys`）；
     *  · 抽屉 → 词卡：抽屉收藏成功后把 key 加进来（`_withCollectedKey`）；词卡本身
     *    在打开时按缓存取初值（`onWordTap`），两条路都落在同一份缓存上。
     *
     * 🔴 本页的收藏对象是 `lines[lineIndex]` 维度：key 集合只描述**当前长按的这句话 / 这个词**，
     *    换句（另一次长按）必须整份重算 —— 所以它只在开抽屉时算、在成功时增量加，不做跨句缓存。
     */
    collectedKeys: [] as string[],
    /** 2026-11-26 ③ 正在朗读的单词（'' = 无）：驱动词卡/单词气泡按钮文案 */
    wordPlaying: '',
    /** V6 T1 未登录守卫弹窗 modal-login「请先登录」 */
    guestLoginShow: false,
    /** V11 页面级会话过期标志（由 auth:expired 订阅置位） */
    authExpired: false,
    /** V12 T2 会话过期弹窗（login-gate modal 态） */
    showAuthModal: false,
    /** V17 稍后后的常驻提示条（登录成功前不消失） */
    showReloginTip: false,
  },

  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
    // P2-2：回前台先把播放态归零 —— 后台期间朗读已停，残留的「播放中高亮 / 停止按钮」是假状态
    // （点它还会因为 tts.playingText 已清空而变成「重新开始播放」）。订阅放在复位之后。
    this._resetPlayingState();
    this._subscribeReading();
  },

  onHide() {
    // P2-2：顺序很关键 —— 先 stopSpeak（此时仍订阅，能收到它推的 null）→ 再显式归零
    // （不依赖 null 一定被收到）→ 最后退订。旧实现先退订再 stopSpeak，null 无人接收，
    // 播放态就永久留在页面上。
    stopSpeak();
    this._resetPlayingState();
    this._unsubscribeReading();
    // T11 / F5：页面隐藏时浮层必须归零。抽屉是 position:fixed，若留在 data 里，
    // 回到本页时「浮层自己回来」（tab 页不销毁时必现，方案 §4.4 漏洞 2）。
    if (this.data.overlay) this.setData({ overlay: null });
    // D1：切后台后「已在收藏 → 已收藏」的回落定时器不该在后台跑（回来时卡片早已归零）
    this._clearTipCollectTimer();
    // K9 同源：按下高亮也是页面局部态，切走必须清（否则回来时某个词还亮着蓝底）
    if (this.data.pressedWordKey >= 0) this.setData({ pressedWordKey: -1 });
  },

  onUnload() {
    this._unsubscribeReading();
    stopSpeak();
    // D1：页面销毁，回落定时器必须清（否则到点还会在已销毁的页面上 setData）
    this._clearTipCollectTimer();
    // 页面已销毁：只清私有播放态，不再 setData（onUnload 里 setData 无意义且可能告警）
    this._playingText = '';
    this._playingIdx = -1;
    this._speakingWord = '';
    this._lineHint = -1; // 页面销毁：句档定位提示一并清
    // V18：页面级退订（与 onLoad 成对，同一 handler 引用 off；组件内不订阅）
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      if (this._offAuthExpired) {
        __bus.off('auth:expired', this._offAuthExpired);
        this._offAuthExpired = null;
      }
      if (this._offAuthLogged) {
        __bus.off('auth:logged', this._offAuthLogged);
        this._offAuthLogged = null;
      }
    }
  },

  onLoad(options: { id?: string | number; book?: string }) {
    const id = Number(options && options.id);
    const book = String((options && options.book) || DEFAULT_NCE_BOOK);
    const fontStep = wx.getStorageSync('nce-font');
    // V21+ 阅读档：与字号档两个独立 storage key，各自读取、互不复位（正交）。
    const readMode = normalizeMode(wx.getStorageSync('nce-mode'));
    const realId = id > 0 ? id : 1;
    this.setData({
      id: realId,
      book,
      fontStep: typeof fontStep === 'number' ? fontStep : 1,
      readMode,
    });
    // V13/V18：页面级订阅（onLoad on / onUnload off；先按旧引用退订防重复订阅）
    const __app = getApp<IAppOption>();
    const __bus = __app && __app.eventBus;
    if (__bus) {
      if (this._offAuthExpired) __bus.off('auth:expired', this._offAuthExpired);
      if (this._offAuthLogged) __bus.off('auth:logged', this._offAuthLogged);
      this._offAuthExpired = () => {
        // T2：置页面级标志 + 弹 modal-auth；保持骨架/原内容，不置裸失败态
        this.setData({ authExpired: true, showAuthModal: true, showReloginTip: false });
      };
      __bus.on('auth:expired', this._offAuthExpired);
      this._offAuthLogged = () => {
        // V16：回调内显式重拉，不依赖 onShow()（详情页 onShow 不调 load）
        this.setData({
          authExpired: false,
          showAuthModal: false,
          showReloginTip: false,
          guestLoginShow: false,
        });
        void this.load();
      };
      __bus.on('auth:logged', this._offAuthLogged);
    }
    void this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const d = await getNceLesson(this.data.id, this.data.book);
      if (!d) {
        this.setData({ error: '未找到该课，可能尚未入库', loading: false });
        return;
      }
      // D-06：仅词汇表直收词带点线标记；换课时清空两个浮层锚点，避免残留旧坐标
      const known = buildKnown(d.words || []);
      const lines: NceLineView[] = (d.lines || []).map((l, i) => ({
        idx: i, en: l.en, cn: l.cn, tokens: tokenize(l.en, known),
        // 行尾停止图标随行项下发（循环作用域限制，见 NceLineView.stopIcon 的注释）
        stopIcon: ICONS.stop,
      }));
      // V24 参考译文 = 整篇 lines[].cn 按句拼接（跳过空值）。
      // 2026-11-26 ①：分隔符由 '' 改 '\n' —— 配合 .cn-fold-c 的 white-space: pre-wrap，
      // 译文与英文一样「一句一行」，不再挤成一段。
      const cnParts = lines.map((l) => (l.cn || '').trim()).filter((s) => s.length > 0);
      const fullCn = cnParts.length ? cnParts.join('\n') : '（本课暂无参考译文）';
      wx.setNavigationBarTitle({ title: `Lesson ${d.id} · ${d.title}` });
      this.setData({
        detail: d, lines, readingLineIdx: -1, readingPhase: 'idle',
        expandedIdx: -1, overlay: null,
        fullCn, cnExpanded: false, loading: false,
        wordPlaying: '', tipPlaying: false,
        // D1/D7：换课 = 换掉全部收藏对象，词卡三态与抽屉 key 集合一并归零
        ...this._tipCollectPatch('idle'),
        collectedKeys: [] as string[],
      });
      this._clearTipCollectTimer();
      this._speakingWord = '';
      this._lineHint = -1; // 换课 / 重载：句档定位提示必须失效（句子下标已换了一套）
    } catch {
      // V11：会话过期不裸失败；保持骨架/原内容（loading 保持 true），准备弹窗
      if (this.data.authExpired) return;
      this.setData({ error: '课文加载失败，请稍后重试', loading: false });
    }
  },

  setFont(e: NceTapEvent) {
    const fontStep = Number(e.currentTarget.dataset.step || 1);
    // V22 正交：只写 nce-font / 只改 fontStep，绝不碰 nce-mode / readMode。
    wx.setStorageSync('nce-font', fontStep);
    this.setData({ fontStep });
  },

  /** V21 切阅读档：只写 nce-mode / 只改 readMode，绝不碰 nce-font / fontStep（正交）。切档清浮层。 */
  setReadMode(e: NceTapEvent) {
    const mode = normalizeMode(e.currentTarget.dataset.mode);
    wx.setStorageSync('nce-mode', mode);
    this.setData({
      readMode: mode,
      expandedIdx: -1, overlay: null,
      tipPlaying: false,
      // D1：切档会关掉词卡 → 三态与回落定时器一并复位
      ...this._tipCollectPatch('idle'),
    });
    this._clearTipCollectTimer();
  },

  /** V24 文末「参考译文 / 中文解释」折叠区开合（默认收起）。 */
  toggleCnSection() {
    this.setData({ cnExpanded: !this.data.cnExpanded });
  },

  /**
   * V21+ 点句/点词共用的按档分派（27 §3.3）：
   * - tap（精读）：toggle 该句 expandedIdx（展开/收起该句中文，至多 1 句，不触发 speakText）；
   * - immersion / bilingual：不设 expandedIdx（沉浸不展开逐句中文、双语中文常显），只清浮层。
   * 🔴 WXML 不按档动态切 bind/catch，.w 始终 catchtap=onWordTap，分发全部收敛到本方法。
   */
  _applyLineTap(i: number) {
    const line = this.data.lines[i];
    if (!line) return;
    const clear = { overlay: null as Overlay, tipPlaying: false };
    if (this.data.readMode === 'tap') {
      this.setData({ ...clear, expandedIdx: this.data.expandedIdx === i ? -1 : i });
    } else {
      this.setData({ ...clear, expandedIdx: -1 });
    }
  },

  /** V2/V23 点句空白热区：与点词热区共用 _applyLineTap，保证「点句任意位置」同语义。 */
  toggleLine(e: NceTapEvent) {
    this._applyLineTap(Number(e.currentTarget.dataset.i));
  },

  /**
   * 单槽位写入口（方案 §4.1 / F1 / F2）：所有浮层入口都走这里，**整体替换**。
   * 因为 `overlay` 是唯一字段，「抽屉与词卡同帧并存」不是靠两处显隐互相记得关，而是结构上不可能。
   * `patch` 允许把「与切换浮层同一帧必须生效的字段」（如 tipPlaying 复位）并进同一次 setData，
   * 避免出现中间帧（F3 同理：换档是「一个 setData 覆盖」，不先关后开）。
   */
  openOverlay(next: Overlay, patch: Record<string, unknown> = {}) {
    this.setData({ ...patch, overlay: next });
  },

  /** 关掉任意浮层（T5/T6/T8）。组件不自己关：它只 triggerEvent('close')，由本页置 null。 */
  closeOverlay() {
    this.setData({ overlay: null });
  },

  /**
   * 当前抽屉内容对应的「已收藏」key 集合（**开抽屉那一刻**的唯一算口）。
   *
   * 🔴 判据只有本地缓存（`utils/collect-cache`）：它是本页所有收藏入口（词卡 / 抽屉）
   *    成功后的唯一落盘点（`rememberCollected`），所以「词卡点了收藏 → 长按开抽屉」天然对齐，
   *    不需要第二套判断。
   * 🔴 本页收藏对象是 `lines[lineIndex]` 维度：调用方必须把**这次长按的那一句**的原文传进来，
   *    不能拿 `lines[0]` 或上一句的缓存顶替（否则 A 句收藏会让 B 句抽屉亮成已收藏）。
   */
  _drawerCollectedKeys(lineText: string, word?: string): string[] {
    const keys: string[] = [];
    const line = String(lineText || '').trim();
    if (line && isCollectedCached('line', line)) keys.push(EVT.COLLECT_LINE);
    const w = String(word || '').trim();
    if (w && isCollectedCached('word', w)) keys.push(EVT.COLLECT_WORD);
    return keys;
  },

  /**
   * 往 key 集合里加一个（**换成新数组**：数组属性的 observer 按引用比较，
   * `push` 原地改不会触发组件重算）。抽屉里收藏成功后用它即时对齐。
   */
  _withCollectedKey(key: string): string[] {
    const cur = Array.isArray(this.data.collectedKeys) ? this.data.collectedKeys : [];
    return cur.indexOf(key) >= 0 ? cur.slice() : cur.concat(key);
  },

  /**
   * 点词热区分发（E1 / AC-B.29 / AC-B.24）：
   * - 🔴 **首行守卫**：非生词（hasDef=false）→ 语义等同「点句子空白」，走 `_applyLineTap`
   *   （tap 档仍展开该句译文、其它档只清浮层），**不弹词卡、不弹抽屉、不朗读、不请求**。
   *   普通词现在也是独立节点（渲染结构改造后），所以这条守卫是「点普通词无反应」的唯一执行点。
   * - 生词 → 任意阅读档都出底部词卡（不再限 tap 档）：沉浸/双语阅读中也可随时查词；
   *   再点同一词收起、再点其它词替换内容。词卡不展开该句中文、不锚定、不测坐标。
   */
  onWordTap(e: NceTapEvent) {
    const ds = e.currentTarget.dataset;
    const i = Number(ds.i ?? 0);
    const hasDef = ds.hasdef === true || ds.hasdef === 'true';
    // 🔴 E1 守卫：点普通词 = 点句子（不弹词卡）
    if (!hasDef) {
      this._applyLineTap(i);
      return;
    }
    const raw = String(ds.w || '');
    if (!raw) {
      this._applyLineTap(i);
      return;
    }
    const w = raw.toLowerCase();
    const cur = this.data.overlay;
    if (cur && cur.kind === 'wordtip' && cur.word === w) {
      // 收起卡片 = 关卡片：与 closeTip 同口径（P2-3，正在读这个词就停掉）
      this.closeTip();
      return;
    }
    const tip = this._lookupWord(w);
    // 🔴 D1：词卡持有「该词所在句下标」，收藏时要落 meta.lineIndex（与抽屉同一个字段口径）
    // 🔴 D7：按钮初值**从本地缓存读**，不再写死 false —— 否则收藏过的词关掉再点开又变「☆ 收藏」
    //    （用户踩到的就是这一条）。缓存只当初值：点按钮照样发真实写请求（失效兜底见 collectTipWord）。
    this._clearTipCollectTimer(); // 换词：上一个词的「已在收藏」回落定时器必须作废
    // 一次 setData 完成「关抽屉 + 开词卡 + 复位按钮态」，不留中间帧（T9/T10）
    this.openOverlay(
      { ...tip, kind: 'wordtip', lineIndex: i },
      {
        tipPlaying: false,
        ...this._tipCollectPatch(isCollectedCached('word', w) ? 'done' : 'idle'),
      },
    );
  },

  /**
   * 关闭词卡：顺手停掉「词卡朗读」，避免关掉卡片还在放音（P2-3）。
   * 🔴 判据用「当前真实在播的文本是不是句子」——不能用 tipPlaying：
   *    朗读中点「另一个生词」会把 tipPlaying 置 false，而上一段语音还在播，
   *    于是关卡片时判定落空、语音不停，页面上已无任何可停止的控件。
   *    真正在播整句时不停（用户可能想继续听整句）。
   */
  closeTip() {
    const playing = this._playingText;
    const wordOnAir = !!playing && this._lineIdxOf(playing) < 0;
    if (wordOnAir || this.data.tipPlaying) {
      stopSpeak();
      this._speakingWord = '';
      this._playingText = '';
    }
    // D1：卡片消失后「已在收藏」的回落定时器没有意义（到点会改到下一次打开的词上）
    this._clearTipCollectTimer();
    this.setData({
      overlay: null, tipPlaying: false,
      ...this._tipCollectPatch('idle'),
    });
  },

  /**
   * D2（2026-11-27）：点页面空白 → 关生词卡（两页同口径）。
   *
   * 🔴 三条约束（缺一条都会退化成「点词变成了关闭」）：
   *  ① **不用绝对定位的透明遮罩**：那层会盖住正文，直接把「点另一个生词换内容」吃掉
   *     （用户已明确否掉压暗遮罩，透明遮罩是同一个问题的另一半）；
   *  ② 词节点自己有 `catchtap="onWordTap"`（catch 阻断冒泡）→ 点词的 tap **根本到不了**根节点，
   *     「换词」这条路天然不受影响；
   *  ③ `e.target.dataset.w` 这条判断是**第二道保险**：万一将来有人把词节点的 catchtap 改成
   *     bindtap（冒泡到根），这里看到 target 是词就直接 return，仍然不会「先关再开」。
   *     🔴 判据必须是 `e.target`（触发的那个节点）而不是 `e.currentTarget`（绑 handler 的根节点）——
   *     用 currentTarget 恒为根节点、拿不到词的 dataset，这条保险等于没写。
   *
   * 只处理 `kind === 'wordtip'`：抽屉有自己的遮罩 / ✕ / 下滑三条通道，
   * 而且抽屉根节点上不许挂 tap（见 components/action-drawer 的红线 1/2），
   * 所以这里对抽屉**什么都不做**（点了标题区不该把抽屉关掉）。
   */
  onPageTap(e?: { target?: { dataset?: Record<string, unknown> } }) {
    const ov = this.data.overlay;
    if (!ov || ov.kind !== 'wordtip') return;
    const ds = (e && e.target && e.target.dataset) || {};
    if (String(ds.w || '')) return;     // 点在词上：换词由词节点自己处理，根节点不许插手
    this.closeTip();
  },

  /** 词卡容器自身的 catchtap：吞掉卡片内的空白点击（否则点释义区会被根节点的 onPageTap 关掉） */
  noop() { /* 故意留空：只消费事件 */ },

  /**
   * 2026-11-26 ④ 词卡「朗读」：读当前单词；再点同词由 speakText 的 same-text 语义停止。
   * 播放态经 onSpeakState 回流（wordPlaying / tipPlaying），页面不自己猜结束时机。
   */
  speakTipWord() {
    const ov = this.data.overlay;
    if (!ov || ov.kind !== 'wordtip' || !ov.word) return;
    this._speakingWord = ov.word;
    this._playingIdx = -1;
    this._lineHint = -1; // 读词：清掉句档定位提示（U1 的 ■ 只属于句子朗读）
    void speakText(ov.word);
  },

  /* ───────────── D1 词卡收藏（三态 + 与抽屉共用同一份 service 调用） ───────────── */

  /**
   * 收藏三态的**唯一 setData 载荷**（状态 + 文案 + 图标一次写完）。
   * 🔴 三者必须同一次 setData：先改状态再改文案会闪一帧「图标变了文案没变」。
   * 文案/图标来自 `utils/icons` 的纯函数（与抽屉 `actsView` 同一份），页面不写第二份字面量。
   */
  _tipCollectPatch(state: CollectState): Record<string, unknown> {
    return {
      tipCollect: state,
      tipCollectLabel: collectLabel(TIP_COLLECT_BASE, state),
      tipCollectIcon: collectIcon(state),
    };
  },

  /** 收藏三态写入口（只动词卡按钮，不碰 overlay / 播放态） */
  _setTipCollect(state: CollectState) {
    this.setData(this._tipCollectPatch(state));
  },

  /** 清「已在收藏 → 已收藏」回落定时器（关闭 / 换词 / 换课 / 切档 / 卸载都要清） */
  _clearTipCollectTimer() {
    if (this._tipCollectTimer) {
      clearTimeout(this._tipCollectTimer);
      this._tipCollectTimer = null;
    }
  },

  /** 起回落定时器：到点仅在仍停在 `existed` 时回 `done`（用户中途又点了就顺其自然） */
  _armTipCollectRevert() {
    this._clearTipCollectTimer();
    this._tipCollectTimer = setTimeout(() => {
      this._tipCollectTimer = null;
      if (this.data.tipCollect === 'existed') this._setTipCollect('done');
    }, TIP_COLLECT_EXISTED_MS);
  },

  /**
   * 词卡「收藏」（D1）：`☆ 收藏 → ⋯ 收藏中（禁用）→ ✓ 已收藏`；
   * 重复点 → `✓ 已在收藏`，1.8s 后回 `已收藏`；失败回 `☆ 收藏`。**成功后词卡不关**。
   *
   * 🔴 未登录：**不收词卡**，直接弹本页既有内联 modal-login（`guestLoginShow`）。
   *    抽屉那边是「先收抽屉再弹」——因为抽屉自带遮罩，两层叠起来才是问题（K10）；
   *    词卡没有遮罩层，收起它反而让用户失去上下文。
   *
   * 🔴 D7 缓存失效兜底：**这里没有 `if (已收藏) return`**。已收藏的按钮再点一次仍然调
   *    `_collectWord`（服务端幂等，`existed:true` 不重复写入）——用户在收藏页删过的条目
   *    会被这次写请求重新建回来，于是 UI 的 ✓ 与服务器重新一致（见 utils/collect-cache 文件头）。
   */
  async collectTipWord() {
    const ov = this.data.overlay;
    if (!ov || ov.kind !== 'wordtip' || !ov.word) return;
    if (this.data.tipCollect === 'busy') return;            // 提交中：防连点（按钮同时置灰）
    if (!isLoggedIn()) {
      this.setData({ guestLoginShow: true });               // 本页既有形态：内联 modal（不改 toast）
      return;
    }
    const word = String(ov.word).toLowerCase();
    const hasDef = !ov.none;
    const lineIndex = typeof ov.lineIndex === 'number' && isFinite(ov.lineIndex) ? ov.lineIndex : -1;
    this._clearTipCollectTimer();
    this._setTipCollect('busy');
    const r = await this._collectWord(word, hasDef, lineIndex);
    // 结果回来时卡片可能已经关掉 / 换了词：只在仍停在同一词上才改按钮态
    // （否则会把「下一个词」的按钮写成上一个词的结果 —— tipCollect 是单槽位）
    const cur = this.data.overlay;
    const same = !!cur && cur.kind === 'wordtip'
      && String(cur.word || '').toLowerCase() === word;
    if (!same) return;
    if (!r.ok) {
      this._setTipCollect('idle');                          // 失败回 ☆（错误提示由 request 层统一）
      return;
    }
    if (r.existed) {
      this._setTipCollect('existed');
      this._armTipCollectRevert();                          // 1.8s 后回「已收藏」
    } else {
      this._setTipCollect('done');
    }
  },


  /**
   * 长按**任意英文单词**（生词或普通词）→ 打开抽屉 `scope='word'`（四项）。
   *
   * - 长按对象已从「仅生词」放宽到「任意英文单词」（2026-11-26 18:05 用户追加 / AC-B.28）；
   * - `hasDef` 只随 overlay 带到标题区（有音标 /「暂无释义」），**不影响任何动作可用性**
   *   （口径 §5.9-8：动作层不得出现 `if (hasDef)`）；
   * - 🔴 无坐标：B 变体抽屉贴底通栏，本方法**不读 touches、不调 SelectorQuery**。
   */
  onWordLongPress(e: NceTapEvent) {
    const ds = e.currentTarget.dataset;
    const i = Number(ds.i ?? 0);
    const w = String(ds.w || '').toLowerCase();
    if (!w) return; // 脏 token（空 data-w）直接忽略，不产生浮层
    const line = this.data.lines[i];
    if (!line) return;
    const hasDef = ds.hasdef === true || ds.hasdef === 'true';
    const info = hasDef ? this._lookupWord(w) : null;
    this.openOverlay(
      {
        kind: 'drawer',
        scope: 'word',
        lineIndex: i,
        lineText: line.en,
        word: w,
        hasDef,
        phonetic: (info && info.phonetic) || '',
      },
      {
        tipPlaying: false,
        // D7（双向同步·方向 1）：词档抽屉第一行同时含「收藏此句」，两个 key 都按本地缓存算。
        // 词/句都是**这次长按的对象**（`line.en` + `w`），不跨句复用。
        collectedKeys: this._drawerCollectedKeys(line.en, w),
      },
    );
  },

  /**
   * V3-A 查词：实现在 utils/lexicon.ts（R3 封闭规则表，与首页今日一句共用）。
   * 保留本方法作页面内统一入口，测试与后续调用点不变。
   */
  _lookupWord(w: string): WordTipView {
    const detail = this.data.detail;
    return lookupWord(w, (detail && detail.words) || []);
  },

  /**
   * V4 平台原生 bindlongpress 长按句子空白 → 抽屉 `scope='line'`（两项）。
   * 长按与 tap 由平台互斥分发：长按**不展开**该句中文（expandedIdx 置 -1）。
   */
  onLongPress(e: NceTapEvent) {
    const i = Number(e.currentTarget.dataset.i);
    const line = this.data.lines[i];
    if (!line) return;
    this.openOverlay(
      { kind: 'drawer', scope: 'line', lineIndex: i, lineText: line.en },
      {
        expandedIdx: -1,
        tipPlaying: false,
        // D7（双向同步·方向 1）：句档抽屉只有「收藏此句」，按这一句的缓存算
        collectedKeys: this._drawerCollectedKeys(line.en),
      },
    );
  },

  /**
   * E4 后半（盲测 D-4）：按下某词 → 该词浅蓝高亮（`w-pressed`），touchend / touchcancel 撤销。
   * 与首页同源（`pages/home/index/index.ts` 的 onWordPressStart）：`<text>` 不支持 hover-class，
   * 裸 `:active` 被既有守卫禁止，故用长按态 class。不新增请求、不改任何业务链路。
   */
  onWordPressStart(e: NceTapEvent) {
    const key = Number((e.currentTarget.dataset || {}).k);
    if (!isFinite(key) || key < 0) return;
    if (this.data.pressedWordKey === key) return; // 同词重复 touchstart 不重复 setData
    this.setData({ pressedWordKey: key });
  },

  /** 松手 / 手势被打断 → 撤掉按下高亮 */
  onWordPressEnd() {
    if (this.data.pressedWordKey >= 0) this.setData({ pressedWordKey: -1 });
  },

  /**
   * 🟢 2026-11-26 盲测 D-7（AC-B.27）修：长按**中文译文块** → 什么都不做。
   *
   * 起因：`.sent`（整句容器，含中文译文 `.sent-cn`）挂着 `bindlongpress="onLongPress"`，
   * 长按中文行会冒泡上去弹出「该句两项抽屉」——与 AC-B.27「长按中文行 / 长按底部朗读·收藏按钮
   * 不弹抽屉」直接冲突，也与首页口径不一致（首页长按只挂 `.daily-en`）。
   *
   * 做法：`.sent-cn` 上 `catchlongpress` 吞掉事件（catch 会阻断冒泡），本方法**故意留空**。
   * 为什么不在 `.sent` 上摘掉 longpress：`tests/nce-detail-v7c.test.ts` 的 C5 判据要求
   * 「同一句节点同时挂 bindtap 与 bindlongpress」（平台互斥分发，长按不展开译文），
   * 那条判据仍然成立；手势隔离改由中文块自己吞事件完成。
   */
  onCnLongPress() { /* 故意留空：只消费事件，不产生浮层 */ },

  // ───────────── 抽屉组件回传的 3 个 handler（组件只 triggerEvent，页面调 services） ─────────────
  // 🔴 2026-11-26 变体 C（用户拍板）：朗读已下沉到组件内直接调 speakText（抽屉不关、按钮自切 ▶/■），
  //    本页不再有 onDrawerSpeakLine / onDrawerSpeakWord。别加回来：会与组件本地朗读**重复朗读一次**，
  //    而且两条停止入口（抽屉按钮 / 本页 U1 的行尾 ■）会互相打架。
  //    页面侧的播放态回流（_onSpeakState → readingLineIdx / wordPlaying）保持不变：
  //    组件在抽屉内朗读时，本页仍按 tts 推来的文本点亮对应句子（此时被抽屉盖住，无害且口径一致）。

  /** 抽屉关闭（遮罩 / 下滑 / ✕ 任一通道）：组件只抛信号，`visible` 由本页置 false。 */
  onDrawerClose() {
    this.closeOverlay();
  },

  /**
   * 「收藏此句」：`collectGlossary({tag:'nce'})` 契约不变；T1 未登录仍弹本页内联 modal-login
   * 「请先登录」（首页同位置是 wx.showToast —— 这个差异**有意保留**，不下沉到公共层）。
   *
   * 🔴 2026-11-27 方案 B（用户拍板，两页通用）：**收藏成功不再收抽屉**
   *    （原实现第一行就 `closeOverlay()`），按钮就地走三态，结果经 `onCollectDone` 回传组件。
   *    未登录路径不变：**先收起抽屉 → 再弹内联 modal**（不叠两层遮罩，K10）。
   */
  async onDrawerCollectLine(e: DrawerEvent<SpeakLineDetail>) {
    const d = (e && e.detail) || {};
    const lineIndex = Number(d.lineIndex);
    const text = String(d.text || '');
    // V-B11 / BB9：**未登录**动作后立即收起（否则 modal 会叠在遮罩上）
    if (!isLoggedIn()) {
      this.closeOverlay();
      this.setData({ guestLoginShow: true });
      return;
    }
    const drawer = drawerOf(this);
    const r = await this._collectLine(isFinite(lineIndex) ? lineIndex : -1, text);
    // D7（双向同步·方向 2）：抽屉里收藏成功 → key 集合换新数组，组件 observer 即时对齐该项
    if (r.ok) this.setData({ collectedKeys: this._withCollectedKey(EVT.COLLECT_LINE) });
    if (drawer) drawer.onCollectDone('line', r.ok, r.existed);
  },

  /**
   * 收藏整句的**唯一实现**（D1 抽出）：抽屉「收藏此句」与将来的任何句子收藏入口共用一份，
   * 不写第二份 payload 组装（sourceText / meta / toast 文案三处必然漂移）。
   * 登录守卫**不在这里**（两页的未登录形态不同：本页内联 modal、首页 toast）——
   * 与首页 `_collectLine` 的分工一致。
   *
   * 🔴 成功即 `rememberCollected('line', en)`（D7）：新建与「已存在」都算已收藏。
   *    enMain 归一化口径与后端去重一致（见 utils/collect-cache）。
   */
  async _collectLine(lineIndex: number, text: string): Promise<{ ok: boolean; existed: boolean }> {
    const fail = { ok: false, existed: false };
    const lines = this.data.lines || [];
    const line = isFinite(lineIndex) && lineIndex >= 0 ? lines[lineIndex] : null;
    const { id, book, detail } = this.data;
    const en = String(text || (line ? line.en : ''));
    if (!en) return fail;
    try {
      const res = await collectGlossary({
        tag: 'nce',
        enMain: en,
        note: (line && line.cn) || '',
        sourceText: `Lesson ${id} · ${detail ? detail.title : ''}`,
        meta: { book, lessonId: id, lineIndex },
      });
      const existed = !!res.existed;
      rememberCollected('line', en);
      wx.showToast({ title: collectToastText('line', existed), icon: 'none' });
      return { ok: true, existed };
    } catch (err) {
      // 失败提示由 utils/request.ts 统一负责（49 §5 方案 B / 11-20 治本授权）：
      // 常规失败在请求层保证「有且仅有一条中文 string toast」；页面层只保留排障留痕
      // （后端 400 的 statusCode / message 供排查），不再自行弹 toast / 不再做 hasHttpResponse 判定，
      // 避免与请求层重复弹或把数组 message 直接塞进 wx.showToast 的 title。
      console.error('[nce/collect]', err);
      return fail;
    }
  },

  /**
   * 「收藏单词」：`collectGlossary({tag:'word'})`，普通词同样可用（AC-B.31）：
   * 没有音标 / 释义也**不拒收** —— `note` 允许为空串、`meta.phonetic` 允许为空串。
   *
   * 🟢 2026-11-26 盲测 D-2（E3/E5 两页口径断链）修：`meta` 必须带 `hasDef`。
   *   原实现 meta 里只有 `book / lessonId / lineIndex / word / phonetic`，**没有 `hasDef`**；
   *   而收藏页 `pages/mine/glossary/index.ts:151` 的灰标判据是严格 `m.hasDef === false`
   *   → `undefined !== false` → 详情页收藏的普通词**永不显示「未收录」**，
   *   同一动作在首页收藏却正常（首页 meta 带 hasDef）—— 两页行为不一致（E5 要求同口径）。
   *   组件早在 `collect-word` 事件里回传了 hasDef（components/action-drawer/index.ts:193），
   *   属「回传被丢弃」。
   *   取值口径：事件带布尔就照用；事件没带（老调用方 / 词卡入口）则回落到本次查词结果
   *   `!info.none`（查到了 = 已收录），**不写 undefined、也不默认 false**，
   *   避免把已收录词误标「未收录」。
   */
  async onDrawerCollectWord(e: DrawerEvent<CollectWordDetail>) {
    const d = (e && e.detail) || {};
    const word = String(d.word || '').toLowerCase();
    const lineIndex = Number(d.lineIndex);
    if (!word) return;
    // 未登录：先收起抽屉 → 再弹内联 modal（与 onDrawerCollectLine 同口径，K10）
    if (!isLoggedIn()) {
      this.closeOverlay();
      this.setData({ guestLoginShow: true });
      return;
    }
    const drawer = drawerOf(this);
    const info = this._lookupWord(word);
    const hasDef = typeof d.hasDef === 'boolean' ? d.hasDef : !info.none;
    const r = await this._collectWord(word, hasDef, isFinite(lineIndex) ? lineIndex : -1);
    // D7（双向同步·方向 2）：抽屉「收藏单词」成功后 key 集合换新数组（缓存已在 _collectWord 里写）
    if (r.ok) this.setData({ collectedKeys: this._withCollectedKey(EVT.COLLECT_WORD) });
    if (drawer) drawer.onCollectDone('word', r.ok, r.existed);
  },

  /**
   * 收藏单词的**唯一实现**（D1 抽出，词卡与抽屉共用）：
   * 登录守卫留在调用方（两页授权形态不同），payload 组装 / toast 文案 / 缓存写入只此一份。
   *
   * `meta.hasDef` 是收藏页 E3「未收录」灰标的判据（`m.hasDef === false` 严格比较）：
   * 必须显式写布尔，**不写 undefined、也不默认 false**（老数据无该字段 → 不显示灰标）。
   *
   * 🔴 成功即 `rememberCollected('word', 词)`（D7 缓存刷新，新建与 existed 都写）。
   */
  async _collectWord(
    word: string,
    hasDef: boolean,
    lineIndex = -1,
  ): Promise<{ ok: boolean; existed: boolean }> {
    const fail = { ok: false, existed: false };
    const w = String(word || '').toLowerCase();
    if (!w) return fail;
    const info = this._lookupWord(w);
    const { id, book, detail } = this.data;
    const note = [info.pos, info.def].filter(Boolean).join(' ');
    try {
      const res = await collectGlossary({
        tag: 'word',
        enMain: info.word || w,
        note,
        sourceText: `Lesson ${id} · ${detail ? detail.title : ''}`,
        meta: {
          book,
          lessonId: id,
          lineIndex,
          word: info.word || w,
          phonetic: info.phonetic || '',
          // E3 判据字段：false → 收藏页「未收录」灰标；与首页 pages/home/index/index.ts 同形
          hasDef,
        },
      });
      const existed = !!res.existed;
      rememberCollected('word', info.word || w);
      wx.showToast({ title: collectToastText('word', existed), icon: 'none' });
      return { ok: true, existed };
    } catch (err) {
      // 失败提示由 utils/request.ts 统一负责；页面只留排障痕
      console.error('[nce/collectWord]', err);
      return fail;
    }
  },

  /**
   * 🔴 收藏结果回传（见文件顶部 2026-11-27 段落）：抽屉组件只负责三态渲染，
   * 收藏仍由本页调 service，结果经 `selectComponent('#drawer').onCollectDone` 回传。
   * 组件实例由模块级 `drawerOf(this)` 取（不写成页面方法：单测的 `this` 是手搓对象，
   * 只挂了被调用的那几个方法，页面方法一多就会 `not a function`）。
   */

  /**
   * 🔴 U1（2026-11-26 19:15 用户拍板）：句子行尾「■ 停止」。
   * 为什么这条不与 V7-C「句子区无常驻 ♪/☆ 控件」冲突（后来人请先读这段再改）：
   *  ① **只在播放中渲染**：`wx:if="{{readingLineIdx === si}}"`，不播放时节点根本不存在，
   *     不是常驻控件；
   *  ② 它是**停止**而不是「播放 / 收藏」入口 —— 不承担「引导用户去朗读或收藏」的可发现性职责，
   *     而 V7-C 禁止常驻控件的目的是「不要把阅读页做成播放器界面」；
   *  ③ 它替代的正是 B 变体删掉的那条唯一停止路径（长按气泡「朗读此句」再点一次 = 停，方案 §3.5 U1），
   *     没有它，用户点完「朗读此句」后抽屉已收起 → 页面上再无任何可停止的控件。
   * 实现：`stopSpeak()` + 显式归零（不依赖 tts 一定推出 null）。
   */
  stopLineSpeak() {
    stopSpeak();
    this._resetPlayingState();
  },

  /** T1「去登录」：复用 loginFromGate() 语义；成功由 auth:logged 广播收起并重拉 */
  async onGuestLogin() {
    const ok = await loginFromGate();
    if (ok) this.setData({ guestLoginShow: false });
  },

  onCloseGuest() { this.setData({ guestLoginShow: false }); },

  /** V17「稍后」：收起弹窗 + 常驻提示条（不是纯 closeModal） */
  onAuthDefer() {
    this.setData({ showAuthModal: false, showReloginTip: true });
  },

  /** V17 点提示条再次唤起同一 modal-auth；提示条登录成功前不消失 */
  onReopenAuth() {
    this.setData({ showAuthModal: true });
  },

  goLesson(e: NceTapEvent) {
    const delta = Number(e.currentTarget.dataset.delta || 0);
    const next = this.data.id + delta;
    const total = nceBookTotal(this.data.book);
    if (next < 1 || next > total) {
      wx.showToast({ title: '已经是最后一课了', icon: 'none' });
      return;
    }
    stopSpeak();
    this.setData({ id: next, readingLineIdx: -1, readingPhase: 'idle', overlay: null, wordPlaying: '', tipPlaying: false });
    this._clearTipCollectTimer(); // D1：换课，卡片要关，回落定时器作废
    this._speakingWord = '';
    this._lineHint = -1; // 换课：句档定位提示跨课无意义
    void this.load();
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  onRetry() { void this.load(); },

  /** 某个文本对应的句子下标（-1 = 不是本课任何一句 → 说明在播的是单词） */
  _lineIdxOf(text: string): number {
    const t = String(text || '').trim();
    if (!t) return -1;
    const lines = this.data.lines || [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] && String(lines[i].en || '').trim() === t) return i;
    }
    return -1;
  },

  /**
   * 🟢 D-8 修：文本 → 句下标的**唯一入口**（U1 行尾 ■ 的定位）。
   *
   * 先用「发起朗读时的 lineIndex」校验（`lines[hint].en === text` 才认），校验不过才退回
   * 文本反查。这样课文含两句完全同文时，■ 落在**用户实际长按/朗读的那一句**上，
   * 而不是反查到的最前面那一句。
   */
  _resolveLineIdx(text: string): number {
    const t = String(text || '').trim();
    const hint = Number(this._lineHint);
    const lines = this.data.lines || [];
    if (t && isFinite(hint) && hint >= 0 && hint < lines.length
      && lines[hint] && String(lines[hint].en || '').trim() === t) {
      return hint;
    }
    return this._lineIdxOf(t);
  },

  /**
   * 播放态归零（切后台 / 回前台 / 播完共用一处，避免各处漏字段）。
   * 🔴 故意**不清** `_lineHint`：tts 的 `speakText` 同步段会先 `stopSpeak()` 推一次 null
   *    （走到这里），紧随其后的 loading 才带文本 —— 若在这里清掉 hint，D-8 的重复句定位就失效了。
   *    hint 的失效点只有三类：换课 / 重载、读单词、页面销毁（均已显式写 -1）。
   */
  _resetPlayingState() {
    this._playingText = '';
    this._playingIdx = -1;
    this._speakingWord = '';
    this.setData({ readingLineIdx: -1, readingPhase: 'idle', wordPlaying: '', tipPlaying: false });
  },

  /**
   * 朗读状态（唯一写入口）：null → 全部归零；非 null → **按 tts 推来的权威文本**算播放态（P2-1）。
   * 🔴 不能用 _playingIdx / _speakingWord 反推：speakText 内部会先 stopSpeak() 推一次 null，
   *    页面收到 null 就把这两个意图标记清零，紧随其后的 loading/playing 再用它们算 →
   *    永远点不亮（句子 A 播着点句子 B、句子播着点词卡朗读、首页整句播着点单词，全是这一根因）。
   *    以 s.text 判定：命中本课某句 → 该句高亮；否则视为单词朗读 → 词卡按钮亮。
   */
  _onSpeakState(s: SpeakState | null) {
    if (!s) {
      this._resetPlayingState();
      return;
    }
    const text = String(s.text || '').trim();
    this._playingText = text;
    let lineIdx: number;
    let word: string;
    if (text) {
      lineIdx = this._resolveLineIdx(text); // D-8：优先用发起时的 lineIndex（重复句不歧义）
      word = lineIdx >= 0 ? '' : text;
    } else {
      // 事件未携带文本（兼容老调用方）：退回意图标记，行为与改动前一致
      lineIdx = this._playingIdx;
      word = this._speakingWord;
    }
    // 词卡按钮态：只有 overlay 当前是词卡、且正在播的就是这个词时才亮（单槽位后判据更直白）
    const ov = this.data.overlay;
    const tipOn = !!word && !!ov && ov.kind === 'wordtip' && String(ov.word || '').toLowerCase() === word.toLowerCase();
    this.setData({
      readingPhase: s.phase === 'loading' ? 'loading' : 'playing',
      readingLineIdx: lineIdx,
      wordPlaying: word,
      tipPlaying: tipOn,
    });
  },

  _subscribeReading() {
    if (!this._offSpeakState) this._offSpeakState = onSpeakState((s) => this._onSpeakState(s));
  },

  _unsubscribeReading() {
    if (this._offSpeakState) {
      this._offSpeakState();
      this._offSpeakState = null;
    }
  },
});
