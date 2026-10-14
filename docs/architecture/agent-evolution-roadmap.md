# Agent 子系统架构演进路线图（落地执行计划）

> **本文定位**：这是「**按什么顺序改代码**」的执行计划。
> ⚠️ 与 `agent-message-schedule.md` 的关系——那份是**消息清单**（schedule = 时序表/清单），描述"有哪些消息、何时发、什么格式"，**不是**项目计划。本文档才是「要做什么改造、先做什么、改哪些文件」。
>
> - 事实底座：`agent-system-design.md`（缺口与 ROI）、`ai-flow-technical-design.md`（主链路）、`agent-message-schedule.md`（消息清单与 N 类缺口）、`multi-agent-design.md`（多 Agent 方案）。
> - **本文不产生新事实**，只把四份文档里已确认的缺口**排成可执行批次**，补齐「改哪个文件 / 怎么验 / 卡哪道门」。
> - 更新记录：
>   - **v1.1（2026-10-14）**：落定 4 项产品定义（见 §2.1）；B4 按「内部自用」口径降级；**B5 首例 = 研发助手**，并由此外推出「B5 前置 = B0 + B4 内容补齐」（§4 依赖图已改）。
>   - v1.0（2026-10-13）：首版。
> - 事实来源（v1.1 新增，均为本地库实测）：`agent_definitions`（5 条业务线及能力配置）、`agent_runs`（213 ok / 31 error）、`web_system_knowledge`（3 集合 × 各 1 篇文档）。


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
| **B1** | **链路止血** | N1 心跳 / N3 权限 C 端（**服务端过滤**）/ N5 runId / N6 admin intent / N4 拒绝挂起 | 1.5d | 用户会遇到但日志里看不出来的故障 | 无（可与 B0 并行） |
| **B2** | **成本与模型** | thinking 计价 / ai-service 模型链路统一 | 1.5d | 成本失真、两套 client 两套心智 | B0（计价要落到 cost 列才有用） |
| **B3** | **调参 UI** | 五个控件（含 `max_steps`）+ `?? 0.7` 修正，**仅超管 + 审计** | 1d | 效果劣化要发版才能调 | **C7 合入目标分支** + B0（否则无法验证） |
| **B4** | **质量与检索** | **先补知识库内容** → 召回率抽查（内部自用口径，不建重评测） | 1d+ | "有 RAG" → "可信的 RAG" | B0；**内容补齐**（见 §2.1） |
| **B5** | **多 Agent** | Agent-as-Tool + 四道护栏；**首例 = 研发助手多集合汇总** | 3d | 单人干不了的复杂任务 | **B0 必须完成**；首例另需 **B4 先补内容** |

> 总口径约 **10 人日**，但 B0 不落的每一天，其它批次都在累积返工成本。

### 2.1 已确认的产品定义（2026-10-14 用户拍板）

| # | 决策点 | 结论 | 对批次的影响 |
|---|---|---|---|
| 1 | 知识库定位 | **内部研发助手自用**（非对外产品能力） | **B4 降级**：不做 golden 评测集与质量门禁，改为「先补内容 + 偶发召回率抽查」 |
| 2 | C 端高危工具 | **服务端一律禁止**装配 `requiresConfirm` 工具 | **N3 走装配侧过滤**，不做小程序 HITL UI（省掉整条 UI 门流程） |
| 3 | 调参面板范围 | **最小集 + 仅超管**：`temperature` / `maxTokens` / `topP` / `thinking` / **`max_steps`**（已在 DB），改动写审计日志 | B3 范围扩一项；不加审批流、不分线开放 |
| 4 | 多 Agent 首例 | **研发助手（多集合检索汇总）** | ⚠️ **依赖链变为 B0 → B4（补内容）→ B5**；三个集合现各仅 1 篇文档，不补内容则首例无意义 |

