/**
 * 浮层（Drawer / Modal / Dropdown 面板）的挂载点。
 *
 * ## 为什么不能直接用默认值
 *
 * 微前端构建（`scripts/vite-micro-frontend.mjs` 的 `cssScopePlugin`）会给模块的每条
 * CSS 选择器加上 `:where([data-module="<name>"])` 前缀做样式隔离，于是所有自定义
 * 样式只对 `<div data-module="admin">` **内部**的 DOM 生效。
 *
 * 而 antd 的 Drawer / Modal 默认 teleport 到 `<body>` —— 落在模块容器之外。
 * 结果是：抽屉外壳（antd cssinjs 运行时注入，不受隔离影响）一切正常，
 * 但**抽屉里所有自有 class 全部匹配不上**，表现为
 *
 *   「卡片没了、字号退回 14px、标题层级和分割线消失，内容贴边像一堆纯文本」
 *
 * 2026-10-23 实测对照（同一份 DOM、同一份线上 CSS，只改挂载位置）：
 *
 * | 项目        | 容器内            | body 下（默认）        |
 * | ----------- | ----------------- | ---------------------- |
 * | max-width   | 680px             | none                   |
 * | padding     | 40px 36px 44px    | 0px                    |
 * | 正文        | 16px / 28.8       | 14px / 16.1（antd 兜底）|
 * | h2          | 24px + 下划线      | 21px + 无下划线         |
 *
 * ## 用法
 *
 * ```vue
 * <a-drawer :get-container="moduleOverlayContainer"> … </a-drawer>
 * <a-modal  :get-container="moduleOverlayContainer"> … </a-modal>
 * ```
 *
 * 安全前提：模块容器（实测 `.module-host`）的 `transform / overflow / contain / z-index`
 * 均为初始值，不创建 containing block，也不裁剪 —— fixed 定位的浮层挂进去后仍相对视口铺满。
 * 若后续给 `.module-host` 加了 `transform` 或 `overflow: hidden`，会破坏浮层定位，
 * 届时需改回 body 并把该组件的样式写成含 `[data-module` 的显式选择器（见 cssScopePlugin 的逃生口）。
 *
 * standalone 模式（vite dev / 未走微前端）页面里没有模块容器，自动退回 `document.body`。
 */
export function moduleOverlayContainer(): HTMLElement {
  // 限定 div，排除 <head> 里用于标记模块 CSS 的 link[data-module]
  return document.querySelector<HTMLElement>('div[data-module]') ?? document.body;
}
