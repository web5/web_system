# Web System

全栈 Web 应用系统 - 包含管理后台、少儿教育门户、小程序和后端服务

## 项目结构

```
web_system/
├── apps/                    # 前端应用
│   ├── admin-web/          # 管理后台 (Vue3 + Ant Design Vue)
│   ├── portal/             # 少儿教育门户 (Vue3 + Ant Design Vue)
│   └── mini-app/           # 微信小程序
├── servers/                 # 后端服务
│   ├── gateway/            # API 网关 (NestJS)
│   ├── auth-service/       # 认证服务 (NestJS)
│   ├── user-service/       # 用户服务 (NestJS)
│   ├── ai-service/         # AI 服务 (NestJS)
│   ├── system-service/     # 系统管理 (NestJS)
│   └── upload-service/     # 文件上传 (NestJS)
├── packages/                # 共享包
│   ├── types/              # TypeScript 类型定义
│   └── shared/             # 公共工具 + API 超时等配置常量
├── docs/                    # 文档（含 Whistle 配置等）
└── scripts/                 # 运维脚本
```

## 技术栈

### 前端
- Vue 3 + TypeScript
- Ant Design Vue
- Vite
- Pinia (状态管理)
- Vue Router

### 后端
- NestJS
- TypeORM
- MySQL（本地）/ PostgreSQL（生产，见部署配置）

### 工具
- pnpm (包管理)
- Whistle (本地开发代理)

## 快速开始

> 换机器从零跑起，请先看 **[docs/development/local-dev-setup.md](./docs/development/local-dev-setup.md)** —— 覆盖无 brew/sudo 安装 MySQL+Redis、`.env` 配置、种子用户等完整步骤。下面仅列要点。

### 0. 本地基础设施（无 brew / 无 sudo，仅首次）

后端依赖 MySQL 与 Redis。若本机无 brew 或不想 `sudo`，用内置脚本把官方二进制装到 `~/local`：

```bash
# 启用 pnpm（若未启用）
corepack enable && corepack prepare pnpm@9.15.0 --activate

# 一键初始化并启动 MySQL(3306) + Redis(6379)，创建库 web_system
bash scripts/local-db.sh
```

> 有 brew 也可直接 `brew install mysql redis`，但脚本默认读 `~/local` 下的二进制。

### 1. 安装依赖

```bash
pnpm install
pnpm --filter @web-system/shared build
pnpm --filter @web-system/types build
```

### 2. 配置 Whistle 代理（推荐 · 统一域名开发）

没有 Whistle 时每个服务独立端口（5173/5174/3000/3001...），Cookie、OAuth 回调、跨域调试都很痛苦。Whistle 将所有服务映射到统一域名 `local.kedouai.com`。

#### 安装与启动

```bash
# 全局安装
npm i -g whistle

# 启动（默认代理端口 8899）
w2 start
```

#### 配置规则

打开 `http://127.0.0.1:8899` → **Rules** 页签，创建规则组 `kedouai-local`：

```
# ============================================================
# 科豆 AI · 本地开发 Whistle 规则
# 统一域名: local.kedouai.com
# ============================================================

# Admin 后台
local.kedouai.com/admin    127.0.0.1:5174

# API → Gateway
local.kedouai.com/api/     127.0.0.1:3000

# 上传文件
local.kedouai.com/uploads/ 127.0.0.1:3002

# 构建产物
local.kedouai.com/assets/  127.0.0.1:5173

# 文档 / Swagger
local.kedouai.com/docs/    127.0.0.1:3000
local.kedouai.com/swagger/ 127.0.0.1:3000

# Portal 兜底
local.kedouai.com          127.0.0.1:5173
```

#### 开启系统代理

macOS：**系统偏好设置 → 网络 → 高级 → 代理**，勾选 HTTP/HTTPS 代理，服务器 `127.0.0.1`，端口 `8899`。

