# 编码最佳实践 · AI 编码参考

> 从安全审计和代码审查中沉淀出来的可模式化规则，适合人类开发和 AI 编码助手共同遵循。

---

## 〇、Monorepo 铁律：同类修改必须扫全量

修改任何横切关注点（CORS、异常过滤、日志、校验）时，**必须 grep 全部服务确认**，不能只改手头正在用的那一个。

**典型翻车路径**：修了 gateway/auth/todo，但 ai/system/user/upload 仍留着同样的问题。

**自查命令清单**：
```bash
# CORS：确认无硬编码 origin:'*' 或空参 enableCors()
grep -rn "origin.*'\*'" servers/*/src/main.ts
grep -rn "enableCors()" servers/*/src/main.ts

# 异常过滤器：确认全部注册
grep -rn "useGlobalFilters" servers/*/src/main.ts

# console 残留：确认全部替换为 Logger
grep -rn "console\." servers/*/src/*.ts

# tsconfig strict：确认全部声明
grep -rn '"strict"' servers/*/tsconfig.json
```

---

## 一、安全必查项（每次改动都应验证）

### 1.1 CORS：永远不要默认 `*`

```typescript
// ❌ 错误
const corsOrigins = configService.get('CORS_ORIGINS', '*');

// ✅ 正确：不设置时禁用 CORS，生产环境必须显式配置
const corsOrigins = configService.get('CORS_ORIGINS', '');
```

**规则**：`CORS_ORIGINS` 默认值必须是空字符串，禁止回退到 `*`。

### 1.2 异常过滤器不泄露内部信息

```typescript
// ❌ 错误：生产环境直接返回 DB 错误信息
} else if (exception instanceof Error) {
  message = exception.message; // 可能泄露表名、路径
}

// ✅ 正确：生产环境返回通用错误
const clientMessage = isHttpException
  ? rawMessage
  : this.isProduction
    ? '服务器内部错误'
    : (exception as Error).message;
```

**规则**：非 `HttpException` 的消息在 `NODE_ENV=production` 时必须替换为通用提示。服务端 Logger 仍然记录完整错误。

### 1.3 HTTP 安全头（Helmet + CSP）

```typescript
// ✅ Gateway main.ts 必须包含
import helmet from 'helmet';
app.use(helmet({
  contentSecurityPolicy: { directives: { /* 按项目配置 */ } },
}));
```

### 1.4 Controller 输入验证

```typescript
// ❌ 错误：裸类型，无校验
@Put()
async update(@Body() data: Record<string, string>) { ... }

// ✅ 正确：使用 class-validator DTO
@Put()
async update(@Body() data: UpdateSettingsDto) { ... }
```

**规则**：所有 `@Body()`、`@Query()`、`@Param()` 参数必须使用 DTO 类，禁止 `Record<string, string>` 等裸类型。

### 1.5 JWT_SECRET 启动校验

```typescript
// ✅ AppModule.onModuleInit 中校验
onModuleInit() {
  const jwtSecret = this.configService.get('JWT_SECRET', '');
  if (!jwtSecret) {
    this.logger.error('JWT_SECRET 未设置，拒绝启动');
    process.exit(1);
  }
}
```

### 1.6 使用结构化 Logger 而非 console.log

```typescript
// ❌ 错误
console.log(`Service is running on: ${port}`);

// ✅ 正确
import { Logger } from '@nestjs/common';
const logger = new Logger('Gateway');
logger.log(`Gateway is running on: http://localhost:${port}`);
```

---

## 二、路由与鉴权

### 2.1 前端路由守卫必须校验 JWT 过期

```typescript
// ❌ 错误：只检查 token 存在
if (!token) { next('/login'); return; }

// ✅ 正确：同时检查过期
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch { return true; }
}
if (!token || isTokenExpired(token)) { next('/login'); return; }
```

### 2.2 401 拦截器防重入 + 自动刷新

```typescript
// 401 竞态锁必须有超时重置
let isRedirecting = false;
if (!isRedirecting) {
  isRedirecting = true;
  setTimeout(() => { isRedirecting = false; }, 60000); // 防止永久锁死
  router.push('/login');
}

