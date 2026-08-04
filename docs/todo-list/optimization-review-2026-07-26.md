# 代码优化审查报告

> 审查范围：`git diff` 最近一次提交的所有改动  
> 审查日期：2026-07-26  
> 涉及文件：14 个文件，+212 / -46 行

---

## 一、严重问题（必须修复）

### 1.1 BUG：admin-web `configureServer` 不会被 Vite 调用

**文件**：`apps/admin-web/vite.config.ts`

`configureServer` 是 Vite plugin 钩子，必须写在 `plugins` 数组内的插件对象中。当前代码把它放在了 `server.*` 配置项下，**完全不会生效**。

```typescript
// ❌ 当前代码（不会生效）
server: {
  port: 5174,
  // ...
  configureServer(server) {  // <-- 这里 Vite 不会识别
    server.middlewares.use(...)
  },
}
```

**修复**：参照 `apps/portal/vite.config.ts` 的写法，抽成独立 plugin：

```typescript
// ✅ 正确写法
plugins: [
  vue(),
  vueJsx(),
  {
    name: 'admin-base-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (url === '/') {
          res.writeHead(301, { Location: '/admin/' });
          res.end();
          return;
        }
        if (url === '/admin') {
          res.writeHead(301, { Location: '/admin/' });
          res.end();
          return;
        }
        if (url.startsWith('/admin') && !url.includes('.')) {
          req.url = '/';
        }
        next();
      });
    },
  },
],
```

### 1.2 硬编码服务地址，生产环境不可用

**文件**：`servers/ai-service/src/bianbian/bianbian.service.ts`

三处微服务间调用使用了不一致的 URL 格式，且 `http://localhost` 在 Docker / 多服务器部署下无法工作：

```typescript
// ❌ 第195行：localhost 死地址
`http://localhost:3004/admin/settings/public/${cacheKey}`

// ❌ 第225行：localhost 死地址
`http://localhost:3002/users/${userId}`

// ⚠️ 第342行：用了 Docker hostname，但与上面不一致
'http://system-service:3004/admin/bianbian/materials'
```

**修复**：统一从 `ConfigService` 读取服务地址，与 gateway `proxy.service.ts` 保持一致：

```typescript
// ✅ 在 constructor 中注入配置
constructor(
  // ... 已有依赖
  private readonly configService: ConfigService,
) {}

// ✅ 使用统一的服务地址
private get systemServiceUrl(): string {
  return this.configService.get('SYSTEM_SERVICE_URL', 'http://localhost:3004');
}
private get userServiceUrl(): string {
  return this.configService.get('USER_SERVICE_URL', 'http://localhost:3002');
}
```

---

## 二、代码质量问题

### 2.1 `image-gen.client.ts` 用 `process.env` 而非 `ConfigService`

**文件**：`servers/ai-service/src/bianbian/image-gen.client.ts:51-57`

项目规范是全部通过 `ConfigService` 读取配置，当前代码直接用 `process.env`：

```typescript
// ❌ 打破统一模式
const apiKey = process.env.IMAGE_GEN_API_KEY;
const baseUrl = process.env.IMAGE_GEN_API_URL?.replace(/\/$/, '') || '...';
```

**修复**：注入 `ConfigService`：

```typescript
constructor(
  private readonly httpService: HttpService,
  private readonly configService: ConfigService,  // 新增
) {}

// 在 generate() 中：
const apiKey = this.configService.get<string>('IMAGE_GEN_API_KEY');
if (!apiKey) throw new Error('图片生成服务未配置 (IMAGE_GEN_API_KEY)');
const baseUrl = this.configService.get('IMAGE_GEN_API_URL', 'https://tokenhub.tencentmaas.com').replace(/\/$/, '');
```

### 2.2 临时文件无清理机制

**文件**：`servers/ai-service/src/bianbian/bianbian.service.ts:451-473`

`saveTempImage` 将 base64 图片写入 `temp-images/` 目录，但没有对应的清理逻辑。每个变身请求都会产生一个临时文件，长期运行会积累大量磁盘占用。

**修复方案**（二选一）：

- **方案 A（推荐）**：在 `transform` 方法结束后立即删除临时文件
- **方案 B**：启动时注册定时任务，清理超过 N 分钟的临时文件

```typescript
// 方案 A 示例：在 transform() 的 finally 中清理
async transform(dto: TransformDto): Promise<TransformResponse> {
  let tempFilename: string | undefined;
  try {
    // ... 现有逻辑
    imageUrl = await this.saveTempImage(dto.image);
    tempFilename = imageUrl.split('/').pop();
    // ...
  } finally {
    if (tempFilename && this.tempImagesDir) {
      const filePath = path.join(this.tempImagesDir, tempFilename);
      fs.promises.unlink(filePath).catch(() => {});
    }
  }
}
```

### 2.3 `getPublicUrl` 硬编码兜底域名

**文件**：`servers/ai-service/src/bianbian/bianbian.service.ts:476-482`

```typescript
// ❌ 硬编码生产域名
const publicBase =
  this.configService.get('BIANBIAN_PUBLIC_BASE_URL') ||
  this.configService.get('PUBLIC_URL')?.replace('http://', 'https://') ||
  'https://dev.kedouai.com';  // <-- 硬编码