或使用 Chrome 插件 [SwitchyOmega](https://chrome.google.com/webstore/detail/proxy-switchyomega/padekgcemlokbadohgkifijomclgjgif) 按需切换。

> 详细配置参考 [docs/development/whistle-local-dev.md](./docs/development/whistle-local-dev.md)

### 3. 启动服务

```bash
# 推荐：一键全栈启动（先启 DB → 后端 6 个 → 前端 3 个，nohup 后台运行）
bash scripts/start-local.sh

# 额外初始化种子用户 admin / test
bash scripts/start-local.sh --seed

# 仅启动已配置好的服务（不含 DB 初始化、不含 seed）
bash scripts/start-dev.sh
```

或按场景启动：

```bash
# 只启动前端（后端已运行）
bash scripts/start-frontend.sh

# 只启动后端
bash scripts/start-dev.sh    # 含前端，但后端已起来就跳过

# 改完代码后，快速编译 + 重启 gateway / ai-service
bash scripts/build-all.sh
bash scripts/restart-servers.sh
```

手动按需启动（调试用）：

```bash
# ===== 后端 =====
cd servers/gateway && pnpm dev &        # :3000
cd servers/auth-service && pnpm dev &   # :3001
cd servers/user-service && pnpm dev &   # :3002
cd servers/ai-service && pnpm start:dev & # :3003 （注意：脚本名是 start:dev，不是 dev）
cd servers/system-service && pnpm dev & # :3004
cd servers/todo-service && pnpm dev &   # :3005

# ===== 前端 =====
cd apps/portal && pnpm dev &    # :5173
cd apps/admin-web && pnpm dev & # :5174

# ===== 文档 =====
npx serve docs -p 4173 &        # :4173
```

### 4. 访问

Whistle 代理开启后，浏览器访问统一域名：

| 页面 | 地址 |
|------|------|
| Portal | http://local.kedouai.com |
| Admin | http://local.kedouai.com/admin |
| API | http://local.kedouai.com/api/xxx |
| Swagger | http://local.kedouai.com/docs |

> 💡 **不开启 Whistle 代理**时可直接访问各端口：Portal → localhost:5173，Admin → localhost:5174

### 5. 环境变量与初始账号

每个后端服务在 `servers/<service>/.env` 读取配置，**这些文件已被 `.gitignore` 忽略，不会入库**，需自行创建。需 DB 的服务（auth / user / ai / system / todo）至少包含：

```dotenv
DB_TYPE=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=            # 与 §0 设置的 MySQL 密码一致，无密码则留空
DB_DATABASE=web_system
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=<随机 48 字节 hex>
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
```

工程**不内置任何用户数据**，初始账号由 `servers/auth-service/scripts/seed.ts` 生成：

```bash
cd servers/auth-service
ADMIN_INIT_PASSWORD='你的管理员密码' TEST_INIT_PASSWORD='test123456' pnpm seed
```

| 用户名 | 角色 | 密码 |
|--------|------|------|
| `admin` | admin | 由 `ADMIN_INIT_PASSWORD` 指定（缺失则脚本报错退出） |
| `test`  | user  | 由 `TEST_INIT_PASSWORD` 指定（缺失则随机生成） |

> seed 脚本的 DB 密码只从 `.env` 注入，源码无硬编码。详细排错见 [docs/development/local-dev-setup.md](./docs/development/local-dev-setup.md)。

## 端口分配

| 应用/服务 | 端口 | 说明 |
|----------|------|------|
| portal | 5173 | 用户门户 |
| admin-web | 5174 | 管理后台 |
| docs | 4173 | 文档站点 |
| gateway | 3000 | API 网关 |
| auth-service | 3001 | 认证服务 |
| user-service | 3002 | 用户服务 + 文件上传 |
| ai-service | 3003 | AI 对话 + 图片生成 + 变变 |
| system-service | 3004 | 系统管理 |
| todo-service | 3005 | 待办 / 任务管理 |

## 共享配置

`@web-system/shared`（`packages/shared/src/api.ts`）集中管理前后端公用的超时配置，portal / admin-web / mini-app / gateway / ai-service 均引用同一份常量。新增或调整超时只需改这一个文件：

```
packages/shared/src/api.ts
├── API_TIMEOUT.DEFAULT / AI_TASK / AI_QUERY      ← 前端用
├── API_TIMEOUT.GATEWAY.{DEFAULT, AI_TASK, TTS}   ← Gateway proxy 用
└── API_TIMEOUT.UPSTREAM.{DEFAULT, CHAT, ...}     ← 后端调第三方用
```

## 功能模块

### 管理后台 (admin-web)
- 用户管理（列表、详情、增删改查）
- 工作台
- 系统设置

### 少儿教育门户 (portal)
- 首页（紫色渐变风格）
  - 导航栏
  - Hero 区域
  - 课程卡片展示
  - 特色功能
- 画笔页面（Canvas 画板）
  - 画笔/橡皮工具
  - 颜色选择
  - 画笔粗细调节
  - 撤销功能
  - 保存作品

### 小程序 (mini-app)
- 首页
- 画板功能

### 用户服务 (user-service)
- 用户 CRUD API
- 用户列表（分页）
- 用户详情
- 用户状态管理

## 部署

### Docker 部署
```bash
docker-compose up -d
```

### 服务器部署
目标服务器：106.52.176.246

## 域名配置

| 环境 | 域名 |
|------|------|
| 生产 | kedouai.com |
| 测试 | dev.kedouai.com |
| 本地开发 | local.kedouai.com (通过 Whistle 代理统一) |

## 开发规范

- 使用 TypeScript
- 遵循 ESLint 规则
- 提交前运行测试


## 常见问题

### Whistle 代理没生效

1. 确认 Whistle 在运行：`w2 status`
2. 确认系统代理已开启：系统偏好设置 → 网络 → 高级 → 代理
3. 确认 Vite 使用了 `host: true` 配置
4. **不要加 `/etc/hosts`** —— Chrome 默认绕过 127.x.x.x 代理，加了反而通不了

### 模块报错 "Expected JavaScript module but got text/html"

Whistle 规则中的 `excludeFilter` 误杀了模块请求。使用本文档推荐的新规则（不包含 excludeFilter）即可。

### 详细排查

参见 [docs/development/whistle-local-dev.md](./docs/development/whistle-local-dev.md) 第 10 节故障排查。

## License

MIT
