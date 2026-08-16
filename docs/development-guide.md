# Web System 研发平台 — 开发与使用指南

> 本文档面向本地开发与日常使用，覆盖技术架构、环境准备、启动、开发流程、发布系统、测试验证与常见问题。
> 关联：`docs/architecture/release-system-design.md`（发布系统设计）、`docs/architecture/micro-frontend-technical-design.md`（微前端技术设计）。

---

## 1. 技术架构总览

### 1.1 分层

```
┌──────────────────────────── 前端（apps/）────────────────────────────┐
│  shell（微前端基座）  portal（门户模块）  admin（后台模块）             │
│  deploy-console（运维控制台）  mini-app（小程序）                      │
└──────────────────────────────────────────────────────────────────────┘
              │ 微前端加载（shell-loader + window.__SHARED__ 共享依赖）
┌──────────────────────────── 网关层（gateway）────────────────────────┐
│  路由反代 /api/* → 各后端服务；微前端基座 index.html + 版本清单注入     │
│  灰度命中（deploy_canary_rules）                                     │
└──────────────────────────────────────────────────────────────────────┘
              │ /api/* 反代（proxy 模块）
┌──────────────────────────── 后端微服务（servers/）───────────────────┐
│ auth  user  ai  system  todo  mcp-gateway  finnews  upload            │
│ deploy-console（发布/部署/监控控制台）                                  │
└──────────────────────────────────────────────────────────────────────┘
              │
┌──────────────────────────── 基础设施 ─────────────────────────────────┐
│  MySQL(3306: web_system + web_system_deploy)  Redis(6379)  nginx(8090)│
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 服务清单与端口

| 服务 | 目录 | 端口 | pm2 进程名 | 说明 |
|---|---|---|---|---|
| gateway | servers/gateway | 6000 | web-gateway | 网关：API 反代 + 微前端基座 + 版本分发/灰度 |
| auth-service | servers/auth-service | 6101 | web-auth | 认证（登录/JWT/微信） |
| user-service | servers/user-service | 6002 | web-user | 用户 |
| ai-service | servers/ai-service | 6003 | web-ai | AI（对话/生图/TTS） |
| system-service | servers/system-service | 6004 | web-system | 系统（配置/素材） |
| todo-service | servers/todo-service | 6005 | web-todo | 待办 |
| mcp-gateway | servers/mcp-gateway | 6006 | web-mcp-gateway | MCP 网关 |
| finnews | servers/finnews | 6007 | web-finnews | 财经资讯 |
| upload-service | servers/upload-service | 6008 | web-upload | 上传 |
| deploy-console | servers/deploy-console | 6200 | web-deploy-console | 运维控制台（发布/环境/服务器/监控） |

> 注：auth-service 用 6101（6001 被其它项目占用）。

### 1.3 前端应用

| 应用 | 目录 | 类型 | 本地访问 |
|---|---|---|---|
| shell | apps/shell | 微前端基座 | 构建产物走 gateway（6000/） |
| portal | apps/portal | 微前端模块 | http://localhost:5173 |
| admin | apps/admin | 微前端模块 | http://localhost:5174/admin/ |
| deploy-console | apps/deploy-console | 独立 SPA（运维） | 由 deploy-console 后端 serve（6200/console/） |
| mini-app | apps/mini-app | 小程序 | 独立上传 |

### 1.4 共享包（packages/）

| 包 | 作用 |
|---|---|
| shared | 共享工具（SnakeNamingStrategy、UuidEntity、micro-frontend 类型） |
| types | 权限类型等 |
| shell-loader | 自研微前端模块加载器（register/mount/unmount，unmount 移除 CSS） |
| mcp-core | MCP 核心 |
| ui | 共享 UI 组件 |

### 1.5 微前端机制（要点）

- **基座 shell**：提供 `window.__SHARED__`（共享 vue/router/pinia/antd 等，避免重复打包），注入 `window.__MODULES_MANIFEST__`（各模块当前版本清单）。
- **模块加载**：`packages/shell-loader` 按 manifest 动态加载模块的 `index.js`/`index.css`，unmount 时移除 CSS。
- **CSS 隔离**：`scripts/vite-micro-frontend.mjs` 用 `:where([data-module="<key>"])` 前缀做作用域隔离（`:where()` 优先级归零，不误伤 antd cssinjs 样式）。
- **产物**：`static/modules/<key>/<version>/{index.js,index.css,manifest.json}`，nginx 直出，版本化可缓存。

---

## 2. 目录结构

```
web_system/
├── apps/            # 前端应用（shell/portal/admin/deploy-console/mini-app）
├── servers/         # 后端微服务（gateway/auth/user/ai/system/todo/mcp-gateway/finnews/upload/deploy-console）
├── packages/        # 共享包（shared/types/shell-loader/mcp-core/ui）
├── scripts/         # 构建/部署/启动/验证脚本
│   ├── local-db.sh          # 启动本地 MySQL + Redis
│   ├── local-up.sh          # 一键构建 + pm2 启动 10 后端（推荐）
│   ├── start-frontend.sh    # 启动 portal/admin/docs 前端
│   ├── dev-e2e-start.sh     # 微前端端到端验证（构建 externals/shell/modules + seed + gateway）
│   ├── dev-verify.sh        # 本地开发验证（DB/单测/集成/健康）
│   ├── build-module.mjs     # 微前端模块打包（vite build --mode mf）
│   ├── vite-micro-frontend.mjs  # UMD 打包 + CSS 作用域隔离插件
│   ├── _test-p0.mjs / _test-p1.mjs  # 发布系统集成测试
│   └── migrations/          # 数据库迁移脚本
├── docs/            # 文档（architecture/ 含架构与设计文档）
├── ecosystem.config.cjs     # pm2 后端进程清单（web-* 10 个）
└── package.json / pnpm-workspace.yaml
```

---

## 3. 环境准备（首次）

**前置**：Node 20+、pnpm、以及本地 MySQL/Redis（`~/local` 下，见 `scripts/local-db.sh`）。

```bash
cd ~/workspace/web_system
pnpm install                    # 首次安装依赖（workspace）
bash scripts/local-db.sh        # 初始化并启动 MySQL(3306) + Redis(6379)
```

> MySQL 客户端路径：`~/local/mysql-8.4.0-macos14-arm64/bin/mysql`（本地无全局 mysql 命令时用它）。

---

## 4. 本地启动

### 4.1 后端（推荐 pm2 方式）

```bash
bash scripts/local-up.sh                # 构建共享包 + 全部后端 → pm2 启动 → 健康检查
bash scripts/local-up.sh --no-build     # 跳过构建，仅 pm2 重启（改 .env 后最快）
bash scripts/local-up.sh --seed         # 额外重置 admin 密码为 admin123
pm2 status                              # 查看 web-* 进程状态
```

### 4.2 前端

```bash
bash scripts/start-frontend.sh          # portal(5173) + admin(5174) + docs(4173)
```

### 4.3 微前端端到端

```bash
bash scripts/dev-e2e-start.sh           # 构建 externals + shell + portal/admin + seed → gateway 前台运行
# 浏览器访问 http://localhost:6000/ → 基座加载 → 进 /portal → 挂载 portal 模块
```

### 4.4 单独运行某个前端模块（standalone 模式）

微前端改造后，admin/portal 的 `index.html` 指向 `main-standalone.ts`，可独立运行排查：

```bash
cd apps/admin && npx vite --port 5175     # standalone（http://127.0.0.1:5175/admin/）
cd apps/portal && npx vite --port 5173    # standalone（http://127.0.0.1:5173/portal/）
```

> standalone 与 mf 模式样式已对齐（`:where()` 前缀修复）。standalone 不加载基座，适合单独排查页面/样式。

---

## 5. 开发流程

### 5.1 后端服务开发

```bash
cd servers/<service>
pnpm dev                  # nest start --watch（热重载）
# 或构建产物模式：pnpm build && pm2 restart web-<service>
```

改 `.env` 后最快重启：`bash scripts/local-up.sh --no-build`。

### 5.2 前端（portal/admin）开发

```bash
cd apps/<app> && npx vite          # dev server（admin 端口 5174 被占用时用 5175）
```

### 5.3 微前端模块发布（开发态快速验证）

```bash
RELEASE_TAG=$(git rev-parse --short HEAD) npx vite build --mode mf   # 在 apps/<module> 下
rsync -a --delete apps/<module>/dist/ servers/gateway/public/static/modules/<module>/<commit>/
# gateway versionCache TTL 10s 过期后生效（无需重启 gateway）
```

---

## 6. 发布系统（deploy-console）

访问 `http://localhost:6200/console/`（登录 admin / deploy2026），或通过 nginx `/console/`。

