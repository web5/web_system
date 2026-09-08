# Agent 平台演进 · 技术方案（Design）

> 承接 `requirements.md`。只描述方案与契约，不含实施清单（见 `tasks.md`）。
> 一期待验收资产锚点：`servers/ai-agent`(6010) 执行器、`servers/ai-service`(6003) 管理中枢、`servers/mcp-gateway`(6006)、`packages/agent-core`、`apps/admin /agents`。

## 0. 总架构（目标态）

```text
L4 admin(/agents 扩展)  观测台(趋势/成本) · 评测台(用例/跑批/diff) · 知识集合管理  [Phase2/3/4]
L3 管理中枢 ai-service   agent_definitions/versions(唯一源) · agent_runs(+usage/cost/version)
                        · run_metrics(聚合) · model_pricing · eval_*(Phase4)      [统一落库点]
L2 执行面 ai-agent/ai-service harness     复用同一 agent-core；通过 TelemetryPort 上报
L1 协议面 mcp-gateway(+mcp-core)          新增 knowledge 工具族(MCP server 聚合)
L0 内核  agent-core                       引擎能力收敛(Phase1) · TelemetryPort(Phase2) · 零依赖保持
```

## D1. agent-core 契约收敛与清理（Phase 1）

### D1.1 CapabilityRef 全类型接入
- 现状：引擎只消费 `hasSkills(skill)`；tool/mcp 走旧的 `agent.tools` 名称数组，`CapabilityRef.config`(timeout 等)未消费。
- 方案：`AgentEngine` 装配阶段统一解析 `capabilities`：
  - `type:'tool'` → 从 ToolRegistry 解析(仍允许按需 resolve)
  - `type:'mcp'` → 经 McpToolAdapter + config 生成 ToolDefinition（合并现状 mcp 懒加载路径）
  - `type:'skill'` → 现状保留（on-demand）
  - 解析失败即**明确错误**（见 R3.4 精神的引擎侧版），不静默降级
- 兼容：一期老定义无 capabilities 字段 → 从 `tools` 派生后按新路径注入，行为不变（跑一期验收回归）。

### D1.2 ToolParameter schema 表达力
- `ToolParameter` 增加 `enum`/`array`(嵌套 item 类型)/`min/max` 描述，供模型侧生成与前端 Playground 展示。改接口时提供默认值，不改既有工具行为。

### D1.3 清理一致性裂缝
- `packages/agent-core`：移除 `DeepseekClient`（已弃用）或标记 internal-only；`fetch-http` 的 `postJson/streamSse` 若被服务层引用则上移导出，否则删除死码。
- `packages/kedou-agent`：harness 注册 TokenHubClient 到 ClientRegistry，config 引导的 `deepseek-v4-flash`/`deepseek-chat` 真实可调用；deploy-assistant agent model 修正。
- DB 唯一事实源：代码内置 `*.agent.ts` 常量删除；`AgentRegistry` 的代码兜底注册改为"仅 seed 用、启动由 DB 覆盖"，避免双源漂移。

## D2. 执行面/管理面收敛（Phase 1，与 D1.3 同批）

- **双 harness 归一**：ai-service 与 ai-agent 共用同一 `agent-core` 装配工厂（提升到共享模块或 `packages` 装配层），消除两份 `AgentRegistry/ClientRegistry` 各自实例的漂移。收敛为：ai-service 负责管理/评测/观测落库；ai-agent 负责 C 端执行/会话（`agent_conversations`）；两份 30s 定义同步器归一为 ai-service 单一 `internal/agent-definitions` 拉取。
- 注：会话查询（`agent_conversations`）仍留在 ai-agent（C 端多轮记忆），`agent_runs` 统一收口 ai-service（R2.1）。

## D3. 观测地基（Phase 2）

### D3.1 TelemetryPort（引擎出口，默认 no-op）
```ts
interface TelemetryPort {
  onRunStart(ctx: { runId; agentId; agentVersion; userId; model; ts });
  onLlmSpan(span: { runId; operation: 'chat'|'chat_with_tools'; model;
                    inputTokens; outputTokens; latencyMs; ts });           // 对齐 gen_ai.operation.name / gen_ai.usage.*
  onToolSpan(span: { runId; tool; argsSize; ok; error?; latencyMs; requiresConfirm; approved?; ts });  // 对齐 gen_ai.tool.name
  onSkillLoad(span: { runId; skill; ts });
  onRunEnd(ctx: { runId; status; error?; durationMs; totalTokens; ts });
}
```
- 字段命名对齐 OTel GenAI SemConv（agent/llm/tool/embedding span 层级 + `gen_ai.*` 属性名），**仅对齐 schema，不引 otel SDK**。
- ai-agent/ai-service 各自实现 Port（写 ai-service 库）；`AgentRunner.stream()` 装配点注入。

