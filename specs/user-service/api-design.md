# user-service · 接口契约（api-design）

> 服务：`servers/user-service`（端口 6002）
> 本文档由 `scripts/gen-api-design.mjs` 从 Swagger 注解自动提取，作为工程 AI 自进化的接口真相源；字段级 schema 以运行时 Swagger（非 production 环境各服务 `/api/docs`）为准。
> 路径口径：下表为 **controller 注册路径**；经 gateway 对外访问时，需在路径前加对应**外部前缀**（见下）。

## 网关访问前缀

本服务经 gateway 暴露的外部前缀：/api/users, /api/keys, /api/permissions/my, /api/admin/permissions, /api/admin/roles, /api/uploads(静态)

> 例：若外部前缀为 `/api/auth`、某接口注册路径为 `/auth/login`，则外部可调用路径为 `/api/auth/login`；若注册路径首段已含外部前缀（如 `/ai/agent`），则直接拼接为 `/api/ai/agent`。具体映射以 gateway 的 ProxyController 路由为准。

## 通用约定

- 鉴权标注：`public` = 标记 `@Public()`（免 JWT，但可能需服务间 Bearer Key）；`bearer` = 需 `Authorization: Bearer`；`custom` = 走指定 `@UseGuards`；空白 = 未显式标注，按服务鉴权策略。
- 入参标注：`Param` = 路径参数；`Query` = 查询参数；`Body` = 请求体；`Headers` = 请求头。（已过滤 `@Req/@Res` 框架对象）

## ApiKeyController（`ApiKeyController` → 注册路径基 `keys`）

### POST /api/keys/apply
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto

### POST /api/keys/verify
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto

### GET /api/keys/mine
- 鉴权：未显式标注（按服务鉴权策略）

### DELETE /api/keys/mine/:id
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id

### GET /api/keys/
- 鉴权：未显式标注（按服务鉴权策略）

### DELETE /api/keys/:id
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id


## InternalKeyController（`InternalKeyController` → 注册路径基 `internal/keys`）

### POST /api/internal/keys/verify
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto


## GlossaryController（`GlossaryController` → 注册路径基 `glossary`）

### POST /api/glossary/
- 说明：收藏一条译文（幂等）
- 鉴权：Bearer JWT
- 入参：Body:dto(CreateGlossaryDto)

**字段定义**

##### Body 对象 `CreateGlossaryDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| sourceType | 'chat' | 'translate' | 是(默认) | 来源 |
| sourceText | string | 否 |  |
| enMain | string | 是(默认) | 英文译文主文 |
| note | string | 否 |  |
| meta | Record<string, unknown> | 否 |  |
| conversationId | string | 否 |  |


### GET /api/glossary/
- 说明：我的收藏列表（分页）
- 鉴权：Bearer JWT

### DELETE /api/glossary/:id
- 说明：删除一条收藏
- 鉴权：Bearer JWT
- 入参：Param:id


## InternalController（`InternalController` → 注册路径基 `internal`）

### POST /api/internal/user-memory/upsert
- 说明：AI 异步写入用户记忆（upsert/remove）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(UpsertMemoryDto)

**字段定义**

##### Body 对象 `UpsertMemoryDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| userId | string | 是(默认) |  |
| items | UpsertMemoryItemDto[] | 是(默认) |  |
| sourceConversationId | string | 否 |  |

###### UpsertMemoryDto.items → `UpsertMemoryItemDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| category | string | 是(默认) |  |
| content | string | 是(默认) |  |
| confidence | number | 否 |  |
| action | 'add' | 'remove' | 否 |  |



### POST /api/internal/user-taste/merge
- 说明：AI 增量写入用户口味（merge）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(MergeTasteDto)

**字段定义**

##### Body 对象 `MergeTasteDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| userId | string | 是(默认) |  |
| namespace | string | 否 |  |
| patch | Record<string, unknown> | 是(默认) |  |


### POST /api/internal/user-taste/remove
- 说明：AI 移除用户口味标签（差集）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(MergeTasteDto)

**字段定义**

##### Body 对象 `MergeTasteDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| userId | string | 是(默认) |  |
| namespace | string | 否 |  |
| patch | Record<string, unknown> | 是(默认) |  |


### GET /api/internal/user-taste/get
- 说明：AI 读取用户口味（注入 prompt 用）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:userId


## UserMemoryController（`UserMemoryController` → 注册路径基 `user-memory`）

