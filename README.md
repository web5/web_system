# 科豆 AI（web_system）

全栈 monorepo —— 微前端基座 + 多个 NestJS 微服务 + 微信小程序 + 自研发布平台。
一个仓库装三类资产：**产品代码**（`apps/` `servers/` `packages/`）、**人读文档**（`docs/`）、**数字人体系**（`.codebuddy/`）。

> AI 常驻加载的项目总入口在 [.codebuddy/CODEBUDDY.md](./.codebuddy/CODEBUDDY.md)；
> 完整开发指南见 [docs/development-guide.md](./docs/development-guide.md)。

---

## 1 产品矩阵

| 产品 | 定位 | 前端路由 |
|---|---|---|
| 变变 | AI 拼贴变身 3D 角色 | `/create → /transform → /result` |
| 画板 | 自由绘画 + AI 文生图 | `/draw` |
| AI 学习助手 | 少儿 AI 对话 | `/chat` |
| Admin 后台 | 运营/系统管理 | `/admin/` |
| 发布控制台 | 流水线、环境、监控 | `/console/` |

---

## 2 项目结构

```
web_system/
├── apps/                     # 前端应用
│   ├── shell/                # 微前端基座（提供 window.__SHARED__ + 版本 manifest）
│   ├── portal/               # 用户门户（微前端模块）
│   ├── admin/                # 管理后台（微前端模块，路由 base = /admin/）
│   ├── deploy-console/       # 运维控制台前端（独立 SPA，由 6200 后端 serve）
│   └── mini-app/             # 微信小程序（原生 + TS）
├── servers/                  # 后端微服务（NestJS + TypeORM，每服务独立库）
│   ├── gateway/              # API 反代 + 微前端基座 + 版本分发/灰度
│   ├── auth-service/         # 认证（登录/JWT/微信）
│   ├── user-service/         # 用户
│   ├── ai-service/           # AI（对话/生图/TTS/变变）
│   ├── ai-agent/             # AI Agent 运行时引擎
│   ├── system-service/       # 系统配置/素材
│   ├── todo-service/         # 待办
│   ├── mcp-gateway/          # MCP 网关
│   ├── content-hub/          # 内容中枢（财经/AI 资讯）
│   ├── upload-service/       # 上传
│   ├── knowledge-service/    # 知识库 / RAG
│   └── deploy-console/       # 发布平台后端
├── packages/                 # 共享包
│   ├── shared/               # 跨端配置唯一收口（API_TIMEOUT、命名策略、实体基类）
│   ├── types/                # 权限等 TS 类型
│   ├── ui/                   # 共享 UI + 设计 token
│   ├── shell-loader/         # 自研微前端加载器
│   ├── agent-core/           # @kedouai/agent-core（ReAct 引擎/注册表/记忆压缩）
│   ├── kedou-agent/          # Agent CLI
│   └── mcp-core/             # MCP 核心
├── docs/                     # 人读文档（架构/开发/UI/产品/发布手册）
├── scripts/                  # 构建/启动/验证/发布脚本
├── migrations/               # 数据库迁移 SQL
├── .codebuddy/               # 数字人体系（agent-kit / skills / rules）
└── ecosystem.config.cjs      # pm2 进程清单（web-*）
```

---

## 3 技术栈

| 层 | 技术 | 要点 |
|---|---|---|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Ant Design Vue 4.x | 微前端化：shell 基座 + `shell-loader` 动态加载模块 |
| 后端 | NestJS 10 + TypeORM | MySQL（本地）/ PostgreSQL（生产），全部 TS strict |
| 小程序 | 微信原生 + TS | `apps/mini-app` |
| 共享 | pnpm workspace | 跨端配置统一收口 `@web-system/shared` |
| 部署 | pm2 + Docker Compose + Nginx + 自研发布平台 | 见 §6 |

---

## 4 快速开始

> 换机器从零跑起先看 **[docs/development/local-dev-setup.md](./docs/development/local-dev-setup.md)**（含无 brew/sudo 安装 MySQL+Redis、`.env` 配置、种子用户）。

