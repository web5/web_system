# Agent 平台玩法（agent-core / ai-agent / ai-service / mcp-gateway / knowledge）

> 自动生成 + specs/agent-platform-evolution 指引。

## 核心原则

- DB 是 Agent 定义的唯一事实源（代码 *.agent.ts 已废弃，seed 只补录缺失）。
- capabilities 三类引用：tool(代码注册) / mcp(module/tool) / skill；capability 可带 config（timeout/longRunning/requiresConfirm/collectionId）。
- MCP 工具 = mcp-gateway 声明式 seed（代码常量 → mcp_modules/mcp_tools），模块级启停，运行时 mcp-core 转发。
- 知识集合授权（决策 7=C）：集合不设白名单，agent 定义 capabilities 里 `{type:mcp,ref:knowledge/<tool>,config:{collectionId}}` 显式绑定即授权。
- 观测/成本：run 落 ai-service（agent_runs 含 usage/cost/agentVersion）+ run_metrics 日聚合 + model_pricing 单价。

## MCP 模块与工具

- seed 模块 code_key: paper, institution, finnews, knowledge, wechat_mp, deploy

- `get_latest_topics`
- `search_news`
- `get_stock_news`
- `get_sector_hot`
- `get_sector_library`
- `get_market_pulse`
- `knowledge_search`
- `knowledge_list`
- `knowledge_status`
- `knowledge_ingest`
- `knowledge_delete`
- `create_wechat_draft`
- `publish_to_wechat`
- `fetch_papers`
- `get_quote`
- `get_north_holding`
- `get_fund_flow`
- `get_lhb`
- `get_rating`
- `get_report`
- `get_valuation`
- `get_chip`
- `get_finance_yoy`
- `list_modules`
- `get_current_versions`
- `list_releases`
- `publish_version`
- `rollback`
- `promote_release`
- `publish_pipeline`
- `mock_job`

## 权限点清单（packages/types）

- `dashboard:view`
- `users:view`
- `users:create`
- `users:edit`
- `users:delete`
- `settings:view`
- `settings:edit`
- `roles:view`
- `roles:manage`
- `logs:view`
- `bianbian:view`
- `bianbian:manage`
- `mcp:view`
- `agents:view`
- `agents:debug`
- `agents:manage`
- `skills:view`
- `skills:manage`
- `database:view`
- `database:query`
- `agents:eval`
- `knowledge:view`
- `knowledge:manage`

## 本演进规格（specs/agent-platform-evolution）

- design.md
- requirements.md
- tasks.md
- ui-prototypes.md

## Admin 页面（路由/权限）

- /login | BasicLayout.vue | dashboard:view
- settings | Settings.vue | settings:view
- settings/roles | RoleManagement.vue | roles:manage
- settings/models | ModelPricingPage.vue | agents:cost:view
- mcp | McpAdminPanel.vue | mcp:view
- bianbian | BianbianManage.vue | bianbian:view
- agents | AgentOverview.vue | agents:view
- metrics | MetricsPage.vue | agents:view
- capabilities | CapabilitiesPage.vue | agents:view
- knowledge | KnowledgeCollectionsPage.vue | knowledge:view
- retrieval | RetrievalDebuggerPage.vue | agents:debug
- runs/:agentId | AgentRuns.vue | agents:view
- runs/:agentId/run/:id | AgentRunDetail.vue | agents:view
- definitions | AgentDefList.vue | agents:manage
- skills | SkillList.vue | skills:view
- playground | AgentPlayground.vue | agents:debug
- users | UserList.vue | users:view
- :id | UserDetail.vue | users:view
- database | DataBrowser.vue | database:view