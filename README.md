# 科豆 AI（web_system）

全栈 monorepo —— 微前端基座 + 多个 NestJS 微服务 + 微信小程序 + 自研发布平台。
一个仓库装四类资产：**产品代码**（`apps/` `servers/` `packages/`）、**人读文档**（`docs/`）、**知识库**（`raw/` → `wiki/`）、**数字人体系**（`.codebuddy/`）。

> AI 常驻加载的项目总入口在 [.codebuddy/CODEBUDDY.md](./.codebuddy/CODEBUDDY.md)（工程文档一律从本 README 进）；
> **文档总索引**见 [docs/INDEX.md](./docs/INDEX.md)；本地开发指南见
> [docs/development/local-dev-guide.md](./docs/development/local-dev-guide.md)。
> ⚠️ `docs/development-guide.md` 是 2026-09 历史版（仅作链路考古，勿据此取值）。

### 资产构成与知识库边界（`raw/` + `wiki/`）

| 目录 | 内容 | 维护方式 |
|---|---|---|
| `raw/` | **外部**素材原文快照（文章 / 论文 / 推文 …） | AI 采集，**不可变** —— 只新增，不改写已落盘文件 |
| `wiki/` | 由 `raw/` 编译出的知识文章 + `index.md` 全局索引 + `log.md` 操作日志 | AI 维护，人读与提问 |
| `docs/` | **项目自产**文档（架构 / 开发 / UI / 产品 / 发布手册） | 人写，随代码演进 |

- **边界判据**（只此一条）：**外部输入的编译结论** → `wiki/`；**本项目自产的东西** → `docs/`。项目自产文档不进 `wiki/`，外部素材原文不进 `docs/`。
- 位置固定在**项目根**（`raw/` + `wiki/`）—— 数字人技能默认即此布局，故不改技能里的路径约定；两个目录**随仓库入库**，知识库才能跨会话累积。

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
│   └── kedou-ai-minigram/        # 微信小程序·科豆 AI（原生 + TS）
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
│   ├── mcp-core/             # MCP 核心
│   └── agent-message/        # AI 对话消息共享逻辑（blocks 解析/翻译/折叠）
├── docs/                     # 人读文档（架构/开发/UI/产品/发布手册）
│   └── architecture/system-overview.md   # ← 架构与部署总览（唯一入口）
├── specs/                    # 设计/变更规格（新机制先在此定稿；规范见 SDD-SOP，门禁 npm run check:specs）
├── scripts/                  # 构建/启动/验证/发布脚本
├── migrations/               # 数据库迁移 SQL
├── .codebuddy/               # 数字人体系（agent-kit / skills / rules）
├── ecosystem.apps.cjs        # pm2 清单 · 应用域（11 个业务服务）
├── ecosystem.console.cjs     # pm2 清单 · console 域（deploy-console，独立发布互不影响）
└── ecosystem.config.cjs      # pm2 全量入口（= 应用域 + console 域合并）
```

> **小程序命名约定**：一个微信小程序 = 一个 `apps/<小程序名>` 包（当前 `apps/kedou-ai-minigram` = 科豆 AI 小程序；2026-09 由 `apps/mini-contract`（合同翻译官）更名而来，不再沿用早先的 `mini-<业务>` 前缀）。新增小程序时同步三处：① `rush.json` 登记 package；② `scripts/modules.json` 注册发布模块（`key` 与目录同名、`type=frontend`、`publicPath` 唯一）；③ 模块 key 由 `modules.json` 种子进发布平台 DB，如需改 key 走 `migrations/` 迁移（参考 `0006_rename_mini_contract_to_kedou_ai_minigram.sql`）。

---

## 3 技术栈

| 层 | 技术 | 要点 |
|---|---|---|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Ant Design Vue 4.x | 微前端化：shell 基座 + `shell-loader` 动态加载模块 |
| 后端 | NestJS 10 + TypeORM | MySQL（本地）/ PostgreSQL（生产），全部 TS strict |
| 小程序 | 微信原生 + TS | `apps/kedou-ai-minigram`（科豆 AI） |
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

> ⚠️ 上表是**本机**示例。`DB_DATABASE` 三环境不同（dev `web_system_deploy`、prod 云库 `web_system`），
> 照抄到服务器会连错库；见 §5 与 [docs/协作指令速查.md](./docs/协作指令速查.md) §4。

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
| auth-service | 6101（**仅本机**） / 6001（dev·prod） | web-auth | 认证。本机 6001 被其他项目占用故用 6101，dev/prod 用 6001 |

> ⚠️ 完整的**三环境端口矩阵**见 [`docs/architecture/system-overview.md`](./docs/architecture/system-overview.md) §3。
> 注意本机用 `ecosystem.config.cjs`、发布目录用 `ecosystem.config.js`，两者 pm2 名与 auth 端口口径不同（已知技术债）。
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

> 端口在域清单中写死 `env.PORT`，避免 `pm2 restart` 沿袭旧 PORT 造成端口漂移；console 与应用拆成两个 pm2 域（`ecosystem.console.cjs` / `ecosystem.apps.cjs`），发布互不影响。

---

## 6 架构要点

```
前端 apps/（shell 基座 + portal/admin 模块 + kedou-ai-minigram 小程序 + deploy-console SPA）
        │  shell-loader + window.__SHARED__ 共享依赖，按 __MODULES_MANIFEST__ 加载版本
