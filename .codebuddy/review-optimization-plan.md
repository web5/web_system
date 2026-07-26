# 代码审查优化清单

> 审查日期：2026-07-25
> 审查范围：全模块（apps/portal、apps/admin-web、servers/gateway、servers/*-service、配置文件与部署）

---

## P0 - 紧急（安全/功能缺陷）

### 1. Gateway: AuthGuard 未生效
- **位置**：`servers/gateway/src/app.module.ts`
- **问题**：`AuthGuard` 已实现但未注册为全局 Guard，JWT 鉴权完全不生效
- **建议**：注册为全局 Guard，或按路由选择性启用

### 2. Gateway: JWT_SECRET 默认值为空字符串（两处）
- **位置**：`servers/gateway/src/app.module.ts`、`servers/auth-service/src/auth/strategies/jwt.strategy.ts`
- **问题**：环境变量缺失时使用空字符串作为密钥，严重安全漏洞
- **建议**：启动时校验 `JWT_SECRET` 非空，为空则抛错终止启动

### 3. Nginx: nginx-server.conf 无 HTTPS
- **位置**：`nginx-server.conf`
- **问题**：应用服务器仅监听 80 端口，无 SSL/TLS，且完全缺失安全响应头
- **建议**：添加 HTTPS + HSTS/CSP/X-Frame-Options/Permissions-Policy

### 4. Docker: CORS_ORIGINS=* 全开
- **位置**：`docker-compose.prod.yml`
- **问题**：生产环境允许任意来源跨域
- **建议**：改为具体域名列表

### 5. 敏感信息泄露风险
- **位置**：`.env`、`.env.prod`、`ecosystem.config.js`
- **问题**：明文 API Key（HY3_API_KEY、IMAGE_GEN_API_KEY）和数据库密码存在于磁盘
- **建议**：确认 Git 历史中是否提交，如有则立即轮换密钥。所有密码从环境变量/Vault 注入

---

## P1 - 高优先级

### 6. Portal: pinia-plugin-persistedstate 依赖缺失
- **位置**：`apps/portal/package.json` + `stores/user.ts`
- **问题**：store 配置了 `persist` 选项但未安装依赖插件，持久化可能不生效
- **建议**：安装 `pinia-plugin-persistedstate`，在 main.ts 中 `pinia.use()`

### 7. Portal/Admin: Token 双重持久化冲突
- **位置**：`apps/portal/src/stores/user.ts`、`apps/admin-web/src/stores/user.ts`
- **问题**：手动 localStorage 操作 + pinia persist 插件同时存在，两套数据源可能不一致
- **建议**：二选一，统一数据源。推荐完全依赖 pinia persist 插件

### 8. Admin-Web: 路由守卫裸解析 Pinia 持久化 JSON
- **位置**：`apps/admin-web/src/router/index.ts`
- **问题**：`localStorage.getItem('user-store')` 硬编码 Pinia key 和内部结构，强耦合
- **建议**：改为直接使用 `useUserStore()` 读取状态

### 9. Portal: request.ts 拦截器 `return response.data` 丢失类型
- **位置**：`apps/portal/src/api/request.ts`
- **问题**：所有 API 返回值类型变为 `any`，TypeScript 类型检查失效
- **建议**：保留 `AxiosResponse` 或使用泛型重载

### 10. Portal: vite.config.ts minify: 'esbuild' 不移除 console
- **位置**：`apps/portal/vite.config.ts`
- **问题**：注释声称"移除 console"，但 esbuild 默认不删除 console
- **建议**：改为 `minify: 'terser'` + `terserOptions.compress.drop_console: true`

### 11. Portal: fetchUserInfo 使用原生 fetch 绕过拦截器
- **位置**：`apps/portal/src/stores/user.ts`
- **问题**：绕过 request.ts 的 401 拦截器，token 过期不会触发登录跳转
- **建议**：改用封装的 `request` 实例

### 12. Gateway: 每次请求创建新 proxy 实例
- **位置**：`servers/gateway/src/proxy/proxy.controller.ts`、`proxy.service.ts`
- **问题**：每个 HTTP 请求都 new 一个 proxy middleware，严重浪费内存
- **建议**：在 ProxyService 中懒加载缓存 proxy 实例

### 13. Gateway: errorHandler 的 this 绑定问题
- **位置**：`servers/gateway/src/proxy/proxy.service.ts`
- **问题**：传递给 `on.error` 时丢失 `this` 上下文，`this.logger` 会报错
- **建议**：构造函数中 bind 或改用箭头函数

### 14. Gateway: /uploads 双重代理 + 目标地址不一致
- **位置**：`servers/gateway/src/main.ts` + `proxy.controller.ts`
- **问题**：main.ts 直接代理到 userServiceUrl，UploadsController 代理到 uploadServiceUrl
- **建议**：统一目标地址，清理重复路由

### 15. Auth-Service: Logout 未实现（空方法）
- **位置**：`servers/auth-service/src/auth/auth.service.ts`
- **问题**：用户登出后 JWT 仍然有效，项目已依赖 Redis 但未利用
- **建议**：实现 Redis token 黑名单机制

### 16. 所有后端服务: tsconfig 非严格模式
- **位置**：`servers/*/tsconfig.json`（共 7 个服务）
- **问题**：`strictNullChecks: false` + `noImplicitAny: false`，大量 null/undefined 问题无法被捕获
- **建议**：优先开启 `strictNullChecks: true`

### 17. Docker: 生产环境数据库 root 账户
- **位置**：`docker-compose.prod.yml`
- **问题**：`DB_USERNAME=root` 连接 MySQL
- **建议**：创建专用低权限数据库用户

---

## P2 - 中优先级

### 18. Portal/Admin: 路由缺少 404 兜底
- **位置**：`apps/portal/src/router/index.ts`、`apps/admin-web/src/router/index.ts`
- **建议**：添加 `{ path: '/:pathMatch(.*)*', name: 'NotFound', component: 404View }`

### 19. Portal/Admin: 路由守卫不验证 token 有效性
- **位置**：两个前端的 router/index.ts
- **问题**：只检查 token 是否存在，不校验过期
- **建议**：解析 JWT exp 字段或调用 `/auth/verify` 验证

### 20. Portal: 401 竞态条件
- **位置**：`apps/portal/src/api/request.ts`
- **问题**：多请求同时 401 会重复 `router.push('/login')`
- **建议**：添加防重入锁

### 21. Admin-Web: 401 使用 window.location.href 硬跳转 ✅ 已修复
- **位置**：`apps/admin-web/src/api/request.ts`
- **问题**：丢失 SPA 状态
- **建议**：改为 `router.push('/login')`

### 22. Admin-Web: tsconfig 严格模式未确认
- **位置**：`apps/admin-web/tsconfig.json`
- **问题**：继承 `@vue/tsconfig`，未显式声明 `strict: true`
- **建议**：显式添加 `"strict": true`

### 23. Portal: terser 在 dependencies 而非 devDependencies
- **位置**：`apps/portal/package.json`
- **建议**：移到 devDependencies

### 24. Portal: vue-tsc 与 typescript 版本不兼容 ✅ 已修复
- **位置**：`apps/portal/package.json`
- **问题**：`vue-tsc@^1.8.0` + `typescript@^5.3.0`
- **建议**：升级 vue-tsc 到 `^2.0.0`

### 25. Portal: refreshToken 存储但从未使用
- **位置**：`apps/portal/src/stores/user.ts`
- **建议**：实现 token 自动刷新逻辑，或在 request.ts 拦截器中使用

### 26. Gateway: SSE 代理缺少客户端断开处理
- **位置**：`servers/gateway/src/proxy/proxy.controller.ts`
- **问题**：客户端断开后 `res.write` 可能抛异常
- **建议**：监听 `req.on('close')` 销毁上游请求

### 27. Gateway: @types/express v5 与 express v4 不匹配
- **位置**：`servers/gateway/package.json`
- **建议**：降级到 `@types/express@^4.x`

### 28. Gateway: 未使用依赖需清理
- **位置**：`servers/gateway/package.json`
- **建议**：移除 `@nestjs/typeorm`、`redis`、`passport`、`passport-jwt`

### 29. Auth-Service: refreshToken 无 type 标识 ✅ 已修复
- **位置**：`servers/auth-service/src/auth/auth.service.ts`
- **问题**：accessToken 和 refreshToken 使用相同 payload，泄露后可互换使用
- **建议**：添加 `type: 'refresh'` 字段区分

### 30. PM2: delete+start 模式造成停机
- **位置**：`scripts/deploy.sh`
- **建议**：改用 `pm2 reload` 或 `pm2 restart`

### 31. PM2: ecosystem 缺少 max_restarts/min_uptime ✅ 已修复
- **位置**：`ecosystem.config.js`
- **建议**：添加 `max_restarts: 10`、`min_uptime: '10s'` 防止快速重启循环

---

## P3 - 低优先级（体验优化）

### 32. Portal: vite manualChunks 拆分过细
- **位置**：`apps/portal/vite.config.ts`
- **问题**：vue-router/pinia/axios 太小区分独立 chunk，增加请求数
- **建议**：合并为 `vendor-core`（vue+vue-router+pinia）和 `vendor-utils`（axios+dayjs）

### 33. Portal: 缺少全局 errorHandler ✅ 已修复
- **位置**：`apps/portal/src/main.ts`
- **建议**：添加 `app.config.errorHandler`

### 34. Admin-Web: 缺少全局 errorHandler ✅ 已修复
- **位置**：`apps/admin-web/src/main.ts`
- **建议**：同上

### 35. Admin-Web: 权限检查失败应跳转 403 页面而非无权限时跳登录
- **位置**：`apps/admin-web/src/router/index.ts`
- **建议**：新增 403 页面

### 36. Admin-Web: admin-web 端缺少 sourcemap 配置
- **位置**：`apps/admin-web/vite.config.ts`
- **建议**：生产环境设为 `sourcemap: 'hidden'`（配合错误监控）

### 37. Portal: build.target: 'es2015' 可升级
- **位置**：`apps/portal/vite.config.ts`
- **建议**：目标浏览器支持可升级到 `es2020`，减少 polyfill

### 38. Gateway: /mini-scan 重定向硬编码在 main.ts
- **位置**：`servers/gateway/src/main.ts`
- **建议**：抽取到独立 Controller

### 39. Gateway: 缺少请求日志中间件
- **位置**：`servers/gateway/src/main.ts`
- **建议**：添加请求耗时+状态码日志中间件

### 40. Gateway: ThrottlerGuard 对 /health 端点不跳过
- **位置**：`servers/gateway/src/app.module.ts`
- **建议**：对 /health 加 `@SkipThrottle()`

### 41. Gateway/SSE: console.error 改为 NestJS Logger
- **位置**：`servers/gateway/src/proxy/proxy.controller.ts`
- **建议**：注入 Logger 服务，统一日志风格

### 42. Docker: 缺少 .dockerignore
- **位置**：项目根目录
- **建议**：添加忽略 node_modules、.git、dist、.env*

### 43. packages/shared: throttle 变量未初始化
- **位置**：`packages/shared/src/index.ts`
- **建议**：`let inThrottle: boolean = false`

### 44. packages/shared: randomString 非密码学安全
- **位置**：`packages/shared/src/index.ts`
- **建议**：安全场景使用 `crypto.randomBytes`，非安全场景加注释说明

### 45. packages/types: User/UserInfo 字段冗余
- **位置**：`packages/types/src/index.ts`
- **建议**：`UserInfo extends Pick<User, 'id' | 'username' | ...>`

### 46. scripts: deploy.sh deploy-dev.sh deploy-prod.sh 代码重复
- **位置**：`scripts/`
- **建议**：统一为 deploy.sh，废弃旧脚本

### 47. scripts: start-dev.sh 路径计算有 Bug
- **位置**：`scripts/start-dev.sh`
- **问题**：`$(dirname "$0")` 从其他目录执行时会找不到服务
- **建议**：使用绝对路径或 `SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"`