### 6.1 核心概念

| 概念 | 表 | 说明 |
|---|---|---|
| 模块 | deploy_modules | 可部署单元（backend/frontend/micro-frontend/mini-app） |
| 环境 | deploy_environments | dev/prod/staging，一等公民 |
| 服务器组 | deploy_servers | serverName 指向多台服务器（多副本/负载均衡） |
| 环境服务路由 | deploy_env_service_routes | 每环境定义「服务名 → serverName」 |
| 当前版本 | deploy_deployments | env × module → 版本指针（唯一约束） |
| 版本历史 | deploy_versions | 每次发布的版本记录（git commit 标识） |
| 灰度规则 | deploy_canary_rules | header/percent/user-list 三种匹配 |

### 6.2 发布流程

1. **注册模块**（模块管理）：backend 类型走 git 发布，micro-frontend 走构建产物。
2. **配置环境 + 服务器组 + 路由**：环境 → 服务器组（serverName）→ 服务路由。
3. **发布**：微前端 `vite build --mode mf` → 上传 `static/modules/<key>/<commit>/` → 切指针（10s 生效）。
4. **回滚**：指针切回历史版本（秒级，前端/微前端）。
5. **灰度**：创建规则 → 部分流量命中 canary → 全量后指针切到 canary 版本。

