# ai-service · 接口契约（api-design）

> 服务：`servers/ai-service`（端口 6003）
> 本文档由 `scripts/gen-api-design.mjs` 从 Swagger 注解自动提取，作为工程 AI 自进化的接口真相源；字段级 schema 以运行时 Swagger（非 production 环境各服务 `/api/docs`）为准。
> 路径口径：下表为 **controller 注册路径**；经 gateway 对外访问时，需在路径前加对应**外部前缀**（见下）。

## 网关访问前缀

本服务经 gateway 暴露的外部前缀：/api/ai, /api/agent-defs, /api/agent-runs, /api/admin/skills, /api/bianbian

> 例：若外部前缀为 `/api/auth`、某接口注册路径为 `/auth/login`，则外部可调用路径为 `/api/auth/login`；若注册路径首段已含外部前缀（如 `/ai/agent`），则直接拼接为 `/api/ai/agent`。具体映射以 gateway 的 ProxyController 路由为准。

## 通用约定

- 鉴权标注：`public` = 标记 `@Public()`（免 JWT，但可能需服务间 Bearer Key）；`bearer` = 需 `Authorization: Bearer`；`custom` = 走指定 `@UseGuards`；空白 = 未显式标注，按服务鉴权策略。
- 入参标注：`Param` = 路径参数；`Query` = 查询参数；`Body` = 请求体；`Headers` = 请求头。（已过滤 `@Req/@Res` 框架对象）

## AgentController（`AgentController` → 注册路径基 `ai/agent`）

### POST /api/ai/agent/run
- 说明：运行 Agent（流式 SSE，返回工具调用与最终回答）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(AgentRunDto)

**字段定义**

##### Body 对象 `AgentRunDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| agentId | string | 是(默认) |  |
| userInput | string | 是(默认) |  |
| conversationId | string | 否 |  |



## AgentDefController（`AgentDefController` → 注册路径基 `admin/agent-defs`）

### GET /api/admin/agent-defs/
- 说明：列所有 Agent 定义
- 鉴权：Bearer JWT

### GET /api/admin/agent-defs/capabilities
- 说明：能力资产总览（按 agent 聚合四类能力，只读）
- 鉴权：Bearer JWT

### GET /api/admin/agent-defs/:id
- 说明：Agent 定义详情
- 鉴权：Bearer JWT
- 入参：Param:id

### POST /api/admin/agent-defs/
- 说明：新建 Agent 定义（草稿）
- 鉴权：Bearer JWT
- 入参：Body:dto(SaveAgentDefDto)

**字段定义**

##### Body 对象 `SaveAgentDefDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是(默认) |  |
| name | string | 是(默认) |  |
| systemPrompt | string | 是(默认) |  |
| model | string | 是(默认) |  |
| tools | string[] | 是(默认) |  |
| capabilities | CapabilityRef[] | 否 |  |
| maxSteps | number | 是(默认) |  |
| temperature | number | null | 否 |  |
| memory | MemoryDto | 是(默认) |  |
| streaming | boolean | 否 |  |


### PUT /api/admin/agent-defs/:id
- 说明：保存 Agent 定义草稿（不发布）
- 鉴权：Bearer JWT
- 入参：Param:id、Body:dto(SaveAgentDefDto)

**字段定义**

##### Body 对象 `SaveAgentDefDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是(默认) |  |
| name | string | 是(默认) |  |
| systemPrompt | string | 是(默认) |  |
| model | string | 是(默认) |  |
| tools | string[] | 是(默认) |  |
| capabilities | CapabilityRef[] | 否 |  |
| maxSteps | number | 是(默认) |  |
| temperature | number | null | 否 |  |
| memory | MemoryDto | 是(默认) |  |
| streaming | boolean | 否 |  |


### POST /api/admin/agent-defs/:id/publish
- 说明：发布为新版本（生效）
- 鉴权：Bearer JWT
- 入参：Param:id、Body:dto(PublishDto)

**字段定义**

##### Body 对象 `PublishDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| changeNote | string | 否 |  |


### POST /api/admin/agent-defs/:id/enabled
- 说明：启用/停用 Agent
- 鉴权：Bearer JWT
- 入参：Param:id、Body:dto(SetEnabledDto)

**字段定义**

##### Body 对象 `SetEnabledDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| enabled | boolean | 是(默认) |  |


### GET /api/admin/agent-defs/:id/versions
- 说明：历史版本列表
- 鉴权：Bearer JWT
- 入参：Param:id