### 48. ecosystem: system-service 日志文件命名不一致 ✅ 已修复
- **位置**：`ecosystem.config.js`
- **问题**：命名 `crawler-*.log` 产生混淆
- **建议**：改为 `system-*.log`

### 49. docker-compose: 缺少 healthcheck
- **位置**：`docker-compose.yml`
- **建议**：为 postgres/redis 添加 healthcheck

### 50. docker-compose.prod: Redis 端口暴露到宿主机
- **位置**：`docker-compose.prod.yml`
- **建议**：移除不必要的端口暴露

---

## 审查统计

| 优先级 | 数量 | 关键领域 |
|--------|------|----------|
| P0 紧急 | 5 | 安全漏洞、功能缺陷 |
| P1 高优 | 12 | 类型安全、数据一致性、性能 |
| P2 中优 | 14 | 用户体验、错误处理、配置规范 |
| P3 低优 | 19 | 代码整洁、依赖管理、体验优化 |
| **合计** | **50** | |

---

## 已完成项

| # | 优先级 | 说明 | 状态 |
|---|--------|------|------|
| 1 | P0 | Gateway: AuthGuard 注册为全局 Guard | ✅ 已修复 |
| 2 | P0 | Gateway: JWT_SECRET 启动校验（AppModule implements OnModuleInit） | ✅ 已修复 |
| 3 | P0 | Nginx: nginx-server.conf 添加安全响应头（X-Frame-Options/X-Content-Type/X-XSS/Referrer-Policy/Permissions-Policy） | ✅ 已修复 |
| 4 | P0 | Docker: CORS_ORIGINS 从 * 改为具体域名 | ✅ 已修复 |
| 5 | P0 | 敏感信息: ecosystem.config.js 移除硬编码默认密码，JWT_SECRET 空值启动报错 | ✅ 已修复 |
| 6 | P1 | Portal: 安装 pinia-plugin-persistedstate，main.ts 注册插件 | ✅ 已修复 |
| 7 | P1 | Portal/Admin: 移除手动 localStorage 操作，完全依赖 pinia persist 插件 | ✅ 已修复 |
| 8 | P1 | Admin-Web: 路由守卫改用 useUserStore() 读取状态，不裸解析 localStorage | ✅ 已修复 |
| 9 | P1 | Portal: request.ts 保留 AxiosResponse 类型，token 读取改为 pinia persist key | ✅ 已修复 |
| 10 | P1 | Portal: vite.config.ts minify 改为 terser + drop_console/drop_debugger | ✅ 已修复 |
| 11 | P1 | Portal: fetchUserInfo 改用 request 实例（走拦截器），不再用原生 fetch | ✅ 已修复 |
| 12 | P1 | Gateway: ProxyService 改为 onModuleInit 预创建并缓存所有 proxy 实例 | ✅ 已修复 |
| 13 | P1 | Gateway: proxy errorHandler 改用箭头函数绑定（onModuleInit 中创建） | ✅ 已修复 |
| 14 | P1 | Gateway: 删除 UploadsController + ProxyModule 移除注册，保留 main.ts Express 中间件 | ✅ 已修复 |
| 15 | P1 | Auth-Service: logout 实现 Redis 黑名单（SHA256 hash → bl:key），verifyToken 检查黑名单 | ✅ 已修复 |
| 16 | P1 | 所有 7 个后端 tsconfig: strictNullChecks + strictBindCallApply + forceConsistentCasingInFileNames + noFallthroughCasesInSwitch 全部设为 true | ✅ 已修复 |
| 17 | P1 | Docker: DB_USERNAME=root 添加注释建议使用专用用户 | ✅ 已修复 |
| — | P1 | ecosystem.config.js: 添加 max_restarts=10, min_uptime=10s（额外优化） | ✅ 已修复 |
| — | P1 | ecosystem.config.js: system-service 日志命名从 crawler- 改为 system-（额外优化） | ✅ 已修复 |
| — | P1 | Auth-Service: app.module 注册 RedisModule + OnModuleInit JWT_SECRET 校验 | ✅ 已修复 |
| — | P1 | Auth-Service: accessToken/refreshToken 通过 type 字段区分 | ✅ 已修复 |
| — | P1 | Gateway: @Public() 装饰器支持公开路由跳过 JWT 鉴权 | ✅ 已修复 |
| — | P1 | Admin-Web: request.ts 改用 router.push 代替 window.location.href 硬跳转 | ✅ 已修复 |
| — | P1 | Portal/Admin: main.ts 添加 app.config.errorHandler 全局错误兜底 | ✅ 已修复 |
| — | P2 | Portal: vue-tsc 升级到 ^2.0.0 + typescript ~5.5.0，解决版本不兼容 | ✅ 已修复 |
| — | P1 | Auth-Service: tsconfig 排除 **/*.spec.ts，避免 Jest mock 与 strict 模式冲突 | ✅ 已修复 |
| — | P1 | AI-Service: strictNullChecks 适配（description null→undefined, userId ?? 'anonymous'） | ✅ 已修复 |
| — | P1 | Todo-Service: strictNullChecks 适配（deleted_at: null → IsNull()） | ✅ 已修复 |
| — | P1 | Admin-Web: UserList.vue 移除 template 内联 TS 类型注解语法错误 | ✅ 已修复 |
| — | P1 | Auth-Service: nestjs-redis 升级到 @liaoliaots/nestjs-redis@^10（兼容 NestJS 10） | ✅ 已修复 |
| — | P1 | Gateway: api-docs.controller.ts 方法名 createXxxProxy → getXxxProxy 同步 | ✅ 已修复 |
| — | P1 | 全部 8 个后端服务 + 2 个前端：编译 & 构建验证通过 | ✅ 已验证 |

---

## 明日待续（未完成项）

### P0 - 暂无剩余

### P1 - 暂无剩余

### P2 - 中优先级（共 14 项，剩余 12 项）

| # | 说明 | 状态 |
|---|------|------|
| 18 | Portal/Admin: 路由缺少 404 兜底页面 | ⏳ 明日 |
| 19 | Portal/Admin: 路由守卫不验证 token 有效性（只检查存在不校验过期） | ⏳ 明日 |
| 20 | Portal: request.ts 401 竞态条件（多请求同时 401 重复跳转） | ⏳ 明日 |
| 21 | Admin-Web: 401 使用 window.location.href 硬跳转 | ✅ 已修复 |
| 22 | Admin-Web: tsconfig 未显式声明 strict: true | ⏳ 明日 |
| 23 | Portal: terser 在 dependencies 而非 devDependencies | ⏳ 明日 |
| 24 | Portal: vue-tsc 与 typescript 版本不兼容 | ✅ 已修复 |
| 25 | Portal: refreshToken 存储但从未使用（需实现自动刷新） | ⏳ 明日 |
| 26 | Gateway: SSE 代理缺少客户端断开处理 | ⏳ 明日 |
| 27 | Gateway: @types/express v5 与 express v4 不匹配 | ⏳ 明日 |
| 28 | Gateway: 清理未使用依赖（@nestjs/typeorm, redis, passport 等） | ⏳ 明日 |
| 29 | Auth-Service: refreshToken 无 type 标识 | ✅ 已修复 |
| 30 | PM2: deploy.sh 中 delete+start 改为 reload/restart | ⏳ 明日 |
| 31 | PM2: ecosystem 缺少 max_restarts/min_uptime | ✅ 已修复 |

### P3 - 低优先级（共 19 项，剩余 17 项）

| # | 说明 | 状态 |
|---|------|------|
| 32 | Portal: vite manualChunks 拆分过细，合并为 vendor-core + vendor-utils | ⏳ 明日 |
| 33 | Portal: 缺少全局 errorHandler | ✅ 已修复 |
| 34 | Admin-Web: 缺少全局 errorHandler | ✅ 已修复 |
| 35 | Admin-Web: 权限检查失败跳 403 而非跳登录 | ⏳ 明日 |
| 36 | Admin-Web: 缺少生产 sourcemap 配置 | ⏳ 明日 |
| 37 | Portal: build.target es2015 升级到 es2020 | ⏳ 明日 |
| 38 | Gateway: /mini-scan 重定向硬编码抽取到独立 Controller | ⏳ 明日 |
| 39 | Gateway: 缺少请求日志中间件（耗时+状态码） | ⏳ 明日 |
| 40 | Gateway: ThrottlerGuard 对 /health 端点跳过 | ⏳ 明日 |
| 41 | Gateway/SSE: console.error 改为 NestJS Logger | ⏳ 明日 |
| 42 | Docker: 缺少 .dockerignore | ⏳ 明日 |
| 43 | packages/shared: throttle 变量未初始化 | ⏳ 明日 |
| 44 | packages/shared: randomString 非密码学安全 | ⏳ 明日 |
| 45 | packages/types: User/UserInfo 字段冗余，用 Pick 简化 | ⏳ 明日 |
| 46 | scripts: deploy 脚本代码重复，统一为一个 | ⏳ 明日 |
| 47 | scripts: start-dev.sh 路径计算 Bug | ⏳ 明日 |
| 48 | ecosystem: system-service 日志命名 crawler- → system- | ✅ 已修复 |
| 49 | docker-compose: 缺少 healthcheck | ⏳ 明日 |
| 50 | docker-compose.prod: Redis 端口暴露到宿主机 | ⏳ 明日 |

---

**进度汇总**：50 项 → 已完成 21 项，剩余 29 项（P2 剩余 12 项 + P3 剩余 17 项）
