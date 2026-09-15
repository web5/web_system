# upload-service · 接口契约（api-design）

> 服务：`servers/upload-service`（端口 6008）
> 本文档由 `scripts/gen-api-design.mjs` 从 Swagger 注解自动提取，作为工程 AI 自进化的接口真相源；字段级 schema 以运行时 Swagger（非 production 环境各服务 `/api/docs`）为准。
> 路径口径：下表为 **controller 注册路径**；经 gateway 对外访问时，需在路径前加对应**外部前缀**（见下）。

## 网关访问前缀

本服务经 gateway 暴露的外部前缀：/api/upload

> 例：若外部前缀为 `/api/auth`、某接口注册路径为 `/auth/login`，则外部可调用路径为 `/api/auth/login`；若注册路径首段已含外部前缀（如 `/ai/agent`），则直接拼接为 `/api/ai/agent`。具体映射以 gateway 的 ProxyController 路由为准。

## 通用约定

- 鉴权标注：`public` = 标记 `@Public()`（免 JWT，但可能需服务间 Bearer Key）；`bearer` = 需 `Authorization: Bearer`；`custom` = 走指定 `@UseGuards`；空白 = 未显式标注，按服务鉴权策略。
- 入参标注：`Param` = 路径参数；`Query` = 查询参数；`Body` = 请求体；`Headers` = 请求头。（已过滤 `@Req/@Res` 框架对象）

## UploadController（`UploadController` → 注册路径基 `upload`）

### GET /api/upload/categories
- 说明：获取支持的分类及限制
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/upload/avatar
- 说明：上传头像（2MB，支持 JPG/PNG/GIF/WEBP）
- 鉴权：Bearer JWT

### POST /api/upload/drawing
- 说明：上传画板照片（10MB，支持 JPG/PNG/GIF/WEBP）
- 鉴权：Bearer JWT

### POST /api/upload/bianbian
- 说明：上传变变照片（10MB，支持 JPG/PNG/GIF/WEBP）
- 鉴权：Bearer JWT

### POST /api/upload/general
- 说明：通用文件上传（5MB，支持 JPG/PNG/GIF/WEBP）
- 鉴权：Bearer JWT

