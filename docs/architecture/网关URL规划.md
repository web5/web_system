# 网关 URL 规划

> Gateway 路由设计 — URL 分类、代理规则、模块实现与路径重写

---

## 目录

- [1. URL 分类总览](#1-url-分类总览)
- [2. 健康检查 `/health`](#2-健康检查-health)
- [3. API 代理 `/api/*`](#3-api-代理-api)
  - [3.1 路由映射表](#31-路由映射表)
  - [3.2 路径重写规则](#32-路径重写规则)
  - [3.3 兜底策略](#33-兜底策略)
  - [3.4 Controller 实现](#34-controller-实现)
- [4. 静态资源 `/static/*`](#4-静态资源-static)
- [5. ProxyService 配置](#5-proxyservice-配置)
- [6. 模块注册](#6-模块注册)

---

## 1. URL 分类总览

Gateway 统一处理三类请求，三类 URL 前缀互不冲突，职责清晰：

| 分类 | 前缀 | 职责 | 模块 |
|------|------|------|------|
| 🔍 健康检查 | `/health` | 服务存活性检测 | `HealthModule` |
| 🔄 API 代理 | `/api/*` | 转发到后端微服务 | `ProxyModule` |
| 📦 静态资源 | `/static/*` | SPA 前端文件服务 | `StaticModule` |

**路由决策流程：**

```
请求进入 Gateway
    │
    ├── /health ───→ HealthController.heartbeat()
    │                     └→ { status: "ok", timestamp, uptime }
    │
    ├── /api/auth/* ──→ Proxy → Auth Service  (:3001)
    ├── /api/users* ──→ Proxy → User Service  (:3002)
    ├── /api/ai/*   ──→ Proxy → AI Service    (:3003)
    ├── /api/*      ──→ 404 { code: 404, message: "Unknown API route..." }
    │
    └── /static/* ────→ ServeStatic → public/index.html 或 assets/*
```

---

## 2. 健康检查 `/health`

用于调试和监控，快速确认 Gateway 是否在线。

**端点：** `GET /health`

**响应：**
```json
{
  "status": "ok",
  "timestamp": "2026-05-23T04:02:00.000Z",
  "uptime": 1234.56
}
```

**实现：** `src/health/health.controller.ts`

```typescript
@Controller()
export class HealthController {
  @Get('health')
  heartbeat() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
```

- `status`：固定返回 `"ok"`，表示服务正常
- `timestamp`：当前 ISO 时间戳
- `uptime`：Node.js 进程已运行秒数

---

## 3. API 代理 `/api/*`

使用 `http-proxy-middleware` 将前端请求透明转发到后端微服务，同时重写路径去除 `/api` 前缀。

### 3.1 路由映射表

| 路由规则 | 匹配请求示例 | 转发目标 | pathRewrite |
|----------|-------------|----------|-------------|
| `/api/auth/*` | `POST /api/auth/login` | Auth Service (:3001) | `/api/auth` → `/auth` |
| | `POST /api/auth/register` | Auth Service (:3001) | `/api/auth` → `/auth` |
| | `POST /api/auth/miniprogram-login` | Auth Service (:3001) | `/api/auth` → `/auth` |
| `/api/users*` | `GET /api/users` | User Service (:3002) | `/api/users` → `/users` |
| | `GET /api/users/123` | User Service (:3002) | `/api/users` → `/users` |
| `/api/ai/*` | `POST /api/ai/chat` | AI Service (:3003) | `/api/ai` → `/ai` |
| `/api/*` (兜底) | `GET /api/unknown` | — | 返回 404 |

### 3.2 路径重写规则

网关统一使用 `/api/{服务名}` 前缀，转发前剥离该前缀，保证后端服务路由简洁：

| 用户请求 | 经过 Gateway | 转发到后端 |
|----------|-------------|-----------|
| `POST /api/auth/login` | pathRewrite → `/auth` | `POST /auth/login` → Auth Service |
| `GET /api/users/profile` | pathRewrite → `/users` | `GET /users/profile` → User Service |
| `POST /api/ai/chat` | pathRewrite → `/ai` | `POST /ai/chat` → AI Service |
| `GET /api/unknown` | — | 404 响应 |

### 3.3 兜底策略

未匹配的 `/api/*` 路径不再静默转发到后端，而是明确返回 404：

```json
{
  "code": 404,
  "message": "Unknown API route: GET /api/unknown"
}
```

这样做的优势：
- **调试友好**：客户端能立刻知道路由不存在，而非得到一个后端误响应
- **安全性**：避免意外将请求泄露到错误的服务
- **可观测性**：通过 HTTP 状态码即可判断路由是否正确

### 3.4 Controller 实现

`src/proxy/proxy.controller.ts`：

```typescript
@Controller('api')
export class ProxyController {
  constructor(private proxyService: ProxyService) {}

  @All('auth/*')
  proxyAuth(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createAuthProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('users*')
  proxyUsers(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createUserProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('ai/*')
  proxyAi(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createAiProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('*')
  notFound(@Req() req: Request, @Res() res: Response) {
    res.status(404).json({
      code: 404,
      message: `Unknown API route: ${req.method} ${req.path}`,
    });
  }
}
```

> **注意**：`/api/users*` 使用 `*`（不含 `/`）同时匹配 `/api/users` 和 `/api/users/xxx`，避免为精确匹配和通配匹配各写一条路由。

---

## 4. 静态资源 `/static/*`

使用 `@nestjs/serve-static` 模块，以 `/static` 为前缀提供 SPA 构建产物。

`src/static/static.module.ts`：

```typescript
@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'public'),
      serveRoot: '/static',
      serveStaticOptions: {
        index: ['index.html'],
        maxAge: 3600000,   // 静态资源浏览器缓存 1 小时
      },
    }),
  ],
})
export class StaticModule {}
```

| 请求 | 返回 |
|------|------|
| `/static/` | `public/index.html` |
| `/static/assets/index-xxx.js` | `public/assets/index-xxx.js` |
| `/static/assets/index-xxx.css` | `public/assets/index-xxx.css` |

**设计考量：**

- 使用独立前缀 `/static` 而非根路径 `/`，避免与 API 路由和健康检查冲突
- 不再需要 `exclude: ['/api*']` 排除规则
- 如需多应用（admin/portal）共用 Gateway，可扩展为 `serveRoot: '/static/admin'` 和 `serveRoot: '/static/portal'`

---

## 5. ProxyService 配置

`src/proxy/proxy.service.ts` 通过环境变量读取各后端服务地址：

```typescript
@Injectable()
export class ProxyService {
  private authServiceUrl: string;
  private userServiceUrl: string;
  private aiServiceUrl: string;

  constructor(private configService: ConfigService) {
    this.authServiceUrl = this.configService.get('AUTH_SERVICE_URL', 'http://localhost:3001');
    this.userServiceUrl = this.configService.get('USER_SERVICE_URL', 'http://localhost:3002');
    this.aiServiceUrl    = this.configService.get('AI_SERVICE_URL',    'http://localhost:3003');
  }
  // ... createAuthProxy / createUserProxy / createAiProxy
}
```

每个 `createXxxProxy()` 方法的代理配置模式一致：

```typescript
createXxxProxy() {
  return createProxyMiddleware({
    target: this.xxxServiceUrl,
    changeOrigin: true,
    pathRewrite: { '^/api/xxx': '/xxx' },
    on: { proxyReq: fixRequestBody },
  });
}
```

---

## 6. 模块注册

`src/app.module.ts` 按以下顺序导入模块：

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    HealthModule,        // /health — 心跳检测
    ProxyModule,         // /api/*  — API 代理
    AuthModule,          // JWT 认证守卫
    StaticModule,        // /static — 静态资源
  ],
})
export class AppModule {}
```

---

> 文档版本：v1.0  
> 更新时间：2026-05-23  
> 关联文档：[技术架构](./技术架构.md)
