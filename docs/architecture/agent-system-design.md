# Agent 系统架构设计 · web_system（维度 → 架构 → 实现）

> 状态：**待评审（v2）** ｜ 日期：2026-10-13 ｜ 盘点基线：**分支 `feat/llm-tuning-multi-model`**（worktree `/Users/geekwen/workspace/web_system-llm-tuning`，**尚未合入 master**）
> 视角：T11 架构师三层递进 —— **维度（要回答什么）→ 架构（结构长什么样）→ 实现（用什么技术填）**
> 姊妹文档：`docs/architecture/agent-dev-t11-mindmap.md`（技能思维导图）、`kedou-architecture-diagrams.html`（业务 / 技术架构图）、`ai-flow-technical-design.md`（AI 主链路）、`multi-agent-design.md`（多 Agent，设计中）
> **v2（同日复核）**：更正 v1 关于 RAG 与评测的两处结论（详见 §0.6），缺口清单与工作量随之调整。
>
> ⚠️ **基线口径**：本文按上述**分支**代码盘点。凡与 `master` 现状不同的条目，均在该处标注「**仅分支**」——目前集中在 **C7 调参三项**（`topP / maxTokens / thinking`；master 只透传 `temperature`，实体亦无此三列）与 **ai-service 的 ModelCatalog**。落码前请先核对自己所在分支。
>
> 本文档只做架构设计与现状盘点，**不改任何代码**。文中标注缺口/目标处均为尚未实施项，落地时须按对应动作门执行（见 §4）。

---

## 0. 一句话结论

web_system 的 Agent 底座（`packages/agent-core` + `ai-agent` + `ai-service` + `knowledge-service`）**承重层基本成型、易变层已完成配置化、可换层一半成型**，最大缺口在**质量与评测**：检索侧已有 Ragas 三指标离线评测，但 **Agent 任务层面**只有成本归因、没有**结果归因**（`agent_runs` 无 `outcome`），导致"任务完成准确率"这个一等决策在本系统里**无法被度量**。建议按 §4 的 P0 → P1 → P2 补齐。

---

## 0.5 事实依据（全部来自本仓库代码，非记忆）

| 事实 | 文件 |
|---|---|
| 引擎是 **ReAct 循环**（单 Agent 闭环） | `packages/agent-core/src/core/agent-engine.ts:1-11` |
| 生成参数已透传 temperature/maxTokens/topP/thinking（**仅分支**：master 只传 `temperature`，`agent-engine.ts:165`） | `agent-engine.ts:164-171`（分支） |
| 定义实体**已有** maxTokens/topP/thinking（含互斥注释）（**仅分支**：master 实体无此三列） | `servers/ai-service/src/agent-def/entities/agent-definition.entity.ts:66-86` |
| **三级回落** DB → env → 内置，60s 轮询 | `servers/ai-agent/src/agent/model-catalog.service.ts:48-52,75` |
| `hy3` 由专用 client 承载，清单混入需跳过（否则覆盖注册） | `model-catalog.service.ts:156-167` |
| ai-service Agent 链路已有同款 ModelCatalog（2026-10-10 新增）（**仅分支**：master 该路径无此文件） | `servers/ai-service/src/agent/model-catalog.service.ts` |
| 但 `ClientRegistry` Provider **仍硬编码** Hy3 + deepseek-v4-flash 作初始值 | `servers/ai-service/src/agent/agent.module.ts:32-36` |
| 普通 chat 链路另有一套自研 client + 独立 key | `servers/ai-service/src/ai/ai.service.ts:27-37`、`src/common/http/hy3.client.ts` |
| 遥测端口 5 类事件（run / llm / tool / skill / end） | `agent-engine.ts:22,72-88,102,231,293` |
| 工具级 Human-in-the-loop 有雏形（`confirmHandler`） | `agent-engine.ts:94,323` |
| 记忆：压缩配置 + 长期 profile 均已落地 | `agent-definition.entity.ts:88-94`、`agent-engine.ts:127-132` |
| 版本快照 / draft-published / enabled / DB 优先 | `agent-definition-version.entity.ts`、`agent-definition.entity.ts:13,100-110` |
| 成本：字典价 → `agent_runs.cost` → `run_metrics` 聚合 | `dict-pricing.provider.ts`、`run-metrics.entity.ts`（`total_cost`） |
| **`agent_runs` 结果归因（B0，2026-10-20 已落地）** | `outcome` / `fail_stage` / `graded_by` / `graded_at` 四列已加（迁移 `archive/migrations/p36-agent-runs-outcome.mjs`）；推导收口在 `AgentLogService.deriveAttribution`——按 error 事件的 `[CODE]` 前缀（agent-core `withCode`）映射 `fail_stage`，B0 只产出 `graded_by='rule'`；**历史行不回填**，保持 NULL = 未判定 |
| **RAG 由独立服务承载（v2 更正）** | `servers/knowledge-service`（:6011）已实现集合 / 文档 / embedding / 检索 / Ragas 离线评测；经 `knowledge.internal.controller.ts` 暴露 `knowledge/mcp/*`，由 mcp-gateway 以 MCP 工具装配进 Agent（`ai-agent/src/agent/agent-def-sync.service.spec.ts` 为装配规则的回归用例） |