---

## 7. 测试与验证

### 7.1 一键验证脚本

```bash
bash scripts/dev-verify.sh              # 全部（DB + 单测 + 集成 + 健康）
bash scripts/dev-verify.sh --unit       # 仅单元测试
bash scripts/dev-verify.sh --integ      # 仅集成测试
bash scripts/dev-verify.sh --health     # 仅服务健康/登录自检
```

### 7.2 单元测试（deploy-console）

```bash
cd servers/deploy-console && npx jest   # deploy.service / server.service 等
```

### 7.3 集成测试（真实 DB）

```bash
node scripts/_test-p0.mjs   # 数据一致性（去重/唯一约束/component 命名）
node scripts/_test-p1.mjs   # 服务器组/路由（建表/迁移/唯一约束）
```

### 7.4 登录自检

```bash
# 网关（admin/admin123）
curl -X POST http://127.0.0.1:6000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
# deploy-console（admin/deploy2026）
curl -X POST http://127.0.0.1:6200/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"deploy2026"}'
```

---

## 8. 常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| 端口 5174 被占用 | 无关 React 项目占用 | admin standalone 用 `--port 5175` |
| MySQL 报 `Illegal mix of collations` | 新表 collation 与旧表不一致 | 建表统一 `utf8mb4_unicode_ci`（与 deploy_environments 一致） |
| gateway 启动报 `No metadata for DeployCanaryRuleEntity` | deploy 连接 entities 漏注册 | app.module.ts 的 deploy 连接 entities 数组补实体 |
| 微前端样式错乱（Input 高度/按钮颜色） | `[data-module]` 前缀优先级高于 antd `:where()` | 前缀改用 `:where([data-module])`（已修复） |
| 模块切换后 CSS 残留污染 | loader unmount 不移除 CSS | shell-loader unmount 时 removeCss（已修复） |
| deploy-console 前端白屏/路由不匹配 | vue-router base `/console/` 与父路由 `/console` 双重 | 父路由 path 改 `/`，菜单/跳转去 `/console` 前缀（已修复） |
| 部署前要重置 admin 密码 | 密码丢失 | `bash scripts/local-up.sh --seed` |

---

## 附录：关键脚本速查

| 脚本 | 作用 |
|---|---|
| `scripts/local-db.sh` | 启动 MySQL + Redis |
| `scripts/local-up.sh` | 构建 + pm2 启动 10 后端 + 健康检查 |
| `scripts/start-frontend.sh` | 启动 portal/admin/docs |
| `scripts/dev-e2e-start.sh` | 微前端端到端验证 |
| `scripts/dev-verify.sh` | 开发验证（DB/单测/集成/健康） |
| `scripts/build-module.mjs <key>` | 微前端模块打包 |
| `scripts/deploy.sh <env> [component]` | 部署（SSH 到远程） |
| `scripts/rollback.sh <env> <tag>` | 回滚 |
| `scripts/seed-admin.mjs` | 重置 admin 密码 |
| `scripts/seed-dev-deployment.mjs` | 本地 e2e 种子（模块/版本/指针） |