// 优先尝试 refreshToken 自动刷新
async function tryRefreshToken() {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;
  const res = await axios.post('/auth/refresh', { refreshToken });
  // 更新本地 token，重试原请求
}
```

### 2.3 404 / 403 页面

- 所有前端必须配置 404 兜底路由 `/:pathMatch(.*)*`
- 403 无权限页面：权限检查失败跳 `/403`，而非 `/login` 或 `/dashboard`

---

## 三、配置规范

### 3.1 TypeScript 严格模式

```json
// tsconfig.json
{ "compilerOptions": { "strict": true } }
```

### 3.2 依赖版本匹配

```json
// ❌ @types/express v5 搭配 express v4
// ✅ 版本号必须一致
{ "@types/express": "^4.17.21", "express": "^4.21.0" }
```

### 3.3 定期清理无用依赖

- 确认 `package.json` 中的每个依赖在源码中被实际 import
- 被 `@nestjs/passport` 等间接依赖的包，如 Gateway 不用 Passport 则一并移除

### 3.4 Vite 构建配置

```typescript
// ✅ 生产构建最佳配置
build: {
  sourcemap: 'hidden',       // 配合错误监控
  target: 'es2020',           // 减少 polyfill 体积
  minify: 'terser',           // 正确移除 console
  terserOptions: {
    compress: { drop_console: true, drop_debugger: true },
  },
}
```

---

## 四、部署与运维

### 4.1 PM2 部署使用 restart，不用 delete+start

```bash
# ❌ 有停机时间
pm2 delete gateway; pm2 start ...

# ✅ 零停机
pm2 restart gateway 2>/dev/null || pm2 start ...
```

### 4.2 Docker 规范

```yaml
# 生产环境
redis:
  ports:
    - "127.0.0.1:6379:6379"  # ✅ 仅本机访问，不暴露公网

# 必须配置 healthcheck
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U web_system"]
    interval: 10s
```

### 4.3 必须有 .dockerignore

至少排除：`node_modules`, `.git`, `dist`, `.env*`, `*.log`

---

## 五、代码质量（shared 包）

### 5.1 变量初始化

```typescript
// ❌ 可能 undefined
let inThrottle: boolean;

// ✅ 显式初始值
let inThrottle: boolean = false;
```

### 5.2 非安全函数加注释

```typescript
// ✅ 明确标注安全性
/**
 * 生成随机字符串
 * 注意：使用 Math.random()，非密码学安全，仅适用于非安全场景
 * 安全场景请使用 crypto.randomBytes
 */
export function randomString(length = 32): string { ... }
```

### 5.3 类型定义避免冗余

```typescript
// ❌ 重复字段
interface UserInfo {
  id: number;
  username: string;
  email?: string;
  // ...
}

// ✅ 继承公共字段
interface UserInfo extends Pick<User, 'id' | 'username'> {
  // 仅声明 UserInfo 特有的字段
  roles: string[];
}
```

### 5.4 Shell 脚本路径

```bash
# ❌ 从其他目录执行会找不到文件
cd "$(dirname "$0")/servers/auth-service"

# ✅ 使用绝对路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../servers/auth-service"
```

---

## 六、自检清单（PR 前）

| 检查项 | 说明 |
|--------|------|
| CORS 默认值 | 不是 `*` |
| 异常过滤器 | 生产环境掩码非 HttpException |
| HTTP 安全头 | Helmet + CSP 已启用 |
| Controller 输入 | 全部使用 class-validator DTO |
| console.log | 全部替换为 NestJS Logger |
| JWT 过期校验 | 前端路由守卫 + isTokenExpired |
| 404/403 页面 | 两个前端都已配置 |
| 401 竞态锁 | 有 60s 超时重置 |
| TypeScript strict | 全部 `tsconfig.json` 声明 `strict: true` |
| 无用依赖 | 确认每个依赖都被 import |
| PM2 部署 | restart 而非 delete+start |
| Docker | healthcheck + 不暴露敏感端口 + .dockerignore |
