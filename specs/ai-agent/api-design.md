# ai-agent · 接口契约（api-design）

> 服务：`servers/ai-agent`（端口 6010）
> 本文档由 `scripts/gen-api-design.mjs` 从 Swagger 注解自动提取，作为工程 AI 自进化的接口真相源；字段级 schema 以运行时 Swagger（非 production 环境各服务 `/api/docs`）为准。
> 路径口径：下表为 **controller 注册路径**；经 gateway 对外访问时，需在路径前加对应**外部前缀**（见下）。

## 网关访问前缀

本服务经 gateway 暴露的外部前缀：/api/ai-agent

> 例：若外部前缀为 `/api/auth`、某接口注册路径为 `/auth/login`，则外部可调用路径为 `/api/auth/login`；若注册路径首段已含外部前缀（如 `/ai/agent`），则直接拼接为 `/api/ai/agent`。具体映射以 gateway 的 ProxyController 路由为准。

## 通用约定

- 鉴权标注：`public` = 标记 `@Public()`（免 JWT，但可能需服务间 Bearer Key）；`bearer` = 需 `Authorization: Bearer`；`custom` = 走指定 `@UseGuards`；空白 = 未显式标注，按服务鉴权策略。
- 入参标注：`Param` = 路径参数；`Query` = 查询参数；`Body` = 请求体；`Headers` = 请求头。（已过滤 `@Req/@Res` 框架对象）

## AgentController（`AgentController` → 注册路径基 `agent`）

### GET /api/agent/conversations
- 说明：我的 Agent 对话列表（分页）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:query(ListConversationsDto)

**字段定义**

##### Query 对象 `ListConversationsDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| page | number | 是(默认) |  |
| pageSize | number | 是(默认) |  |
| source | 'chat' | 'tool' | 是(默认) |  |
| agentId | string | 否 |  |


### GET /api/agent/conversations/:id
- 说明：Agent 对话详情（报告快照 + 消息序列）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id

### DELETE /api/agent/conversations/:id
- 说明：删除我的 Agent 对话
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id

### POST /api/agent/run
- 说明：运行 Agent（流式 SSE，返回工具调用与最终回答）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(AgentRunDto)

**字段定义**

##### Body 对象 `AgentRunDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| agentId | string | 否 |  |
| userInput | string | 是(默认) |  |
| conversationId | string | 否 |  |
| model | string | 否 |  |
| source | 'chat' | 'tool' | 否 |  |


### POST /api/agent/admin-run
- 说明：Admin 对话调试运行（需 agents:debug）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(AgentRunDto)

**字段定义**

##### Body 对象 `AgentRunDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| agentId | string | 否 |  |
| userInput | string | 是(默认) |  |
| conversationId | string | 否 |  |
| model | string | 否 |  |
| source | 'chat' | 'tool' | 否 |  |


### GET /api/agent/models
- 说明：列出已注册的可用模型
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/agent/permission/:requestId
- 说明：确认/拒绝 Agent 工具执行的权限请求
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:requestId、Body:body


## OcrController（`OcrController` → 注册路径基 `ocr`）

### POST /api/ocr/recognize
- 说明：OCR 识别合同图片文字，返回识别文本
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(OcrRecognizeDto)

**字段定义**

##### Body 对象 `OcrRecognizeDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| imageBase64 | string | 是(默认) |  |
| scene | string | 否 |  |


