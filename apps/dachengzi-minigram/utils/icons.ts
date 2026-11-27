/**
 * 图标资产唯一真源（纯常量 + 纯函数，零副作用）— 组件与两页共用一份。
 *
 * 背景（2026-11-27 用户真机反馈 2）：
 *   「播放 icon 跟抽屉的播放 icon 不一致，真机下更差，不是 svg icon」
 *   三处播放图标原来是**三种画法、两种颜色**：
 *     · 抽屉 `.ad-ico-play`：CSS border 三角，硬编码 `#C2410C`（橙，跟品牌蓝体系冲突）；
 *     · 详情页词卡 `.wt-ico::before`：CSS border 三角，`#1D4ED8`；
 *     · 首页卡片 `.dq-act`：**纯文字字符** `▶ 朗读` / `■ 停止`（继承 `--t2`，真机上各家字形不一）。
 *   现在统一成一套 SVG（`assets/icons/*.svg`），三处只引用本文件的常量。
 *
 * 🔴 为什么颜色写在 SVG 里、而不是 wxss 的 `color`：
 *   小程序 `<image>` 是**图片**，不是字体图标，**不能继承 CSS color**，也无法 `currentColor`
 *   （没有内联 <svg> 能力）。所以每个状态一个文件、色值烘进 SVG。
 *   为了不违反 app.wxss「新增页面一律从这里取色，禁止硬编码色值」，两条约束兜住漂移：
 *     ① 本文件是**唯一**引用这些路径的地方（页面/组件不得写 `/assets/icons/...` 字面量）；
 *     ② `tests/rd-blindfix-1126-guards.test.ts` 断言 SVG 内的色值**等于** app.wxss 的
 *        `--brand-deep` / `--accent-ink`，改 token 不跟着改 SVG 直接变红。
 *
 * 🔴 为什么 wxml 里看到的是 `{{icons.play}}` 而不是路径字面量：
 *   wxml 无法 import ts。组件/页面把本文件的对象放进 `data.icons` 后插值，
 *   这样「路径只有一份」这条约束在模板层也成立（测试会扫三个模板文件，禁止出现字面量）。
 */

/** 图标路径（相对小程序根目录，`<image src>` 直接可用） */
export const ICONS = {
  /** 播放（实心三角，`--brand-deep`） */
  play: '/assets/icons/play.svg',
  /** 停止（圆角方块，`--brand-deep`） */
  stop: '/assets/icons/stop.svg',
  /** 未收藏（空心星，`--brand-deep`） */
  star: '/assets/icons/star.svg',
  /** 已收藏（实心星，`--accent-ink`）— 当前三态用 ✓，本项备用（见文件末 `collectIcon`） */
  starFilled: '/assets/icons/star-filled.svg',
  /** 已收藏（对勾，`--accent-ink`）— 与交互原型「✓ 已收藏」逐字一致 */
  check: '/assets/icons/check.svg',
} as const;

/**
 * 收藏按钮的状态（与交互原型规格表逐行对应：
 * `30-任务产物/2026-11-27-收藏下沉抽屉-交互原型/原型-收藏抽屉内反馈.html`）。
 *
 *  - `idle`    默认：`☆ 收藏此句`
 *  - `busy`    提交中：`☆ 收藏中`（置灰禁用，防连点重复写入）
 *  - `done`    新建成功：`✓ 已收藏`（停留态，可继续点 → 走 `existed` 分支）
 *  - `existed` 已存在：`✓ 已在收藏`（沿用 `collectToastText` 的 existed 口径）
 *
 * 失败 → 回 `idle`（错误提示由 `utils/request.ts` 统一弹，页面只回传 `ok=false`）。
 */
export type CollectState = 'idle' | 'busy' | 'done' | 'existed';

/** 收藏三态（按钮文案）：`idle` 回落到动作表原 label，不在这里另写字面量 */
const COLLECT_STATE_LABEL: Record<Exclude<CollectState, 'idle'>, string> = {
  busy: '收藏中',
  done: '已收藏',
  existed: '已在收藏',
};

/**
 * 收藏按钮文案：`idle` 用动作表原 label（`收藏此句` / `收藏单词`，真源 utils/line-actions），
 * 其余三态用上面那张表 —— 页面与组件都不写第二种文案。
 */
export function collectLabel(baseLabel: string, state: CollectState): string {
  return state === 'idle' ? baseLabel : COLLECT_STATE_LABEL[state];
}

/**
 * 收藏按钮图标：未收藏（含提交中）空心星、已收藏对勾。
 * ⚠️ 刻意**不用** `starFilled` 表示「已收藏」——原型真源写死的是 `✓ 已收藏`，
 *    三处图标必须一致（用户本轮反馈的正是「两处 icon 不一致」）。
 *    `starFilled` 已随资产清单建好，将来若要换成 ★ 只改这一行。
 */
export function collectIcon(state: CollectState): string {
  return state === 'done' || state === 'existed' ? ICONS.check : ICONS.star;
}

/** 播放 / 停止图标（播放态 → 方块）。三处播放按钮共用，禁止各自写三元字面量 */
export function playIcon(playing: boolean): string {
  return playing ? ICONS.stop : ICONS.play;
}
