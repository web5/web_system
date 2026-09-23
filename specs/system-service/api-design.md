# system-service · 接口契约（api-design）

> 服务：`servers/system-service`（端口 6004）
> 本文档由 `scripts/gen-api-design.mjs` 从 Swagger 注解自动提取，作为工程 AI 自进化的接口真相源；字段级 schema 以运行时 Swagger（非 production 环境各服务 `/api/docs`）为准。
> 路径口径：下表为 **controller 注册路径**；经 gateway 对外访问时，需在路径前加对应**外部前缀**（见下）。

## 网关访问前缀

本服务经 gateway 暴露的外部前缀：/api/admin(除 permissions/roles/skills), /api/dict

> 例：若外部前缀为 `/api/auth`、某接口注册路径为 `/auth/login`，则外部可调用路径为 `/api/auth/login`；若注册路径首段已含外部前缀（如 `/ai/agent`），则直接拼接为 `/api/ai/agent`。具体映射以 gateway 的 ProxyController 路由为准。

## 通用约定

- 鉴权标注：`public` = 标记 `@Public()`（免 JWT，但可能需服务间 Bearer Key）；`bearer` = 需 `Authorization: Bearer`；`custom` = 走指定 `@UseGuards`；空白 = 未显式标注，按服务鉴权策略。
- 入参标注：`Param` = 路径参数；`Query` = 查询参数；`Body` = 请求体；`Headers` = 请求头。（已过滤 `@Req/@Res` 框架对象）

## BianbianAdminController（`BianbianAdminController` → 注册路径基 `admin/bianbian`）

### GET /api/admin/bianbian/categories
- 说明：素材分类列表（含各分类素材数量）
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/admin/bianbian/materials
- 说明：素材列表
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:category、Query:keyword、Query:page、Query:pageSize

### POST /api/admin/bianbian/materials
- 说明：创建素材
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto

### PUT /api/admin/bianbian/materials/:id
- 说明：更新素材
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id、Body:dto

### DELETE /api/admin/bianbian/materials/:id
- 说明：删除素材
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id

### PUT /api/admin/bianbian/materials/sort
- 说明：批量更新素材排序
- 鉴权：未显式标注（按服务鉴权策略）

### PUT /api/admin/bianbian/materials/batch/toggle
- 说明：批量启用/禁用素材
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto

### POST /api/admin/bianbian/seed
- 说明：初始化默认素材库（force=1 时强制覆盖重建）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:force


## DatabaseExplorerController（`DatabaseExplorerController` → 注册路径基 `admin/db`）

### GET /api/admin/db/tables
- 说明：业务表列表（敏感表仅 super_admin 可见）
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/admin/db/tables/:name/schema
- 说明：表结构（字段 + 索引，标注敏感级别）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:name

### GET /api/admin/db/tables/:name/rows
- 说明：分页查询表数据（服务端自动脱敏）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:name、Query:query(QueryRowsDto)

**字段定义**

##### Query 对象 `QueryRowsDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| page | number | 否 |  |
| pageSize | number | 否 |  |
| sortField | string | 否 |  |
| sortOrder | 'asc' | 'desc' | 否 |  |


### POST /api/admin/db/query
- 说明：执行只读 SQL（仅 super_admin，自动 LIMIT 200 并写审计日志）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(QuerySqlDto)

**字段定义**

##### Body 对象 `QuerySqlDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| sql | string | 是(默认) |  |



## DictController（`DictController` → 注册路径基 `admin/dict`）

### GET /api/admin/dict/types
- 说明：列出字典类型（支持 keyword 模糊匹配 code/name）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:query(ListDictTypesDto)

**字段定义**

##### Query 对象 `ListDictTypesDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| keyword | string | 否 |  |


### POST /api/admin/dict/types
- 说明：新建字典类型
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(CreateDictTypeDto)

**字段定义**

##### Body 对象 `CreateDictTypeDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| code | string | 是(默认) |  |
| name | string | 是(默认) |  |
| description | string | 否 |  |
| sort | number | 否 |  |
| enabled | boolean | 否 |  |


### PUT /api/admin/dict/types/:id
- 说明：更新字典类型
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id、Body:dto(UpdateDictTypeDto)

**字段定义**

##### Body 对象 `UpdateDictTypeDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| name | string | 否 |  |
| description | string | 否 |  |
| sort | number | 否 |  |
| enabled | boolean | 否 |  |