### POST /api/admin/agent-defs/:id/rollback
- 说明：回滚到指定版本并发布
- 鉴权：Bearer JWT
- 入参：Param:id、Body:dto(RollbackDto)

**字段定义**

##### Body 对象 `RollbackDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| versionId | string | 是(默认) |  |


### DELETE /api/admin/agent-defs/:id
- 说明：删除 Agent 定义（谨慎）
- 鉴权：Bearer JWT
- 入参：Param:id


## AgentDefInternalController（`AgentDefInternalController` → 注册路径基 `internal/agent-definitions`）

### GET /api/internal/agent-definitions/
- 说明：返回所有已发布且启用的 Agent 定义
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/internal/agent-definitions/seed
- 说明：seed 内置 Agent 定义到 DB（仅空表时执行）
- 鉴权：未显式标注（按服务鉴权策略）


## AgentLogController（`AgentLogController` → 注册路径基 `agent-runs`）

### GET /api/agent-runs/agents
- 说明：列出所有 agent（聚合，含总数/最近一次/错误数）
- 鉴权：Bearer JWT

### GET /api/agent-runs/metrics
- 说明：run 日指标（run_metrics）
- 鉴权：Bearer JWT

### GET /api/agent-runs/
- 说明：分页列出 agent runs
- 鉴权：Bearer JWT

### GET /api/agent-runs/:id
- 说明：查看某次 run 的完整原始数据
- 鉴权：Bearer JWT
- 入参：Param:id


## AgentLogInternalController（`AgentLogInternalController` → 注册路径基 `internal/agent-runs`）

### POST /api/internal/agent-runs/
- 说明：ai-agent 推送一次 run 记录
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:body


## AiController（`AiController` → 注册路径基 `ai`）

### GET /api/ai/models
- 说明：获取可用AI模型列表
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/ai/chat
- 说明：非流式AI对话
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:chatDto(ChatDto)

**字段定义**

##### Body 对象 `ChatDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| messages | ChatMessageDto[] | 是(默认) |  |
| conversationId | string | 否 |  |
| temperature | number | 否 |  |
| maxTokens | number | 否 |  |
| model | string | 否 |  |


### POST /api/ai/chat/stream
- 说明：流式AI对话（SSE）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:chatDto(ChatDto)

**字段定义**

##### Body 对象 `ChatDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| messages | ChatMessageDto[] | 是(默认) |  |
| conversationId | string | 否 |  |
| temperature | number | 否 |  |
| maxTokens | number | 否 |  |
| model | string | 否 |  |


### GET /api/ai/conversations
- 说明：获取对话历史列表
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/ai/conversations/:id
- 说明：获取对话详情
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id

### DELETE /api/ai/conversations/:id
- 说明：删除对话
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id

### POST /api/ai/image/submit
- 说明：提交AI图片生成任务
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:submitDto(ImageSubmitDto)

**字段定义**

##### Body 对象 `ImageSubmitDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| prompt | string | 是(默认) | 图片生成提示词 |


### POST /api/ai/image/query
- 说明：查询图片生成任务结果
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:queryDto(ImageQueryDto)

**字段定义**

##### Body 对象 `ImageQueryDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 是(默认) | 任务 ID |



## ArtworksController（`ArtworksController` → 注册路径基 `ai/artworks`）

### POST /api/ai/artworks/
- 说明：保存作品到相册
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(SaveArtworkDto)

**字段定义**

##### Body 对象 `SaveArtworkDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| userId | number | 是(默认) |  |
| title | string | 是(默认) |  |
| imageUrl | string | 否 |  |
| originalImageUrl | string | 否 |  |
| sourceType | 'bianbian' | 'draw-ai' | 'design' | 'ai-art' | 是(默认) |  |
| prompt | string | 否 |  |
| metadata | Record<string, unknown> | 否 |  |


### GET /api/ai/artworks/
- 说明：获取用户相册作品列表
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:userId

### DELETE /api/ai/artworks/:id
- 说明：删除相册作品
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id、Query:userId


## BianbianController（`BianbianController` → 注册路径基 `bianbian`）

### POST /api/bianbian/transform
- 说明：变变 AI 变身 - 上传拼接作品，生成 3D 角色
- 鉴权：Bearer JWT
- 入参：Body:dto(TransformDto)

**字段定义**

