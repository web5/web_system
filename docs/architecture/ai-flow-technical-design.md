# AI 整体流程 · 技术方案（web_system）

> 状态：**待评审** ｜ 日期：2026-10-13 ｜ 基线：`master`（现状）
> 图示：`docs/architecture/ai-flow-diagrams.html`（AI 子系统架构图 / Agent 运行主链路 / 知识链路，脚本 `scripts/gen-ai-flow-diagrams.mjs` 生成，禁手改）
> 关联：`agent-system-design.md`（架构决策与缺口清单）、`agent-dev-t11-mindmap.md`（技能思维导图）、`multi-agent-design.md`（多 Agent 编排，设计中）、`system-overview.md`（系统现状单一真相源）
>
> 本文只描述**流程与技术方案**，不重复缺口清单；所有条目均可在代码中定位（见每节「事实来源」）。
> ⚠️ 口径：图上与文中的数据按 **master 现状** 绘制。凡「仅在分支 `feat/llm-tuning-multi-model` 上」的差异，均在该处显式标注（目前仅一处：生成参数透传，见 §3.2 #7）。

---

## 0. 一句话结论

AI 流程的本体是**「一次 ReAct 循环」**：代码负责骨架（意图路由 → 上下文装配 → `for step < maxSteps` 循环 → 终止判定），模型只负责叶子（这一步调哪个工具、说什么）。整条链路以 **SSE 事件流**对外表达，每一类事件都对应一个可观测的阶段；**降级点全部落在"不阻塞主对话"上**（意图路由失败 → 兜底 agent，落库失败 → 只影响下一轮）。

---

## 1. 范围与事实依据

| 环节 | 实现位置 |
|---|---|
| HTTP 入口 / SSE 编排 / 后置钩子 | `servers/ai-agent/src/agent/agent.controller.ts:122-348` |
| 意图路由编排 | `servers/ai-agent/src/agent/intent/intent.service.ts`（分类器 `packages/agent-core/src/core/intent-classifier.ts`） |
| ReAct 引擎与终止判定 | `packages/agent-core/src/core/agent-engine.ts:60-366` |
| 运行封装（runId） | `packages/agent-core/src/core/agent-runner.ts` |
| MCP 工具执行器 | `servers/ai-agent/src/mcp/mcp.service.ts`（`POST {MCP_GATEWAY_URL}/mcp/tools/call` + job 轮询） |
| 知识服务（RAG） | `servers/knowledge-service/src/knowledge/*`（`collections / documents / search / rag-eval`） |
| 普通对话链路 | `servers/ai-service/src/ai/ai.service.ts`（`chat` / `chatStream`） |
| 定义与日志 | `servers/ai-service/src/agent-def/*`、`agent-log/*` |

---

## 2. 架构：六层职责（图 1）

> 见图 `ai-subsystem-architecture.svg`

| 层 | 职责 | 关键约束 |
|---|---|---|
| 终端接入 | 消费 SSE：逐字渲染 + 过程卡片 | `admin-run` 需 `agents:debug`；C 端无此权限，不能绕过权限校验直刷对话 |
| 服务编排 | `ai-agent` 收请求、跑意图路由、管权限确认、落库 steps；`ai-service` 管定义 CRUD 与普通对话 | 定义变更走 `draft/published`，运行中不受影响 |
| 运行时核心 | `agent-core`：ReAct 循环 + 上下文装配 + `TelemetryPort` | **零依赖**：不依赖 Nest、不依赖 MCP SDK（MCP 由注入的 executor 承担） |
| 能力端口 | 本地工具 / MCP 工具 / 技能 / 知识，统一成一个 Tool 契约 | 一切皆插件：MCP 只是"远程 Provider" |
| 模型层 | `ClientRegistry` 三级回落 + 独立意图分类模型 | 加模型只改字典，不发版 |
| 数据与可观测 | 定义、运行日志、对话、知识库、成本 | 成本 = 字典单价 × usage |

---

## 3. 主链路：一次运行的 18 个阶段（图 2）

