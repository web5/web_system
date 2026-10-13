# Agent 子系统架构演进路线图（落地执行计划）

> **本文定位**：这是「**按什么顺序改代码**」的执行计划。
> ⚠️ 与 `agent-message-schedule.md` 的关系——那份是**消息清单**（schedule = 时序表/清单），描述"有哪些消息、何时发、什么格式"，**不是**项目计划。本文档才是「要做什么改造、先做什么、改哪些文件」。
>
> - 事实底座：`agent-system-design.md`（缺口与 ROI）、`ai-flow-technical-design.md`（主链路）、`agent-message-schedule.md`（消息清单与 N 类缺口）、`multi-agent-design.md`（多 Agent 方案）。
> - **本文不产生新事实**，只把四份文档里已确认的缺口**排成可执行批次**，补齐「改哪个文件 / 怎么验 / 卡哪道门」。
> - 更新日期：2026-10-13

---

## 0. 一句话结论

**当前 Agent 子系统"能跑、跑得完整"，但"跑得好不好没法证明"**——缺的不是功能，是**结果归因**（`outcome`）。所有后续改造（多 Agent、RAG 调优、成本控制）都依赖它，所以它是 B0，且必须先做。

---

## 1. 为什么现在"看不到架构改动"（事实陈述）

| 事实 | 说明 |
|---|---|
| **零业务代码落地** | 本轮所有产出（PR #328 的 20 个文件）**全是 `docs/architecture/*` 与生成脚本 `scripts/gen-*.mjs`**，未改一行服务端/前端业务代码。这是遵守"先方案后落码"的结果 |
| 改动在主仓里能看到 | 20 个文件位于分支 `docs/agent-run-flow-multi-agent` → **PR #328**（master 是 protected branch，直推被拒） |
| **此前为什么合不进去** | CI 红线扫描 **R11 fail**：早期两笔 commit message 写了 `Design: N/A（文档与图示，无 UI 源码改动）` 这种**伪凭证**（既不是 `pass` 也不是真实报告路径）。已修正（rebase 到最新 master + 删除该行，纯文档 commit 不带 `Design:` 即零摩擦） |
| 设计态 ≠ 已实现 | 下文批次 **B1 之后**的条目目前**全部是设计态**，等待进入编码 |

---

## 2. 路线图总览

按依赖排，**不是按紧急排**。不做完 B0，后面每一批都会返工。

| 批次 | 主题 | 条目 | 工作量 | 解决什么 | 前置 |
|---|---|---|---|---|---|
| **B0** | **归因底座** | P0 `outcome/fail_stage` 埋点 | 1.5d | 失败无法归因 → 所有优化凭感觉 | 无 |
| **B1** | **链路止血** | N1 心跳 / N3 权限 C 端 / N5 runId / N6 admin intent / N4 拒绝挂起 | 1.5d | 用户会遇到但日志里看不出来的故障 | 无（可与 B0 并行） |
| **B2** | **成本与模型** | thinking 计价 / ai-service 模型链路统一 | 1.5d | 成本失真、两套 client 两套心智 | B0（计价要落到 cost 列才有用） |
| **B3** | **调参 UI** | 四个控件 + `?? 0.7` 修正 | 1d | 效果劣化要发版才能调 | **C7 合入目标分支** + B0（否则无法验证） |
| **B4** | **质量与检索** | 召回率基线 / golden 集 / 混合检索+rerank | 1.5d+ | "有 RAG" → "可信的 RAG" | B0 |
| **B5** | **多 Agent** | Agent-as-Tool + 四道护栏 | 3d | 单人干不了的复杂任务 | **B0 必须完成**（多层失败否则不可见） |

> 总口径约 **10 人日**，但 B0 不落的每一天，其它批次都在累积返工成本。

---

## 3. 分批明细

### B0 · 归因底座（⭐ 最高价值，无依赖）

**为什么第一**：现在 `agent_runs` 只有 `status: 'ok' | 'error'`（技术状态）+ `cost/totalTokens/durationMs`。一次失败你看不到它卡在**检索没召回**、**推理错**、还是**工具调错** —— 于是每次优化都是猜。

