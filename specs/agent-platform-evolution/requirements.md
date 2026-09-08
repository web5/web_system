# Agent 平台演进 · 需求规格（Requirements）

> 来源：brainstorm 收敛（2026-09-08）。承接一期 `specs/agent-platform/`（已验收 27 项 A1~A7）。
> 本文档为规格「需求」件，配套 `design.md`（技术方案）、`tasks.md`（实施清单）。

## 1. 决策记录（已与需求方确认）

| 决策点 | 结论 |
|---|---|
| 平台定位 | 暂不定义；先把功能与架构补齐（不做多租户/计费/开放 API） |
| 自研 vs 托管(ADP) | 引擎/运行时/自家系统耦合自研；通用重件不追产品化；能力资产一律走标准协议(MCP/OpenAI tools/SKILL.md) |
| 执行模型 | 暂缓异步化（不引队列）；长任务继续走 jobId 轮询约定 |
| 评测/观测策略 | 自研落地，但**口径/判据/数据模型全面借用业界成熟定义**：可观测事件 schema 对齐 OTel GenAI SemConv；RAG 评测采用 Ragas 维度；主观判据采用 LLM-as-judge + rubric |
| 首批执行范围 | Phase1 清债 → Phase2 观测地基 → Phase3 RAG → Phase4 评测闭环（依赖前序真实 run 数据校准） |

## 2. 目标

把已具备"单 Agent 流式 ReAct + 工具/MCP/Skill 接入 + 本地确认"最小闭环的 agent 平台，补齐**可编排契约、可记忆、可观测、可评测**四个平台级能力，且不破坏一期已验收行为。

## 3. 非目标（本期不做）

- 多智能体编排（Orchestrator/子 agent/handoff）、规划反思 loop
- 任务队列 / 异步 run worker / Redis
- MCP Client（外连第三方 MCP server）与 OAuth
- 多租户、计费、对外开放 API
- 通用产品级评测/观测 SaaS（不追 Langfuse/ADP 功能面）

## 4. 约束

- monorepo 私有化部署，数据不出内网；技术栈 TS/NestJS/PostgreSQL（mcp-gateway 侧 MySQL）
- 每个微服务独立数据库（铁律）
- `agent-core` 保持零运行时依赖、纯函数可测；新增能力以**可选注入 Port** 形态进入，不破坏一期验收
- 治理横切复用 `@web-system/shared` RBAC 模式
- 类型安全：TS strict、禁止 any；新增领域类型收敛到 `@web-system/types` 或就近包（不再散落）

## 5. 用户故事

- 作为 **admin 运营**，我能看到每个 agent 的 run 量/成功率/token 成本/延迟趋势，并钻取到单次 run 回放
- 作为 **admin 运营**，我能维护某 agent 的评测用例集，在发布新版本前看到"相对当前已发布版本的得分 diff"，关键用例回退则禁止发布
- 作为 **开发者**，我能给任意 agent 挂载文档知识库（RAG），agent 通过 MCP 工具检索并带引用回答
- 作为 **工程师/学习者**，我在引擎里看到的遥测事件字段与 OTel GenAI SemConv、评测口径与 Ragas 对齐，未来可平滑接入外部 LLMOps
- 作为 **admin 运营**，我能在 `/agents` 以页面形态"看到"每个平台模块的状态（定义/运行/成本/知识/评测），并完成配置与治理动作，而非只有 API
- 作为 **admin 运营**，我能维护模型单价，并把一次失败 run 一键沉淀为评测用例（坏例回收）
- 作为 **管理员**，我能按最小权限把知识/成本/评测等新能力授权给对应角色（页面级 403）

## 6. 验收标准（EARS）