### 0.6 盘点更正记录（v2，2026-10-13 同日复核）

| v1 结论 | 事实 | 更正后口径 |
|---|---|---|
| 「agent-core 无 RAG / KB 子系统，知识全压 `systemPrompt`」 | RAG 不在 `packages/agent-core` 里，而在独立服务 `knowledge-service`（6011），并通过 MCP 工具进 Agent | **RAG 已建成**（独立服务形态，比内嵌在 core 更符合"可换层"设计）；缺口在**召回质量与评测覆盖**，不是"整块缺失" |
| 「评测体系：无」 | `rag-eval.service.ts` 实现 Ragas 三指标（context_relevance / answer_relevance / faithfulness） | **KB 问答链路有离线评测**；缺口收窄为「Agent 任务级 outcome 与业务线 golden 集」 |
| 「`agent_runs` 无结果归因」（v2 列为最大架构债） | B0（2026-10-20）已补 `outcome` / `fail_stage`，落库侧不再缺 | 缺口收窄为「**业务线 golden 集 + 离线 LLM 评测**」——`graded_by='auto_llm_judge'` 与 `score` 尚未落地（B4） |

> 教训（已进记忆）：`grep` 的作用域决定结论的作用域 —— 只在 `packages/agent-core` 里搜 RAG，得到的是"core 内没有"，而不是"系统没有"。盘点跨服务能力时必须全仓搜。

---

## 1. 维度层：8 个维度在 web_system 的判据

| # | 维度 | 本项目要回答的问题 | 现状判据（代码事实） | 结论 |
|---|---|---|---|---|
| 1 | **能力边界** | Agent 能做什么由谁声明 | `capabilities`（tool / mcp / skill 统一引用）+ `load_skill` 按需挂载 | ✅ 已由定义显式声明，边界清晰 |
| 2 | **可靠性** | 失败能否归因到环节 | 有错误码、空结果/超步数显式判失败；但**仅 process 成败，无 answer 正确性** | ❌ **最大缺口**，见 §2 承重层 |
| 3 | **成本** | 单 run 真实成本 | `DictPricingProvider` 字典价 → `agent_runs.cost` → `run_metrics.total_cost` | ⚠️ 有，但 thinking token 计价口径待确认（字典仅 input / output price） |
| 4 | **可控性** | "下一步"谁决定 | ReAct：模型决定调什么工具，但 `maxSteps` 硬上限 + 工具级 `confirmHandler` | ⚠️ 有雏形，**缺编排级审批节点** |
| 5 | **可演化** | 加模型 / 改参数能否不发版 | ai-agent 三级回落已完善；ai-service Agent 链路已接字典但 Provider 仍留硬编码初始值；普通 chat 链路独立 | ⚠️ 半成型 |
| 6 | **安全合规** | 自主调用时的权限边界 | 项目级 `InternalGuard` + 权限码体系在 | ❌ Agent **自主**调用时的能力授权收敛未定义 |
| 7 | **可观测** | 出问题能否定位 | `TelemetryPort` 5 类事件 + 成本归因 | ⚠️ 过程可观测已有，**质量不可观测**缺失 |
| 8 | **可交付** | 定义变更可灰度可回滚 | 版本快照 + `draft/published` + `enabled` 下线开关 | ⚠️ 定义可回滚已有，**工具 schema 无语义版本** |