> ⚠️ **口径**：单 Agent 场景下可见 **15 段**（14 段 + 后置钩子 ✓），**不进入递归层**；只有工具解析为「子 Agent」且真的发起委派时，才展开第 12–15 段的「递归层」（条件进入）。图上以**青色虚线框**标注该层，日常单 Agent 运行可整段跳过。

> 见图 `ai-agent-run-flow.svg`

### 3.1 请求进入与意图路由

| # | 阶段 | 关键实现 |
|---|---|---|
| 1 | `POST /api/agent/run` | 响应头 `text/event-stream` + `no-cache` + `X-Accel-Buffering: no`（**必须禁 nginx 缓冲**，否则流被攒批） |
| 2-3 | 意图路由 + 下发 `intent` 事件 | 优先级：`@agentId` 显式 > 显式传入 > 会话锁定 > 规则(≥0.88) > LLM(≥0.75, 3s 超时) > 兜底；**`intent` 事件必须早于任何 token**，前端据此渲染 Agent 徽标 |
| 4 | 取定义快照 | ⚠️ 必须用**解析后**的 id 取快照；用 `dto.agentId` 在 `auto` 时静默取空 |

### 3.2 上下文装配与工具准备

| # | 阶段 | 关键实现 |
|---|---|---|
| 5 | 装配 messages | `system`（prompt + 技能目录）→ 历史摘要 → 长期 profile → 用户输入；profile 放在用户消息**之前**（离意图最近、权重最高） |
| 6 | 技能判定 | 有技能 → 追加技能目录 + 注入 `load_skill` 工具 |
| 7 | 生成工具 schema | 透传 `temperature`（**master 现状**：`agent-engine.ts:165` 只传 temperature，`agent.interface.ts` 仅有 `maxSteps + temperature?`）。`topP/maxTokens/thinking` 属 C7 变更，**仅在分支 `feat/llm-tuning-multi-model`**，合入前无此三项 |

### 3.3 ReAct 循环（`for step < maxSteps`）

| # | 阶段 | 关键实现 |
|---|---|---|
| 8 | 调模型（流式） | `content_delta` / `reasoning_delta` 逐字透传；`reasoning_delta` 不计入最终回答 |
| 9 | 判是否有工具调用 | 无 → 落库 +（有工具步骤则 `summary`）+ `final` + `onRunEnd(ok)` |
| 10 | 执行工具 | `tool_call` → 执行 → `tool_result`；**四类**：本地 / MCP（异步 job 轮询）/ `load_skill` / **子 Agent 委派**（第四类，见 §3.3.1） |
| 11 | 权限确认（HITL） | 写操作工具（`requiresConfirm`）→ `permission_request` 事件挂起 → 前端 `POST /agent/permission/:requestId`；**60s 超时自动拒绝**；确认者必须与发起者同一 userId。子 Agent 委派同样先过这道门 |
| 12–15 | 子 Agent 递归层（条件进入） | 工具是子 Agent 时展开一层子链路：护栏 → 子上下文 → 子循环 → 摘要，见 §3.3.1 |
| 16 | 结果回写 | tool 消息（或子 Agent 摘要）入上下文 → 回到步骤 8 再次推理；`onToolSpan(ok/latency)` 遥测 |

### 3.3.1 子 Agent 递归层（图 2 青色虚线框 · 设计中）

> 完整方案见 `multi-agent-design.md`；此处只描述**它在主链路里长什么样**。范式选 **Agent-as-Tool**：子 Agent 就是「第四类工具」，因此父循环的代码路径不改，递归层挂在第 11 步（权限确认）之后、第 16 步（结果回写）之前。

