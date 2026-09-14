# mcp-gateway · 接口契约（api-design）

> 服务：`servers/mcp-gateway`（端口 6006）
> 本文档由 `scripts/gen-api-design.mjs` 从 Swagger 注解自动提取，作为工程 AI 自进化的接口真相源；字段级 schema 以运行时 Swagger（非 production 环境各服务 `/api/docs`）为准。
> 路径口径：下表为 **controller 注册路径**；经 gateway 对外访问时，需在路径前加对应**外部前缀**（见下）。

## 网关访问前缀

本服务经 gateway 暴露的外部前缀：/api/mcp

> 例：若外部前缀为 `/api/auth`、某接口注册路径为 `/auth/login`，则外部可调用路径为 `/api/auth/login`；若注册路径首段已含外部前缀（如 `/ai/agent`），则直接拼接为 `/api/ai/agent`。具体映射以 gateway 的 ProxyController 路由为准。

## 通用约定

- 鉴权标注：`public` = 标记 `@Public()`（免 JWT，但可能需服务间 Bearer Key）；`bearer` = 需 `Authorization: Bearer`；`custom` = 走指定 `@UseGuards`；空白 = 未显式标注，按服务鉴权策略。
- 入参标注：`Param` = 路径参数；`Query` = 查询参数；`Body` = 请求体；`Headers` = 请求头。（已过滤 `@Req/@Res` 框架对象）

## AdminController（`AdminController` → 注册路径基 `api/modules`）

### GET /api/modules/
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/modules/
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto

### PUT /api/modules/:id
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id、Body:dto

### DELETE /api/modules/:id
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id

### POST /api/modules/:id/toggle
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id、Body:body


## DebugController（`DebugController` → 注册路径基 `api/debug`）

### POST /api/debug/
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto


## McpController（`McpController` → 注册路径基 `/`）

### POST /api/mcp
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/mcp
- 鉴权：未显式标注（按服务鉴权策略）

### DELETE /api/mcp
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/mcp/:module
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:module

### GET /api/mcp/:module
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:module

### DELETE /api/mcp/:module
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:module

### POST /api/mcp/tools/call
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:body

