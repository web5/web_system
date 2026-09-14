# content-hub · 接口契约（api-design）

> 服务：`servers/content-hub`（端口 6007）
> 本文档由 `scripts/gen-api-design.mjs` 从 Swagger 注解自动提取，作为工程 AI 自进化的接口真相源；字段级 schema 以运行时 Swagger（非 production 环境各服务 `/api/docs`）为准。
> 路径口径：下表为 **controller 注册路径**；经 gateway 对外访问时，需在路径前加对应**外部前缀**（见下）。

## 网关访问前缀

本服务经 gateway 暴露的外部前缀：/api/finnews, /api/content-hub

> 例：若外部前缀为 `/api/auth`、某接口注册路径为 `/auth/login`，则外部可调用路径为 `/api/auth/login`；若注册路径首段已含外部前缀（如 `/ai/agent`），则直接拼接为 `/api/ai/agent`。具体映射以 gateway 的 ProxyController 路由为准。

## 通用约定

- 鉴权标注：`public` = 标记 `@Public()`（免 JWT，但可能需服务间 Bearer Key）；`bearer` = 需 `Authorization: Bearer`；`custom` = 走指定 `@UseGuards`；空白 = 未显式标注，按服务鉴权策略。
- 入参标注：`Param` = 路径参数；`Query` = 查询参数；`Body` = 请求体；`Headers` = 请求头。（已过滤 `@Req/@Res` 框架对象）

## ContentController（`ContentController` → 注册路径基 `api/content`）

### GET /api/content/sources
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/content/sources
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:body

### PATCH /api/content/sources/:id
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id、Body:body

### DELETE /api/content/sources/:id
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id

### GET /api/content/pipelines
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/content/pipelines
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:body

### PATCH /api/content/pipelines/:id
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id、Body:body

### DELETE /api/content/pipelines/:id
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id

### GET /api/content/items
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/content/publications
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/content/run/:pipeline
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:pipeline

### POST /api/content/wechat/draft
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:body

### POST /api/content/wechat/publish
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:body


## FinnewsController（`FinnewsController` → 注册路径基 `api`）

### GET /api/papers
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/papers/digest
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:body

### GET /api/topics
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/search
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/stock-news
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/sector-hot
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/market-pulse
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/sectors
- 鉴权：未显式标注（按服务鉴权策略）


## InstitutionController（`InstitutionController` → 注册路径基 `api/institution`）

### GET /api/institution/quote
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/institution/north-holding
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/institution/fund-flow
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/institution/lhb
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/institution/rating
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/institution/report
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/institution/valuation
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/institution/chip
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/institution/finance-yoy
- 鉴权：未显式标注（按服务鉴权策略）