| 项 | 内容 |
|---|---|
| 目标 | 成本归因 → **成本 + 质量双归因** |
| 改造 | `agent_runs` 加 nullable 列：`outcome`（`success/partial/fail`）、`fail_stage`（`retrieval/reasoning/tool/other`）、`score`、`graded_by`、`graded_at` |
| 写入点 | `AgentEngine.run()` 结束按已有状态初判；编排各阶段埋 `fail_stage`（工具失败已有 `onToolSpan.ok=false` → 直接映射 `tool`） |
| **文件落点** | `servers/ai-service/src/agent-log/entities/agent-run.entity.ts`（加列）、`agent-log.service.ts`（写 outcome）、`packages/agent-core/src/interfaces/telemetry.interface.ts`（`TelemetryRunEnd` 扩字段） |
| 迁移 | 走 `scripts/migrations/pNN-*.mjs`：need `information_schema` 幂等守卫、`EMIT_SQL=1` 导出校验、`datetime(3)`、不写 COLLATE |
| 命中门 | **契约门**（动 `agent-core` 接口）+ 迁移规范 |
| **验收** | ① 随机抽 20 条失败 run，能明确归因到 retrieval / reasoning / tool 之一；② 新列全 nullable，存量 run 行为与改动前完全一致 |
| 风险 | `agent-core` 接口变更影响面需契约评审；建议与现有遥测字段**向后兼容**（全可选） |

---

### B1 · 链路止血（用户会遇到，但日志看不出来）

四条都来自消息清单核查（`agent-message-schedule.md` §6），**改起来小、体感收益直接**，建议与 B0 并行由不同人做。

| # | 缺口 | 改造要点 | 文件落点 | 验收 |
|---|---|---|---|---|
| **N1** | **无心跳帧**：MCP 工具 / 权限等待期间整条流零字节，中间代理（含 nginx proxy_timeout）可能直接掐断 → "跑到一半静默失败" | 工具执行 / 等待期间定期写 SSE 注释帧 `: keepalive\n\n`（客户端自动忽略） | `servers/ai-agent/src/agent/agent.controller.ts`（`setHeader` 在 182-185，主写入点 277） | 挂一个 90s 的慢工具，客户端**不**被代理掐断；抓包可见定期注释帧 |
| **N3** | ⚠️ **`permission_request` 只有 admin 接了**：小程序 `pages/chat/index` 无该分支 → 高危工具在 C 端**静默挂起到 60s 自动拒绝** | 二选一：① 补小程序 HITL UI；②（更省）服务端禁止 C 端 Agent 装配 `requiresConfirm` 工具 | `apps/kedou-ai-minigram/pages/chat/index/index.ts`（消费侧）／或 `servers/ai-agent/src/agent/agent-def-sync.service.ts`（装配侧过滤） | C 端触发高危工具时**要么弹确认、要么直接不装配**，不存在"默默等到超时" |
| **N4** | `ok:false` 不唤醒挂起：确认请求不存在/越权时返回 `{ok:false}`，工具仍挂在 `await confirm()` 直到 60s 超时 | 返回体区分「已处理 / 不存在 / 越权」，并考虑立刻 reject | `servers/ai-agent/src/agent/permission-broker.ts` | 越权确认立刻失败，不等 60s |
| **N5** | 无 `runId` 对外暴露：内部 `onRunEnd` 有 `runId`，但 SSE **没有任何一条消息带它** → 前端无法直接对到 `agent_runs` 排查 | `intent` 或 `final` 带上 `runId`（**契约变更，走 C2 纪律**）；需先确认 controller 侧能否在开流时拿到 runId，若不能则在编排层生成后透传 | `agent.controller.ts` + `runtime.interface.ts` (`StreamEvent`) | 任意一次对话能从前端日志直接反查 `agent_runs` 那一行 |
| **N6** | admin 无 `intent` 消费（走 default 兜底）—— 调试台最需要看路由结果 | 补 case | `apps/admin/src/views/Agents/AgentPlayground.vue` | 调试台可见意图分类结果 |
| N2 | 无断流续传（帧不带 `id:`、无 `Last-Event-ID`） | 至少发 `id: <step>` | `agent.controller.ts` | 二期看是否值得；多数场景重跑即可 |

