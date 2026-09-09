# web_system 工程架构总览

> 自动生成：服务器/路由/表/代理/微前端。来源为源码静态扫描。

## 服务清单（servers/*）

- **ai-agent**  — AI Agent 编排服务 - 统一承载 AI 分析/编排能力（合同风险识别等），复用 @kedouai/agent-core
- **ai-service** :6003 — AI 对话服务 - 集成 Hy3 preview 大模型
- **auth-service**  — 认证服务 - 用户名密码登录、微信扫码登录
- **content-hub**  — 内容中枢微服务：财经资讯 + 每日论文 + AI 资讯的采集/去重/LLM 处理/多通道发布
- **deploy-console**  — 部署控制台后端服务
- **gateway**  — API Gateway - 路由、鉴权、静态资源服务
- **knowledge-service** :6011 — RAG 知识服务：集合/文档/分块管理、embedding 向量化、余弦检索（MySQL JSON 向量）
- **mcp-gateway**  — MCP 网关服务：streamable-http 端点 + 模块管理 API
- **system-service** :6004 — 系统管理服务 - 配置、操作日志
- **todo-service**  — Todo List 微服务 - 任务管理
- **upload-service** :6008 — 公共文件上传服务 — 支持头像、画板、变变等场景
- **user-service** :6002 — User management service

### 数据库表（@Entity 表名）

- ai-agent: agent_conversations
- ai-service: agent_definition_versions, agent_definitions, agent_runs, model_pricing, run_metrics, artworks, bianbian_records, conversations, agent_skills
- content-hub: content_items, content_media, content_pipelines, content_publications, content_sources, finnews_entities, finnews_news, finnews_subscriptions, finnews_topics
- deploy-console: audit_logs, config_change_logs, config_items, config_snapshots, deploy_approvals, deploy_canary_rules, deploy_deployments, deploy_env_service_routes, deploy_environments, deploy_module_stage_commands, deploy_modules, deploy_pipeline_templates, deploy_pipelines, deploy_release_events, deploy_release_locks, deploy_servers, deploy_tasks, deploy_tool_catalog, deploy_versions, notification_logs, system_settings
- gateway: deploy_canary_rules, deploy_deployments, deploy_modules, gateway_access_logs, gateway_routes
- knowledge-service: knowledge_chunks, knowledge_collections, knowledge_docs
- mcp-gateway: mcp_jobs, mcp_modules, mcp_tools
- system-service: bianbian_materials, operation_logs, system_configs
- todo-service: todo_tasks
- upload-service: upload_files
- user-service: mcp_api_keys, mcp_key_codes, permissions, role_permissions, roles

### 服务内 Controller 路由（前 80 条/服务）

#### ai-agent

- agent Get conversations
- agent Get conversations/:id
- agent Post run
- agent Post admin-run
- agent Get models
- agent Post permission/:requestId
- ocr Post recognize
#### ai-service

- ai/agent Post run
- admin/agent-defs Get capabilities
- admin/agent-defs Get :id
- admin/agent-defs Put :id
- admin/agent-defs Post :id/publish
- admin/agent-defs Post :id/enabled
- admin/agent-defs Get :id/versions
- admin/agent-defs Post :id/rollback
- admin/agent-defs Delete :id
- internal/agent-definitions Get seed
- agent-runs Get agents
- agent-runs Get metrics
- agent-runs Get :id
- admin/model-pricing Delete :id
- ai Get models
- ai Post chat
- ai Post chat/stream
- ai Get conversations
- ai Get conversations/:id
- ai Delete conversations/:id
- ai Post image/submit
- ai Post image/query
- ai/artworks Delete :id
- bianbian Post transform
- bianbian Get quota/:userId
- bianbian Get records
- bianbian Delete records/:id
- bianbian Get materials
- bianbian Get temp-image/:filename
- bianbian Get admin/stats
- bianbian Get admin/records
- admin/skills Get :code
- admin/skills Put :code
- admin/skills Delete :code
- admin/skills Post import
- internal/skills Get :code
- ai/tts Post speak
#### auth-service

- auth Post login
- auth Post register
- auth Post wechat-login
- auth Post miniprogram-login
- auth Post refresh
- auth Post logout
- auth Get verify
- auth Get wechat/authorize
- auth Get wechat/callback
- auth Post bind-miniprogram
- auth Post bind-official-account
- auth/qrcode Post create
- auth/qrcode Get check
- auth/qrcode Post confirm
- auth/qrcode Get scan
- auth/qrcode Get oauth-url
- user Get profile
- user Get :id
#### content-hub

- api/content Get sources
- api/content Post sources
- api/content Patch sources/:id
- api/content Delete sources/:id
- api/content Get pipelines
- api/content Post pipelines
- api/content Patch pipelines/:id
- api/content Delete pipelines/:id
- api/content Get items
- api/content Get publications
- api/content Post run/:pipeline
- api/content Post wechat/draft
- api/content Post wechat/publish
- api Get papers
- api Get topics
- api Get search
- api Get stock-news
- api Get sector-hot
- api Get market-pulse
- api Get sectors
- api/institution Get quote
- api/institution Get north-holding
- api/institution Get fund-flow
- api/institution Get lhb
- api/institution Get rating
- api/institution Get report
- api/institution Get valuation
- api/institution Get chip
- api/institution Get finance-yoy
#### deploy-console