---

## 2. 架构层：4 层在 web_system 的位置与缺口

### 2.1 承重层（改一次伤筋动骨）

| 决策 | 本系统现状 | 缺口 |
|---|---|---|
| **架构范式** | 定为 **单 Agent ReAct 闭环**（`AgentEngine` 明确注释 ReAct） | ⚠️ 多 Agent 编排未铺开 —— 扩之前需预留子 Agent 注册 + 消息总线 |
| **控制流所有权** | 代码定骨架（for 循环 + maxSteps + 错误判别），模型填叶子（调哪个工具） | ⚠️ HITL 止步于工具级 `confirmHandler`，**无编排级审批** |
| **状态与记忆** | `memory`（compaction / keepRecent）+ 长期 profile 已落地 | ❌ **无 checkpoint**（中断不可续跑）；多步重算上下文 = 隐性成本 |
| **安全边界** | 项目级 guard 在 | ❌ Agent 自主调用的能力授权未收敛（爆炸半径未定义） |
| **质量与评测** ⭐ | 仅成本归因，无结果归因；检索侧另有 Ragas 离线评测 | ❌ **Agent 任务层整块缺失**：`agent_runs` 无 `outcome/fail_stage`；无业务线 golden eval 集 |

### 2.2 可换层（设计为可插拔）

| 决策 | 本系统现状 | 缺口 |
|---|---|---|
| **模型解耦** | `ClientRegistry` 抽象 + `ModelCatalogService` 三级回落（ai-agent 完善） | ⚠️ ai-service 普通 chat 链路双套 client / 双 key 未统一 |
| **工具契约** | `capabilities` 归一三类；`ToolRegistry.toSchemas` 生成 schema；contracts.md 有 MCP 工具类 | ❌ schema **无语义化版本**，工具变更可能静默 breaking |
| **KB & RAG** | ✅ **已建成独立服务**：`knowledge-service`（:6011）集合 / 文档 / embedding / 检索 + Ragas 评测；经 mcp-gateway 以 MCP 工具（`knowledge_search/list/status/ingest/delete`）装配进 Agent，集合绑定随 Agent 定义走 | ⚠️ 缺口不在"有没有"，而在"准不准"：无混合检索（BM25+向量）/rerank、**召回率未测**；`agent-core` 侧无 `KnowledgePort` 抽象（耦合在 MCP 工具层，替换供应商需改工具层） |
| **评测体系** | ⚠️ **KB 链路有**：`rag-eval.service.ts` Ragas 三指标（context_relevance / answer_relevance / faithfulness），`POST /knowledge/mcp/eval` | ❌ Agent **任务级**评测缺失：无 outcome、无业务线 golden 集 |

### 2.3 易变层（配置化 —— **本系统完成度最高**）

| 旋钮 | 现状 | 证据 |
|---|---|---|
| 模型 | ✅ DB 字典可切，不发版 | `model-catalog.service.ts` |
| prompt | ✅ `systemPrompt` 存 DB，30s 轮询生效 | `agent-definition.entity.ts:28-43` |
| temperature / maxTokens / topP / thinking | ✅ **四参数全 DB 化且引擎已透传**（2026-10-10 C7 落地）（**仅分支**：master 只透传 temperature） | `agent-engine.ts:164-171` |
| maxSteps / streaming / memory | ✅ DB 可配 | entity 相应列 |

> ⚠️ **剩余缺口在 UI**：admin 表单尚未加 `maxTokens` / `topP` / `thinking` 三个控件（另有一处 `?? 0.7` 默认值 bug），目前只能改库或走接口 —— 属 UI 门 C-3。
> ⚠️ **依赖分支**：上述四项中后三项（`maxTokens / topP / thinking`）的**后端**改动仅在分支上；master 直接做 UI 会指向不存在的字段，故 §3.3 的前置动作是「先合入 C7」。具体 UI 仍按 UI 门评审（原型先行）。