> ⚠️ N2 判为二期：续传要引入幂等与上下文重建，成本远高于收益，先记着不上。

---

### B2 · 成本与模型（消除双心智）

| 项 | 现状 | 改造 | 文件落点 | 命中门 |
|---|---|---|---|---|
| thinking 计价 | `llm_models` 字典只有 input/output 单价，thinking 口径未定 | 补 `thinking_price_per1k`，或明确"并入 output"口径并写 playbook；`DictPricingProvider` 按 usage 中 thinking tokens 计价 | `llm_models` 字典 + `DictPricingProvider` | **发布门**（改字典配置） |
| ai-service 模型链路统一 | `agent.module.ts:32-36` Provider 仍写死 `Hy3Client` + `TokenHubClient('deepseek-v4-flash')`；普通 chat 走自研 client + 第二套 key | ① `AgentModule.onModuleInit` 调已有 `ModelCatalogService.start()` 覆盖硬编码；② 自研 client 标 deprecated 逐步切 `TokenHubClient` | `servers/ai-service/src/agent/agent.module.ts`、`servers/ai-service/src/ai/ai.service.ts` | **发布门**（改 env/凭证） |

**验收**：字典加一个模型 id，≤60s 内 ai-agent 与 ai-service **两侧同时**可见；开 thinking 的 run 其 `cost` 覆盖 thinking 消耗。

---

### B3 · 调参 UI（易变层收尾）

⚠️ **前置硬依赖**：先把 **C7**（`topP / maxTokens / thinking`）合入目标分支。C7 目前**只在 worktree 分支 `feat/llm-tuning-multi-model`**，master 的 `agent-engine.ts:165` 仅透传 `temperature` —— **没合之前做 UI，控件会指向不存在的字段**。

| 项 | 内容 |
|---|---|
| 改造 | 增 `temperature` / `maxTokens` / `topP` / `thinking` 四个输入（带短 hint 与档位默认值）；**修 `?? 0.7`**（null = "不传"，0.7 = "显式设 0.7"，语义完全不同）；前后端互斥校验都要给可读错误 |
| 落点 | `apps/admin/src/views/Agents/*` |
| 命中门 | **UI 门（admin 系）**：填规格 → 设计评审 → 用户确认原型 → `Proto: <sha>` + `Design: pass` |
| 验收 | 某 agent 效果劣化时，后台改一个参数（**不发版、不重启**），30s 生效，且能用 B0 的 `outcome` 前后对比验证 |

---

### B4 · 质量与检索（"有 RAG" → "可信的 RAG"）

RAG **已存在**（`servers/knowledge-service:6011`，集合/文档/embedding/余弦检索 + Ragas 离线评测，以 MCP `knowledge_*` 工具族接入 Agent）。缺口不是"有没有"，而是"准不准"。

| 步骤 | 内容 | 落点 |
|---|---|---|
| 1 | **先拿召回率基线**（最高性价比杠杆，比调 prompt 有效得多）：用现有 `POST /knowledge/mcp/eval` 对每条业务线真实问题跑一遍，`topK=5`、按集合分别测 | `servers/knowledge-service`（现有 eval 端点即可） |
| 2 | 按基线决定是否上**混合检索**（BM25 + 向量）与 **rerank** | `search.service.ts` 内扩展，**不改对外契约** |
| 3 | eval 用例沉淀为文件化 **golden 集**（现为请求体内联 `cases:[{question}]`，代码注释已点出 Phase4 `eval_cases` 未落地） | `knowledge/eval/cases/*.json` |
| 4 | 若需换检索供应商，再补 `agent-core` 的 `KnowledgePort` 抽象（当前不阻塞业务，排最后） | `packages/agent-core` |

**验收**：每条业务线的知识集合都能跑出一个**召回率数字**，后续任何改动以此对比，而不是凭感觉。

