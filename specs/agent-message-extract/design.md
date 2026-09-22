# 对话消息处理抽离复用 · 设计文档

> 状态：方案定稿，待实现。2026-09-22
> 目标：把「AI 对话消息处理」从 portal 私有抽成跨端可复用能力，覆盖 **portal / admin（Vue）** 与 **小程序（原生 WXML）**。

## 1. 背景与目标

- portal 已有一份 `apps/portal/src/utils/answer-parse.ts`（纯函数：`parseAnswer` 把 agent 纯文本流解析成 `AnswerBlock` 块 `p/h/ol/ul/law/code/tcard`），渲染在 `AiChat.vue`，`code` 块由新组件 `AnswerCode.vue` 承担（本轮已加）。
- admin 端 `AgentPlayground.vue` 目前是纯文本 `pre-wrap` + 过程卡片，**没有 blocks 解析**；小程序 chat 页是原文直显 + 翻译卡片 + 音乐卡片，`utils/translate-parse.ts` 只是翻译专用解析。
- 三端存在**重复同义**函数（`parseSections / stripTitles / looksLikeTranslateReply` 在 portal 与小程序各有一份）。
- 目标：① 纯逻辑抽到独立零依赖包，三端共用一份真源；② Vue 渲染组件收敛到 `@web-system/ui`，portal/admin 复用；③ 小程序通过构建链真正引用共享逻辑，并补 blocks 的 WXML 渲染。

## 2. 现状（已摸清）

| 端 | 技术栈 | 消息渲染 | 解析函数 |
|---|---|---|---|
| portal | Vue 3 + vite | blocks → `AiChat.vue` + `AnswerCode.vue` | `answer-parse.ts`（含 code 块） |
| admin | Vue 3 + antd + vite | `AgentPlayground.vue` 纯文本 pre-wrap + 过程卡片 | 无 |
| 小程序 | 原生 WXML + 微信开发者工具内置 TS 编译 | 原文直显 + 翻译卡 + 音乐卡 | `translate-parse.ts`（翻译专用） |

关键约束（实测/代码注释确认）：
- 小程序原生模块系统**加载不了 workspace 包**（`utils/constants.ts` 有注释记录：require 时报 `module not defined`）。
- 小程序 `build` 脚本是空壳（`echo`），无独立构建链；tsconfig `paths` 仅用于类型检查。
- `pnpm-workspace.yaml` 已含 `packages/*`，新建包自动纳入 workspace。
- `@web-system/ui` 组件采用「子路径源码直引」（vite alias 到 `packages/ui/src/...`）；`@web-system/shared` 前端也在用（`API_TIMEOUT` + 类型）。

## 3. 总体方案（分层）

```
┌─────────────────────────────────────────────────────┐
│ 渲染层（分端，不复用）                                  │
│  portal: AiChat.vue + AnswerCode/AnswerBlocks（ui 包）│
│  admin : AgentPlayground.vue + AnswerCode（ui 包）     │
│  小程序: chat/index.wxml 的 blocks 模板 + WXML 组件    │
├─────────────────────────────────────────────────────┤
│ 纯逻辑层（三端复用，唯一真源）                          │
│  packages/agent-message（零依赖纯 TS）                 │
│  parseAnswer / foldCut / boldSegs / parseSections …   │
└─────────────────────────────────────────────────────┘
```

## 4. 新包 `packages/agent-message` 设计

- `package.json`：`@web-system/agent-message`，`private: true`，**零 dependencies**；`build` = `tsc && tsc -p tsconfig.cjs.json`（对齐 `packages/types` 的 ESM + CJS 双产物，CJS 供小程序 require）。
- 目录与导出（`src/index.ts` 统一导出）：

| 模块 | 内容 | 来源 |
|---|---|---|
| `types.ts` | `AnswerBlock`（p/h/ol/ul/law/code/tcard）、`BoldSeg`、`ParseOptions` | portal answer-parse |
| `parse.ts` | `parseAnswer`、`splitFences`、`parsePlain`、翻译卡 `parseTranslateCard`/`splitLeadingLatin` | portal answer-parse |
| `inline.ts` | `boldSegs`、`stripInline` | portal answer-parse |
| `fold.ts` | `foldCut`、`plainLength` | portal answer-parse |
| `translate.ts` | `parseSections`、`stripTitles`、`looksLikeTranslateReply`、`inferDirection` | portal 与小程序 **合并收敛** |
| `index.ts` | 上述全量 re-export | — |

### 函数收敛映射（去重）

