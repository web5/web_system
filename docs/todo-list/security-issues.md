# 安全问题待办清单

> 最后更新: 2026-07-25

---

## ✅ 已修复

| 序号 | 问题 | 修复方式 |
|------|------|---------|
| 1 | `.env` 文件泄露到 Git | `.gitignore` 改为 `**/.env*`，允许 `!.env.example` |
| 2 | `docker-compose.yml` 硬编码密码 | 改为 `${POSTGRES_PASSWORD}` 环境变量 |
| 3 | `docker-compose.prod.yml` 硬编码密码和 JWT Secret | 改为 `${DB_PASSWORD}` / `${JWT_SECRET}` |
| 4 | `upload-service/auth.guard.ts` 硬编码回退 JWT Secret | 移除回退值，未设置环境变量时直接报错 |
| 5 | `auth-service/seed.ts` 硬编码默认密码 `admin123` / `test123` | 改为必须通过环境变量指定 |
| 6 | `todo-service` SQL 注入风险 (`sortBy` 参数) | 加入字段白名单校验 |
| 7 | 缺少 API 速率限制 | Gateway 集成 `@nestjs/throttler`，每 IP 每分钟 100 次 |

---

## 🔴 高危 — 待修复

### 1. CORS 通配符 `*`

- **位置**: `docker-compose.prod.yml:32` → `CORS_ORIGINS=*`
- **风险**: 任意来源可访问生产 API，可能导致 CSRF/数据泄露
- **修复**: 改为具体的允许域名列表，如 `CORS_ORIGINS=https://dev.kedouai.com,https://admin.kedouai.com`

```yaml
# docker-compose.prod.yml
environment:
  - CORS_ORIGINS=https://dev.kedouai.com,https://admin.kedouai.com
```

---

## 🟡 中危 — 待修复

### 2. Helmet 安全头缺失

- **位置**: `servers/gateway/src/main.ts`
- **风险**: 缺少 X-Frame-Options、X-Content-Type-Options、HSTS 等安全头，应用暴露于点击劫持、MIME 嗅探等攻击
- **修复**: 安装 `helmet` 并在 main.ts 中启用

```bash
cd servers/gateway && pnpm add helmet @types/helmet
```

```typescript
// servers/gateway/src/main.ts
import helmet from 'helmet';
app.use(helmet());
```

### 3. CSP 头缺失

- **位置**: `servers/gateway/src/main.ts`
- **风险**: 无法限制页面可加载的脚本/样式来源，XSS 攻击面增大
- **修复**: 配合 helmet 配置 Content-Security-Policy 头（也可在 Nginx 层配置）

### 4. system-service 无输入验证

- **位置**: `servers/system-service/src/system/system.controller.ts`
- **风险**: controller 直接接收 `Record<string, string>` 类型，不做校验，可注入恶意值
- **修复**: 为 `/config/create`、`/config/update` 等接口创建 class-validator DTO

### 5. 生产环境异常过滤器泄露内部信息

- **位置**: 多个微服务的 `common/filters/all-exceptions.filter.ts`
- **风险**: 非 HttpException 类型的错误（如 DB 连接失败）的 message 直接返回给客户端，泄露内部路径/表名
- **修复**: 生产环境返回通用错误信息 `{ statusCode: 500, message: '服务器内部错误' }`

---

## 🟢 低危 — 待修复

### 6. console.log 替换为结构化 Logger

- **位置**: `servers/gateway/src/proxy/proxy.controller.ts` 等
- **风险**: 生产环境 console 输出可能包含请求参数，且无法控制日志级别
- **修复**: 替换为 `@nestjs/common` 的 `Logger`

```typescript
import { Logger } from '@nestjs/common';
private readonly logger = new Logger(ProxyController.name);
this.logger.log('...');
```

---

## 修复优先级

1. **立即**: 修复 CORS `*`（只需改环境变量）
2. **本周**: 安装 helmet + 修复异常过滤器
3. **下个迭代**: DTO 校验 + CSP 配置 + 切换 Logger