### Phase 1 · 清债（契约收敛）
- R1.1 When 一个 AgentDefinition 声明 `capabilities` 含 tool/mcp/skill 三类,系统应按声明注入全部三类能力;而仅 tool/mcp 声明的 agent,引擎运行时不得静默丢失工具
- R1.2 While capability 声明含 config(timeout 等),when 引擎执行该能力,系统应消费其 config;未声明 config 时行为与现状一致
- R1.3 When 任一服务启动,系统不得再注册代码内置 `*.agent.ts` 常量定义的 agent 到运行注册表(DB 为唯一事实源);已注册的代码兜底仅用于 DB 无记录时提示,不静默覆盖
- R1.4 When 用户配置 CLI 使用 `deepseek-v4-flash`/`deepseek-chat`,系统应真实调用对应模型(经 TokenHubClient),而非静默回退 hy3;已弃用的 DeepseekClient 引用清零
- R1.5 When 一次 run 完成,系统应将 token usage(prompt/completion/total) 随 run 落库(观测地基的前置)

### Phase 2 · 观测地基
- R2.1 When 任意来源(ai-agent / ai-service)的一次 run 完成,系统应把该 run 统一收口 ai-service 落库,并携带 `agentVersion`(被测定义版本)快照
- R2.2 While agent 引擎执行,when 发生 llm 调用/工具调用/skill 加载,系统应产出结构化遥测事件(字段对齐 OTel GenAI SemConv:agent/llm/tool span 层级与 `gen_ai.*` 属性名)
- R2.3 When admin 查询成本,系统应按 `model_pricing` 单价与 run usage 给出每 agent/每用户/每模型的成本;单价可后台配置
- R2.4 When admin 打开观测页,系统应展示按日的 run 量/成功率/平均耗时/token/成本趋势,并可下钻到单 run 回放

### Phase 3 · RAG 知识服务
- R3.1 When 运营在任意 agent 声明 knowledge 能力后,该 agent 可通过 `knowledge_search` 工具检索已入库知识,返回内容**携带来源引用**
- R3.2 When 上传文档入库,系统应完成解析分块+向量化;检索按相关度排序且召回率可被 Ragas 三指标(faithfulness / answer relevance / context relevance)评测
- R3.3 While 知识被删除/更新,when 再次检索,系统不得返回已删除内容(一致性)
- R3.4 When 无任何知识集合被授权给某 agent,该 agent 调用 knowledge 工具应得到明确错误,而非空结果静默降级

### Phase 4 · 评测闭环（第二批触发）
- R4.1 When admin 对某 agent 执行评测任务,系统应使用与线上一致的真实引擎与工具链跑完用例(危险工具 `confirm=deny`),不得使用存根/重放伪造结果
- R4.2 When 评测完成,系统应产出:每用例×每判据得分(程序化断言 + LLM-as-judge rubric 双轨)、耗时/成本、相对基线版本的 diff
- R4.3 When 运营点击发布 agent 新版本,系统应自动跑 smoke 用例集;得分回退超阈值或关键用例 fail 时阻止发布并返回 diff 报告
- R4.4 When 运营在 run 详情将一次失败/不满意 run 标记为评测用例,系统应自动生成 eval_case(坏例回收)

### 横切 · Web 运营配套（W，随各 Phase 同批交付）
- W1 When admin 打开 /agents 观测入口,系统应展示 run 量/成功率/成本/延迟趋势,并可下钻到单 run 详情（页面形态落点见 D6.2）
- W2 When 运营管理知识集合,系统应提供集合 CRUD、文档上传与解析状态查看、删除、agent 授权白名单（D6.2/D4.3）
- W3 When 运营管理评测,系统应提供数据集/用例 CRUD、跑批、报告与基线 diff,并在发布动作中呈现 smoke 门禁结果（D6.2/D5.3）
- W4 When 用户缺少新增权限点(knowledge:view/manage / agents:eval / agents:cost:view),访问对应页面与接口应返回 403（复用 v-has-perm / RBAC）
- W5 When 运营在能力资产总览选择某个 agent,系统应聚合展示其四类能力(本地工具/MCP 工具/技能/知识集合)及来源与状态,并提供跳回各模块管理页的入口;本页不提供任何写操作;某子源聚合失败时该分区显示错误态与重试,其余分区照常展示（D6.6）

## 7. 验收方式
- Phase1/2：`servers/*` 内 e2e + 既有验收脚本风格（参照 `specs/agent-platform/acceptance.md`），补充红线回归
- Phase3：Ragas 三指标评测脚本 + 引用命中断言
- Phase4：publish 门禁的通过/拦截两条用例 + judge 一致性抽检
