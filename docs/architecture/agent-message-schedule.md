# Agent 消息计划表（SSE / HTTP）

> 状态：**待评审** ｜ 日期：2026-10-13 ｜ 基线：`master`（现状）
> 真相源：`packages/agent-core/src/interfaces/runtime.interface.ts` 的 `StreamEventType`（**11 项**，含全部载荷字段）
> 发送侧：`servers/ai-agent/src/agent/agent.controller.ts`、`packages/agent-core/src/core/agent-engine.ts`
> 关联：`ai-flow-technical-design.md`（主链路 18 段与事件时机）、`multi-agent-design.md`（多 Agent 消息，设计中）、`agent-system-design.md`（缺口清单）
>
> 本文是**消息清单的事实表**：每条消息都能在代码里定位到行。**改任何一个 `type` 或字段前先看 `docs/api/contracts.md` §1 C2 的契约变更纪律**（删/改成员会破坏 import 型消费方，历史踩过 TS2678 静默通过门禁的事故，见 `docs/api/reviews/sse-stream-contract-20260924.md`）。

---

## 0. 一句话结论

对外只有 **11 类流内消息 + 2 类 HTTP 消息**。三条硬规则撑起全部语义：

1. **`intent` 必须是本轮第一个事件**（早于任何 token）—— 前端据此渲染 Agent 徽标，也是排查路由误判的唯一入口；
2. **是否落 `steps` 由 controller 单点判定**：`content_delta` / `reasoning_delta` 是逐字增量（一轮可能上千条），只透传渲染，**不落库**（否则 `agent_runs` 表膨胀）；其余 9 类全落；
3. **`error` 必须带错误码**（`[CODE] 技术原文`）—— 服务端只归类，用户提示由客户端按码查表。

⚠️ 当前三个**未覆盖**：无心跳帧（长工具调用期间零字节，易被代理掐断）、无断流续传（无 `Last-Event-ID`，断流只能整轮重跑）、**小程序端未接 `permission_request`**（高危工具在小程序会一直挂起到 60s 自动拒绝）。详见 §6。

---

## 1. 传输约定

| 项 | 值 | 位置 / 说明 |
|---|---|---|
| 协议 | HTTP SSE（`POST /api/agent/run`） | `agent.controller.ts` `handleRun` |
| 响应头 | `Content-Type: text/event-stream` · `Cache-Control: no-cache` · `Connection: keep-alive` · **`X-Accel-Buffering: no`** | ⚠️ 少最后一条 = nginx 攒批，流式变一次性返回 |
| 帧格式 | `data: {JSON}\n\n`（**不带** `event:` / `id:` 标准字段） | 客户端按 `type` 分派，不用 EventSource 原生语义 |
| 鉴权 | `Authorization`（AuthGuard 穿透） | 无 userId → 401，不进流 |
| 心跳 / keepalive | ❌ **无** | 见 §6 N1 |
| 断流续传 | ❌ **无**（无 `Last-Event-ID`） | 见 §6 N2 |
| 关闭 | `res.end()` 由服务端单方面结束 | 之后仅异步落库 + 后置钩子 |

---

## 2. 消息计划表（流内 11 类）

「阶段」列对应主链路图 `ai-agent-run-flow.svg` 的段号。

| # | 消息 `type` | 阶段 | 触发条件（发送点） | 载荷字段 | 落 `steps` | 备注 |
|---|---|---|---|---|---|---|
| 1 | `intent` | 2–3 | 意图路由完成后立刻推（**controller:224**） | `intent{agentId, agentName?, confidence, via, switched?, previousAgentId?}` | ✅ | **必须早于任何 token**；`via: explicit\|locked\|rule\|llm\|fallback` |
| 2 | `content_delta` | 8 | 流式逐字（engine:172）；非流式 Agent 在末步一次性补发（engine:260） | `content, step` | ❌ | 最终回答正文增量 |
| 3 | `reasoning_delta` | 8 | 模型产出思考过程（engine:177） | `content, step` | ❌ | 不计入最终回答；UI 一般折叠 |
| 4 | `tool_call` | 10 | 模型返回工具调用（engine:295） | `name, args, step` | ✅ | 过程卡片起点 |
| 5 | `tool_result` | 10 | 工具执行返回（engine:324；技能分支 engine:397） | `name, content, step` | ✅ | 失败时 `content` = `工具执行失败: <原因>`，模型据此继续推理（**不抛错、不中断**） |
| 6 | `skill_load` | 6→10 | `load_skill` 挂载技能成功（engine:395） | `name`(技能 code), `content`(技能名), `step` | ✅ | 仅技能路径有，普通工具无 |
| 7 | `summary` | 13 | 本轮**有工具步骤**且模型不再调工具时（engine:267） | `content, step, usage` | ✅ | 文案：`已完成 N 步工具调用：A → B。\n结论预览：<前 150 字>…` |
| 8 | `final` | 13 | 正常结束（engine:274） | `content, step, conversationId, usage` | ✅ | ⭐ `conversationId` 是**会话续接**的唯一来源，漏传即每轮开新会话 |
| 9 | `error` | 17/异常 | ① `MODEL_ERROR`（engine:188）② `MODEL_EMPTY`（engine:204 / 236）③ 超步数（engine:341）④ controller 兜底（controller:316，`withCode(classifyError(...))`） | `content`(`` `[CODE] 原文` ``)，③④另带 `usage` | ✅ | 四种出口，客户端按**错误码**提示，技术原文只进日志 |
| 10 | `permission_request` | 11 | 工具执行期间调 `confirm()`（controller:258） | `requestId, content`(提示文案) | ✅ | 挂起工具执行等待确认；**60s 超时自动拒绝**（PermissionBroker） |
| 11 | `card` | 10 | `tool_result` 且 `name === 'present-music-card'` 且 content 可 JSON 解析（controller:285） | `card{kind, ...}, step` | ❌ | 原始 `tool_result` 已落库（内容即卡片 JSON），历史回看据此还原；`kind` 一期 `'music'` |