- audit Get list
- auth Post login
- auth Get profile
- canary Get :id
- canary Put :id
- canary Delete :id
- canary Post :id/preview
- config Get items
- config Put items
- config Delete items/:id
- config Post snapshots
- config Post snapshots/restore
- deploy Post build
- deploy Post deploy
- deploy Post rollback
- deploy Post publish-version
- deploy Post modules/publish
- deploy Get tasks
- deploy Get task/:id
- deploy Get stream/:taskId
- deploy Get versions
- deploy Get modules
- deploy Get module-deployments/:moduleKey
- deploy Get current-versions
- deploy Get releases
- environments Get :id
- environments Put :id
- environments Delete :id
- modules Get :key/branches
- hooks Post release
- mcp Post pipeline
- mcp Get pipeline/:jobId
- mcp Post pipeline/:jobId/cancel
- mcp Post pipeline/:jobId/promote
- mcp Post version
- mcp Post rollback
- mcp Get modules
- mcp Get current-versions
- mcp Get releases
- mcp Post mock-job
- mcp Get mock-job/:jobId
- metrics Get releases/overview
- metrics Get releases/trend
- metrics Get releases/stage-failures
- metrics Get releases/top-modules
- metrics Get releases/failures
- modules Get :key
- modules Put :key
- modules Delete :key
- monitor Get health
- monitor Get pm2
- monitor Get logs
- monitor Post pm2/restart
- monitor Get port
- monitor Get local/pm2
- monitor Get local/health
- monitor Get local/logs
- monitor Post local/pm2/restart
- monitor Get local/port
- notifications Get channels
- pipelines Get meta/releases
- pipelines Get meta/summary
- pipelines Get :id
- pipelines Post :id/cancel
- pipelines Post :id/promote
- pipelines Post :id/retry
- pipelines Post :id/approve
- pipelines Post :id/reject
- pipelines Delete :id
- pipeline-templates Post :id/duplicate
- pipeline-templates Put :id
- pipeline-templates Delete :id
- servers Delete :id
- servers Get overview
- servers Delete :id
- modules Get :key/stage-commands
- modules Get :key/pipeline-script-view
- modules Get stage-commands/templates
- modules Get :key/stage-commands/:stage
- modules Put :key/stage-commands/:stage
#### gateway

