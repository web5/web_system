# 微前端子模块样式规范

> 适用于 `apps/portal`、`apps/admin` 等微前端子模块。核心目标：样式隔离 + 不破坏 antdv 组件默认样式。

## 一、隔离机制

`scripts/vite-micro-frontend.mjs` 的 `cssScopePlugin` 给子模块 CSS 的每条选择器加 `:where([data-module="<name>"])` 前缀。

- **`:where()` 是关键**：优先级归零。若用 `[data-module="xxx"]`（属性选择器）会 +0,1,0 优先级，压过 antdv cssinjs 的 `:where()` 样式，导致大面积误伤（见「历史事故」）。
- **隔离效果**：样式只命中模块容器（`<div data-module="<name>">`）内的 DOM。
- **不加前缀的选择器**：`html` / `body` / `:root` / `[data-theme]` 保持全局（用于 CSS 变量和页面背景）。

## 二、编写铁律

1. **不写全局 reset**。`* { margin:0; padding:0 }` 这类规则不要写——antdv 的 `ant-design-vue/dist/reset.css` 已处理基础 reset；即便要写，`:where()` 前缀下它也不会误伤 antdv，但没有必要。

2. **antdv 组件定制走 theme，不走 CSS 覆盖**。颜色/圆角/字号等用 `<a-config-provider :theme="{ token: {...} }">` 定制，不要写 `.ant-btn { color: xxx }` 这类覆盖。

3. **CSS 变量用 `:root` 定义**（保持全局）。跨模块同名变量冲突由 `shell-loader` 在 `unmount` 时 `removeCss` 兜底（当前单模块挂载架构下已覆盖该场景）。

4. **组件内样式优先 scoped**。需要穿透 antdv 内部时用 `:deep(.ant-xxx)`，避免全局污染。

5. **深浅主题**：用 `data-theme` 属性 + CSS 变量切换，不在 CSS 硬编码颜色值。浅色变量值注意在白背景下的可见性（如边框色别用 `rgba(0,0,0,.1)` 这种过淡值）。

## 三、历史事故（避免重蹈）

| 现象 | 根因 | 修复 |
|---|---|---|
| Input `size=large` 高度塌成 24px、padding 清零 | `* { padding:0 }` 加 `[data-module]` 前缀后优先级升到 0,1,0，压过 antdv 的 `:where()`（0,0,0） | 前缀改 `:where()` 归零 |
| primary 按钮文字变深色（应为白色）、hover 失效 | 同上（优先级提升覆盖 antdv 的 colorTextLightSolid / hover） | 前缀改 `:where()` |
| 模块切换后另一模块背景被污染 | `:root` 变量同名全局覆盖 + unmount 不移除 CSS | shell-loader unmount 时 `removeCss` |
| 浅色主题 Input 边框不可见 | `--input-border: rgba(0,0,0,.1)` 过淡 | 调深为 `.2` |

## 四、验证要点

新增/改动子模块样式后，至少验证：

1. antdv 组件尺寸正常（`size="large"` 的 Input 高度 40px、字号 16px）。
2. primary 按钮文字为白色，hover/active 有反馈。
3. 深浅主题切换后组件颜色协调。
4. 模块间切换（SPA）后背景/文字不被污染。