| 段 | 关键设计 | 为什么 |
|---|---|---|
| 入口 | 工具名解析为 `agent:<子 Agent ID>`（`CapabilityRef.type = 'agent'`，JSON 取值扩展，**零 DDL**） | 与普通工具共用同一条 `execute` 路径，引擎不必感知差异 |
| 护栏 | ① `depth ≤ 3` ② 调用栈去重（A→B→A 立即熔断）③ **全局步数预算跨层共享** ④ 权限取「父 ∩ 子」交集 | 缺一即失控：无限递归 / 循环烧钱 / 父子 `maxSteps` **相乘**放大成本 / 权限越界。任一不满足即短路返回错误，**不阻塞父循环** |
| 子上下文 | 只传「子任务描述」，**不继承**父的完整上下文 | 上下文隔离正是委派的收益；同时避免父上下文被撑爆 |
| 子循环 | 复用同一 ReAct 引擎与 `ToolRegistry`（`registerLazy` 按需拉起，不调不拉起） | 一套引擎支撑多层，不引入第二套控制流 |
| 摘要 | 子 run 末步**强制**产出结构化摘要（结论 + 关键证据，不回过程全量） | 不回摘要就会把父上下文撑爆，第二轮直接超窗 |
| SSE 口径 | 子链路过程事件**默认折叠**，对外只表现为父的一条 `tool_call` / `tool_result` | 否则事件流按层数翻倍，前端渲染与问题归因都失控 |
| 归因 | 子 run 落 `agent_runs` 并挂 `parentRunId` + `depth` | 多层失败可定位到「第几层第几步」 |

⚠️ **顺序铁律**：先落 P0（`agent_runs.outcome / fail_stage`），再上多 Agent。否则多层失败在当前埋点下完全不可见——只能看到「run 失败」，看不到是哪一层的哪个阶段失败。

### 3.4 终止与收尾

| 终止态 | 触发条件 | 对外表现 |
|---|---|---|
| ✅ 正常 | 模型无工具调用 | `final`（含 conversationId + usage）+ `onRunEnd(ok)` |
| ⚠️ 模型异常 | 调用抛错 / 空返回（`!content && !toolCalls`） | `error(MODEL_ERROR / MODEL_EMPTY)` + `onRunEnd(error)`；**不再把空 assistant 消息写进记忆**（曾污染上下文并渲染空气泡） |
| ⚠️ 超步数 | `step == maxSteps` | 先 `persist` 已产生的消息，再 `error(达到最大步数限制)` —— 不丢已有上下文 |

关闭流后（异步，不阻塞响应）：steps 流水落库 `agent_runs`（含 usage）、`post-run hooks`（用户记忆更新等）。

### 3.5 SSE 事件表

| 事件 | 含义 | 是否落 steps |
|---|---|---|
| `intent` | 路由结果（agentId / confidence / via / switched） | ✅ |
| `content_delta` / `reasoning_delta` | 逐字增量（可能上千条） | ❌（避免表膨胀） |
| `tool_call` / `tool_result` | 工具调用与结果 | ✅ |
| `card` | 结构化卡片（`present-music-card` 结果转出，语义在 controller 收口） | ❌（原始 `tool_result` 已落库） |
| `summary` | 多步工具链完成的总结 | ✅ |
| `final` | 最终回答 + usage | ✅ |
| `permission_request` | 高危操作待确认 | ✅ |
| `error` | 带错误码（`withCode` / `classifyError`），技术原文只进 run 落库 | ✅ |

---

## 4. 关键机制

### 4.1 意图路由（服务端解析 agentId）

- **候选集实时取自注册表**（`registry.list()`）：后台增删 agent 无需改代码发版。
- **路由线索实时生成**（`routingHints()`：id / name / description / keywords）：历史版本把线索写死在服务里，是 2026-09-28「100% 兜底」事故根因。
- **切换门槛**：`规则 ≥0.88`、`LLM ≥0.75` 才允许换 agent；兜底不切。
- **灰度开关 `INTENT_ROUTING_ENABLED` 默认关**：开关应与「后台 agent 配置完成并 publish」绑定上线，否则所有输入落兜底。
- **模型名必须与注册键逐字一致**（默认 `deepseek/deepseek-v4-flash`）：写短名不报错、只静默回退 hy3，表现为「偶发兜底」，极难定位。

### 4.2 上下文与记忆

| 机制 | 说明 |
|---|---|
| 历史摘要 | `memory.compaction` + `keepRecent`，按 `agent.memory` 配置 |
| 长期画像 | `loadProfile(userId)` 跨会话生效，作为 system 消息插在用户输入之前 |
| 落库时机 | 仅「产生最终回答」或「超步数」时 `persist`；中间步骤不落对话表 |
| 后置钩子 | `postRunHooks`（fire-and-forget）：对话结束后更新用户记忆，失败不影响结果 |

