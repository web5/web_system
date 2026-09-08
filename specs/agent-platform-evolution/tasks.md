# Agent 平台演进 · 实施清单（Tasks）

> 承接 `requirements.md` R1~R4 + W1~W4 与 `design.md` D1~D6。每项给出依赖与验收引用。
> 执行顺序 = Phase 1 → 2 → 3（→ 4 由需求方确认触发）。每 Phase 后端能力与其 Web 配套（D6.2）同批交付。
> **UI 原型稿已产出：`specs/agent-platform-evolution/ui-prototypes.md`（9 页规格书）。写码前逐页按该规格执行，不再另产 page-spec。**

## Phase 1 · 清债（契约收敛，无独立 UI，影响 run 详情展示字段）
- [ ] 1.1 agent-core：CapabilityRef 三类型(tool/mcp/skill)统一接入引擎 + config 消费（D1.1）→ 验收 R1.1/R1.2；跑一期验收回归不回归
- [ ] 1.2 agent-core：ToolParameter 支持 enum/嵌套 array（D1.2）
- [ ] 1.3 agent-core：移除/收口 DeepseekClient 与死码，清理 fetch-http 导出（D1.3）→ 验收 R1.4 关联
- [ ] 1.4 kedou-agent：注册 TokenHubClient、修正 CLI config 与 deploy-assistant model（D1.3）→ 验收 R1.4
- [ ] 1.5 删除代码内置 `*.agent.ts` 常量，DB 为唯一事实源；同步器归一（D2）→ 验收 R1.3
- [ ] 1.6 usage(prompt/completion/total) 随 run 落库（D3.2 前置子项）→ 验收 R1.5

## Phase 2 · 观测地基（依赖 1.6；含 Web 配套）
- [ ] 2.1 agent-core 增加 TelemetryPort（no-op 默认）并在 AgentRunner 装配点接入（D3.1）
- [ ] 2.2 ai-service/ai-agent 实现 TelemetryPort 落库实现（D3.1/D3.2）→ 验收 R2.1/R2.2
- [ ] 2.3 agent_runs 扩展列(agentVersion/usage/cost) 迁移（D3.2）
- [ ] 2.4 新表 model_pricing + run_metrics + 聚合任务（D3.3）→ 验收 R2.3
- [ ] 2.5 run 数据统一收口 ai-service（双 harness 归一完成态）→ 验收 R2.1
- [ ] 2.6 admin 观测页：趋势/成本/成功率/下钻（D3.4 + D6.2/ui-prototypes 观测台）→ 验收 R2.4/W1
- [ ] 2.7 run 详情页增强：展示 agentVersion/token/成本/耗时（ui-prototypes 3 号页）
- [ ] 2.8 模型单价配置页 + 新增权限点落地（ui-prototypes 4 号页）→ 验收 W4
- [ ] 2.9 ai-service 能力聚合 API + 能力资产总览页（只读聚合 + 跳转，D6.6/ui-prototypes 10 号页）→ 验收 W5
- [ ] 2.10 **admin 框架整合（横切，首个 UI 批次先做）**：router 新增路由 + `BasicLayout` 菜单三处同步 + `packages/types` 权限点与 `ROLE_PERMISSIONS` + `RoleManagement.GROUP_LABELS`（依据 ui-prototypes「与 admin 现有框架整合」§3/§4）

## Phase 3 · RAG 知识服务（可与 Phase2 并行；含 Web 配套）
- [ ] 3.1 选定载体(开放决策1/2) → 建表 + pgvector 迁移（D4.2）
- [ ] 3.2 EmbeddingProvider 抽象 + 默认提供方接入（D4.3）
- [ ] 3.3 文档入库解析分块 + 向量化异步任务（D4.2/4.3）
- [ ] 3.4 MCP 工具族 knowledge_* 注册进 mcp-gateway + 授权校验（D4.3）→ 验收 R3.1/R3.3/R3.4
- [ ] 3.5 Ragas 三指标评测脚本（D4.3 口径）→ 验收 R3.2
- [ ] 3.6 知识集合管理页：集合 CRUD/文档上传/解析状态/删除/agent 授权（ui-prototypes 5 号页）→ 验收 W2
- [ ] 3.7 权限点 knowledge:view/manage 落地（D6.3）→ 验收 W4
- [ ] 3.8 检索调试器页：query → top-k 命中/score/来源（ui-prototypes 6 号页）

## Phase 4 · 评测闭环（依赖 Phase1/2，触发时点=开放决策3；含 Web 配套）
- [ ] 4.1 eval 三表建库 + admin 用例集 CRUD（D5.1）
- [ ] 4.2 eval Runner（真实引擎非流式 + confirm=deny + 超时/预算截断，D5.2）
- [ ] 4.3 双轨判据执行器：程序化断言 + LLM-as-judge rubric（D5.2）
- [ ] 4.4 publish 门禁 + diff 报告 + 未配 smoke 集提示（D5.3）→ 验收 R4.1~R4.3
- [ ] 4.5 坏例回收（run 详情 → eval_case，D5.2）→ 验收 R4.4
- [ ] 4.6 评测台页面：数据集/用例 CRUD + 批量导入 + badcase 回收入口 + 报告与基线 diff（ui-prototypes 7 号页）→ 验收 W3
- [ ] 4.7 发布弹窗集成 smoke 门禁结果与 diff 展示（ui-prototypes 8 号页）→ R4.3 页面形态
- [ ] 4.8 权限点 agents:eval / agents:cost:view 落地（D6.3）→ 验收 W4
- [ ] 4.9 跨模块总览 Dashboard：agent/知识/评测健康与成本聚合（ui-prototypes 2 号页，随评测收尾交付）

## 验收汇总（每个 Phase 结束时跑）
- [ ] 对照 requirements.md R*/W* 逐条过；Phase1 额外跑一期验收（specs/agent-platform/acceptance.md）不回归