### D3.2 agent_runs 扩展（ai-service）
新增列：`agentVersion`(int, 定义版本快照) · `promptTokens/completionTokens/totalTokens`(int) · `cost`(decimal) · `model` 已有 · `source` 已有。
写库点：SSE 结束 + 异步推送（沿用 AgentRunPusher）；版本快照在 run 开始从 registry 取。

### D3.3 新表（均 ai-service 库）
```text
model_pricing  provider | model | inputPricePer1k | outputPricePer1k | currency | updatedBy   (运营配置)
run_metrics    聚合: agentId | model | source | date | runCount | okCount | errorCount
               | avgDurationMs | totalTokens | totalCost | permissionDeniedCount     (定时/触发聚合)
```
- 聚合任务用 content-hub 式 `@nestjs/schedule` cron 或 run 结束增量写；成本 = usage × pricing（无单价记录记 0 并在 admin 提示补配，不发明降级数值）。

### D3.4 admin 观测页（/agents 扩展）
总览卡片 + 按 agent/model 趋势图（成功/耗时/token/成本）+ 列表下钻 run 详情(回放已有)。RBAC 沿用 `agents:view`。

## D4. RAG 知识服务（Phase 3）

### D4.1 载体（推荐 A，见 §开放决策）
- 推荐：独立轻服务 `servers/knowledge-service`（新库 `web_system_knowledge`，PostgreSQL + pgvector），对平台只暴露 MCP 工具（经 mcp-gateway 聚合，复用凭证/审计链路），不直接开放 HTTP 给业务。
- 备选 B：先放 ai-service 内模块（同库），量起再拆。

### D4.2 表
```text
knowledge_collections  id | name | agentIds(json 授权白名单) | embedModel | meta | enabled
knowledge_docs         id | collectionId | title | source | rawText(mediumtext) | status(parsing/ready/failed) | checksum
knowledge_chunks       id | docId | seq | content | embedding(vector) | meta   (索引 HNSW)
```
- 权限：工具调用时校验发起 agentId ∈ collection.agentIds（R3.4：无授权返回明确错误）。

### D4.3 MCP 工具契约（注册进 mcp-gateway）
```text
knowledge_ingest(collectionId, title, text|fileRef, source?)  → jobId(docId), 异步解析分块
knowledge_search(collectionId, query, topK=5)                 → [{chunkId, content, docTitle, score}]  // 带来源引用(R3.1)
knowledge_list(collections?)                                  → 集合与授权可见性
knowledge_delete(collectionId, docId?)                        → 删除(级联 chunks, R3.3)
knowledge_status(docId)                                       → parsing/ready/failed 与分块数
```
- embedding Provider 抽象：env 配置默认提供方（tokenhub/hy3 的 embedding 或腾讯云 bge），`EmbeddingProvider` 接口 + 注册表，风格同 `SearchProviderRegistry`。
- 评测口径：检索+问答对按 **Ragas 三指标**（faithfulness / answer_relevance / context_relevance）出脚本化评测，纳入 Phase4 用例集。

## D5. 评测闭环（Phase 4，架构先行/实现第二批）

### D5.1 数据（ai-service 库）
```text
eval_datasets  id | name | agentId | description | version
eval_cases     id | datasetId | input | rubricConfig(json: 程序化断言+LLM-judge 维度) | tags | source(manual/golden/badcase)
eval_runs      id | datasetId | agentId | agentVersion | total | passed | scoreSummary(json) | status | createdBy
eval_results   id | runId | caseId | assertType(programmatic|judge) | score | passed | detail(json) | latencyMs | cost
```

### D5.2 Runner（执行层，必须真实引擎）
- 放 ai-service：`publish` 的定义 + 非流式跑 agent-core 同一 harness；每 case 一个隔离 conversation；危险工具注入 `confirm=deny`；允许超时/预算截断并记入 result。
- 判据两轨：程序化断言（JSON/包含/正则/轨迹断言/相似度）+ LLM-as-judge（独立模型经 tokenhub，rubric 维度: 正确性/约束遵循/工具使用恰当/安全友好，参照 agent-kit 五维 rubric 思想但产品化）。
- 坏例回收：run 详情页一键由 `agent_runs` 生成 `eval_cases`(source=badcase)。

