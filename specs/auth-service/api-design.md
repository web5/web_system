# auth-service · 接口契约（api-design）

> 服务：`servers/auth-service`（端口 6101）
> 本文档由 `scripts/gen-api-design.mjs` 从 Swagger 注解自动提取，作为工程 AI 自进化的接口真相源；字段级 schema 以运行时 Swagger（非 production 环境各服务 `/api/docs`）为准。
> 路径口径：下表为 **controller 注册路径**；经 gateway 对外访问时，需在路径前加对应**外部前缀**（见下）。

## 网关访问前缀

本服务经 gateway 暴露的外部前缀：/api/auth, /api/auth/qrcode

> 例：若外部前缀为 `/api/auth`、某接口注册路径为 `/auth/login`，则外部可调用路径为 `/api/auth/login`；若注册路径首段已含外部前缀（如 `/ai/agent`），则直接拼接为 `/api/ai/agent`。具体映射以 gateway 的 ProxyController 路由为准。

## 通用约定

- 鉴权标注：`public` = 标记 `@Public()`（免 JWT，但可能需服务间 Bearer Key）；`bearer` = 需 `Authorization: Bearer`；`custom` = 走指定 `@UseGuards`；空白 = 未显式标注，按服务鉴权策略。
- 入参标注：`Param` = 路径参数；`Query` = 查询参数；`Body` = 请求体；`Headers` = 请求头。（已过滤 `@Req/@Res` 框架对象）

## AuthController（`AuthController` → 注册路径基 `auth`）

### POST /api/auth/login
- 说明：用户名密码登录
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:loginDto(LoginDto)

**字段定义**

##### Body 对象 `LoginDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| username | string | 是(默认) | 用户名 |
| password | string | 是(默认) | 密码 |


### POST /api/auth/register
- 说明：用户注册
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:registerDto(RegisterDto)

**字段定义**

##### Body 对象 `RegisterDto`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| username | string | 是(默认) | 用户名 |
| password | string | 是(默认) | 密码 |
| email | string | 否 |  |


### POST /api/auth/wechat-login
- 说明：微信扫码登录
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:wechatDto

### POST /api/auth/miniprogram-login
- 说明：微信小程序登录
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:mpDto

### POST /api/auth/refresh
- 说明：刷新 Token
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:refreshToken

### POST /api/auth/logout
- 说明：登出
- 鉴权：Bearer JWT
- 入参：Headers:authorization

### GET /api/auth/verify
- 说明：验证 Token 并返回用户信息
- 鉴权：Bearer JWT
- 入参：Headers:authorization

### GET /api/auth/wechat/authorize
- 说明：微信网页授权跳转
- 鉴权：Bearer JWT
- 入参：Query:redirect

### GET /api/auth/wechat/callback
- 说明：微信网页授权回调
- 鉴权：Bearer JWT
- 入参：Query:code、Query:state

### POST /api/auth/bind-miniprogram
- 说明：绑定小程序 openid 到当前用户
- 鉴权：Bearer JWT
- 入参：Body:code、Headers:authorization

### POST /api/auth/bind-official-account
- 说明：绑定公众号 openid 到当前用户
- 鉴权：Bearer JWT
- 入参：Body:code、Headers:authorization


## QrcodeController（`QrcodeController` → 注册路径基 `auth/qrcode`）

### POST /api/auth/qrcode/create
- 说明：创建扫码登录 ticket
- 鉴权：未显式标注（按服务鉴权策略）

### GET /api/auth/qrcode/check
- 说明：轮询检查 ticket 状态
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:ticket

### POST /api/auth/qrcode/confirm
- 说明：小程序扫码确认
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Body:ticket、Body:code

### GET /api/auth/qrcode/scan
- 说明：扫码重定向——微信扫码后跳转 OAuth 授权
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:ticket、Query:redirect

### GET /api/auth/qrcode/oauth-url
- 说明：获取扫码 URL（用于二维码内容）
- 鉴权：未显式标注（按服务鉴权策略）
- 入参：Query:ticket、Query:redirect


## UserController（`UserController` → 注册路径基 `user`）

### GET /api/user/profile
- 说明：获取当前用户信息
- 鉴权：Bearer JWT

### GET /api/user/:id
- 说明：根据 ID 获取用户
- 鉴权：Bearer JWT
- 入参：Param:id