### 4.1 安装依赖

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate   # 启用 pnpm
pnpm install
pnpm --filter @web-system/shared build
pnpm --filter @web-system/types build
```

### 4.2 本地基础设施（首次）

```bash
bash scripts/local-db.sh     # 拉起 MySQL(3306) + Redis(6379)，建库 web_system
```

> 有 brew 也可 `brew install mysql redis`，但脚本默认读 `~/local` 下的官方二进制。

### 4.3 启动

```bash
bash scripts/local-up.sh            # 构建共享包 + 全部后端 → pm2 启动 → 健康检查
bash scripts/local-up.sh --no-build # 跳过构建仅重启（改 .env 后最快）
bash scripts/local-up.sh --seed     # 额外重置 admin 密码为 admin123
bash scripts/start-frontend.sh      # 前端：portal(5173) + admin(5174) + docs(4173)
```

单模块 standalone（排查样式/页面，不加载基座）：

```bash
cd apps/admin  && npx vite --port 5175   # http://127.0.0.1:5175/admin/
cd apps/portal && npx vite --port 5173   # http://127.0.0.1:5173/portal/
```

> ⚠️ admin 路由 base 是 `/admin/`，portal 是 `/portal/`，URL 必须带前缀，否则 404。

### 4.4 验证

```bash
bash scripts/dev-verify.sh                  # 全量：DB + 单测 + 集成 + 健康
bash scripts/dev-verify.sh --unit/--integ/--health
node scripts/_test-p0.mjs                   # 发布系统集成测试（真实 DB）
```

### 4.5 环境变量

每个后端服务读 `servers/<service>/.env`（已被 `.gitignore` 忽略，需自行创建）。需 DB 的服务至少包含：

```dotenv
DB_TYPE=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=
DB_DATABASE=web_system
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=<随机 48 字节 hex>
CORS_ORIGINS=http://localhost:5173,http://localhost:5174
```

初始账号不内置，由 seed 生成：

```bash
cd servers/auth-service
ADMIN_INIT_PASSWORD='你的管理员密码' TEST_INIT_PASSWORD='test123456' pnpm seed
```

| 用户名 | 角色 | 密码 |
|---|---|---|
| `admin` | admin | `ADMIN_INIT_PASSWORD`（缺失则脚本报错退出） |
| `test` | user | `TEST_INIT_PASSWORD`（缺失则随机生成） |

---

## 5 端口分配

| 服务 / 应用 | 端口 | pm2 进程 | 说明 |
|---|---|---|---|
| gateway | 6000 | web-gateway | API 反代 + 微前端基座 + 版本分发/灰度 |
| auth-service | 6101 | web-auth | 认证（6001 被本机其他项目占用，故用 6101） |
| user-service | 6002 | web-user | 用户 |
| ai-service | 6003 | web-ai | AI 对话/生图 |
| system-service | 6004 | web-system | 系统配置 |
| todo-service | 6005 | web-todo | 待办 |
| mcp-gateway | 6006 | web-mcp-gateway | MCP 网关 |
| content-hub | 6007 | web-content-hub | 内容中枢 |
| upload-service | 6008 | web-upload | 上传 |
| ai-agent | 6010 | web-ai-agent | Agent 运行时 |
| knowledge-service | 6011 | — | 知识库 / RAG |
| deploy-console | 6200 | web-deploy-console | 发布控制台（`/console/`） |
| portal（dev） | 5173 | — | Vite dev |
| admin（dev） | 5174 | — | Vite dev |
| docs | 4173 | — | 静态文档站 |

> 端口在 `ecosystem.config.cjs` 中写死 `env.PORT`，避免 `pm2 restart` 沿袭旧 PORT 造成端口漂移。

---

## 6 架构要点

```
前端 apps/（shell 基座 + portal/admin 模块 + mini-app + deploy-console SPA）
        │  shell-loader + window.__SHARED__ 共享依赖，按 __MODULES_MANIFEST__ 加载版本
