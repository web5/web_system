# 页面规格书 · 大橙子个人助理小程序（#4 首页改造 + #7 对话 markdown）

> 建：2026-11-10
> 方案真源：`30-任务产物/2026-11-10-小程序人工测试问题第二轮/01-首页与markdown改造方案.md`
> 参考实现：`apps/kedou-ai-minigram/`（同仓科豆 AI 小程序，橙色系 → 大橙子蓝色系）

## 范围

两项前端增量，均**不改 app.json**、**不新增 npm 依赖**、**不改后端接口**：

| # | 需求 | 方案 |
|---|---|---|
| #4 | 首页参考科豆 AI 首页 | 方案 A 增量对齐：保留现有骨架，新增「今日一句」+ 把「最近使用」空态升级为真实「最近对话」卡片 |
| #7 | 对话气泡 markdown 渲染 | 方案 A 移植科豆自研 rich-text 渲染器（`utils/markdown.ts`，零依赖） |

## 页面清单

| 页面 | 路径 | 文件 | 说明 |
|---|---|---|---|
| 首页 | `pages/home/index/index` | `index.wxml` / `index.ts` / `index.wxss` | 问候 hero 后新增「今日一句」；「最近使用」→「最近对话」三态卡片 |
| 对话页 | `pages/chat/index/index` | `index.wxml` / `index.ts` | 普通气泡 AI 回复由 `<text>` 改 `<rich-text nodes>` markdown 渲染 |

## #4 首页改造（方案 A · 增量对齐）

问候语保留「下午好」，不改成 Hello.；今日一句本轮不加「换一句」；不做长文本折叠/复制；全程走 `app.wxss` 蓝色 token，不引入科豆橙。

### 交互判据

| # | 判据 | 实现 |
|---|---|---|
| H1 | 今日一句同天稳定、隔天换 | 新增 `utils/daily.ts` `getDailyQuote()`：本地 7 条文案池按本地日期序数取模（同科豆 `daily.ts`） |
| H2 | 最近对话三态 | data 增 `recent` / `recentLoading`；`loadRecent()` 渲染三态：骨架 `.sk` / 有会话卡片 / 空态（保留原文案） |
| H3 | stale-while-revalidate | 本地缓存键 `welcome_recent_cache` 秒显；后台 `listConversations(1,1)` 取最近会话 + `getConversation(id)` 取最后一条预览（≤60 字），成功写回缓存 |
| H4 | 未登录不发请求 | `loadRecent()` 先判 `isLoggedIn()`，未登录直接空态（退出登录已由 auth 清缓存） |
| H5 | 点卡片恢复会话 | `openConv()` → `wx.navigateTo('/pages/chat/index/index?conversationId=<id>')`（复用现有 `conversationId` 路由参数） |

### 验收判据

| # | 判据 | 通过标准 |
|---|---|---|
| H-V1 | 今日一句稳定 | 同一天多次进出文案一致 |
| H-V2 | 最近对话三态 | 无会话空态；有会话显示最近一次（标题 + 预览 ≤60 字 + 时间）；加载中骨架占位不跳变 |
| H-V3 | 二次秒显 | 二次进入先读本地缓存，后台刷新 |
| H-V4 | 点卡片聚焦 | 进入对话页并聚焦该会话最新一条 |
| H-V5 | 能力入口回归 | 翻译 / 新概念英语 / 新对话入口点击可达；未登录仍走「先登录」引导；合规两行保留 |

## #7 对话气泡 markdown 渲染（方案 A · 移植科豆自研渲染器）

### 渲染器

`utils/markdown.ts` 移植科豆 ~300 行 `mdToNodes(md) → rich-text nodes` + `mdToPlain(md) → 纯文本`，仅改硬编码色值（科豆橙 → 大橙子蓝）：

| 常量 | 科豆值 | 大橙子值 |
|---|---|---|
| `brand` | `#F97316` | `#3B82F6` |
| `brandTxt` | `#EA580C` | `#2563EB` |
| `codeText` | `#C2410C` | `#1D4ED8` |
| `quoteBg` | `rgba(249,115,22,0.06)` | `rgba(37,99,235,0.06)` |

其余常量（`t1` / `t2` / `codeBg` / `line`）不变；渲染逻辑一条不改。

四条硬约束原样保留：① 色值硬编码（rich-text 是 webview 隔离渲染，拿不到页面 CSS 变量）；② 单位用 px 不用 rpx（内部按 `wx.getSystemInfoSync().windowWidth` 做 rpx→px，jsdom 下单测回退 375）；③ nodes 是对象数组非 HTML 字符串（`<>&` 按纯文本，天然无 XSS）；④ 流式友好（未闭合 `**` / `` ` `` / `[` 原样输出、未配对 ``` 围栏按普通段落）。

### 交互判据

| # | 判据 | 实现 |
|---|---|---|
| M1 | 气泡改 rich-text | 普通气泡 AI 回复 `<text class="bub-text">` → `<rich-text nodes="{{item._nodes}}">`，流式光标 `.caret` 保留在 rich-text 旁；用户消息 / 失败态仍走 `<text>`（蓝底白字 / 红字，保可读、不回归） |
| M2 | nodes 生成在页面层 | `withMdNodes(msgs)` 放 `chat/index.ts`；`utils/chat-msg.ts` 仅加 `_nodes?: any[]` / `_mdSrc?: string` 字段，保持「不 import wx / services」裸跑约束 |
| M3 | 流式增量重算 | `patchAi` 在 `patch.text` 变化时顺带重算 `_nodes`（路径级 setData，不全量序列化） |
| M4 | 全链路过渲染 | 历史 `loadHistory` / 种子 `buildSeedBubbles` / 入列 / `onReply` 最终气泡统一过 `withMdNodes` |

### 验收判据

| # | 判据 | 通过标准 |
|---|---|---|
| M-V1 | markdown 语法 | 加粗 / 标题 / 列表 / 代码块 / 表格 / 链接 / 行内代码 / 引用 / 分隔线均正确排版 |
| M-V2 | 流式降级 | 未闭合 `**` / `` ` `` / `[` 原样输出不吞字；未配对 ``` 不误判为代码块 |
| M-V3 | 无 XSS | 文本含 `<>&`、`<script>` 按纯文本渲染 |
| M-V4 | 单测 | 移植 `tests/markdown.test.ts`（含 `assertNoBareString` 守「children 无裸字符串」）全绿 |
| M-V5 | 回归 | 翻译卡气泡（`item.card`）交互（#3）与顶部导航（#5）不受影响 |

## 工程门禁状态

- ✅ 本页规格为 **Proto commit**（只含 specs/），后续 UI 落码另 commit 并带 `Proto: <本 commit sha>` + `Design: pass`（设计评审真源即上文方案文档）。
- ⚠️ 微信开发者工具真机目视仍待人工（今日一句 / 最近对话三态 / markdown 气泡排版 / rich-text 与光标同行），不因单测全绿视为已验收。