```

**修复**：去掉硬编码兜底，配置缺失时直接报错：

```typescript
private getPublicUrl(filename: string): string {
  const publicBase =
    this.configService.get('BIANBIAN_PUBLIC_BASE_URL') ||
    this.configService.get('PUBLIC_URL');
  if (!publicBase) {
    throw new Error('PUBLIC_URL 或 BIANBIAN_PUBLIC_BASE_URL 未配置');
  }
  return `${publicBase.replace(/\/$/, '')}/api/bianbian/temp-image/${filename}`;
}
```

### 2.4 `sleep` 函数重复定义

**文件**：`servers/ai-service/src/bianbian/image-gen.client.ts:237-239`

`ImageGenClient` 自己定义了 `sleep`，但 `@web-system/shared` 已经导出了同名函数：

```typescript
// image-gen.client.ts 中的重复代码
private sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**修复**：从 shared 包导入：

```typescript
import { API_TIMEOUT, sleep } from '@web-system/shared';
// 删除类中的 private sleep 方法，将 this.sleep(xxx) 改为 sleep(xxx)
```

### 2.5 `downloadAndSaveImage` 未检查 HTTP 状态码

**文件**：`servers/ai-service/src/bianbian/bianbian.service.ts:509-516`

下载 AI 生成图片时，只检查了异常，没有检查 HTTP 状态码是否成功：

```typescript
const response = await firstValueFrom(
  this.httpService.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: API_TIMEOUT.GATEWAY.AI_TASK,
  }),
);
await fs.promises.writeFile(filePath, Buffer.from(response.data));
```

**修复**：增加状态码检查：

```typescript
const response = await firstValueFrom(
  this.httpService.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: API_TIMEOUT.GATEWAY.AI_TASK,
  }),
);
if (response.status !== 200) {
  throw new Error(`下载图片失败: HTTP ${response.status}`);
}
await fs.promises.writeFile(filePath, Buffer.from(response.data));
```

---

## 三、架构层面建议

### 3.1 Gateway SPA 回退过于宽泛

**文件**：`servers/gateway/src/main.ts:107-108`

任何不匹配 API/文档/管理后台/静态资源的 GET 请求都会被回退到 Portal 的 `index.html`：

```typescript
// 这意味着 /random-page、/favicon.ico（无扩展名判断可能漏过）等
// 全部返回 Portal 的 index.html
res.sendFile(join(__dirname, '..', 'public', 'portal', 'index.html'));
```

**建议**：增加路径白名单，只有 `/portal/` 开头的路径或根路径才回退到 Portal：

```typescript
// 只对 /portal/ 开头的路径做 SPA 回退
if (path.startsWith('/portal/') || path === '/portal') {
  return res.sendFile(join(__dirname, '..', 'public', 'portal', 'index.html'));
}
// 其他未匹配路径 → 由 NestJS 404 处理（配合前端 NotFound.vue）
return next();
```

### 3.2 素材 SVG 双写维护负担

**文件**：`apps/portal/scripts/generate-materials.mjs:69-70`

生成脚本将 SVG 同时写入两个目录：
- `apps/portal/public/materials/svg/`（本地开发用）
- `servers/gateway/public/materials/svg/`（生产部署用）

**建议**：只写到 Gateway 的 `public/materials/svg/`，Portal 本地开发通过 vite proxy 转发到 Gateway。这样只有一个数据源，避免不一致。

### 3.3 `ai-service/main.ts` CORS 配置语义不清晰

**文件**：`servers/ai-service/src/main.ts:27-32`

```typescript
const corsOrigins = configService.get('CORS_ORIGINS', '');
app.enableCors({
  origin: corsOrigins || false,  // 空字符串时 origin=false（禁用 CORS）
  // ...
});
```

`origin: false` 的含义是"不设置 Access-Control-Allow-Origin 响应头"，这在 Gateway 已处理 CORS 的场景下是可以的，但建议加注释说明：

```typescript
const corsOrigins = configService.get('CORS_ORIGINS', '');
app.enableCors({
  // 空值时关闭 CORS（微服务不直接对外暴露，由 Gateway 统一处理 CORS）
  origin: corsOrigins || false,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
});
```

---

## 四、文档同步问题

### 4.1 `DEPLOYMENT.md` 未更新路由变化

**文件**：`DEPLOYMENT.md:12-16`

架构图仍然描述旧的单层 SPA 路由，未反映 Portal 迁移到 `/portal/` 路径：

```markdown
# ❌ 当前文档（过时）
| /            | SPA 回退中间件 → index.html |
| /create      | SPA 回退中间件 → index.html (SPA 路由) |
```

**建议更新**：

```markdown
# ✅ 更新后
| /            | 301 重定向 → /portal/ |
| /portal/*    | Portal SPA 回退 → public/portal/index.html |
| /admin/*     | Admin SPA 回退 → public/admin/index.html |
| /materials/* | Gateway 静态资源服务 |
| /create      | Portal SPA 路由（/portal/ 内部路径） |
```

---

## 五、改动总结

| 级别 | 数量 | 说明 |
|------|------|------|
| 🔴 严重 | 2 | admin-web configureServer 无效、硬编码地址 |
| 🟡 代码质量 | 4 | process.env 直接使用、临时文件泄漏、硬编码域名、重复函数 |
| 🔵 建议 | 3 | SPA 回退过宽、素材双写、CORS 注释缺失 |
| ⚪ 文档 | 1 | DEPLOYMENT.md 未更新 |

---

## 六、优先级建议

1. **立即修复**：1.1（admin-web 路由中间件不生效）和 1.2（硬编码地址）
2. **本迭代修复**：2.1、2.2、2.3、2.5
3. **后续优化**：2.4、3.1、3.2、3.3、4.1