### 2.4 业务透镜

| 透镜 | 本系统可答吗 | 依据 |
|---|---|---|
| 成本 | ✅ 大部分 | `agent_runs.cost` + `run_metrics.total_cost`；缺 thinking 计价口径 |
| 风险 | ⚠️ 部分 | 旋钮已配置化（止血手段在），但无模型级 fallback 策略 |
| 杠杆 | ⚠️ 部分 | ai-agent 已解绑；ai-service 普通链路未解绑 |
| 度量 | ⚠️ 部分 | KB 问答有 Ragas 三指标；**Agent 任务无 outcome / eval 集** → 换模型仍凭感觉 |

---

## 3. 实现层：每个架构块的技术方案（现状 → 目标 → 落点）

### 3.1 质量与评测 ⭐ P0（承重层 · 最大债）

**现状**：`agent_runs` 只在 `cost` 维度归因；结果只有 `ok/error`，无法区分"检索没召回 / 推理错 / 工具调错"。

**目标**：成本归因升级为 **成本 + 质量双归因**。

**技术实现**：
1. `agent_runs` 加列：`outcome`（enum `success/partial/fail`）、`fail_stage`（enum `retrieval/reasoning/tool/other`）、`score`（0-100，可选）、`graded_by`（`auto_llm_judge/human/rule`）、`graded_at`。全部 nullable → 存量零影响。
2. 写入点：`AgentEngine.run()` 结束时按已有状态初判；`fail_stage` 在编排各阶段埋点（工具失败已有 `onToolSpan.ok=false`，可直接映射 `tool`）。
3. 离线：`scripts/agent-eval/` 跑每条业务线 20~50 条 golden 用例，LLM-as-judge 判 `outcome`。
4. 线上：看 `fail_stage` 分布决定改 **KB / prompt / 编排**。

**文件落点**：`servers/ai-service/src/agent-log/entities/agent-run.entity.ts`（新增列）、`agent-log.service.ts`（写 outcome）、`packages/agent-core/src/interfaces/telemetry.interface.ts`（`TelemetryRunEnd` 扩字段）。
> 涉及 `agent-core` 接口 + 迁移 → 落地须过**契约门**与迁移规范（`EMIT_SQL=1` 校验、`DATETIME(3)`、不写 COLLATE）。

### 3.2 模型解耦收尾 P1（可换层）

**现状**：Agent 链路已字典化，但 `agent.module.ts:32-36` 的 Provider 仍写死 `Hy3Client` + `TokenHubClient('deepseek-v4-flash')`；普通 chat 链路走自研 client，且是第二套 key。

**目标**：单一 client 抽象 + 单一凭证 + 加模型只改字典。

**技术实现**：
1. `AgentModule.onModuleInit` 调用已有 `ModelCatalogService.start()`，让三级回落结果覆盖初始硬编码；或把 Provider 硬编码收敛为只注册 `Hy3Client` 兜底，其余交 sync。
2. 普通 chat 链路：自研 client 标 **deprecated**，逐步切 `TokenHubClient`，统一凭证。
3. 收敛后只留一份心智与一种故障模式。

**文件落点**：`servers/ai-service/src/agent/agent.module.ts`、`servers/ai-service/src/ai/ai.service.ts`。
> 改 env / 凭证 → 落地须过**发布门**。

### 3.3 调参 UI P1（易变层收尾）

**现状**：后端已就绪（**仅分支** `feat/llm-tuning-multi-model`；**master 尚未合入 C7**），admin 表单缺控件且有一处 `?? 0.7` 默认值 bug。

**前置**：先把 C7（`topP / maxTokens / thinking`）合入目标分支，否则控件会指向不存在的字段。

**目标**：三个控件 + 互斥即时提示。

**技术实现**：增 `temperature` / `maxTokens` / `topP` / `thinking` 四个输入，带短 hint 与档位默认值；`?? 0.7` 改为明确"未配置"（null 语义与 0.7 完全不同 —— 一个是"不传"，一个是"显式设 0.7"）。互斥校验后端已有，前端要给可读错误。

