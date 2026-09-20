# 工程全面审计报告

> 审计日期：2026-07-26  
> 审计范围：全栈 monorepo（7 个后端微服务 + 2 个前端 + 配置/部署）  
> 审计基准：`.codebuddy/references/coding-best-practices.md`

---

## 审计摘要

| 级别 | 数量 | 关键问题 | 状态 |
|------|------|---------|------|
| 🔴 P0 安全缺陷 | 3 | CORS 硬编码 `*`、异常过滤器缺失、密钥硬编码 | ✅ 全部修复 |
| 🟡 P1 质量/一致性 | 7 | tsconfig 无 strict、admin refreshToken 存而不用、依赖版本冲突、healthcheck 缺失 | ✅ 6/7 修复（refreshToken 留存） |
| 🟢 P2 体验/文档 | 7 | API 格式不统一、分页参数混乱、测试零覆盖、Swagger 缺失 | 📋 已记录，后续迭代

---

## 🔴 P0 — 安全缺陷

### P0-1: CORS 硬编码 `*`（4 个服务）

`ai-service` 和 `system-service` 的 `main.ts` 直接 `origin: '*'`。`user-service` 和 `upload-service` 无参 `enableCors()`，NestJS 默认等同于 `*`。

**风险**：任意来源可访问内部微服务 API。

**修复**：统一从 `CORS_ORIGINS` 环境变量读取，默认空字符串。

**涉及文件**：
- `servers/ai-service/src/main.ts:23-24`
- `servers/system-service/src/main.ts:7`
- `servers/user-service/src/main.ts:23`
- `servers/upload-service/src/main.ts:26`

### P0-2: 全局异常过滤器缺失（3 个服务）

`todo-service`、`system-service`、`gateway` 的 `main.ts` 没有注册全局异常过滤器。未处理的非 HttpException（如 DB 连接失败）会直接暴露内部错误信息给客户端。

**修复**：复用 auth-service 的 `AllExceptionsFilter` 或创建统一过滤器。

### P0-3: 敏感密钥残留在 .env 文件

`servers/ai-service/.env` 含有真实 HY3_API_KEY、DEEPSEEK_API_KEY、腾讯云 AK/SK。`servers/todo-service/scripts/migrate.js:8` 硬编码数据库密码。

**风险**：即使 .gitignore 覆盖，开发机泄露或误提交仍有风险。

**修复**：清理 .env 中的真实密钥为占位符；migrate.js 改为读取环境变量。

---

## 🟡 P1 — 质量/一致性

### P1-1: 全部 7 个微服务 tsconfig 无 `strict: true`（32 处 any）

虽然开启了 `strictNullChecks: true`，但 `noImplicitAny` 全部设为 `false`。生产代码中存在 21 处 `:any` 类型注解和 11 处 `as any` 断言。

**修复**：添加 `"strict": true`，逐服务修复编译错误。

### P1-2: admin-web refreshToken 存而不用

Portal 已实现 401→refresh→重试的闭环。Admin 的 `request.ts` 401 时直接清除存储跳登录，refreshToken 完全没有被使用。

### P1-3: @types/node v22 vs Node 20 运行时

`servers/gateway/package.json` 中 `@types/node: ^22.0.0`，但 Dockerfile 使用 `node:20-alpine`。可能使用 Node 22 独有 API 而生产不支持。

### P1-4: @types/helmet 误放在 dependencies

`@types/*` 包应在 `devDependencies`，目前浪费生产依赖体积。

### P1-5: docker-compose.prod 缺失 healthcheck

生产环境的 Redis 和应用服务全部没有 healthcheck（开发环境有但遗漏了生产环境）。

### P1-6: upload-service JWT_SECRET 启动时不校验

`auth.guard.ts` 中 `process.env.JWT_SECRET` 为空时只在请求到来时抛错，启动时无感知。

### P1-7: CORS_ORIGINS=* 在 .env.example 中

`auth-service` 和 `gateway` 的 `.env.example` 给开发者错误示范。

---

## 🟢 P2 — 建议改进

### P2-1: API 响应格式 5+ 种不一致

- `code: 200`（HTTP 语义）vs `code: 0`（C 风格）混用
- 同一个 controller 内 `{ code, data }` 与裸 data 并存
- `{ success: true }` 这种独立格式也存在

### P2-2: 分页参数 `limit` vs `pageSize` 不统一

user-service 用 `limit`，其余服务用 `pageSize`。有的直接在 controller 设默认值，有的在 DTO 中，有的完全不设。

### P2-3: 测试覆盖率仅 1/7 服务

仅 `auth-service` 有 3 个 spec 文件。其余 6 个服务零测试。

### P2-4: 5 个 controller 无 Swagger 装饰器

`ai-service` 的 ai/tts/artworks controller 和 `system-service` 的 settings/operation-logs controller 无 `@ApiTags`/`@ApiOperation`。

### P2-5: 静默 catch 吞错

OAuth 回调 catch 只重定向不记 log；Gateway swagger API fetch 的 catch 完全空块。

### P2-6: 数据库连接池未配置

5 个 TypeORM 服务全部使用默认连接池大小（10），无 `extra.max/min` 配置。

### P2-7: 3 个服务缺少 Dockerfile

`system-service`、`todo-service`、`upload-service` 无 Dockerfile。

---

## 可新增的 AI 最佳实践

基于以上发现，以下模式应沉淀到 `CODEBUDDY.md`：

| 实践 | 标签 | 说明 |
|------|------|------|
| **CORS 必须从环境变量读取** | 安全 | 永远不硬编码 `origin: '*'`，无参 `enableCors()` 也不行 |
| **每个微服务必须有全局异常过滤器** | 安全 | 生产环境密钥消息→通用提示 |
| **.env 文件只放占位符** | 安全 | 真实密钥走环境变量注入/k8s secret |
| **tsconfig 统一 strict: true** | 质量 | 特别是 `noImplicitAny: true` |
| **前端 401 必须实现 refreshToken 自动刷新** | 质量 | 不能仅存储不刷新 |
| **.env.example 不能有 `CORS_ORIGINS=*`** | 安全 | 给开发者的错误示范 |
| **Docker 生产环境必须有 healthcheck** | 运维 | 每个数据库和应用服务都要 |
| **@types/* 包必须在 devDependencies** | 配置 | 避免污染生产依赖 |