Gateway（6000）→ /api/* 反代各微服务；兼微前端基座 + 版本分发/灰度
后端 servers/（12 个 NestJS 微服务，每服务独立库）
基础设施：MySQL（web_system + web_system_deploy）、Redis、Nginx、pm2
```

- **每服务独立数据库**；所有 API 走 gateway，前端不直连后端
- **微前端**：shell 提供共享依赖防重复打包；CSS 用 `:where([data-module])` 前缀隔离；产物版本化存 `static/modules/<key>/<version>/`
- **灰度**：gateway `deploy_canary_rules`（header / percent / user-list 三种匹配）
- **静态资源**：`/api/uploads/*`（用户上传 + AI 生成图统一落盘）、`/static/cdn/pub/**`（系统素材 / 默认头像 / logo / 二维码，源 `assets/shared-public/`），均由 gateway 直出

详细说明：[docs/architecture/技术架构.md](./docs/architecture/技术架构.md)、
[docs/architecture/micro-frontend-technical-design.md](./docs/architecture/micro-frontend-technical-design.md)

---

## 7 发布与部署

> 核心认知：服务统一从**发布目录 `~/web_system_release`** 运行（pm2 `web-*`，dotenv 按 cwd 加载发布目录 `.env`）。
> **发布 = 工作区 commit & push → 发布目录 git 拉取 → 构建部署**，不是基于当前工作区。
> 手册：[docs/development/local-release-runbook.md](./docs/development/local-release-runbook.md)
>
> **小程序不走这条链路**（无 pm2、无发布目录）：出预览码 / 上传体验版见
> [docs/miniprogram/release-runbook.md](./docs/miniprogram/release-runbook.md)。

### 7.1 发布通道（统一 MCP，A / B 只是调用方式）

> 🔴 **Agent 发布唯一入口 = `web-system-deploy` skill**（真源 `~/skills/web-system-deploy/SKILL.md`）。
> 凡「让新代码在 dev / prod 生效」，**先读本 skill**，与措辞无关（「按建议继续」「上线 R1/A6」也算）。
> 🔴 **统一通道 = deploy-console MCP 流水线：后端 10 服务与前端 `admin`/`portal` 都支持**（2026-11-04 用户拍板订正）。
> A / B 是**调用方式**，不是模块二分：后端推荐 A（封装 prod 闸门），前端常用 B；**两端都能走两种**。
>
> | 方式 | 适用 | 入口 |
> |---|---|---|
> | **A · `publish.sh`（封装式）** | 后端 10 服务（user/ai/gateway/auth/content-hub/mcp-gateway/system/upload/ai-agent/todo）；前端同样可走 B | `bash ~/skills/web-system-deploy/scripts/publish.sh dev\|prod\|plan\|rollback\|status <svc>` → SSH dev 机 → `/console/api/mcp/*` + `X-Mcp-Key`，封装 prod 闸门绑定 |
> | **B · MCP tools/call（直调式）** | 前端 `admin` / `portal`；后端同样可调工具面（prod 闸门需另绑） | mcp-gateway `/mcp/deploy` tools/call（`release_plan` → `publish_pipeline` → `approve` → `verify_release`，**必传 versionTag**） |
> | `shell` / `mini-contract` | 手动，暂不支持流水线 | — |
> | **`deploy-console` 自身** | 🔴 **永远手动**（流水线 `enabled=0`，自部署会杀掉执行者） | `scripts/release-deploy-console.sh` |
> | `finnews` | 已删除，无恢复路径 | — |
>
> ❌ 别把 A / B 写成「后端只能 `publish.sh`、前端只能 tools/call」的模块二分。
> 🔴 **禁止自签 JWT 打 `POST /api/pipelines`** —— 那是控制台 UI 通道，能提交但 agent 无 `deploy:pipeline:approve` → 403 卡 `awaiting-approval`（2026-11-04 实测）。
> 🔴 `status=succeeded` ≠ 生效，唯一判据 = `verify_release` 的 `verdict`（`verified` 才算完）。
> 判不准模块类型 → `list_modules` 查，**不要猜**。

下表是**平台侧通道语义**（供理解链路），不是 agent 调用入口；小程序与本地调试不走该链路。

| 发布对象 | 通道 | 说明 |
|---|---|---|
| 后端服务 | 发布流水线 · 模式 A | 由 `publish.sh` 经 MCP 端点发起；动作链 `sync → restart → verify` |
| `admin` / `portal` | MCP 工具面 · 模式 B | 流水线只投递版本目录，须再调生效接口并传完整 `versionTag` |
| deploy-console 自身（6200） | **传统发布 · 手动** | `~/skills/web-system-deploy/scripts/release-deploy-console.sh`；⚠️ 勿走流水线 |
| 微信小程序（kedou-ai-minigram） | **CI 出码** | 固定出口 IP 的执行机上跑 `scripts/preview.js`（预览码）/ `scripts/upload.js`（体验版）；完整前置与排错见 [docs/miniprogram/release-runbook.md](./docs/miniprogram/release-runbook.md) |

> ⚠️ **§7.2 四步铁律仅用于本地调试**：它是手工更新本地微前端产物的旧做法，**不是线上发布入口**；线上生效一律走上面的 skill 路由。

### 7.2 微前端模块更新四步铁律

改完 admin/portal 源码**必须**执行，否则浏览器仍加载旧产物：

```bash
cd apps/admin                       # portal 同理
V=$(git -C ../.. rev-parse --short HEAD)
P=default                           # 产品线段（= 发布模板 key），RELEASE_TAG 与部署路径必须一致
RELEASE_TAG=$P/$V MF_FORMAT=system npx vite build --mode mf
mkdir -p ../gateway/public/static/modules/admin/$P/$V && cp -r dist/* ../gateway/public/static/modules/admin/$P/$V/
# ⚠️ 版本表在 web_system_deploy.deploy_deployments（不是 web_system 库！）
# UPDATE web_system_deploy.deploy_deployments SET current_version='$P/$V', status='deployed', deployed_at=NOW()
#   WHERE env_id='dev' AND module_key='admin';
sleep 12                            # gateway 有 TTL 10s 版本缓存；仍旧则 pm2 restart web-gateway
curl -s localhost:6000/__manifest__ # 确认 admin version=$P/$V
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

> 完整版：`.codebuddy/rules/coding-best-practices.md`

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

## 9 文档地图（**唯一分入口 = `docs/INDEX.md`**）

> **先查 [`docs/INDEX.md`](./docs/INDEX.md) 再检索**，别全仓 grep —— 它是唯一的「按问句 → 真源」路由表，本层不复制。
> **开发维护知识库全貌 / AI 防跑偏总图** → [`docs/知识库拓扑.md`](./docs/知识库拓扑.md)（图片版 `docs/architecture/知识库拓扑.svg`，由 `scripts/gen-kb-topology.mjs` 生成，禁手改）。
> 工程事实（§4.5 env / §5 端口 / §7.1 发布通道）只在本文件，且只此一份；活跃文档数等统计口径见 `docs/INDEX.md` 顶部。

**目录边界（防检索到旧事实）**：`docs/plans/`、`docs/reviews/`、`docs/development/*review*`、
`specs/*/tasks.md`、`.workbuddy/memory/2026-*.md` 都是**历史快照**。
🔴 其中 **80 份史料正文已于 2026-11-04 物理移入 `archive/` 存档目录**，原位置指针桩同日由用户拍板删除（活跃区零副本；48 处历史链接失效清单见治理目录 `史料桩删除后断链清单.txt`）；
**全仓事实检索一律排除 `archive/`**（`grep -R --exclude-dir=archive`）。
🔴 **本文档地图不给存档文件建索引**：史料不承载当前事实，无路径、无链接；
问「当时为什么这么定」属考古，只有人显式指定路径时才追溯，AI 不得据此判断线上现状。
当前事实只认 `README.md` / `docs/INDEX.md` / `docs/architecture/system-overview.md` / 对应 skill。
`DEPLOYMENT.md` 已于 2026-11-04 **删除**（旧正文只在 git `84667dee`）；活跃区不得再建链接或「参考 / 详见」推荐语。

---

## 10 常见问题

**Whistle 代理没生效**：确认 `w2 status` 在运行 → 系统代理指向 `127.0.0.1:8899` → Vite 开了 `host: true` → **不要加 `/etc/hosts`**（Chrome 默认绕过 127.x.x.x 代理，加了反而通不了）。

**改了 admin/portal 源码但页面没变**：走了浏览器旧产物，执行 §7.2 四步铁律。

**`curl 6200` 返回旧行为**：6200 端口被旧孤儿进程占用。用 `lsof -ti tcp:6200` 找到并 `kill -9`，再 `pm2 restart web-deploy-console`，确认占用 pid == pm2 当前 pid。

**build 报 `TS2688`**：`pnpm install` 中断残留 `*_tmp_*` 目录，`mv` 到 /tmp 清理后重装。

---

## License

MIT
