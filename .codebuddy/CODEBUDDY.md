# 科豆 AI · 项目入口

## 是什么

科豆 AI 儿童创造力平台 — 全栈 monorepo（Vue3 + NestJS + PostgreSQL + 微信小程序）。

**平台产品矩阵**：
| 产品 | 定位 | 路由 |
|------|------|------|
| 变变 | AI 拼贴变身 3D 角色 | /create → /transform → /result |
| 画板 | 自由绘画 + AI 文生图 | /draw |
| AI 学习助手 | 少儿 AI 对话 | /chat |

## 技术栈速查

| 层 | 技术 |
|----|------|
| 前端 | Vue3 + Vite + Pinia + Ant Design Vue 4.x |
| 后端 | NestJS 10 + TypeORM 0.3 + PostgreSQL |
| 小程序 | 微信原生 + TypeScript |
| 部署 | Docker Compose + Nginx |

## 端口

| 服务 | 端口 |
|------|------|
| gateway | 3000 |
| auth-service | 3001 |
| user-service | 3002 |
| ai-service | 3003 |
| system-service | 3004 |
| portal (dev) | 5173 |
| admin-web (dev) | 5174 |
| docs (static) | 4173 |

## 设计常量

**平台（暗色）**：主色 `#f97316` 暖橙 / 暗底 `#0A0A0D` / 文字 `#F8FAFC`
**变变产品（暖色）**：主色 `#FF8C42` 魔法橙 / 底色 `#FFF8F0` 暖白 / 文字 `#333333`

## 开发规则

1. 大改动走 Superpowers 工作流：brainstorm → plan → execute → review
2. 架构决策前加载 `tech-review` 审查
3. 不主动 git commit
4. TypeScript 严格模式，禁止 `any`
5. 每个微服务独立数据库
6. 所有 API 通过 gateway 代理
7. **Icon 规范**：禁止使用 emoji 作为图标，统一使用 SVG icon；如果没有合适的 SVG icon，宁可不用 icon
8. **静态资源路径**：
   - `/api/uploads/*` — 用户上传文件和 AI 生成图片的统一路径（头像、变变图、画板等）
   - `/materials/svg/*` — 系统素材 SVG，独立于页面路由，由 Gateway 直接提供
   - AI 生成图片必须落盘到 `/api/uploads/` 目录 + 数据库存相对路径，不能只存远程 URL

## AI 编程规范

这些规则从真实踩坑中提炼，旨在提高 AI 编码的「一次正确率」，减少事后补救。

### 安全铁律（每次改动必查）

| 规则 | 正确做法 | 错误做法 |
|------|---------|---------|
| CORS | `configService.get('CORS_ORIGINS', '')`，禁止 `origin: '*'` 或无参 `enableCors()` | 硬编码 `*` 或空参调用 |
| 异常消息 | 生产环境非 HttpException → `'服务器内部错误'` | 直接返回 `exception.message` |
| 输入校验 | 所有 @Body/@Query 用 class-validator DTO | `Record<string, string>` 裸类型 |
| 日志 | `new Logger('xxx').log(...)` | `console.log/error(...)` |
| JWT_SECRET | 每个服务 main.ts/AppModule 启动时校验非空 | 空字符串不报错 |
| .env 密钥 | .env 文件加安全警告注释，密钥走环境变量注入 | 真实密钥明文暴露在文件中 |
| 异常过滤器 | 每个微服务 main.ts 必须有全局异常过滤器 | 未处理异常直接暴露客户端 |
| .env.example | CORS_ORIGINS 写具体域名，不写 `*` | 给开发者错误示范 |

### 代码质量铁律

| 规则 | 正确做法 | 错误做法 |
|------|---------|---------|
| TS 严格模式 | `"strict": true` + `"strictPropertyInitialization": false` | 手选 subset 且 noImplicitAny: false |
| JWT 校验 | 前端路由守卫校验 `exp` 过期 | 只检查 token 是否存在 |
| 401 拦截器 | 竞态锁 + 60s 超时重置 + refreshToken 自动刷新 | 无锁或锁永不重置 |
| 404/403 | 所有前端必须配置 404 + 403 页面 | 权限失败跳 /dashboard |
| @types 版本 | 与运行时包主版本一致，放 devDependencies | @types/node@22 配 node:20，@types/helmet 放 dependencies |
| 无用依赖 | 每个依赖都被源码 import，定期清理 | package.json 残留僵尸包 |
| 变量初始化 | `let flag: boolean = false` | `let flag: boolean`（undefined） |

### 部署铁律

