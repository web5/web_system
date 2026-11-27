/**
 * 长按动作抽屉 · 纯函数层（零 wx 副作用 / 零 services 依赖）
 *
 * 归属：`components/action-drawer/` 与 `pages/{nce/detail,home/index}` 共用。
 * 只放「与页面上下文无关」的计算：动作集合、收藏 toast 文案。
 *
 * 🔴 明确不放：`book / lessonId / sourceText / from` 等**页面私有上下文**（方案 §3.2 契约 3）。
 *    收藏 payload 由各页自己组装 —— 详情页与首页的 meta 字段本来就不同，下沉到公共层会造出
 *    「组件知道页面上下文」的隐式耦合。
 *
 * 🔴 事件名为什么用常量而不是字符串字面量散在各处：
 *    ts 侧统一走 `EVT.XXX`（写错即 tsc 报错）；但 **wxml 无法 import 常量**，`bind:collect-line`
 *    只能写字面量 —— 所以 `EVT` 的值必须与 wxml 里的字面量逐字相同，这条由
 *    `tests/action-drawer.test.ts` 的 grep 静态断言兜住（扫组件 wxml 的 `bind:` / `triggerEvent`
 *    字符串是否都属于 `EVT` 的值集合）。
 *
 * 🔴 2026-11-26 变体 C 后 `speak-line` / `speak-word` 的**双重身份**（改名前先读这段）：
 *    ① 作为 `ActionItem.key` / `data-key` 的值 —— 组件的分流标识，仍是「朗读动作」的稳定 id；
 *    ② **不再是对外事件名** —— 朗读已下沉到组件内直接调 `services/tts`，页面不再 `bind:speak-*`，
 *       组件也不再 `triggerEvent('speak-*')`。保留在 `EVT` 里是因为 wxml 的 `data-key` 仍需要
 *       与 `EVT` 逐字一致（actionsOf 的 key 直接来自这里），删掉会让 key 变成散落的字面量。
 *    `close` / `collect-line` / `collect-word` 三个仍是真正的对外事件。
 *
 * 设计真源：`公共能力抽象方案.md` §2.1 ③ / §3；`需求口径确认-B版.md` AC-B.5 / AC-B.6 / AC-B.7。
 */

/**
 * 抽屉的 5 个动作 key / 对外事件名（值必须与组件 wxml 的 `data-key` / 页面 `bind:` 字面量逐字一致）。
 * ⚠️ 其中 SPEAK_LINE / SPEAK_WORD 自 2026-11-26 变体 C 起**只作动作 key，不再是对外事件**
 *    （朗读下沉到组件，见文件头的「双重身份」说明）。
 */
export const EVT = {
  /** 「朗读此句」动作 key（payload 已不再 emit：组件内直接 speakText） */
  SPEAK_LINE: 'speak-line',
  /** 「朗读单词」动作 key（同上） */
  SPEAK_WORD: 'speak-word',
  /** 点「收藏此句」：payload `{ lineIndex, text }` */
  COLLECT_LINE: 'collect-line',
  /** 点「收藏单词」：payload `{ word, lineIndex, hasDef }` */
  COLLECT_WORD: 'collect-word',
  /** 关闭手势（遮罩 / 下滑 / ✕）：payload `{ via: 'mask' | 'swipe' | 'close' }` */
  CLOSE: 'close',
} as const;

/**
 * 词卡「朗读」圆形图标按钮的无障碍文案（AC-3.4：`aria-label` 随形态在两者间切换）。
 *
 * 🔴 为什么放在公共层而不是两页各自 data 里写死字面量：
 *   ① 两页各写一份字面量必然漂移（首页说「朗读单词」、详情页说「朗读」这类）；
 *   ② wxml 无法 import 常量，页面只能把常量注入 data 再由 wxml 插值；
 *   ③ 页面 ts 里出现 `'朗读单词'` 这种动作文案字面量本身就是被静态断言禁止的
 *      （`tests/nce-blind-a-render-structure.test.ts` A2 第二例）。
 */
export const ARIA_WORD_PLAY = '朗读单词';
export const ARIA_WORD_STOP = '停止朗读';

/** 抽屉动作的作用域：句子空白 = 两项；任意英文单词 = 四项 */
export type ActionScope = 'line' | 'word';