### 4.3 工具生态与执行

| 类型 | 注册方式 | 执行路径 |
|---|---|---|
| 本地工具 | 代码注册进 `ToolRegistry` | 进程内调用，统一 `ToolResult` |
| MCP 工具 | `agent-def-sync` 按定义装配 → `McpToolAdapter` 包装 | `POST {MCP_GATEWAY_URL}/mcp/tools/call` → 异步 job → `fetchJobStatus` 轮询 |
| 技能 | `load_skill` 内置工具按需挂载 | 引擎内置逻辑（不计入普通工具路径） |
| 子 Agent（设计中） | `CapabilityRef.type = 'agent'` → `resolveAgentCapabilities()` 解析 | 走 `ToolRegistry` 同一条路径；`registerLazy` 按需拉起，实际执行的是 §3.3.1 的递归层 |

> MCP 元数据里的 `requiresConfirm` 决定是否走人工确认（见 3.3 #12）。

### 4.4 模型可换（三级回落）

`ClientRegistry` 解析顺序：**DB 字典 `llm_models` → env `TOKENHUB_MODELS` → 代码内置**，60s 轮询刷新；未注册模型走 `getOrFallback`（不抛错）。
⚠️ 特例：`hy3` 由专用 client 承载，混入清单会被 apply() 跳过（不得用 TokenHubClient 注册 hy3）。

### 4.5 成本与遥测

- 引擎按步累加 usage（prompt / completion），随 `final`/`summary`/`error` 事件带出；
- `onLlmSpan`（模型调用）、`onToolSpan`（工具调用）、`onSkillLoad`、`onRunEnd` 构成过程 trace；
- `DictPricingProvider` 按字典单价换算 → `agent_runs.cost` → `run_metrics` 聚合。
- ⚠️ 口径缺口：thinking token 计价未定（字典只有 input/output 单价），思考消耗是隐形成本大头。

### 4.6 知识链路（RAG）

> 见图 `ai-knowledge-flow.svg`

1. **入库**：集合 → 文档 → 分块 → embedding → 落 `web_system_knowledge`。
2. **装配**：集合随 Agent 定义绑定，`agent-def-sync` 注册对应 MCP 工具；按集合操作的工具（`search/ingest/delete`）必须显式 `collectionId`，集合无关的（`list/status`）只要绑定 ≥1 个集合就注册。
3. **检索**：模型调 `knowledge_search` → `mcp-gateway :6006` → `knowledge-service /knowledge/mcp/search`（`InternalKey` 鉴权）→ topK（默认 5）上下文回写 → 继续推理。
4. **评测（离线）**：`POST /knowledge/mcp/eval` 跑 Ragas 三指标 —— `context_relevance` / `answer_relevance` / `faithfulness`，逐 case 打分后取均值。

⚠️ 两个待补：**召回率未测**（当前无混合检索 / rerank）、**用例集由请求体传入**（未沉淀为版本化 golden 集）。

---

## 5. 容错与降级矩阵

| 故障点 | 现状行为 | 缺口 |
|---|---|---|
| 意图分类超时 / 失败 | 回落兜底 agent，不阻塞对话 | 无：兜底即设计 |
| 会话锁定读写失败 | 按「未锁定」处理，继续本轮 | 无 |
| 模型调用失败 / 空返回 | `error(MODEL_ERROR/MODEL_EMPTY)` + run 落库 error；不写脏记忆 | 无**模型级 fallback**（换模型重试） |
| 工具执行失败 | `tool_result` 返回失败文案，模型继续推理 | 无重试退避；失败率只能靠 `onToolSpan.ok` 事后统计 |
| 权限确认超时 | 60s 自动拒绝 | 无：拒绝即安全侧默认 |
| 超步数 | 保存已产生消息后报错 | 无断点续跑（无 checkpoint） |
| 落库失败 | 不影响对话结果（日志告警） | 无重投队列 → 可能丢 trace |
| 检索无召回 | 模型基于空上下文作答 | ⚠️ **无「无据拒答」护栏**，有编造风险 |
| 子 Agent 护栏不满足（设计中） | 短路返回错误，父循环继续推理 | 无：护栏即安全侧默认；但**失败归因依赖 `fail_stage`（P0）** |
| 子 Agent 返回超长内容（设计中） | 末步强制摘要截断 | 需在协议里固化摘要长度上限，否则父上下文仍有撑爆风险 |