### 2.1 HTTP 侧消息（非流）

| 消息 | 方法 / 路径 | 载荷 | 返回 | 备注 |
|---|---|---|---|---|
| 发起运行 | `POST /api/agent/run` | `agentId`(可空/`auto`)、`userInput`、`conversationId?`、`model?`、`source?` | SSE 流 | `source='tool'` → 会话标记 tool，不进主对话列表 |
| 人工确认 | `POST /agent/permission/:requestId` | `{ approve: boolean }` | `{ ok: boolean }` | `ok=false` = requestId 不存在或**确认者 ≠ 发起者**（越权）；此时工具仍挂起到 60s 超时，见 §6 N3 |

---

## 3. 顺序不变式（硬约束，破坏即出 bug）

| 不变式 | 为什么 | 违反后果 |
|---|---|---|
| `intent` 早于任何 token | 前端先渲染 Agent 徽标，才知道"谁在回答" | 徽标闪变 / 无法排查路由误判 |
| `final` 之前必有（有工具时）`summary` | 过程收口 | 前端过程卡片缺总结 |
| `tool_call` 与 `tool_result` 成对 | 过程卡片开合 | 卡片卡在"执行中" |
| `card` 紧跟其对应的 `tool_result` | 富卡片补发语义 | 历史上曾只能"退出重进才看得到"卡片 |
| `error` 是本轮最后一条 | 流随即关闭 | 客户端状态机误判仍在流式 |

---

## 4. 错误码表（`packages/agent-core/src/core/agent-errors.ts`）

传输格式：`[CODE] 技术原文`；未带码的老格式由客户端 `inferCodeByText()` 兜底（前后端升级不同步时仍可用）。

| 码 | 含义 | 典型触发 |
|---|---|---|
| `NETWORK_TIMEOUT` | 网络超时 / 断连 | upstream timeout、ECONNRESET |
| `AUTH_EXPIRED` | 登录态失效 | 401 / token 过期 |
| `RATE_LIMITED` | 限流 | 429 |
| `MODEL_ERROR` | 模型调用失败 | 上游错误、超时（**最常见**） |
| `MODEL_EMPTY` | 模型返回空结果 | `!content && !toolCalls`（此时**不写记忆**，避免空气泡） |
| `AGENT_ERROR` | 工具 / Agent 执行失败 | tool / skill / mcp 相关异常文本 |
| `SERVER_ERROR` | 服务不可用 | 5xx、网关层 |
| `UNKNOWN` | 兜底 | 未匹配任何规则 |

> `classifyError` 按异常文本正则匹配，**取第一个命中**；所以文案里出现"模型/工具"类词会直接影响归类 —— 改文案要意识到它会被错误码规则消费。

---

## 5. 落库口径（`agent_runs.steps`）

落库由 controller 在**同一个循环**里判定，结构：

```jsonc
{ "type": "tool_call", "name": "xxx", "content": "...", "step": 2, "ts": 1739..., "usage": { "promptTokens": 1, "completionTokens": 2, "totalTokens": 3 } }
```

| 判定 | 消息 |
|---|---|
| ✅ 落（9 类） | `intent` / `tool_call` / `tool_result` / `skill_load` / `summary` / `final` / `error` / `permission_request` |
| ❌ 不落（2 类） | `content_delta` / `reasoning_delta`（逐字增量，量级大） |
| ❌ 额外记一条的 | `card` 不单独落；它对应的原始 `tool_result` 已含卡片 JSON |

`usage` 只在 `summary` / `final` / 部分 `error` 上，随 steps 落库 → `DictPricingProvider` 换算 `agent_runs.cost`。
⚠️ thinking token 计价未定（字典只有 input/output 单价），思考消耗是隐形成本大头。

**不在 SSE 里的内部遥测**（走 `TelemetryPort`，别当流消息查）：`onLlmSpan` / `onToolSpan` / `onSkillLoad` / `onRunEnd`。

---

## 6. 缺口与风险（按优先级）

