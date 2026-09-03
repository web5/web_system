# 科豆 AI · 颜色定义点地图（Color Reference）

> 版本：v0.1（草案，待批注）｜ 日期：2026-09-03
> 定位：**"颜色可能被定义的所有地方"的权威清单** + hover/active 高亮分层约定。
> 谁用：AI 改任何视觉先查本文档 —— 先判断"这个色该不该在这定义"，再动手。
> 原则：数值唯一源 = `packages/ui/src/tokens.ts` ↔ `tokens.css`（同值）；消费端**只引用不抄值**；新色值必须先进 Token，再引用。
> **覆盖问题（多层谁生效 / 改了不生效）见同目录《css-override-rules.md》**——本文档管"在哪定义"，那篇管"谁赢"。

---

## 1. 颜色定义点清单（哪些文件能出现色值）

| # | 位置 | 角色 | 状态 | 约束 |
|---|---|---|---|---|
| 1 | `packages/ui/src/tokens.ts` | **数值唯一源**（gray/brand/语义/roles/radius/shadow） | ✅ 已落地 | 唯一可"创造新色值"处；改动须经 DR 记录 |
| 2 | `packages/ui/src/tokens.css` | CSS 变量镜像（含旧名 alias） | ✅ 已落地 | 必须与 tokens.ts **同值**（人工同步 + diff 核对）；alias 一个版本周期后删 |
| 3 | `packages/ui/src/antd-theme.ts` | antd 组件 token 映射（含全部 hover 态 token） | ✅ 已落地 | 只从 `uiTokens` 取值，不写新 hex |
| 4 | `packages/ui/src/theme.css` | 全局兜底覆盖（reset/例外面板） | ✅ !important 已清零 | 新条目必须注释理由；原则上只承载 antd 表达不了的 |
| 5 | 各 app `src/style.scss` | 历史遗留业务样式 | ⚠️ 去裸值中（P1-1） | 新代码**禁止新增**；存量逐页清理 |
| 6 | 业务 `.vue` `<style scoped>` | 页面级样式 | ⚠️ 裸色偶发（R1-5） | **默认禁止裸色**；只用 `--ws-*` 变量；特殊例外登记至 §4 |
| 7 | `.vue` `<template>`/`<script>` 内联 `style=""` | 应急写法 | ⚠️ 存在 | 禁止色值；仅布局属性（间距等）允许 |
| 8 | 组件库自带默认（antd 组件/图标色） | 框架默认 | 由 antd-theme 覆盖 | 新页面如遇默认蓝紫说明主题未生效 → 查 ConfigProvider 接入 |

> **判断口诀**：改色先想「这个值有没有 Token？没有 → 进 tokens.ts（#1）再引用；有 → 找它的角色变量（--ws-bg-*/--ws-text-*）」。任何出现在 #5/#6/#7 的新 hex/rgba 都是违规。

## 2. hover/active 语义阶梯（谁来定义"hover 色"）

hover 色**只有两类来源**，不得自行发明深浅：

| 用途 | token | light | dark | 说明 |
|---|---|---|---|---|
| 容器 hover（表格行/菜单项/下拉项） | `--ws-bg-hover`（roles.bgHover） | #F2F2F2 | #2A2A2A | 已存在 |
| 容器按压 active | `--ws-bg-active`（roles.bgActive） | #EBEBEB | #333333 | ✅ 已补（R4 定稿；dark #333333 按压微亮） |
| antd 控件项 hover/active | antd-theme `controlItemBgHover` / `controlItemBgActive` | = roles.bgHover / brand 低 alpha | 同左 | 已接 token，勿页面级覆盖 |
| 主按钮 hover/active | `colorPrimaryHover` / `colorPrimaryActive` | brand-400 / brand-600 | 同左 | 已接 token |
| 链接 hover | `colorLinkHover` | brand-400 | 同左 | 已接 token |
| 悬浮触发器（header 用户卡等） | **不加整块灰底**：文字 secondary→primary + 微阴影/透明度 | — | — | R3 约定，见 §3 |

## 3. 悬浮触发器 hover 约定（R3，来自 MainLayout 用户卡反馈）

- **形态**：header 内可点击触发器（用户卡/图标按钮）**默认不铺整块圆角灰底**——与圆形头像/图标叠置时"灰底套圆"观感脏，且在浅色 header 上 gray-200 反馈近乎不可见。
- **推荐反馈**：① 文字/图标色加深一级（--ws-text-secondary → primary）；② 需要更强反馈时加轻 shadow（--ws-shadow-card 半透明淡）或箭头（caret）变色。
- **确需底色**（如做成胶囊按钮）：圆角 `--ws-radius-pill`、高 32~36、留白对称，hover 底 `--ws-bg-subtle`（比行 hover 更淡一档），且与容器圆角贴合。

## 4. 例外登记表（现状散写值 → 目标 Token）

| 场景 | 现状（代码位置） | 归属 | 目标 |
|---|---|---|---|
| 深色侧栏 hover | `rgba(255, 255, 255, 0.06)`（MainLayout） | 固定面板例外（R1 规则 2） | ✅ R4 升 `--dc-panel-menu-hover`（app 局部变量，style.scss :root） |
| 深色侧栏 selected | `rgba(249, 115, 22, 0.18)`（MainLayout） | 同上 | ✅ R4 升 `--dc-panel-menu-selected` |
| 深色侧栏/顶栏容器与文字 | `#0F0F12`/`#161618`/`#a3a3a3`/`#ededed`（style.scss/App.vue/MainLayout） | 同上 | ✅ R4 升 `--dc-panel-*` 一组（遵循 css-override §3 app 局部 `--app-*` 规则） |
| Beehive logo 品牌色 | `#001529` / `#F5A623`（MainLayout svg） | 品牌图标例外（style.scss 头注释） | 保留登记（图标专属，不参与主题） |
| 头像阴影 | `rgba(249, 115, 22, 0.25)`（MainLayout） | 品牌橙 alpha | 进 tokens.shadow 或 --ws-brand-500 透明引用 |
| 登录页渐变 | `#1a1a2e→#0f3460` 深蓝（R1 观察） | 登录页例外 | 单独裁决（R1 观察项，未定） |
| 图表/echarts 色板 | Dashboard 内（R1 观察） | 例外 | P2 灰度评审定色板 |
| 头像渐变 | brand-500→accent（已规范） | ✅ 已 token | — |

> 例外 = **有注释 + 有唯一去处**，不是"可以随便写"。登记后仍应尽量升 token（上方"目标"列）。

## 5. 自查命令（AI 生成后 / 评审时跑）

```bash
# 业务代码裸色（应只出现在 #1/#2/#3 与例外登记处）
grep -rn --include='*.vue' --include='*.scss' -E '#[0-9a-fA-F]{3,8}|rgba?\(' apps/ | grep -v '\.css' | grep -v -E '--ws-|var\('

# 新增 !important
grep -rn '!important' apps/*/src packages/ui/src | grep -v theme.css

# hover 散写色（应只引用 --ws-bg-*）
grep -rn 'hover' apps/*/src --include='*.vue' | grep -E '#|rgba' | grep -v -- '--ws-'
```

---

*v0.1.2（2026-09-03 R5）：用户卡 hover 已按 §3 整改（深壳内白 6% 底 + 文字提亮，见评审记录 R5）；`bgActive` 已补、面板散写值已升 `--dc-panel-*`（R4）。*
