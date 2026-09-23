# 页面规格 · AI 回答 blocks 渲染（admin + 小程序）

> 主题：把 agent 返回的 markdown 纯文本解析为结构化块渲染，解决 ``` 代码围栏被当纯文本直出的问题。
> 解析真源：`packages/agent-message`（`parseAnswer`，块类型 p/h/ol/ul/law/code/tcard）。
> 原型：admin `docs/ui/prototypes/admin-agents.html`（Agents 模块框架稿，Playground 屏）；小程序 `apps/kedou-ai-minigram/prototype/index.html`（演示入口「对话 · markdown 代码块（blocks 渲染）」）。
> code 块视觉（2026-09-22 二轮修订）：**深色代码块**——浅色页面里的深底代码块（Notion / ChatGPT 同款语言），替换纯灰底；三端（portal / admin / 小程序）统一。
> 容器与文字基线（2026-09-22 三轮修订，参考 Vercel / Geist 设计语言）：AI 回答容器**不用灰底填充**——admin 改白底 + 1px 细边框 + 8px 圆角 + 极淡阴影（portal / 小程序本就白底，保持通透不加边框）；
> 正文**不用纯黑**，改柔和深灰 `--text-body:#3F3F46`，仅强调（结论先行 / 小标题 / 加粗）用 `--text-strong:#18181B`；正文 14px / 行高 1.75。

## 一、admin · Agent Playground（Quick）

- 页面/组件：`apps/admin/src/views/Agents/AgentPlayground.vue`
- 类型与参照：不变（原页面）；仅改 assistant 消息的内容渲染，用户气泡 / 过程卡片 / Debugger 面板不动。
- 改动内容：AI 气泡 `content` 经 `parseAnswer` 解析为 blocks 后按块渲染（`p`·`p.lead`、`h`、`ol/ul`、`law`、`code`、`tcard`）。
- 涉及 Token：`--ws-*`（blocks 与 portal 同源）+ **新增 `--ws-code-bg` / `--ws-code-hd` / `--ws-code-text` / `--ws-code-hd-text`**（code 块深色方案；light `#1C1E26/#16181F/#E2E8F0/#A5ACBA`，dark `#17181D/#121318/#D4D4D8/#8B90A0`）+ **新增 `--ws-text-body:#3F3F46` / `--ws-text-strong:#18181B`**（正文柔和深灰 / 强调近黑；dark 对应 `#D4D4D8` / `#F4F4F5`）——**落码前四项新色均须入 `packages/ui/src/tokens.ts` + `tokens.css` 双文件（light/dark 双主题）**。
- 交互影响：code 块新增「复制」（复制围栏体原文）；流式未闭合 ``` 围栏降级纯段落，不吞内容。
- 复用：解析 `@web-system/agent-message`；code 组件 `@web-system/ui/components/AnswerCode.vue`（portal/admin 共用，深色样式随组件迁移）。

## 二、小程序 · chat 页对话气泡（Quick）

- 页面/组件：`apps/kedou-ai-minigram/pages/chat/index/index.wxml`（对话 AI 气泡）
- 类型与参照：不变（原对话页）；仅 AI 气泡从「原文直显」升级为 blocks 渲染。
- 改动内容：AI 消息 `text` 经 `parseAnswer` 解析为 blocks，WXML 按块类型渲染（`p`/`h`/`ol`/`law`/`code`）；翻译卡 / 音乐卡保留现有组件分支。
- 涉及 Token：`--brand` / `--brand-soft` / `--brand-txt` / `--line` / `--t1~t3` + 新增 `--code-bg` / `--code-hd` / `--code-text` / `--code-hd-text`（code 块深色方案，与 portal `--ws-code-*` 同值；light `#1C1E26/#16181F/#E2E8F0/#A5ACBA`，dark `#17181D/#121318/#D4D4D8/#8B90A0`）+ 新增 `--text-body:#3F3F46` / `--text-strong:#18181B`（dark `#D4D4D8` / `#F4F4F5`）；落码时同步 `app.wxss` token 层。
- 交互影响：code 块「复制」用 `wx.setClipboardData`；流式未闭合围栏降级纯段落。
- 复用：解析 `@web-system/agent-message`（经构建链 `vendors/agent-message` 产物，相对路径引用）。

## 三、状态覆盖自查

- [x] 流式截断（未闭合围栏）→ 降级纯段落，不吞内容
- [x] code 块复制成功/失败反馈（admin `message` / 小程序 toast）
- [x] 空内容 → `parseAnswer` 返回空数组，气泡按原空态处理
- [x] 失败态（error/aborted）→ 维持现有错误内联展示，不进 blocks

## 四、风险/待澄清

- 小程序构建链（`build-vendor.mjs` → `vendors/agent-message` CJS 产物 + 相对路径 require）为本轮 P2 首件验证项：微信开发者工具对「TS 源码相对 import CJS 产物」的处理需实测，失败则改单文件产物 + `require` 单入口。
- admin `AnswerCode` 迁 `@web-system/ui` 后需确认 `--ws-bg-subtle`/`--ws-radius-md` 等 token 在 admin 已注入（已确认 admin 引入 tokens.css，落码时抽查 dark 主题）。