- api/auth Post login
- api/auth Post register
- api/auth Post wechat-login
- api/auth Post miniprogram-login
- api/auth All :path(*)
- api/auth Get profile
- api/auth Get :id
- api/auth Put :id
- api/auth Delete :id
- api/auth All :path(*)
- api/auth Post chat
- api/auth Get conversations
- api/auth Post image/submit
- api/auth Post image/query
- api/auth All :path(*)
- Get __version__
- Get __manifest__
- Get health
- Get mini-scan
- api All auth
- api All auth/:path(*)
- api All users
- api All users/:path(*)
- api All keys
- api All keys/:path(*)
- api Post ai/chat/stream
- api Post ai-agent/agent/run
- api Post ai-agent/agent/admin-run
- api All ai-agent
- api All ai-agent/:path(*)
- api Post ai/tts/speak
- api All ai
- api All ai/:path(*)
- api All admin/:path(*)
- api All admin/permissions
- api All admin/permissions/:path(*)
- api All admin/roles
- api All admin/roles/:path(*)
- api All admin/skills
- api All admin/skills/:path(*)
- api All admin/model-pricing
- api All admin/model-pricing/:path(*)
- api All permissions/my
- api All admin
- api All admin/:path(*)
- api All agent-runs
- api All agent-runs/:path(*)
- api All knowledge
- api All knowledge/:path(*)
- api All agent-defs
- api All agent-defs/:path(*)
- api All bianbian
- api All bianbian/:path(*)
- api All todos
- api All todos/:path(*)
- api All upload
- api All upload/:path(*)
- api All mcp
- api All mcp/:path(*)
- api All :path(*)
- api All finnews
- api All finnews/:path(*)
- api All content-hub
- api All content-hub/:path(*)
- api All uploads/bianbian
- api All uploads/bianbian/:path(*)
- api All uploads
- api All uploads/:path(*)
- api All :path(*)
- swagger All auth
- swagger All auth/*
- swagger All ai
- swagger All ai/*
- swagger All user
- swagger All user/*
#### knowledge-service

- knowledge Get collections
- knowledge Post collections
- knowledge Put collections/:id
- knowledge Post collections/:id/toggle
- knowledge Delete collections/:id
- knowledge Get documents
- knowledge Get documents/:id
- knowledge Delete documents/:id
- knowledge Post documents
- knowledge Get search
- knowledge/mcp Get search
- knowledge/mcp Get list
- knowledge/mcp Get status/:docId
- knowledge/mcp Post ingest
- knowledge/mcp Post eval
- knowledge/mcp Post delete
#### mcp-gateway

- api/modules Put :id
- api/modules Delete :id
- api/modules Post :id/toggle
- Post mcp
- Get mcp
- Delete mcp
- Post mcp/:module
- Get mcp/:module
- Delete mcp/:module
- Post mcp/tools/call
#### system-service

- admin/bianbian Get categories
- admin/bianbian Get materials
- admin/bianbian Post materials
- admin/bianbian Put materials/:id
- admin/bianbian Delete materials/:id
- admin/bianbian Put materials/sort
- admin/bianbian Put materials/batch/toggle
- admin/bianbian Post seed
- admin/db Get tables
- admin/db Get tables/:name/schema
- admin/db Get tables/:name/rows
- admin/db Post query
- admin/settings Get public/:key
#### todo-service

- todos Get stats
- todos Get :id
- todos Put :id
- todos Delete :id
- todos Patch :id/status
#### upload-service

- upload Get categories
- upload Post avatar
- upload Post drawing
- upload Post bianbian
- upload Post general
#### user-service

- keys Post apply
- keys Post verify
- keys Get mine
- keys Delete mine/:id
- keys Delete :id
- internal/keys Post verify
- internal/roles Post permissions
- Get admin/permissions
- Get admin/roles
- Post admin/roles
- Put admin/roles/:code
- Delete admin/roles/:code
- Get permissions/my
- users Get me
- users Put me
- users Post me/avatar
- users Get profile
- users Get :id
- users Put :id
- users Delete :id

## gateway 代理路由（/api 前缀）

- /apiauth
- /apiauth/:path(*)
- /apiusers
- /apiusers/:path(*)
- /apikeys
- /apikeys/:path(*)
- /apiai-agent
- /apiai-agent/:path(*)
- /apiai
- /apiai/:path(*)
- /apiadmin/:path(*)
- /apiadmin/permissions
- /apiadmin/permissions/:path(*)
- /apiadmin/roles
- /apiadmin/roles/:path(*)
- /apiadmin/skills
- /apiadmin/skills/:path(*)
- /apiadmin/model-pricing
- /apiadmin/model-pricing/:path(*)
- /apipermissions/my
- /apiadmin
- /apiadmin/:path(*)
- /apiagent-runs
- /apiagent-runs/:path(*)
- /apiknowledge
- /apiknowledge/:path(*)
- /apiagent-defs
- /apiagent-defs/:path(*)
- /apibianbian
- /apibianbian/:path(*)
- /apitodos
- /apitodos/:path(*)
- /apiupload
- /apiupload/:path(*)
- /apimcp
- /apimcp/:path(*)
- /api:path(*)
- /apifinnews
- /apifinnews/:path(*)
- /apicontent-hub
- /apicontent-hub/:path(*)
- /apiuploads/bianbian
- /apiuploads/bianbian/:path(*)
- /apiuploads
- /apiuploads/:path(*)
- /api:path(*)

## 共享包（packages/*）

- agent-core — 科豆 AI Agent 核心库（纯 TS，零运行时依赖）：ReAct 引擎、工具/Agent/Client 注册表、模型客户端、记忆与摘要压缩
- kedou-agent — 科豆 AI Agent CLI —— 基于 @kedouai/agent-core 的交互式 AI Agent（自带大模型 API key，不消耗作者 token）
- mcp-core — MCP 核心能力：模块注册 + 声明式 HTTP→MCP 转换（框架无关，可复用）
- shared — 共享工具函数和常量
- shell-loader — 自研微前端模块加载器（不依赖第三方库）
- types — 共享 TypeScript 类型定义
- ui — 公共 UI 规范：设计 token + AntD 主题 + 组件注册清单

## 端口与部署登记

- deploy-local.sh BACKENDS 与 ecosystem.config.js 为部署事实源；health-check.sh SERVICES 为巡检清单。

## 前端微前端（apps/admin）

- 路由与权限：19 条页面路由
- /login  / BasicLayout.vue  / dashboard:view
- settings  / Settings.vue  / settings:view
- settings/roles  / RoleManagement.vue  / roles:manage
- settings/models  / ModelPricingPage.vue  / agents:cost:view
- mcp  / McpAdminPanel.vue  / mcp:view
- bianbian  / BianbianManage.vue  / bianbian:view
- agents  / AgentOverview.vue  / agents:view
- metrics  / MetricsPage.vue  / agents:view
- capabilities  / CapabilitiesPage.vue  / agents:view
- knowledge  / KnowledgeCollectionsPage.vue  / knowledge:view
- retrieval  / RetrievalDebuggerPage.vue  / agents:debug
- runs/:agentId  / AgentRuns.vue  / agents:view
- runs/:agentId/run/:id  / AgentRunDetail.vue  / agents:view
- definitions  / AgentDefList.vue  / agents:manage
- skills  / SkillList.vue  / skills:view
- playground  / AgentPlayground.vue  / agents:debug
- users  / UserList.vue  / users:view
- :id  / UserDetail.vue  / users:view
- database  / DataBrowser.vue  / database:view