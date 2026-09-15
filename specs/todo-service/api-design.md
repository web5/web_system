# todo-service · 接口契约（api-design）

> 服务：`servers/todo-service`（端口 6005）
> 本文档由 `scripts/gen-api-design.mjs` 从 Swagger 注解自动提取，作为工程 AI 自进化的接口真相源；字段级 schema 以运行时 Swagger（非 production 环境各服务 `/api/docs`）为准。
> 路径口径：下表为 **controller 注册路径**；经 gateway 对外访问时，需在路径前加对应**外部前缀**（见下）。

## 网关访问前缀

本服务经 gateway 暴露的外部前缀：/api/todos

> 例：若外部前缀为 `/api/auth`、某接口注册路径为 `/auth/login`，则外部可调用路径为 `/api/auth/login`；若注册路径首段已含外部前缀（如 `/ai/agent`），则直接拼接为 `/api/ai/agent`。具体映射以 gateway 的 ProxyController 路由为准。

## 通用约定

- 鉴权标注：`public` = 标记 `@Public()`（免 JWT，但可能需服务间 Bearer Key）；`bearer` = 需 `Authorization: Bearer`；`custom` = 走指定 `@UseGuards`；空白 = 未显式标注，按服务鉴权策略。
- 入参标注：`Param` = 路径参数；`Query` = 查询参数；`Body` = 请求体；`Headers` = 请求头。（已过滤 `@Req/@Res` 框架对象）

## TodoController（`TodoController` → 注册路径基 `todos`）

### GET /api/todos/
- 说明：获取任务列表
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:query(QueryTodoDto)

**字段定义**

##### Query 对象 `QueryTodoDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| page | number | 否 |  |
| pageSize | number | 否 |  |
| status | string | 否 |  |
| priority | string | 否 |  |
| category | string | 否 |  |
| keyword | string | 否 |  |
| sortBy | string | 否 |  |
| sortOrder | 'asc' | 'desc' | 否 |  |


### GET /api/todos/stats
- 说明：获取任务统计
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:period

### GET /api/todos/:id
- 说明：获取任务详情
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id

### POST /api/todos/
- 说明：创建任务
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:createTodoDto(CreateTodoDto)

**字段定义**

##### Body 对象 `CreateTodoDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| title | string | 是(默认) |  |
| description | string | 否 |  |
| priority | TodoPriority | 否 |  |
| category | TodoCategory[] | 否 |  |
| due_date | string | 否 |  |


### PUT /api/todos/:id
- 说明：更新任务
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id、Body:updateTodoDto(UpdateTodoDto)

**字段定义**

##### Body 对象 `UpdateTodoDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| title | string | 否 |  |
| description | string | 否 |  |
| status | TodoStatus | 否 |  |
| priority | TodoPriority | 否 |  |
| category | TodoCategory[] | 否 |  |
| due_date | string | 否 |  |


### DELETE /api/todos/:id
- 说明：删除任务
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id

### PATCH /api/todos/:id/status
- 说明：更新任务状态
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id、Body:status

