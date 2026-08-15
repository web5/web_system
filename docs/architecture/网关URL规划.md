# 网关 URL 规划

> Gateway 路由设计 — 单端口统一处理前端 SPA、静态资源和 API 代理，以及 MCP 平台的 `/mcp`、`/api/finnews` 路由

---

## 目录

- [1. URL 分类总览](#1-url-分类总览)
- [2. 静态资源托管](#2-静态资源托管)
- [3. SPA 回退中间件](#3-spa-回退中间件)
- [4. API 代理 `/api/*`](#4-api-代理-api)
- [5. MCP 相关路由](#5-mcp-相关路由)
- [6. 模块注册顺序](#6-模块注册顺序)

---

## 1. URL 分类总览

Gateway（端口 6000）是应用层唯一入口，统一处理全部请求：

| 分类 | 路径特征 | 处理方式 | 模块 |
|------|----------|----------|------|
| 📦 静态资源 | 带扩展名 (.js/.css/.svg) | `ServeStaticModule` | `StaticModule` |
| 🔄 API 代理 | `/api/*` | `ProxyModule` | `ProxyModule` |
| 🔀 MCP 代理 | `/api/mcp/*`、`/api/finnews/*` | 代理到 mcp-gateway / finnews（含鉴权） | `ProxyModule` |
| 🌐 SPA 回退 | 无后缀 GET | Express 中间件 → `index.html` | main.ts |
| 🔧 前端托管 | `/portal/`、`/admin/`、`/mcp-admin/` | `ServeStaticModule` | `StaticModule` |
| 📚 接口文档 | `/docs`、`/swagger` | SwaggerModule | `SwaggerDocsModule` |

**Nginx 层（SSL 层 42.194.200.69）路由：**

> SSL 层只做两件事：`/mcp` 直连 mcp-gateway，其余全部转发到 gateway。**前端（portal/admin/mcp-admin）和 API 都不在 nginx 层区分，统一走 `location /` 到 gateway 6000，由 gateway 内部分发。**

| 路径 | 转发目标 | 说明 |
|------|---------|------|
| `/mcp`、`/mcp/:module` | `mcp-gateway:6006` | MCP 协议端点（正则 `^/mcp(/.*)?$`，直连 mcp-gateway，不走 gateway） |
| `/`（其余所有，含 `/api/*`、`/portal/`、`/admin/`、`/mcp-admin/`） | `gateway:6000` | 前端托管 + API 代理，统一走 gateway 内部分发 |

**路由决策流程：**

```
请求进入 Gateway (:6000)
    │
    ├── /api/finnews/*  → 鉴权 → finnews(:6007)
    ├── /api/mcp/*      → mcp-gateway(:6006) 管理接口
    ├── /api/auth|users|ai|admin|todos|upload/* → 各微服务
    │
    ├── /portal/    → public/portal/*
    ├── /admin/     → public/admin/*
    ├── /mcp-admin/ → public/mcp-admin/*
    ├── /assets/*   → public/assets/*
    │
    ├── / (GET, 无后缀) → SPA 回退 → index.html
    │
    └── 其他          → NestJS 默认 404
```

---

## 2. 静态资源托管

使用 `@nestjs/serve-static` 模块，从 `servers/gateway/public/` 目录托管文件。

| 请求 | 返回 |
|------|------|
| `/portal/` | `public/portal/index.html` |
| `/portal/assets/xxx.js` | `public/portal/assets/xxx.js` |
| `/admin/` | `public/admin/index.html` |
| `/mcp-admin/` | `public/mcp-admin/index.html` |
| `/mcp-admin/assets/xxx.js` | `public/mcp-admin/assets/xxx.js` |
| `/assets/xxx.js` | `public/assets/xxx.js` |
| `/favicon.svg` | `public/favicon.svg` |

**public 目录结构：**

```
public/
├── index.html          # Portal SPA 入口（根路径回退）
├── assets/             # 共享静态资源
├── portal/             # Portal 构建产物
│   ├── index.html
│   └── assets/
├── admin/              # Admin-web 构建产物
│   ├── index.html
│   └── assets/
├── mcp-admin/          # mcp-admin 构建产物
│   ├── index.html
│   └── assets/
└── favicon.svg
```

---

## 3. SPA 回退中间件

SPA 子路由需要返回对应前端的 `index.html`。在 `main.ts` 中注册 Express 中间件：

```typescript
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const path: string = req.path;

  // 跳过后端路由
  if (path.startsWith('/api') || path.startsWith('/docs') || path.startsWith('/swagger')) {
    return next();
  }
  // 跳过有扩展名的静态资源（由 ServeStaticModule 处理）
  if (extname(path)) return next();

  // SPA 回退：按前端 base 前缀分发
  if (path.startsWith('/admin')) {
    return res.sendFile(join(__dirname, '..', 'public', 'admin', 'index.html'));
  }
  if (path.startsWith('/mcp-admin')) {
    return res.sendFile(join(__dirname, '..', 'public', 'mcp-admin', 'index.html'));
  }
  if (path.startsWith('/portal')) {
    return res.sendFile(join(__dirname, '..', 'public', 'portal', 'index.html'));
  }
  // 默认回退到 Portal
  return res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});
```

---

## 4. API 代理 `/api/*`

使用 `http-proxy-middleware` 转发到后端微服务，路径重写剥离 `/api` 前缀。

### 4.1 路由映射表

| 路由规则 | 匹配请求示例 | 转发目标 | pathRewrite |
|----------|-------------|----------|-------------|
| `/api/auth/*` | `POST /api/auth/login` | auth-service (:6001) | `/api` → `` |
| `/api/users*` | `GET /api/users` | user-service (:6002) | `/api` → `` |
| `/api/ai/*` | `POST /api/ai/chat` | ai-service (:6003) | `/api` → `` |
| `/api/admin/*` | `GET /api/admin/*` | ai-service (:6003) | `/api` → `` |
| `/api/bianbian/*` | — | ai-service (:6003) | `/api` → `` |
| `/api/todos*` | — | todo-service (:6005) | `/api` → `` |
| `/api/upload*` | — | user-service (:6002) | `/api` → `` |
| `/api/mcp/*` | `GET /api/mcp/modules` | mcp-gateway (:6006) | `/api/mcp` → `/api` |
| `/api/finnews/*` | `GET /api/finnews/api/market-pulse` | finnews (:6007) | `/api/finnews` → `` |
| `/api/uploads/*` | — | user-service (:6002) | `/api` → `` |
| `/api/*`（兜底） | — | — | 返回 404 |

> **注意**：
> - `/api/finnews` 和 `/api/mcp` 必须放在 `/api/:path(*)` 兜底之前注册
> - `/api/finnews` 带服务间鉴权（`checkServiceAuthAndProxy` 验 Bearer）
> - `system-service`（:6004）有 proxy 实例但暂未暴露路由

### 4.2 ProxyService 配置

`src/proxy/proxy.service.ts` 通过环境变量读取各后端服务地址，预创建 proxy 中间件实例：

```typescript
this.authServiceUrl    = configService.get('AUTH_SERVICE_URL', 'http://localhost:6001');
this.userServiceUrl    = configService.get('USER_SERVICE_URL', 'http://localhost:6002');
this.aiServiceUrl      = configService.get('AI_SERVICE_URL', 'http://localhost:6003');
this.systemServiceUrl  = configService.get('SYSTEM_SERVICE_URL', 'http://localhost:6004');
this.todoServiceUrl    = configService.get('TODO_SERVICE_URL', 'http://localhost:6005');
this.mcpGatewayUrl     = configService.get('MCP_GATEWAY_URL', 'http://localhost:6006');
this.finnewsServiceUrl = configService.get('FINNEWS_SERVICE_URL', 'http://localhost:6007');
```

---

## 5. MCP 相关路由

MCP 平台的路由分三层，职责清晰：

### 5.1 Nginx 层（SSL 层 42.194.200.69）

两处域名入口（均在 42.194.200.69）：

**① 正式域名 `kedouai.com/mcp`**（`/etc/nginx/conf.d/default.conf` 的 kedouai.com server 块，2026-08-15 起）：

```nginx
# MCP 正式对外端点：https://kedouai.com/mcp/finnews
location ~ ^/mcp(/.*)?$ {
    proxy_pass http://175.27.189.123:6006;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_buffering off;
}
```

**② 开发域名 `dev.kedouai.com/mcp`**（`/etc/nginx/conf.d/dev.kedouai.com.conf`）：

```nginx
# MCP 协议端点 → 直连 mcp-gateway（正则匹配 /mcp 和 /mcp/:module，不含 /mcp-admin）
location ~ ^/mcp(/.*)?$ {
    proxy_pass http://175.27.189.123:6006;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 180s;   # SSE 支持
}

# 其余所有请求 → gateway（含 /api/* 和三个前端 SPA）
location / {
    proxy_pass http://175.27.189.123:6000;
    # ...（WebSocket / 超时 / 缓冲配置省略）
}
```

### 5.2 mcp-gateway 层（:6006）

| 路由 | 方法 | 说明 |
|------|------|------|
| `/mcp` | POST/GET/DELETE | MCP 聚合端点（所有启用模块工具） |
| `/mcp/:module` | POST/GET/DELETE | MCP 单模块端点（按 `code_key`，如 `/mcp/finnews`） |
| `/api/modules` | GET/POST/PUT/DELETE | 模块管理（供 mcp-admin 调用） |
| `/api/debug` | POST | 工具调试验证 |
| `/api/keys/apply` | POST | 公开申请 API Key（邮箱+验证码；SMTP 未配置时 403 降级） |
| `/api/keys/verify` | POST | 校验验证码并签发 Key（明文仅返回一次） |
| `/api/keys` | GET | Key 列表（需 `X-Admin-Key`） |
| `/api/keys/:id` | DELETE | 吊销 Key（需 `X-Admin-Key`） |

> **鉴权模型**（2026-08-15 起）：`/mcp` 的 Bearer 支持双路径——遗留共享 `MCP_CLIENT_KEY`（兼容）
> 或每用户 API Key（`mcp_api_keys` 表，SHA-256 存储，可吊销/过期，记录 `last_used_at`）。
> 生产建表 SQL 见 `servers/mcp-gateway/sql/mcp_keys_tables.sql`（生产 `synchronize:false` 需手动执行）。

### 5.3 Gateway 层（:6000）

| 路由 | 说明 |
|------|------|
| `/api/mcp/*` | 代理到 mcp-gateway 管理接口（`/api/mcp/modules` → `/api/modules`） |
| `/api/finnews/*` | 代理到 finnews（含服务间鉴权） |
| `/portal/`、`/admin/`、`/mcp-admin/` | 托管三个前端 SPA（ServeStaticModule） |

---

## 6. 模块注册顺序

`src/app.module.ts` 按以下顺序导入模块，路由优先级由注册顺序决定：

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env'] }),
    ThrottlerModule.forRoot(...),   // 全局限流
    HealthModule,                   // /health
    ProxyModule,                    // /api/* 代理
    AuthModule,                     // JWT 认证守卫
    StaticModule,                   // 静态资源 + SPA 托管
    SwaggerDocsModule,              // /swagger
    ApiDocsModule,                  // /docs
  ],
})
export class AppModule {}
```

**ProxyController 内路由注册顺序**（`@All(':path(*)')` 兜底必须在最后）：

```
auth → users → ai → admin → bianbian → todos → upload → mcp → finnews
  → uploads/bianbian → uploads → :path(*)（兜底 404）
```

---

> 文档版本：v3.0
> 更新时间：2026-08-14
> 变更说明：端口 3000→6000、新增 mcp/finnews 路由、新增 mcp-admin 托管、补充 Nginx 层 /mcp 正则路由
> 关联文档：[技术架构](./技术架构.md) · [MCP 服务间鉴权](./MCP服务间鉴权.md)
