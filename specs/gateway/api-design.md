# gateway · 接口契约（api-design）

> 服务：`servers/gateway`（端口 6000）
> 网关 = API 反代 + 微前端基座 + 版本分发/灰度。以下分两部分：① 网关自有 controller（api-docs/version/health/mini-scan/swagger-docs）；② **路由映射表**（ProxyController 是反向代理 catch-all，标了 @ApiExcludeController，不列为离散端点，其转发规则见下表）。

## 通用约定

- 所有 `/api/*` 请求经 gateway 反代到各后端微服务；gateway 自身不实现业务逻辑，仅转发。
- 鉴权由**下游微服务**各自处理（ProxyController 标 `@Public()`），gateway 只做转发与超时控制。

## 用户管理（`ApiAuthController` → 注册路径基 `api/auth`）

### POST /api/auth/login
- 说明：用户名密码登录
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/auth/register
- 说明：用户注册
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/auth/wechat-login
- 说明：微信扫码登录（公众号/网页）
- 鉴权：未显式标注（按服务鉴权策略）

### POST /api/auth/miniprogram-login
- 说明：微信小程序登录
- 鉴权：未显式标注（按服务鉴权策略）

### ALL /api/auth/:path(*)
- 鉴权：未显式标注（按服务鉴权策略）


## AI 能力（`ApiUsersController` → 注册路径基 `api/users`）

### GET /api/users/
- 说明：获取用户列表
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/users/profile
- 说明：获取用户资料
- 鉴权：Bearer JWT

### GET /api/users/:id
- 说明：根据 ID 获取用户
- 鉴权：Bearer JWT

### POST /api/users/
- 说明：创建用户
- 鉴权：Bearer JWT

### PUT /api/users/:id
- 说明：更新用户
- 鉴权：Bearer JWT

### DELETE /api/users/:id
- 说明：删除用户
- 鉴权：Bearer JWT

### ALL /api/users/:path(*)
- 鉴权：Bearer JWT


## ApiAiController（`ApiAiController` → 注册路径基 `api/ai`）

### POST /api/ai/chat
- 说明：发送 AI 对话消息
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/ai/conversations
- 说明：获取对话列表
- 鉴权：Bearer JWT

### POST /api/ai/image/submit
- 说明：提交图片生成任务
- 鉴权：Bearer JWT

### POST /api/ai/image/query
- 说明：查询图片生成结果
- 鉴权：Bearer JWT

### ALL /api/ai/:path(*)
- 鉴权：Bearer JWT


## VersionController（`VersionController` → 注册路径基 `/`）

### GET /api/__version__
- 说明：查询模块当前线上版本（微前端远程加载入口）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:module

### GET /api/__manifest__
- 说明：查询当前环境完整模块清单（基座调试/CI 用）
- 鉴权：未显式标注（按服务鉴权策略）


## HealthController（`HealthController` → 注册路径基 `/`）

### GET /api/health
- 鉴权：未显式标注（按服务鉴权策略）


## SwaggerDocsController（`SwaggerDocsController` → 注册路径基 `swagger`）

### GET /api/swagger/
- 鉴权：未显式标注（按服务鉴权策略）

### ALL /api/swagger/auth
- 说明：Auth Service Swagger UI
- 鉴权：未显式标注（按服务鉴权策略）

### ALL /api/swagger/auth/*
- 鉴权：未显式标注（按服务鉴权策略）

### ALL /api/swagger/ai
- 说明：AI Service Swagger UI
- 鉴权：未显式标注（按服务鉴权策略）

### ALL /api/swagger/ai/*
- 鉴权：未显式标注（按服务鉴权策略）

### ALL /api/swagger/user
- 说明：User Service Swagger UI
- 鉴权：未显式标注（按服务鉴权策略）

### ALL /api/swagger/user/*
- 鉴权：未显式标注（按服务鉴权策略）

## 路由映射表（ProxyController → 下游服务）

> 来源：`servers/gateway/src/proxy/proxy.controller.ts`。外部路径前缀 → 转发目标。其余未匹配 `/api/*` 返回 404。

| 外部前缀 | 转发到 |
|---|---|
| `/api/auth` | auth-service |
| `/api/users, /api/keys` | user-service |
| `/api/permissions/my, /api/admin/permissions, /api/admin/roles` | user-service |
| `/api/ai, /api/ai/chat/stream(SSE), /api/ai/tts/speak` | ai-service |
| `/api/ai-agent, /api/ai-agent/agent/run(SSE), /api/ai-agent/agent/admin-run(SSE)` | ai-agent |
| `/api/admin/skills` | ai-service |
| `/api/admin(其余), /api/dict` | system-service |
| `/api/agent-runs` | ai-service |
| `/api/knowledge` | knowledge-service |
| `/api/agent-defs` | ai-service |
| `/api/bianbian` | ai-service |
| `/api/todos` | todo-service |
| `/api/upload` | upload-service |
| `/api/uploads` | user-service(静态) |
| `/api/uploads/bianbian` | ai-service(静态) |
| `/api/mcp` | mcp-gateway |
| `/api/finnews, /api/content-hub` | content-hub |