### DELETE /api/admin/dict/types/:id
- 说明：删除字典类型（内置字典拒绝；连带删除其字段与全部明细）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id

### GET /api/admin/dict/types/:code/fields
- 说明：列出字典的字段定义
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:code

### PUT /api/admin/dict/types/:code/fields
- 说明：整体覆盖保存字段定义（前端提交最终态）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:code、Body:dto(ReplaceDictFieldsDto)

**字段定义**

##### Body 对象 `ReplaceDictFieldsDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| fields | DictFieldDto[] | 是(默认) |  |

###### ReplaceDictFieldsDto.fields → `DictFieldDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| name | string | 是(默认) |  |
| label | string | 是(默认) |  |
| type | DictFieldType | 是(默认) |  |
| length | number | 否 |  |
| required | boolean | 否 |  |
| defaultValue | string | 否 |  |
| options | string[] | 否 |  |
| sort | number | 否 |  |



### GET /api/admin/dict/types/:code/items
- 说明：分页列出字典明细（keyword / enabled / page / pageSize）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:code、Query:query(ListDictItemsDto)

**字段定义**

##### Query 对象 `ListDictItemsDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| keyword | string | 否 |  |
| enabled | boolean | 否 |  |
| page | number | 否 |  |
| pageSize | number | 否 |  |


### POST /api/admin/dict/items
- 说明：新增字典项
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(CreateDictItemDto)

**字段定义**

##### Body 对象 `CreateDictItemDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| typeCode | string | 是(默认) |  |
| value | string | 是(默认) |  |
| label | string | 是(默认) |  |
| attrs | Record<string, DictAttrValue> | 否 |  |
| remark | string | 否 |  |
| sort | number | 否 |  |
| enabled | boolean | 否 |  |


### PUT /api/admin/dict/items/:id
- 说明：更新字典项
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id、Body:dto(UpdateDictItemDto)

**字段定义**

##### Body 对象 `UpdateDictItemDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| label | string | 否 |  |
| attrs | Record<string, DictAttrValue> | 否 |  |
| remark | string | 否 |  |
| sort | number | 否 |  |
| enabled | boolean | 否 |  |


### DELETE /api/admin/dict/items/:id
- 说明：删除字典项
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:id


## InternalDictController（`InternalDictController` → 注册路径基 `internal/dict`）

### GET /api/internal/dict/:code
- 说明：按字典编码取启用项（服务间消费）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:code


## PublicDictController（`PublicDictController` → 注册路径基 `dict`）

### GET /api/dict/:code
- 说明：按字典编码取启用项（登录即可）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:code


## InternalLogsController（`InternalLogsController` → 注册路径基 `internal/logs`）

### POST /api/internal/logs/
- 说明：写入一条操作日志（服务间审计）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto


## OperationLogsController（`OperationLogsController` → 注册路径基 `admin/logs`）

### GET /api/admin/logs/
- 说明：查询操作日志（支持分页和多条件筛选）
- 鉴权：未显式标注（按服务鉴权策略）


## SettingsController（`SettingsController` → 注册路径基 `admin/settings`）

### GET /api/admin/settings/
- 说明：获取全部系统配置
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/admin/settings/public/:key
- 说明：获取公开配置项
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Param:key

### PUT /api/admin/settings/
- 说明：批量更新系统配置
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:data(UpdateSettingsDto)

**字段定义**

##### Body 对象 `UpdateSettingsDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|



## InternalStorageController（`InternalStorageController` → 注册路径基 `internal/storage`）

### GET /api/internal/storage/path
- 说明：读取权威上传根目录（含来源）
- 鉴权：未显式标注（按服务鉴权策略）


## StorageController（`StorageController` → 注册路径基 `admin/settings/storage`）

### GET /api/admin/settings/storage/
- 说明：读取存储配置（权威值 + 当前生效值 + 来源）
- 鉴权：未显式标注（按服务鉴权策略）

### PUT /api/admin/settings/storage/
- 说明：保存上传根目录（写前校验，不存在则创建）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(StorageDirDto)

**字段定义**

##### Body 对象 `StorageDirDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| uploadDir | string | 是(默认) |  |


### POST /api/admin/settings/storage/validate
- 说明：校验上传根目录（只校验，不保存、不创建）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:dto(StorageDirDto)

**字段定义**

##### Body 对象 `StorageDirDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| uploadDir | string | 是(默认) |  |


### GET /api/admin/settings/storage/browse
- 说明：列出允许根内的目录（只列目录；仅 super_admin）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:path