---

## 6. 可观测性：现在能答什么

| 问题 | 现在能答吗 | 依据 |
|---|---|---|
| 这次运行花了多少 token / 多少钱 | ✅ | `agent_runs` + usage + 字典定价 |
| 卡在哪个工具、耗时多少 | ✅ | `onToolSpan` |
| 走了哪条意图路由、是否切换 agent | ✅ | `intent` 事件 + `intent_history` |
| 这次答复**对不对** | ❌ | 无 `outcome`、无 golden 集 |
| 失败是检索没召回还是推理错 | ⚠️ 仅检索侧 | 有 Ragas 指标；Agent 任务级 `fail_stage` 缺 |
| 多层委派里是**哪一层哪一步**失败的 | ❌（设计目标） | 需 `agent_runs.parentRunId + depth + fail_stage` 三者齐备（见 §3.3.1 归因） |

---

## 7. 演进路线（与 `agent-system-design.md` §4 一致）

| 优先级 | 项 | 本方案中的落点 |
|---|---|---|
| **P0** | `agent_runs` 加 `outcome / fail_stage` + 阶段埋点 | §3.4 终止态与 §3.5 事件表已把「阶段」定义清楚，埋点直接挂在这三处终止 + 工具结果 |
| P1 | **先合入 C7**（`topP / maxTokens / thinking` 进 `agent_definitions` + 引擎透传，现仅在分支 `feat/llm-tuning-multi-model`）→ **再补调参 UI**（含 `?? 0.7` 修正） | §3.2 #7；master 现状只透传 `temperature` |
| P1 | ai-service 模型链路统一 | §4.4 三级回落，统一到同一 `ClientRegistry` |
| P1 | thinking token 计价 | §4.5 成本口径 |
| P1 | **多 Agent 编排（Agent-as-Tool）** | 主链路图已画出第四类工具与递归层（§3.3.1、图 2 青色虚线框）；完整方案见 `multi-agent-design.md`（含四道护栏与依赖顺序：须在 P0 之后） |
| P2 | 检索质量（召回率 → 混合检索/rerank → golden 集） | §4.6 知识链路 |
| P2 | 工具 schema 语义版本 | §4.3 工具生态 |
| P2 | HITL 编排级审批 | §3.3 #12 从工具级扩到编排级 |

---

## 8. 验收标准

1. **可复现**：按图 2 的 18 段（单 Agent 15 段，递归层条件进入）加日志，任一 `agent_runs` 记录能回放出完整阶段序列（含 intent / tool / usage）。
2. **不阻塞**：注入意图分类超时（>3s），对话仍能走兜底完成（P95 延迟增加 < 3.1s）。
3. **可止血**：某 agent 效果劣化时，后台改参数（不发版）30s 内生效。
4. **答案可判**：抽 20 条真实用例，能标出 `outcome` 与失败环节（依赖 P0 落地）。
5. **检索可量**：每条业务线的知识集合都能跑出召回率基线数字（现有 `/knowledge/mcp/eval` 即可产出）。

---

## 9. 关联文档

| 文档 | 用途 |
|---|---|
| `docs/architecture/ai-flow-diagrams.html` | 本方案的图（架构 / 主链路 / 知识链路） |
| `docs/architecture/multi-agent-design.md` | 多 Agent 编排方案（Agent-as-Tool，设计中；含四道护栏与依赖顺序） |
| `docs/architecture/agent-system-design.md` | 架构决策清单与缺口 P0→P2 |
| `docs/architecture/agent-dev-t11-mindmap.md` | 技能思维导图（价值 / 原理 / 实现三段） |
| `docs/architecture/system-overview.md` | 系统现状单一真相源（服务 / 端口 / 库） |
| `docs/api/contracts.md` §7 | Agent 生成参数与模型清单约定（C7-a…C7-h） |
| `docs/development/agent-capability-playbook.md` | 参数档位与运维口径 |