### GET /api/user-memory/
- 说明：我的记忆列表（分页）
- 鉴权：Bearer JWT

### DELETE /api/user-memory/:id
- 说明：删除一条记忆
- 鉴权：Bearer JWT
- 入参：Param:id


## InternalPermissionController（`InternalPermissionController` → 注册路径基 `internal`）

### POST /api/internal/roles/permissions
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto

### POST /api/internal/permissions/sync
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto

### POST /api/internal/users/by-permissions
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto


## PermissionController（`PermissionController` → 注册路径基 `/`）

### GET /api/admin/permissions
- 说明：权限点全量（按 group 分组）
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/admin/roles
- 说明：角色列表（含权限码）
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/admin/roles
- 说明：新建角色
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto

### PUT /api/admin/roles/:code
- 说明：更新角色（权限全量覆盖）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:code、Body:dto

### DELETE /api/admin/roles/:code
- 说明：删除角色（内置/被引用拒绝）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:code

### GET /api/permissions/my
- 说明：当前登录用户权限码数组
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/admin/permissions/diff
- 说明：代码声明与数据库的权限差异
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/admin/permissions/sync
- 说明：同步权限点与内置角色权限（幂等；覆盖内置角色）
- 鉴权：未显式标注（按服务鉴权策略）


## UserController（`UserController` → 注册路径基 `users`）

### GET /api/users/
- 说明：获取用户列表
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:page、Query:pageSize

### GET /api/users/me
- 说明：获取当前登录用户信息
- 鉴权：Bearer JWT

### PUT /api/users/me
- 说明：更新当前用户资料
- 鉴权：Bearer JWT
- 入参：Body:userData(UpdateUserDto)

**字段定义**

##### Body 对象 `UpdateUserDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| username | string | 否 |  |
| password | string | 否 |  |
| email | string | 否 |  |
| nickname | string | 否 |  |
| phone | string | 否 |  |
| avatar | string | 否 |  |
| gender | 'male' | 'female' | 'unknown' | 否 |  |
| status | 'active' | 'inactive' | 'banned' | 否 |  |
| roles | string[] | 否 |  |
| dailyTransformLimit | number | null | 否 |  |


### POST /api/users/me/avatar
- 鉴权：Bearer JWT

### GET /api/users/profile
- 说明：获取用户详情
- 鉴权：Bearer JWT
- 入参：Query:id

### GET /api/users/:id
- 说明：根据 ID 获取用户
- 鉴权：Bearer JWT
- 入参：Param:id

### POST /api/users/
- 说明：创建用户
- 鉴权：Bearer JWT
- 入参：Body:userData(CreateUserDto)

**字段定义**

##### Body 对象 `CreateUserDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| username | string | 是(默认) | 用户名 |
| password | string | 是(默认) | 密码 |
| email | string | 否 |  |
| nickname | string | 否 |  |
| phone | string | 否 |  |
| gender | 'male' | 'female' | 'unknown' | 否 |  |
| roles | string[] | 否 |  |


### PUT /api/users/:id
- 说明：更新用户
- 鉴权：Bearer JWT
- 入参：Param:id、Body:userData(UpdateUserDto)

**字段定义**

##### Body 对象 `UpdateUserDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| username | string | 否 |  |
| password | string | 否 |  |
| email | string | 否 |  |
| nickname | string | 否 |  |
| phone | string | 否 |  |
| avatar | string | 否 |  |
| gender | 'male' | 'female' | 'unknown' | 否 |  |
| status | 'active' | 'inactive' | 'banned' | 否 |  |
| roles | string[] | 否 |  |
| dailyTransformLimit | number | null | 否 |  |


### DELETE /api/users/:id
- 说明：删除用户
- 鉴权：Bearer JWT
- 入参：Param:id


## UserTasteController（`UserTasteController` → 注册路径基 `user-taste`）

### GET /api/user-taste/:namespace
- 说明：读取我的口味档案
- 鉴权：Bearer JWT
- 入参：Param:namespace

### PUT /api/user-taste/:namespace
- 说明：增量更新我的口味档案
- 鉴权：Bearer JWT
- 入参：Param:namespace、Body:body

### DELETE /api/user-taste/:namespace/tag
- 说明：删除口味档案中的指定标签
- 鉴权：Bearer JWT
- 入参：Param:namespace、Body:body

### DELETE /api/user-taste/:namespace
- 说明：清空我的口味档案
- 鉴权：Bearer JWT
- 入参：Param:namespace