### D5.3 publish 门禁
- `agent-def.service.publish()` 增加门禁：先跑 smoke 集（每 agent 必选 5-10 条）→ 与当前已发布版本同集 diff → 回退超阈值/关键 fail → 拦发布返回 diff；未配 smoke 集时**放行并在日志/响应提示"无评测门禁"**（不发明默认拦截行为，见红线：兜底须明确）。门禁开关与阈值由 admin 按 agent 配置。

## D6. 管理/运营 Web 配套（admin /agents 系）

### D6.1 原则
- UI 是每个 Phase 交付物的组成部分（能看/能配/能动作），与后端同批交付，不做"只见 API 不见页面"。
- 统一落在 `apps/admin` 微前端（`/agents`、`/mcp` 子树），不新建独立后台。
- 权限沿用 `@web-system/shared` RBAC + `v-has-perm`；新增权限点见 D6.3。
- UI 视觉/Token 以 `packages/ui/src/tokens.ts` + `docs/ui/` 规范为准；新页面实现前按 `fe-developer` 规范补 page-spec（本 spec 为功能级规格）。

### D6.2 模块 ↔ 页面矩阵
| 平台模块 | 现状 | 本次 Web 配套 | Phase | 落点 |
|---|---|---|---|---|
| agent 定义/技能/Playground/run 回放 | 已有 | run 详情增强：展示 `agentVersion`/usage/成本/耗时 | P2 | /agents |
| 观测与成本 | 无 | 观测台：run 量/成功率/耗时/token/成本趋势 + 按 agent·model·source 筛选下钻 | P2 | /agents（观测 tab） |
| 模型单价 | 无 | `model_pricing` 配置页（运营配单价，联动成本） | P2 | /agents/settings |
| MCP 工具模块 | 已有(mcp) | knowledge_* 工具注册后自动出现在 /mcp 工具管理 | P3 | /mcp |
| 知识集合 | 无 | 集合 CRUD + 文档上传/解析状态/删除 + agent 授权白名单 | P3 | /agents/knowledge |
| 检索调试器 | 无 | 独立试跑：query → top-k 命中/score/来源引用，调试 embedding 参数（随知识集合一起交付） | P3 | /agents/knowledge/debugger |
| 评测 | 无 | 数据集/用例 CRUD、批量导入、坏例回收入口、跑批、报告与基线 diff | P4 | /agents/eval |
| 发布门禁 | 无（直接发布） | 发布弹窗内嵌 smoke 结果 + diff，拦截时展示报告 | P4 | 定义管理发布动作 |
| 平台总览 Dashboard | 无 | 跨 agent/知识/评测的健康与成本聚合总览（随评测收尾一起交付） | P4 收尾 | /dashboard |
| 能力资产总览 | 无 | 只读聚合页：按 agent 汇总四类能力（本地 tool / MCP 工具 / Skill / 知识集合）与来源、状态，跳回各模块页（D6.6） | P2 | /agents/capabilities |
| MCP 模块/工具 | 已有（/mcp McpAdminPanel；mcp-admin 独立前端源码不在本仓） | **不重复建设**：本演进仅把 knowledge_* 工具注册进 mcp-gateway（D4.3），页面仍归 /mcp | —（跨模块依赖） | /mcp |
| 技能库 Skills | 已有（/agents/skills） | **不重复建设**：本演进仅消费 on-demand `load_skill`，页面仍归 /agents/skills | — | /agents/skills |

### D6.3 权限点新增（packages/types `PERMISSIONS` + user-service 角色）
- `knowledge:view` / `knowledge:manage` —— 知识集合读写与授权
- `agents:cost:view` —— 成本与单价查看（含商务信息，独立于 agents:view）
- `agents:eval` —— 评测动作与门禁配置；评测结果查看随 agents:view
- 默认角色授予策略同现有 editor/viewer 档位，由实现时按权限哲学定

### D6.4 UI 交付约束（微前端铁律，执行时遵循）
- admin 改完须走「构建 → 拷贝 gateway `static/modules/admin/<hash>` → 更新 `web_system_deploy` 版本表 → 等 gateway TTL / 重启」四步并验证 `__manifest__`，否则浏览器仍加载旧产物。
- 不引入 emoji 图标、不新增裸 hex/`!important`（docs/ui 规范）。

## D6.5 MCP / Skills 的归属与聚合策略

**结论：归属不动，入口做聚合（不搬迁、不重写）。**