| # | 级别 | 缺口 | 现状 | 建议 |
|---|---|---|---|---|
| N1 | **P1** | **无心跳帧** | MCP 工具 / 权限等待期间整条流零字节，中间代理（含 nginx proxy_timeout）可能直接掐断，表现为"跑到一半静默失败" | 工具执行期间定期写 `: keepalive\n\n`（SSE 注释帧，客户端自动忽略） |
| N2 | **P1** | **无断流续传** | 帧不带 `id:`，无 `Last-Event-ID`；断流只能整轮重跑（token 翻倍、用户等两次） | 至少发 `id: <step>`；续传属二期，先看是否值得（多数场景重跑即可） |
| N3 | **P1** | **`permission_request` 只有 admin 接了** | 小程序 `pages/chat/index` 处理了 `intent`/`card`，**没有 permission_request 分支** → 高危工具在小程序端静默挂起到 60s 自动拒绝 | 要么补 HITL UI，要么在服务端禁止 C 端 Agent 挂 `requiresConfirm` 工具 |
| N4 | P2 | **`ok:false` 不唤醒挂起** | 确认请求不存在 / 越权时返回 `{ok:false}`，但工具仍在 `await confirm()` 上挂着，直到 60s 超时 | 返回体区分"已处理/不存在/越权"，并考虑立刻 reject |
| N5 | P2 | **无 `runId` 对外暴露** | 内部 `onRunEnd` 有 `runId`，SSE 里没有任何一条消息带它 → 前端无法直接对到 `agent_runs` 记录排查 | `intent` 或 `final` 带上 `runId`（契约变更，走 C2 纪律） |
| N6 | P2 | **`intent` 无 admin 消费** | admin `AgentPlayground` 的 switch 无 `intent` case（走 default 兜底） | 调试台最需要看到路由结果，建议补 |
| N7 | P2 | thinking token 计价缺失 | 见 §5 | 字典加 thinking 单价 |

---

## 7. 消费方对照矩阵（⚠️ 一眼看缺哪端）

| 消息 | portal `api/agent.ts` | 小程序 `pages/chat/index` | admin `AgentPlayground.vue` |
|---|---|---|---|
| `intent` | ✅ :261 | ✅ :777（还据此铺翻译卡片骨架） | ❌（default 兜底） |
| `content_delta` | ✅ :262 | ✅ | ✅ :649 |
| `reasoning_delta` | ✅ :263 | ✅ | ❌（default 兜底） |
| `tool_call` | ❌ | ❌ | ✅ :658 |
| `tool_result` | ❌ | ❌ | ✅ :659 |
| `skill_load` | ❌ | ❌ | ✅ :660 |
| `summary` | ❌ | ❌ | ✅ :718 |
| `final` | ✅ :266 | ✅ | ✅ :685 |
| `error` | ✅ :270 | ✅ | ✅ :698 |
| `permission_request` | ❌ | ❌ | ✅ :712 |
| `card` | ❌ | ✅ :800（music 卡片） | ❌ |

> 读法：portal / 小程序是"只看结果"的 C 端形态（过程类事件不消费是合理的）；admin 是调试台，缺 `intent` 是实打实的盲点。**唯一异常是 `permission_request` 在 C 端无人接管**（N3）。

---

## 8. 多 Agent 时代的消息（设计中，尚未实现）

> 完整方案见 `multi-agent-design.md`；此处只约定**消息层**。

| 设计决定 | 内容 | 理由 |
|---|---|---|
| **折叠策略** | 子 Agent 链路**内部**的过程事件（`content_delta` / 子工具的 `tool_call`/`tool_result`）**不上浮**，对外只表现为父的一条 `tool_call` → `tool_result` | 否则事件流按层深翻倍，前端既渲染不清、也归因不了 |
| **委派语义事件** | 建议新增 `sub_agent_start`（父 runId / 子 agentId / depth / 子任务描述）与 `sub_agent_end`（子 runId / 摘要 / 耗时 / 是否触发护栏） | 复用 `tool_*` 对前端零改造，但丢失"这是委派"的语义（见 `multi-agent-design.md` §7.2） |
| **归因字段** | 子 run 落 `agent_runs` 并挂 `parentRunId` + `depth` | 多层失败要能定位到第几层第几步 |
| **顺序铁律** | 落地前先补 `agent_runs.outcome / fail_stage`（P0） | 否则多层失败只能看到"run 失败"，看不到哪层哪步失败 |

⚠️ 本期**不改任何代码**，上表为设计约定；真正实现时按 C2 契约变更纪律登记两个新 `type`。

---

## 9. 关联文档

| 文档 | 用途 |
|---|---|
| `docs/architecture/ai-flow-technical-design.md` | 主链路 18 段与事件时机（本文聚焦"消息本身"，那边聚焦"流程"） |
| `docs/architecture/multi-agent-design.md` | 多 Agent 委派链路与 §7.2 前端事件建议 |
| `docs/api/contracts.md` §1 C2 / §7 / §8 | SSE 契约变更纪律、生成参数、漂移清单 |
| `docs/api/reviews/sse-stream-contract-20260924.md` | 上一次 SSE 契约漂移修复的评审报告（含机检 R16） |
| `docs/architecture/agent-system-design.md` | 缺口清单 P0→P2 |
