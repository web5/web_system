/**
 * antd 主题色（cssinjs 需要具体色值，无法吃 `var(--ws-brand-500)`）。
 *
 * 这里是 portal **唯一**允许写品牌色值的地方，且与 `@web-system/ui` 的
 * `--ws-brand-500 / 600 / 700`（packages/ui/src/tokens.css）保持一致；
 * 页面与组件样式一律引用 token 名，不写裸 hex。
 *
 * 收敛背景：portal 原主色为 #FF8C42，与小程序 / design token 的 #F97316 不一致。
 */
export const BRAND = {
  500: '#F97316',
  600: '#EA580C',
  700: '#C2410C',
} as const;