Gateway（6000）→ /api/* 反代各微服务；兼微前端基座 + 版本分发/灰度
后端 servers/（12 个 NestJS 微服务，每服务独立库）
基础设施：MySQL（web_system + web_system_deploy）、Redis、Nginx、pm2
```

- **每服务独立数据库**；所有 API 走 gateway，前端不直连后端
- **微前端**：shell 提供共享依赖防重复打包；CSS 用 `:where([data-module])` 前缀隔离；产物版本化存 `static/modules/<key>/<version>/`
- **灰度**：gateway `deploy_canary_rules`（header / percent / user-list 三种匹配）
- **静态资源**：`/api/uploads/*`（用户上传 + AI 生成图统一落盘）、`/materials/svg/*`（系统素材），均由 gateway 直出

详细说明：[docs/architecture/技术架构.md](./docs/architecture/技术架构.md)、
[docs/architecture/micro-frontend-technical-design.md](./docs/architecture/micro-frontend-technical-design.md)

---

## 7 发布与部署

> 核心认知：服务统一从**发布目录 `~/web_system_release`** 运行（pm2 `web-*`，dotenv 按 cwd 加载发布目录 `.env`）。
> **发布 = 工作区 commit & push → 发布目录 git 拉取 → 构建部署**，不是基于当前工作区。
> 手册：[docs/development/local-release-runbook.md](./docs/development/local-release-runbook.md)

### 7.1 三条发布通道（别混用）

| 发布对象 | 通道 | 操作 |
|---|---|---|
| 后端服务 + admin/portal 前端 | **发布流水线** | `POST /api/pipelines`（deploy-console 6200，env=local，branch=feature/xxx）→ 轮询至 succeeded |
| deploy-console 自身（6200） | **传统发布** | 仓库根 `./scripts/publish-deploy-console.sh`（⚠️ 勿走流水线，会自杀式重启执行者） |
| admin/portal 前端微前端模块 | 四步铁律 | 见下 |

### 7.2 微前端模块更新四步铁律

改完 admin/portal 源码**必须**执行，否则浏览器仍加载旧产物：

```bash
cd apps/admin                       # portal 同理
V=$(git -C ../.. rev-parse --short HEAD)
RELEASE_TAG=$V MF_FORMAT=system npx vite build --mode mf
mkdir -p ../gateway/public/static/modules/admin/$V && cp -r dist/* ../gateway/public/static/modules/admin/$V/
# ⚠️ 版本表在 web_system_deploy.deploy_deployments（不是 web_system 库！）
# UPDATE web_system_deploy.deploy_deployments SET current_version='$V', status='deployed', deployed_at=NOW()
#   WHERE env_id='dev' AND module_key='admin';
sleep 12                            # gateway 有 TTL 10s 版本缓存；仍旧则 pm2 restart web-gateway
curl -s localhost:6000/__manifest__ # 确认 admin version=$V
```

两个最容易踩的坑：① 版本表在 **web_system_deploy** 库；② gateway 有 **TTL 10s 缓存**。

### 7.3 域名

| 环境 | 域名 |
|---|---|
| 生产 | kedouai.com |
| 测试 | dev.kedouai.com |
| 本地 | local.kedouai.com（nginx 集成：`sudo ~/local/nginx/sbin/nginx`，配 `local.nginx.conf`） |

---

## 8 开发规范（工程铁律）

> 完整版：`.codebuddy/references/coding-best-practices.md`

1. **同类修改必须扫全量**：改横切关注点前先 grep 所有服务（`enableCors` / `useGlobalFilters` / `console.`）。
2. **跨端配置禁止拷贝**：统一收口 `packages/shared/src/` → `index.ts` re-export → 删各端本地拷贝。
3. **请求超时分三层**：前端 axios / gateway proxy / 后端 http client，真实超时取**最短层**；AI 类接口必须用 `API_TIMEOUT.AI_TASK`（90s）。
4. **新增魔法数字先全局搜索**，复用已有常量。
5. **收口后清理冗余文件**，确认无旧 import 残留。
6. **后端加 shared 依赖**：`package.json` 加 `file:../../packages/shared`，**勿在 tsconfig 加 paths**（会让 nest build 把源码编进 dist）。
7. TS 严格 `strict: true`，禁用 `any`；图标禁 emoji，统一 SVG。

### 共享超时配置

```
packages/shared/src/api.ts
├── API_TIMEOUT.DEFAULT / AI_TASK / AI_QUERY      ← 前端
├── API_TIMEOUT.GATEWAY.{DEFAULT, AI_TASK, TTS}   ← Gateway proxy
└── API_TIMEOUT.UPSTREAM.{DEFAULT, CHAT, ...}     ← 后端调第三方
```

---

## 9 文档地图

| 主题 | 入口 |
|---|---|
| 开发总指南 | [docs/development-guide.md](./docs/development-guide.md) |
| 新机器从零启动 | [docs/development/local-dev-setup.md](./docs/development/local-dev-setup.md) |
| admin 微前端开发 | [docs/development/admin-dev.md](./docs/development/admin-dev.md) |
| 本地发布运维 | [docs/development/local-release-runbook.md](./docs/development/local-release-runbook.md) |
| 发布流水线设计 | [docs/development/deploy-pipeline-dev.md](./docs/development/deploy-pipeline-dev.md) |
| Agent 能力体验手册 | [docs/development/agent-capability-playbook.md](./docs/development/agent-capability-playbook.md) |
| Whistle 本地代理 | [docs/development/whistle-local-dev.md](./docs/development/whistle-local-dev.md) |
| CI 门禁与红绿线 | [docs/development/ai-native-sdlc-ci-deployment.md](./docs/development/ai-native-sdlc-ci-deployment.md) |

---

## 10 常见问题

**Whistle 代理没生效**：确认 `w2 status` 在运行 → 系统代理指向 `127.0.0.1:8899` → Vite 开了 `host: true` → **不要加 `/etc/hosts`**（Chrome 默认绕过 127.x.x.x 代理，加了反而通不了）。

**改了 admin/portal 源码但页面没变**：走了浏览器旧产物，执行 §7.2 四步铁律。

**`curl 6200` 返回旧行为**：6200 端口被旧孤儿进程占用。用 `lsof -ti tcp:6200` 找到并 `kill -9`，再 `pm2 restart web-deploy-console`，确认占用 pid == pm2 当前 pid。

**build 报 `TS2688`**：`pnpm install` 中断残留 `*_tmp_*` 目录，`mv` 到 /tmp 清理后重装。

---

## License

MIT