| 规则 | 正确做法 | 错误做法 |
|------|---------|---------|
| PM2 | `pm2 restart xxx \|\| pm2 start ...` | `pm2 delete; pm2 start` |
| Docker | .dockerignore + 每个服务 healthcheck + 敏感端口仅内网 | 无 .dockerignore，端口全开，无健康检查 |
| 生产 Redis | `127.0.0.1:6379:6379` | `6379:6379`（公网暴露） |
| 脚本路径 | `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` | `dirname "$0"` 相对路径 |

> 完整版：`.codebuddy/references/coding-best-practices.md`  
> 审计报告：`docs/archive/todo-list/audit-report-2026-07-26.md`

### 1. 同类修改必须扫全量（Monorepo 铁律）

修改前必须 `grep` 所有同类文件，不能只改遇到的一个服务。

**真实教训**：之前修了 gateway/auth/todo 三个服务的 CORS 默认值、异常过滤器、console.log→Logger，但 ai-service 仍硬编码 `origin: '*'`，system/user/upload 仍 `enableCors()` 无参。因为这些服务没有被"刚好触及"。

**自查清单（修改任何横切关注点时）**：
- CORS 配置 → `grep -r enableCors servers/*/src` 确认全部从环境变量读取
- 异常过滤器 → `grep -r useGlobalFilters servers/*/src` 确认全部注册
- console.log → `grep -r 'console\.' servers/*/src` 确认无残留
- JWT_SECRET 校验 → 每个用 JWT 的服务 app.module.ts 或有 auth.guard 的都要

### 2. 跨端配置禁止拷贝，必须收口到 `@web-system/shared`

- 先在 `packages/shared/src/` 下新建或追加
- 如需导出，在 `packages/shared/src/index.ts` 中 re-export
- 删掉各端本地的拷贝文件，防止后续开发者误用旧文件

### 2. 请求超时分三层，排查时逐层定位

monorepo 中一次 HTTP 请求经过三层各自独立的超时配置：

| 层 | 位置 | 典型值 |
|----|------|--------|
| 前端 axios / wx.request | `import { API_TIMEOUT } from '@web-system/shared'` | DEFAULT 10s/30s, AI_TASK 180s |
| Gateway http-proxy-middleware | `servers/gateway/src/proxy/proxy.service.ts` 的 `PROXY_TIMEOUT` | DEFAULT 30s, AI_TASK 180s |
| 后端 service 调第三方 | `servers/*/src/common/http/*.client.ts` | 30s |

真实请求超时以 **三层中最短的那层** 为准。遇到「已取消」、504、或 ERR_ABORTED 时，从最内层往外排查，而不是只看某一层。

**Gateway 层也是瓶颈**：新增 AI 类路由（`/api/ai/*`、`/api/bianbian/*`）时，必须在 `proxy.service.ts` 中给对应 proxy 传 `PROXY_TIMEOUT.AI_TASK`，否则会被 30s 默认值截断。

### 3. AI 异步接口不能与 CRUD 共用默认超时

调用第三方 AI 模型的接口（对话 `/ai/chat`、生图 `/ai/image/submit` 等）链路长，冷启动 + 队列等待经常 10-30s，必须单独设置 `API_TIMEOUT.AI_TASK`（90s），不能依赖全局 10s 默认值。

### 4. 新增魔法数字前先全局搜索

写任何硬编码的数字或字符串前，先搜索项目是否已有同类配置或常量。避免以下后果：
- 同类重复配置导致各端行为不一致
- 修改时只改了一处，其他地方仍是旧值

### 5. 收口后清理冗余文件

配置从分散改统一后，必须删除各端的旧配置文件，并确认没有任何地方仍然 import 旧路径。

### 6. 前端项目加入共享包依赖

portal / mini-app 如需引用 `@web-system/shared`：
- `package.json` 加 `"@web-system/shared": "file:../../packages/shared"`
- 小程序额外需要在 `tsconfig.json` 中配置 `paths` 映射
- 执行 `pnpm install` 使符号链接生效

**后端 service 添加方式不同**：
- `package.json` 加 `"@web-system/shared": "file:../../packages/shared"`
- **不要在 tsconfig.json 中加 paths 映射**（pnpm workspace 的符号链接已处理模块解析）
- 加 paths 会导致 `nest build` 把 `packages/shared/src/` 源文件也编译进 dist，产生错误的目录结构
- 执行 `pnpm install` + `pnpm build` 即可

## Skills

| Skill | 何时用 |
|-------|--------|
| `rd-digital-agent` | 入口 Hub，自动路由 |
| `rd-brainstorm` | 模糊需求，出方案选项 |
| `rd-plan` | 细化方案，拆任务 |
| `rd-execute` | TDD 逐项实现 |
| `rd-review` | 完成后自检 |
| `tech-review` | 架构/安全/数据方案审查 |
| `user-memory` | 用户偏好自动加载 |