> ⚠️ 第 4 项的连带影响：B5 不能只看 B0。研发助手作为首例，其价值完全取决于三个知识集合里有多少内容 —— 所以 **B4 的内容补齐工作事实上变成了 B5 的前置**，而不再是可以并行的独立批次。


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
| **N3** | ⚠️ **`permission_request` 只有 admin 接了**；且 `agent_definitions` **无 audience/scene 字段** → "哪个 agent 谁能用"不受约束，一旦高危 agent 接到 C 端就会静默挂起 60s | ✅ **已定策略：服务端装配侧过滤** —— C 端请求上下文下不装配 `requiresConfirm` 工具（**不做**小程序 HITL UI，省掉整条 UI 门） | `servers/ai-agent/src/agent/agent-def-sync.service.ts`（装配侧过滤） | C 端**不可能**出现"等 60s 被拒"；过滤数量进日志便于发现误配 |
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
| 改造 | 增 `temperature` / `maxTokens` / `topP` / `thinking` 四个输入（带短 hint 与档位默认值）**＋ `max_steps`**（已在 DB，直接决定成本上限，属高频调项）；**修 `?? 0.7`**（null = "不传"，0.7 = "显式设 0.7"，语义完全不同）；前后端互斥校验都要给可读错误 |
| 权限 | ✅ **已定：最小集 + 仅超管**（不加审批流、不分线开放）；每次改动写**审计日志**（改前/改后值 + 操作人） |
| 落点 | `apps/admin/src/views/Agents/*` |
| 命中门 | **UI 门（admin 系）**：填规格 → 设计评审 → 用户确认原型 → `Proto: <sha>` + `Design: pass` |
| 验收 | 某 agent 效果劣化时，后台改一个参数（**不发版、不重启**），30s 生效，且能用 B0 的 `outcome` 前后对比验证 |

---

### B4 · 质量与检索（内部自用口径：先补内容，再谈算法）

RAG **已存在**（`servers/knowledge-service:6011`，集合/文档/embedding/余弦检索 + Ragas 离线评测，以 MCP `knowledge_*` 工具族接入 Agent）。缺口不是"有没有"，而是"**里面有没有东西 + 准不准**"。

> ✅ **已定：知识库定位 = 内部研发助手自用**（非对外产品能力）→ 原计划的「golden 评测集 + 质量门禁 + 混合检索/rerank」**整体降级**，不做重评测体系。

**实测现状（这是重启点）**：`web-system-dev` 挂的 3 个集合 `ws-arch` / `ws-agent-platform` / `ws-dev-guide`，
**每个只有 1 篇文档**（embed 模型 `kinfra-text-embedding-4b`）。在这种规模下：召回率基线测不出信息、混合检索与 rerank 属过度工程。

| 步骤 | 内容 | 落点 |
|---|---|---|
| 1 | **补内容**（真正的瓶颈）：每集合从 1 篇提到可用量级（建议每条线 ≥20 篇）——`ws-arch` 天然语料就是本仓 `docs/architecture/*.md` | `knowledge-service` 入库接口 / admin 知识集合页 |
| 2 | 补完后跑一次**召回率抽查**（现有 `POST /knowledge/mcp/eval`，`topK=5`）拿到基线数字，作为后续改动对比 | `servers/knowledge-service`（现有端点即可） |
| 3 | 只有当抽查发现"内容够但召回差"时，才考虑**混合检索**（BM25 + 向量）与 **rerank** | `search.service.ts` 内扩展，**不改对外契约** |
| 4 | 换检索供应商的 `KnowledgePort` 抽象：当前**明确不做**（内部自用，无替换诉求） | ~~`packages/agent-core`~~ |

**验收**：每个集合有可用内容量 + 一个可复现的召回率数字；不再出现"集合建好了但里面只有 1 篇"。


---

### B5 · 多 Agent（最后做，且必须在 B0 之后）

方案已定：**Agent-as-Tool**（子 Agent 当第四类工具）。详细方案见 `multi-agent-design.md`。