**文件落点**：`apps/admin/src/views/Agents/*`。
> 属 **UI 门（admin 系）**：填规格 → 设计评审 → **用户确认原型** → `Proto: <sha>` + `Design: pass` 才落码。

### 3.4 thinking token 计价 P1（成本透镜）

**现状**：字典 `llm_models` 只有 `input_price_per1k` / `output_price_per1k`，thinking token 口径未定。

**目标**：成本真实性 —— thinking 是隐形大头（`CLASSIFY_MAX_TOKENS=256` 的教训：思考吃光输出额度导致全量兜底，而日志只显示"意图识别失败"）。

**技术实现**：在 `llm_models` 字典补 `thinking_price_per1k`，或明确"并入 output"口径并写入 playbook；`DictPricingProvider` 按 usage 中的 thinking tokens 计价。

### 3.5 检索质量与评测覆盖 P2（可换层 · 已有服务，补质量）

**现状**：RAG 能力**已存在**——`servers/knowledge-service`（:6011）实现集合管理、文档入库、embedding、余弦检索与 Ragas 离线评测，并以 MCP 工具族接入 Agent（`knowledge_search` / `knowledge_list` / `knowledge_status` / `knowledge_ingest` / `knowledge_delete`，集合级 enabled 校验在服务内做；装配规则在 `ai-agent/src/agent/agent-def-sync.service.ts`，回归用例见同名 `.spec.ts`）。

**缺口**（不是"有没有"，而是"准不准 + 好不好换"）：

1. **召回质量未量化** —— 先测**检索召回率**（这是当前性价比最高的质量杠杆，比调 prompt 有效得多）；再按数据决定是否上混合检索（BM25 + 向量）与 rerank。
2. **评测未产品化** —— `rag-eval` 已能跑，但用例集是**请求体传入**（`cases:[{question}]`），没有沉淀成可版本化的 golden 集（代码注释里已点出 Phase4 `eval_cases` 尚未落地）。
3. **抽象层级** —— 接入方式是 MCP 工具而非 `KnowledgePort` 端口，`agent-core` 对具体检索服务有隐式依赖；换检索供应商要改工具层。

> 结论：把 3.5 从"新建子系统（3d）"下调为"**质量与评测覆盖（1.5d）**"—— 这是 v2 更正的直接影响，省下的预算应投给 §3.1（P0 质量归因）。

**目标**：把"有 RAG"升级为"**可信的 RAG**"—— 召回率可量化、评测集可版本化、检索实现可替换。

**技术实现**：
1. 用现有 `POST /knowledge/mcp/eval` 对每条业务线的真实问题跑一遍，先拿到召回率基线（`topK=5`，按集合分别测）。
2. 按基线决定是否引入混合检索与 rerank（`search.service.ts` 内扩展，不改对外契约）。
3. 把 eval 用例沉淀成文件化 golden 集（`knowledge/eval/cases/*.json`）并接入脚本，替代请求体内联。
4. 若需换检索供应商，再把 `KnowledgePort` 抽象补到 `agent-core`（当前不阻塞业务，故排在最后）。

### 3.6 工具 schema 语义版本 P2

**现状**：`ToolRegistry.toSchemas` 直出，无版本。

**目标**：工具变更走 `breaking/feat/fix`，变更须过契约评审。

**技术实现**：工具定义集中登记，schema 附 semver；契约登记进 `docs/api/contracts.md` C3（MCP 工具类）。

### 3.7 HITL 编排级审批 P2（可控性）

**现状**：仅工具级 `confirmHandler`。

**目标**：多步写操作有统一审批节点。

**技术实现**：以"人类可审批节点"为锚点划分控制流 —— 审批前代码驱动保可控，审批后模型驱动保灵活。可在 `RunInput` 增审批开关，或在遥测层插网关事件。

---

## 4. 缺口清单与优先级（按 ROI）