| 统一后（agent-message） | portal 原 | 小程序原 | 处理 |
|---|---|---|---|
| `parseSections` | `parseSections` | `parseSections` | 语义一致，取一 |
| `stripTitles` | `stripTitles` | `stripTitles` | 语义一致，取一 |
| `looksLikeTranslateReply` | 同 | 同 | 语义一致，取一 |
| `inferDirection` | `inferDirection` | `inferTranslateDirection` | 合并，保留更全的规则 |
| — | — | `buildTranslateCardView`、`splitSpeakChunks` | **小程序专用，不抽**（涉及 WXML 视图字段与平台 TTS） |

## 5. 三端接入方案

### 5.1 portal（低风险，纯引用替换）
- `apps/portal/src/utils/answer-parse.ts` 改为薄 shim：`export * from '@web-system/agent-message'`（保留 `@/utils/answer-parse` 引用路径不变，避免大范围改 import）；后续可逐步直接改 `AiChat.vue` 的 import。
- vite alias：`@web-system/agent-message` → `../../packages/agent-message/src/index.ts`（源码直引，与 shared/ui 一致）。

### 5.2 admin（UI 实质改动，走 ui-interface 动作门）
- `AgentPlayground.vue` 的 `content_delta/final` 累计的 content 用 `parseAnswer` 解析成 blocks，渲染由 pre-wrap 改为 blocks 模板（复用 `@web-system/ui` 的 `AnswerCode`/`AnswerBlocks`）。
- `AnswerCode.vue` 从 portal 迁到 `packages/ui/src/components/`，portal/admin 共用（token 用 `--ws-*`，两端均已引入 `tokens.css`）。

### 5.3 小程序（构建链 + WXML，走 brand-interface 动作门）
- **构建链（B1）**：新增 `apps/kedou-ai-minigram/scripts/build-vendor.mjs`，用 tsc 把 `packages/agent-message` 编译为 CJS 产物并拷贝到 `apps/kedou-ai-minigram/vendors/agent-message/`（含 `index.js` + `index.d.ts`）；挂到小程序 `build` 脚本前。零依赖，tsc 即可，不引 esbuild。
- 小程序源码用**相对路径** import/require `vendors/agent-message`（绕开包名解析，这是踩过的坑），tsconfig `paths` 同步映射供类型检查。
- chat 页 WXML 补 blocks 渲染（每个块类型一段 WXML 节点），复用共享 `parseAnswer` 产出的块结构；翻译卡/音乐卡保留现有组件。

## 6. 影响清单与分期

### P0 纯逻辑抽离（纯 TS，无 UI 视觉变化，不受 UI 门）
- 新建 `packages/agent-message/`（package.json / tsconfig / tsconfig.cjs / src 6 文件 / jest 迁移）。
- portal `answer-parse.ts` 改 shim + vite alias；删 portal 本地解析实现。
- 小程序 `translate-parse.ts` 的重名函数改为 re-export（先保持 `buildTranslateCardView/splitSpeakChunks` 本地）。
- 迁移/补 jest 测试（portal 现有 translate-parse.test.ts 对齐）。

### P1 admin 接入 blocks 渲染（UI 门，原型先行）
- 原型：admin `AgentPlayground` 的对话结果区加 blocks 形态（含 code 块）。
- `AnswerCode`/`AnswerBlocks` 迁 `packages/ui`，portal + admin 共用。
- `AgentPlayground.vue` 接 `parseAnswer`。

### P2 小程序构建链 + WXML blocks（UI 门，原型先行）
- `build-vendor.mjs` + `vendors/` 产物 + tsconfig paths。
- chat 页 WXML blocks 模板 + 相对路径引用。

## 7. 风险与待验证

- **小程序 CJS 产物的相对路径 require**：微信开发者工具对「TS 源码相对 import 一个 CJS 产物」的处理需实测（P2 首件验证项，失败则改用产物直接拷成单文件 + 小程序 require 单入口）。
- **admin `--ws-*` token 覆盖度**：已确认 admin 多页与 `main-standalone.ts` 引入 `tokens.css`，`AnswerCode` 迁过去可用；接入时抽查 `--ws-bg-subtle/--ws-radius-md` 是否齐。
- **portal shim 兼容**：`AiChat.vue` 仍 import `@/utils/answer-parse`，shim 保证不改 AiChat 即可切真源。
- **发布流水线**：`packages/*` 是否被发布流水线构建（与 `packages/types` 同链路）；前端 vite alias 源码直引，不受 dist 影响，但小程序依赖 CJS 产物，需在构建链里保证产物新鲜。

## 8. 待确认（实现前）

- P1/P2 的 UI 改动分别走各自动作门（ui-interface / brand-interface），原型先行 + 人审，与本设计文档并行。
- 是否 P0 先单独落地（纯逻辑抽离 + portal shim + 测试），验证共享包可被三端类型检查通过后再动 P1/P2。