| 项 | 内容 |
|---|---|
| 数据契约 | `CapabilityRef.type` 加 `'agent'`（JSON 列，**零 DDL**）；`ToolContext` 加 `depth/callStack/stepBudget`（全可选）；`agent_runs` 加 `parentRunId/depth` |
| 四道护栏 | 深度 ≤ 3 / 调用栈循环检测 / **跨层共享步数预算**（各层独立会乘积失控）/ 权限取**交集** |
| SSE 口径 | 子链路内部过程事件**折叠不上浮**，对外表现为父的一条 `tool_call` / `tool_result`；如需区分委派再加 `sub_agent_start/end` |
| 首例 | ✅ **已定：研发助手（`web-system-dev`）多集合检索汇总** —— 把 `ws-arch` / `ws-agent-platform` / `ws-dev-guide` 三个集合的检索拆成子 Agent，各自消化长文档后只回摘要，避免原始片段全量灌进主窗口 |
| 工作量 | 3d（内核 1.5 + 可观测 1 + admin 能力选择器 0.5） |
| 命中门 | **契约门**（动 `agent-core`）+ UI 门 |

> 🔴 **顺序铁律：B0 不完成不许开工**。理由很硬：多层嵌套一旦失败，在当前埋点下**你连是哪一层失败的都不知道**，护栏本身就变成了黑盒。
>
> 🔴 **首例的额外依赖：B4 必须先补内容**。研发助手的价值完全来自知识集合里有东西 —— 每集合 1 篇文档时，"多集合汇总"没有可汇总的对象。所以实际顺序是 **B0 → B4 补内容 → B5**。


---

## 4. 不可颠倒的依赖

```
B0 归因底座 ──┬──> B2 计价（cost 才真实）
              ├──> B3 UI（调参效果要能验证）
              └──> B4 检索（改动要能量化）
                      │
                      └──> 🔴 B5 多 Agent · 首例=研发助手
                            （B0 保证「失败能归因」，
                              B4 保证「有内容可汇总」——缺一不可）

B1 链路止血：与 B0 无依赖，可并行，独立发 PR

C7 合入 ──> B3 调参 UI（控件不能指向不存在的字段）
```

> ⚠️ 与上一版的差异：**B5 的前置从「B0」变成「B0 + B4 内容补齐」**。原图把 B4 画成与 B5 并列的分支，但首例选定研发助手后，两者变成**串联**关系。


---

## 5. 各批次命中的动作门（提前准备，别临门卡住）

| 批次 | 契约门 | UI 门 | 发布门 | 备注 |
|---|---|---|---|---|
| B0 | ✅ | — | — | 动 `agent-core` 接口，**必须走契约评审** |
| B1 | ⚠️ N5 是（SSE 契约变更走 C2） | — | — | N1/N3/N4 **纯服务端，无门**（N3 已定为装配侧过滤，不进 UI 门） |
| B2 | — | — | ✅ | 改字典 / env / 凭证 |
| B3 | — | ✅ | — | 需 `Proto:` + `Design: pass` |
| B4 | — | — | — | 补内容是数据操作（入库），**不走契约门**；仅当改检索对外契约才需要 |
| B5 | ✅ | ✅ | — | 内核 + admin 能力选择器 |

> 💡 本次踩的坑就是最好的提醒：**UI 门的 `Design:` 凭证不能写 `N/A` 之类占位值**，非 UI commit 干脆不要带这一行。

---

## 6. 建议立刻开的最小动作

如果要马上动手，按 ROI 排序的四个最小单元：

1. **N1 心跳帧**（约 0.5h）——一行定时注释帧，消掉发布助手那条"最长静默 10 分钟、nginx 必掐断"的故障路径。
2. **N3 服务端过滤**（约 0.5d）——✅ 已定策略，装配侧禁止 C 端挂 `requiresConfirm` 工具，**不走 UI 门**。
3. **知识库补内容**（约 0.5d，可随时插入）——把 `docs/architecture/*.md` 灌进 `ws-arch` 等集合。这是 B4 与 B5 首例的共同前置，**且不需要等 B0**。
4. **B0 的 `outcome` 加列 + 最小埋点**（约 1.5d）——做完后，后面每一批才第一次有了"改完能不能证明有效"的能力。

> 与上一版的差异：新增第 3 项。因为「B5 首例 = 研发助手」拍板后，**知识库内容量成了两个批次的共同阻塞点**，而它恰好是四项里唯一不需要前置、可以立刻做的事。


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