| 优先级 | 项 | 解决哪个维度 | 工作量 | 落地命中动作门 |
|---|---|---|---|---|
| **P0** | `agent_runs` 加 `outcome/fail_stage` + 各阶段埋点 | 可靠性 / 可观测 / 度量 | 1.5d | **契约门** + 迁移规范 |
| **P1** | 调参 UI 表单（含 `?? 0.7` 修正）—— **前置：合入 C7** | 可演化 / 风险 | 1d | **UI 门** |
| **P1** | ai-service 模型链路统一（清双 client / 双 key） | 杠杆 / 可演进 | 1d | **发布门** |
| **P1** | thinking token 计价口径入字典 | 成本 | 0.5d | **发布门**（改字典配置） |
| **P2** | 检索质量与评测覆盖（召回率基线 → 混合检索/rerank → golden 集） | 可靠性 / 质量 | 1.5d | 无（服务内改动，若动对外契约则**契约门**） |
| **P2** | 工具 schema 语义版本 | 可交付 | 1d | **契约门** C3 |
| **P2** | 业务线 golden eval 集（≥20 条/线） | 度量 | 1d | 无（脚本） |
| **P2** | HITL 编排级审批节点 | 可控性 | 1.5d | **契约门** |
| **P2** | **多 Agent 编排（Agent-as-Tool）** —— **必须排在 P0 之后** | 能力边界 / 可控性 | 3d（内核 1.5 + 可观测 1 + admin 0.5） | **契约门**（动 `agent-core`）+ UI 门（能力选择器） |

> 串行建议：P0（质量归因）→ P1 UI 与 P1 模型统一并行 → P1 thinking 计价 → P2 按业务节奏（多 Agent 最后，见 `multi-agent-design.md` §9 依赖顺序）。

---

## 5. 验收标准

1. **质量双归因**：`agent_runs.outcome` 有值且 `fail_stage` 分布可按周查看；随机抽 20 条失败 run 能明确归因到 retrieval / reasoning / tool 之一。
2. **调参可止血**：某 agent 效果劣化时，管理员后台改一个参数（不发版、不重启），30s 内生效，且可用 `outcome` 前后对比验证。
3. **加模型零发版**：字典加一个模型 id，≤60s 内 ai-agent 与 ai-service **两侧同时**可见（ai-service 需先完成对应 P1）。
4. **成本真实**：一条开了 thinking 的 run，其 `cost` 覆盖 thinking 消耗，或文档明确并入 output 的口径。
5. **存量零影响**：新列全 nullable，存量 run 行为与改动前完全一致（回归对照）。
6. **检索质量可量化（v2 新增）**：每条业务线的知识集合都能跑出一个**召回率基线数字**（现有 `/knowledge/mcp/eval` 即可产出），后续改动以此对比，而非凭感觉。

---

## 6. 关联文档

| 文档 | 用途 |
|---|---|
| `docs/architecture/system-overview.md` | **系统现状单一真相源**（服务/端口/库/发布通道，本文档盘点的事实底座） |
| `docs/architecture/kedou-architecture-diagrams.html` | 业务架构图 + 技术架构图（生成物，脚本 `scripts/gen-arch-diagrams.mjs`） |
| `docs/architecture/ai-flow-technical-design.md` | **AI 整体流程技术方案**（主链路 17 阶段 / 容错降级矩阵 / 可观测性） |
| `docs/architecture/ai-flow-diagrams.html` | AI 子系统架构图 + Agent 运行主链路 + 知识链路（脚本 `scripts/gen-ai-flow-diagrams.mjs`） |
| `docs/architecture/agent-dev-t11-mindmap.md` | 技能思维导图（节点版，含价值/原理/实现三段） |
| `docs/architecture/multi-agent-design.md` | **多 Agent 编排方案**（Agent-as-Tool / 四道护栏 / 分阶段，设计中） |
| `docs/api/contracts.md` §7 C7 | Agent 生成参数与模型清单约定（C7-a…C7-h） |
| `docs/api/reviews/contract-review-2026-10-10-c7-tuning-params.md` | C7 评审报告（阻塞 0 / 重要 2） |
| `docs/plans/2026-10-10-multi-model-and-llm-tuning-plan.md` | A/B/C 三条工作线进度（A 完成、C 后端完成、B 半完成） |
| `specs/llm-models-unify/design.md` | 字典收编 model_pricing（注：最终采用 `DictPricingProvider`，非该文的 `ModelPricingCatalog`） |
| `docs/development/agent-capability-playbook.md` | 参数档位约定 |