---

### B5 · 多 Agent（最后做，且必须在 B0 之后）

方案已定：**Agent-as-Tool**（子 Agent 当第四类工具）。详细方案见 `multi-agent-design.md`。

| 项 | 内容 |
|---|---|
| 数据契约 | `CapabilityRef.type` 加 `'agent'`（JSON 列，**零 DDL**）；`ToolContext` 加 `depth/callStack/stepBudget`（全可选）；`agent_runs` 加 `parentRunId/depth` |
| 四道护栏 | 深度 ≤ 3 / 调用栈循环检测 / **跨层共享步数预算**（各层独立会乘积失控）/ 权限取**交集** |
| SSE 口径 | 子链路内部过程事件**折叠不上浮**，对外表现为父的一条 `tool_call` / `tool_result`；如需区分委派再加 `sub_agent_start/end` |
| 工作量 | 3d（内核 1.5 + 可观测 1 + admin 能力选择器 0.5） |
| 命中门 | **契约门**（动 `agent-core`）+ UI 门 |

> 🔴 **顺序铁律：B0 不完成不许开工**。理由很硬：多层嵌套一旦失败，在当前埋点下**你连是哪一层失败的都不知道**，护栏本身就变成了黑盒。

---

## 4. 三条不可颠倒的依赖

```
B0 归因底座 ──┬──> B2 计价（cost 才真实）
              ├──> B3 UI（调参效果要能验证）
              ├──> B4 检索（改动要能量化）
              └──> 🔴 B5 多 Agent（多层失败要能归因）

B1 链路止血：与 B0 无依赖，可并行，独立发 PR

C7 合入 ──> B3 调参 UI（控件不能指向不存在的字段）
```

---

## 5. 各批次命中的动作门（提前准备，别临门卡住）

| 批次 | 契约门 | UI 门 | 发布门 | 备注 |
|---|---|---|---|---|
| B0 | ✅ | — | — | 动 `agent-core` 接口，**必须走契约评审** |
| B1 | ⚠️ N5 是（SSE 契约变更走 C2） | ⚠️ N3 若走小程序 UI 则是 | — | N1/N4 纯服务端，无门 |
| B2 | — | — | ✅ | 改字典 / env / 凭证 |
| B3 | — | ✅ | — | 需 `Proto:` + `Design: pass` |
| B4 | 视是否动对外契约 | — | — | 服务内改动默认无门 |
| B5 | ✅ | ✅ | — | 内核 + admin 能力选择器 |

> 💡 本次踩的坑就是最好的提醒：**UI 门的 `Design:` 凭证不能写 `N/A` 之类占位值**，非 UI commit 干脆不要带这一行。

---

## 6. 建议立刻开的最小动作

如果要马上动手，按 ROI 排序的三个最小单元：

1. **N1 心跳帧**（约 0.5h）——一行定时注释帧，消掉"跑到一半静默失败"这类最难查的故障单。
2. **N3 服务端兜底**（约 0.5d）——先不做小程序 HITL UI，直接在装配侧禁止 C 端 Agent 挂 `requiresConfirm` 工具，**先止血**。
3. **B0 的 `outcome` 加列 + 最小埋点**（约 1.5d）——这个做完后，后面每一批才第一次有了"改完能不能证明有效"的能力。

---

## 7. 关联文档

| 文档 | 用途 |
|---|---|
| `agent-system-design.md` | 缺口与 ROI 盘点（P0→P2 的原始出处） |
| `ai-flow-technical-design.md` | 主链路 18 段 / 容错降级矩阵 / 可观测性 |
| `agent-message-schedule.md` | **消息清单**（本计划的 N 类缺口出处） |
| `multi-agent-design.md` | 多 Agent 方案（B5 依据，含四道护栏与依赖顺序） |
| `system-overview.md` | 系统现状单一真相源（服务/端口/库/发布通道） |
| `agent-dev-t11-mindmap.md` | 技能思维导图 |
| `docs/api/contracts.md` §7 C7 | 生成参数与模型清单约定（B3 前置） |
