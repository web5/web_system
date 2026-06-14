# 网关 URL 规划

> Gateway 路由设计 — 单端口统一处理前端 SPA、静态资源和 API 代理

---

## 目录

- [1. URL 分类总览](#1-url-分类总览)
- [2. 静态资源 `/assets/*`](#2-静态资源-assets)
- [3. SPA 回退中间件](#3-spa-回退中间件)
- [4. API 代理 `/api/*`](#4-api-代理-api)
- [5. 管理后台 `/admin/*`](#5-管理后台-admin)
- [6. 模块注册顺序](#6-模块注册顺序)

---

## 1. URL 分类总览

Gateway（端口 3000）是唯一入口，统一处理全部请求：

| 分类 | 路径特征 | 处理方式 | 模块 |
|------|----------|----------|------|
| 📦 静态资源 | 带文件扩展名 (.js/.css/.svg) | `ServeStaticModule` | `StaticModule` |
| 🔄 API 代理 | `/api/*` | `ProxyModule` | `ProxyModule` |
| 🌐 SPA 路由 | 无后缀 GET 请求 | Express 中间件 → `index.html` | main.ts |
| 🔧 管理后台 | `/admin/*` | `ServeStaticModule` | `StaticModule` |
| 📚 接口文档 | `/docs`, `/swagger` | SwaggerModule | `SwaggerDocsModule` |

**路由决策流程：**

```
请求进入 Gateway (:3000)
    │
    ├── /api/* ──────→ ProxyModule → 后端微服务
    │
    ├── /docs        → SwaggerModule
    ├── /swagger     → SwaggerModule
    │
    ├── /admin/*     → ServeStaticModule → public/admin/*
    ├── /assets/*    → ServeStaticModule → public/assets/*
    ├── /favicon.ico → ServeStaticModule
    │
    ├── / (GET, 无后缀) → SPA 中间件 → public/index.html
    ├── /create       → SPA 中间件 → public/index.html
    ├── /transform    → SPA 中间件 → public/index.html
    │
    └── 其他          → NestJS 默认 404
```

---

## 2. 静态资源 `/assets/*`

使用 `@nestjs/serve-static` 模块，从 `servers/gateway/public/` 目录托管文件。

`src/static/static.module.ts`：

```typescript
ServeStaticModule.forRoot({
  rootPath: join(__dirname, '..', '..', 'public'),
  serveStaticOptions: {
    index: ['index.html'],
    maxAge: 3600000,  // 浏览器缓存 1 小时
  },
})
```

> **注意**：没有设置 `serveRoot`，静态文件从根路径 `/` 提供服务。

| 请求 | 返回 |
|------|------|
| `/assets/index-xxx.js` | `public/assets/index-xxx.js` |
| `/assets/index-xxx.css` | `public/assets/index-xxx.css` |
| `/favicon.svg` | `public/favicon.svg` |

**public 目录结构：**

```
public/
├── index.html          # Portal SPA 入口
├── assets/             # Portal 构建产物
├── admin/              # Admin-web 构建产物
│   ├── index.html
│   └── assets/
└── favicon.svg
```

---

## 3. SPA 回退中间件

Portal 是单页应用（SPA），`/create`、`/transform`、`/result` 等路由需要返回 `index.html`。

在 `main.ts` 中注册 Express 中间件：

```typescript
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const path: string = req.path;

  // 跳过后端路由
  if (path.startsWith('/api') || path.startsWith('/docs') || path.startsWith('/swagger') || path.startsWith('/admin')) {
    return next();
  }

  // 跳过有扩展名的静态资源（由 ServeStaticModule 处理）
  if (extname(path)) return next();

  // SPA 回退
  res.sendFile(join(__dirname, '..', 'public', 'index.html'));
});
```

**中间件执行顺序（Express 层面）：**

1. `ServeStaticModule` 中间件 — 尝试匹配并返回静态文件
2. SPA 回退中间件 — 非后端/非文件路径返回 `index.html`
3. NestJS 控制器路由 — API 代理、Swagger 等

---

## 4. API 代理 `/api/*`

使用 `http-proxy-middleware` 转发到后端微服务，路径重写剥离 `/api` 前缀。

### 4.1 路由映射表

| 路由规则 | 匹配请求示例 | 转发目标 | pathRewrite |
|----------|-------------|----------|-------------|
| `/api/auth/*` | `POST /api/auth/login` | Auth Service (:3001) | `/api/auth` → `/auth` |
| `/api/users*` | `GET /api/users` | User Service (:3002) | `/api/users` → `/users` |
| `/api/ai/*` | `POST /api/ai/chat` | AI Service (:3003) | `/api/ai` → `/ai` |
| `/api/*` (兜底) | — | — | 返回 404 |

### 4.2 ProxyService 配置

`src/proxy/proxy.service.ts` 通过环境变量读取各后端服务地址：

```typescript
constructor(private configService: ConfigService) {
  this.authServiceUrl = configService.get('AUTH_SERVICE_URL', 'http://localhost:3001');
  this.userServiceUrl = configService.get('USER_SERVICE_URL', 'http://localhost:3002');
  this.aiServiceUrl   = configService.get('AI_SERVICE_URL',   'http://localhost:3003');
}
```

---

## 5. 管理后台 `/admin/*`

Admin-web 构建产物存放在 `public/admin/` 目录，由 `ServeStaticModule` 统一托管。

> admin-web 的 Vite 构建配置了 `base: '/admin/'`，确保资源路径正确：`/admin/assets/xxx.js`。

| 请求 | 返回 |
|------|------|
| `/admin/` | `public/admin/index.html` |
| `/admin/assets/xxx.js` | `public/admin/assets/xxx.js` |
| `/admin/assets/xxx.css` | `public/admin/assets/xxx.css` |

---

## 6. 模块注册顺序

`src/app.module.ts` 按以下顺序导入模块，路由优先级由导入顺序决定：

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    HealthModule,          // /health — 心跳检测
    ProxyModule,           // /api/*  — API 代理
    AuthModule,            // JWT 认证守卫
    StaticModule,          // /assets/* /admin/* — 静态资源
    SwaggerDocsModule,     // /swagger — Swagger 文档聚合
    ApiDocsModule,         // /docs — 统一 API 文档
  ],
})
export class AppModule {}
```

> **注意**：SPA 回退中间件在 `main.ts` 中注册，位于所有模块之后，确保优先经过 NestJS 路由和 ServeStaticModule。

---

> 文档版本：v2.0
> 更新时间：2026-06-15
> 变更说明：从 `/static` 前缀改为根路径 `/` 托管，新增 SPA 回退中间件，新增 admin-web 子路径支持
> 关联文档：[技术架构](./技术架构.md) · [部署指南](../../DEPLOYMENT.md)