##### Body 对象 `TransformDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| description | '画布导出的图片（base64 data URL，如 data:image/jpeg;base64,...）', | 是(默认) |  |
| example | 'data:image/jpeg;base64,/9j/4AAQSkZJRg...', | 是(默认) |  |
| image | string | 是(默认) |  |
| description | '用户对作品的描述（可选，用于辅助 AI 理解画面意图）', | 是(默认) |  |
| example | '一只可爱的小猫在草地上玩耍', | 是(默认) |  |
| description | string | 否 |  |
| description | '目标风格', | 是(默认) |  |
| example | 'pixar-3d', | 是(默认) |  |
| style | string | 否 |  |
| description | '输出尺寸', | 是(默认) |  |
| example | '1024x1024', | 是(默认) |  |
| outputSize | string | 否 |  |
| description | '用户 ID', | 是(默认) |  |
| userId | string | 否 |  |
| description | '用户角色（admin 免次数限制）', | 是(默认) |  |
| type | [String], | 是(默认) |  |
| roles | string[] | 否 |  |


### GET /api/bianbian/quota/:userId
- 说明：查询用户当日剩余变身次数
- 鉴权：Bearer JWT
- 入参：Param:userId

### GET /api/bianbian/records
- 说明：获取用户的变身记录列表
- 鉴权：Bearer JWT
- 入参：Query:userId、Query:page、Query:pageSize

### DELETE /api/bianbian/records/:id
- 说明：删除一条变身记录
- 鉴权：Bearer JWT
- 入参：Param:id、Query:userId

### GET /api/bianbian/materials
- 说明：获取公开素材列表（供 Portal/小程序使用）
- 鉴权：Bearer JWT

### GET /api/bianbian/temp-image/:filename
- 说明：获取临时参考图片（内部使用）
- 鉴权：Bearer JWT
- 入参：Param:filename

### GET /api/bianbian/admin/stats
- 说明：变变数据总览（管理员）
- 鉴权：Bearer JWT

### GET /api/bianbian/admin/records
- 说明：变身记录列表（管理员，跨用户）
- 鉴权：Bearer JWT
- 入参：Query:page、Query:pageSize、Query:userId


## SkillController（`SkillController` → 注册路径基 `admin/skills`）

### GET /api/admin/skills/
- 说明：技能列表
- 鉴权：Bearer JWT

### GET /api/admin/skills/:code
- 说明：技能详情（含正文）
- 鉴权：Bearer JWT
- 入参：Param:code

### POST /api/admin/skills/
- 说明：新建技能
- 鉴权：Bearer JWT
- 入参：Body:dto(SaveSkillDto)

**字段定义**

##### Body 对象 `SaveSkillDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| code | string | 是(默认) |  |
| name | string | 是(默认) |  |
| description | string | 是(默认) |  |
| version | string | 否 |  |
| content | string | 是(默认) |  |
| requiredTools | string[] | 否 |  |
| enabled | boolean | 否 |  |
| code | string | 是(默认) |  |
| name | string | 是(默认) |  |
| description | string | 是(默认) |  |
| version | string | 是(默认) |  |
| content | string | 是(默认) |  |


### PUT /api/admin/skills/:code
- 说明：编辑技能（全量覆盖）
- 鉴权：Bearer JWT
- 入参：Param:code、Body:dto(SaveSkillDto)

**字段定义**

##### Body 对象 `SaveSkillDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| code | string | 是(默认) |  |
| name | string | 是(默认) |  |
| description | string | 是(默认) |  |
| version | string | 否 |  |
| content | string | 是(默认) |  |
| requiredTools | string[] | 否 |  |
| enabled | boolean | 否 |  |
| code | string | 是(默认) |  |
| name | string | 是(默认) |  |
| description | string | 是(默认) |  |
| version | string | 是(默认) |  |
| content | string | 是(默认) |  |


### DELETE /api/admin/skills/:code
- 说明：删除技能
- 鉴权：Bearer JWT
- 入参：Param:code

### POST /api/admin/skills/import
- 说明：zip 技能包一键导入（解析 SKILL.md frontmatter + 正文）
- 鉴权：Bearer JWT


## SkillInternalController（`SkillInternalController` → 注册路径基 `internal/skills`）

### GET /api/internal/skills/:code
- 说明：按 code 返回技能完整定义（含正文，供 on-demand 加载）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:code


## TtsController（`TtsController` → 注册路径基 `ai/tts`）

### POST /api/ai/tts/speak
- 说明：文字转语音（TTS）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:body