- **数据与实现归属不变**：MCP = mcp-gateway（`mcp_modules`/`mcp_tools`，页面 /mcp，独立 mcp-admin 源码不在本仓）；Skills = ai-service（技能表 + zip 导入 + `load_skill`，页面 /agents/skills）。二者已有 owner 与验收资产，重复建设会引入新的双份漂移。
- **本演进与它们的关系（只做依赖，不做接管）**：
  - MCP：D4.3 的 `knowledge_*` 工具注册进 mcp-gateway（复用其凭证/审计/job 语义）；Phase1 的 capabilities 中 `type:'mcp'` 接入引擎，消费的是 mcp-gateway 已注册的工具。
  - Skills：本演进只消费 on-demand 挂载与 `skill_load` 事件，不改技能库实现。
- **运营视角的缺口**：当前没有一处能看到"某个 agent 的全部能力资产"（本地 tool / MCP 远程工具 / Skill / 知识集合），需要在四处跳转才知道。可选方案见开放决策 6。
- **超出本范围、需要单独立项的两件事**（点名依赖，不在本 spec 执行）：
  1. 二期「工具元数据入库 + 工具 MCP 化」（`docs/architecture/agent-definition-db-design.md` 未开工）——与本 Phase1 的 capabilities 接入是上下游关系。
  2. 技能版本/技能市场（无既有规划）。

### D6.6 能力资产总览页（开放决策 6 = B，随 Phase2 交付）

- **定位**：只读聚合视图，回答"某个 agent 到底有哪些能力"。**不提供任何增删改，不搬迁任何模块的归属**（MCP 仍归 mcp-gateway / /mcp，Skills 仍归 ai-service / /agents/skills）。
- **路由与权限**：`/agents/capabilities`；权限 `agents:view`（只读）。
- **数据聚合（关键架构点）**：新增 **ai-service 聚合 API**（建议 `GET /admin/agent-capabilities?agentId=`），由 ai-service 拉取自身（agent_definitions.capabilities、技能表、知识集合授权）与 mcp-gateway（mcp_tools 工具清单）后合并返回；**前端不扇出直连多服务**（避免凭证/跨域问题，日后换 owner 只改聚合层）。
- **页面结构**（自上而下）：① agent 选择（`a-select`，选项动态 > 5 时合规）② 四类能力概览卡（本地工具 / MCP 工具 / 技能 / 知识集合，含数量）③ 能力明细表：类型 | 名称 | 来源（代码注册 / mcp-gateway / ai-service 技能库 / knowledge-service）| 状态（启用/停用/未授权）| 更新时间 | 操作（"去 MCP 管理"/"去技能库"/"去知识集合"，跳对应模块页）。
- **只读约束的落地**：本页零写操作；跳转按钮在缺少目标模块权限时 disabled + tooltip 说明所需权限（不静默隐藏、不静默放行）。
- **状态矩阵**：子源聚合失败 → **该能力分区显示错误态 + 重试**，其余分区照常展示（明确的分区失败，不做整页静默降级）；agent 未挂载任何能力 → 空态"该 agent 未挂载能力，去定义管理配置 capabilities"。

## 开放决策（待需求方拍板，写入 tasks 前确认）
1. RAG 载体：A 独立 knowledge-service（推荐，贴合独立库铁律） vs B ai-service 内模块
2. pgvector 引入：是否接受为本仓 Postgres 增加扩展（需 migrations 脚本）
3. 评测第二批触发时点：Phase3 验收后即触发 vs 先积累真实 run 再校准阈值后触发
4. ✅ 已选定（2026-09-08）：**需要高保真拆分**——v1 综合稿（9 页合一）保留为 IA 总览；另产出**逐页独立的高保真原型稿 v2 系列**（每页一份 HTML，含完整导航/真实数据/状态矩阵/分页/交互反馈），作为实现依据。拆分方案与保真度标准见 `ui-prototypes.md`「高保真拆分方案」，首批文件在 `docs/analysis/agent-platform/`
5. ✅ 已确认（2026-09-08）：Web 运营配套范围按 D6.2 全矩阵交付（含 P3 独立检索调试器、P4 收尾跨模块 Dashboard，不后置）；D6.3 权限点设计（knowledge:view/manage、agents:eval、agents:cost:view）已认可
6. ✅ 已选定（2026-09-08）：**B —— 新增只读「能力资产总览」聚合页**（/agents/capabilities，随 Phase2 交付，聚合 API 归 ai-service，页面零写操作、跳回各模块；MCP/Skills 归属不动）。设计见 D6.6，页面规格见 `ui-prototypes.md` 10 号页，原型稿见 `agent-platform_原型_v1_观测与评测.html`「能力资产」