/**
 * 动作种类（2026-11-26 变体 C 起）：
 * - `speak`   —— 朗读**下沉到组件**：组件直接 `services/tts.speakText`，不 emit、不关抽屉，
 *                按钮本地切 ▶/■ 播放态（用户 2026-11-26 拍板，设计真源
 *                `30-任务产物/2026-11-26-阅读交互调整-原型稿/原型-变体C-抽屉内朗读.html`）；
 * - `collect` —— 收藏**仍回页面**：组件只 `triggerEvent`，页面弹 toast / 内联 modal 后收起抽屉
 *                （两页的授权形态差异**有意保留**，不下沉到组件）。
 */
export type ActionKind = 'speak' | 'collect';

export interface ActionItem {
  /** 稳定 key（wxml `wx:key`）：与事件名同值，便于 `data-key` 直接分流 */
  key: string;
  /** 该动作的事件名（= `EVT` 的某个值）。**只有 `kind='collect'` 才会真的 emit** */
  evt: string;
  /** 按钮文案（只用于渲染，不参与判定） */
  label: string;
  /** 动作种类：决定组件是「本地调 tts」还是「回页面」（见 ActionKind） */
  kind: ActionKind;
  /** 播放中文案（仅 `kind='speak'` 有）：`朗读此句 → 停止此句` / `朗读单词 → 停止单词` */
  stopLabel?: string;
}

/**
 * 四项的**唯一真源**，顺序 = 2×2 grid 的行优先铺法：
 *
 *   第 1 行：朗读此句 | 收藏此句      ← 列 = 动词（左朗读 / 右收藏）
 *   第 2 行：朗读单词 | 收藏单词      ← 行 = 对象（上句 / 下词）
 *
 * 🔴 顺序不许改：AC-B.6 / V-B6 要求「句档两项的两个格子与词档四项第一行格子 rect 完全一致」，
 *    即两项档必须是 `slice(0, 2)`。「朗读此句 / 朗读单词 / 收藏此句 / 收藏单词」那种按动词排的
 *    写法会让两项档变成「朗读此句 + 朗读单词」，与已拍板口径冲突。
 *    证据：`原型-变体B-底部抽屉.html:617-622` `var ACTIONS = [朗读此句, 收藏此句, 朗读单词, 收藏单词]`
 *    及 `:1016` `actsHTML()` 的 `scope === 'word' ? ACTIONS : ACTIONS.slice(0, 2)`。
 */
const ACTIONS: ReadonlyArray<Readonly<ActionItem>> = Object.freeze([
  Object.freeze({
    key: EVT.SPEAK_LINE, evt: EVT.SPEAK_LINE, label: '朗读此句', kind: 'speak', stopLabel: '停止此句',
  }),
  Object.freeze({ key: EVT.COLLECT_LINE, evt: EVT.COLLECT_LINE, label: '收藏此句', kind: 'collect' }),
  Object.freeze({
    key: EVT.SPEAK_WORD, evt: EVT.SPEAK_WORD, label: '朗读单词', kind: 'speak', stopLabel: '停止单词',
  }),
  Object.freeze({ key: EVT.COLLECT_WORD, evt: EVT.COLLECT_WORD, label: '收藏单词', kind: 'collect' }),
] as ActionItem[]);

/**
 * 按作用域取动作集合。
 * - `line` → 2 项（朗读此句 / 收藏此句），恰为四项的前两项；
 * - `word` → 4 项（2×2）。
 *
 * 🔴 **与 hasDef 无关**：普通词（`hasDef=false`）同样是 4 项，且「朗读单词 / 收藏单词」走完全相同的
 *    实现路径（口径 §5.9 第 8 条 / AC-B.30 / AC-B.31）。因此本函数**不接收 hasDef** ——
 *    从签名上就断掉「将来有人加 `if (!hasDef)` 少给两项」的可能。
 */
export function actionsOf(scope: ActionScope): ActionItem[] {
  return scope === 'word' ? ACTIONS.slice() : ACTIONS.slice(0, 2);
}

/**
 * 收藏成功 toast 文案（对齐 `pages/nce/detail/detail.ts` 迁移前的既有文案，零行为变更）：
 * - 句：`existed ? '已在收藏中' : '已收藏'`
 * - 词：`existed ? '已在生词本' : '已收藏'`
 *
 * 幂等语义：`collectGlossary` 重复收藏返回 `existed=true` → 换一句文案，不当失败处理（口径 §5.9-2）。
 */
export function collectToastText(kind: ActionScope, existed: boolean): string {
  if (kind === 'line') return existed ? '已在收藏中' : '已收藏';
  return existed ? '已在生词本' : '已收藏';
}
