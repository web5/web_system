# 本地开发总指南（Local Dev Guide）

> **本文是本地开发的「总入口 / 索引」**：把「各服务怎么本地跑」与「通用基础能力的本地支持情况」收在一张表里，
> 细节仍指向各专题文档，不复制它们的正文。
> 适用：macOS 本机（`local.kedouai.com` + 发布目录 `~/web_system_release`）
> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on（应用侧可改，约定见 `.codebuddy/references/doc-conventions.md`）

## 0 先读这一段（事实源与优先级）

本地开发的**事实源在代码层**，文档只是索引。冲突时按下述顺序取信：

| 优先级 | 事实源 | 管什么 |
|---|---|---|
| 1 | `ecosystem.config.cjs`（仓库根） | **端口与 pm2 进程名**（唯一权威，端口写死在 `env.PORT` 防漂移） |
| 2 | 各 `servers/<svc>/.env` | 该服务的真实配置（`.env` 不入库，`.env.example` 是模板） |
| 3 | `servers/gateway/src/proxy/proxy.controller.ts` | `/api/*` 前缀 → 目标服务的映射 |
| 4 | `scripts/modules.json` | 发布流水线可发布的模块清单（未登记 = 流水线管不到） |
| 5 | 专题文档 | 流程、踩坑、验收步骤 |

⚠️ 端口一律以本文 §2 为准：`local-dev-setup.md`、`whistle-local-dev.md` 里的端口与目录名不要直接照抄。

### 0.1 AI / Agent 阅读顺序（省 token 版）

1. **先读本文**（1 屏拿到：端口、依赖、探活、基础能力、脚本、文档地图）。
2. 再按任务跳转专题文档，不要全量读 `docs/`：
   - 起不来 / 换机器 → `from-zero-init-data.md`、`local-dev-setup.md`（只看基础设施部分）
   - 改前端 / 微前端不生效 → `admin-dev.md` §一·C（四步铁律）
   - 发布 / 流水线 / 踩坑 → `local-release-runbook.md`、`deploy-pipeline-dev.md`
   - Agent 能力 → `agent-capability-playbook.md`
3. **要"现在到底跑成什么样"**：跑 `bash scripts/health-check.sh local`（12 服务端口 + gateway 接口 + MCP + AI 链路，20 秒出结果），
   比读文档可靠；`curl -s http://127.0.0.1:6000/__manifest__` 看微前端实际加载版本。

---

## 1 本地访问入口（一张表）

前置：`/etc/hosts` 需有 `127.0.0.1 local.kedouai.com`；本地 nginx 由 `local.nginx.conf` 生成（模板占位符 `{{NGINX_HOME}}` / `{{WORKSPACE_DIR}}` / `{{RELEASE_DIR}}` 需替换）。

```bash
sudo $HOME/local/nginx/sbin/nginx            # 启动（80/443 需 root）
$HOME/local/nginx/sbin/nginx -t              # 改配置前校验
sudo $HOME/local/nginx/sbin/nginx -s reload  # 重载
```

| 入口 | 地址 | 去向 |
|---|---|---|
| 管理后台 | `https://local.kedouai.com/admin/` | gateway 6000（SPA 回退 → shell 基座） |
| 门户 | `https://local.kedouai.com/portal/` | gateway 6000 |
| 发布控制台 | `https://local.kedouai.com/console/` | deploy-console 6200（strip `/console` 前缀） |
| API | `https://local.kedouai.com/api/*` | gateway 6000 |
| **健康检查** | `https://local.kedouai.com/api/health` | gateway 6000（`@Public()` 免鉴权） |
| MCP | `https://local.kedouai.com/mcp` | mcp-gateway 6006（不经过 gateway） |
| 微前端 manifest | `https://local.kedouai.com/__manifest__` | gateway 6000 |
| 微前端产物 | `https://local.kedouai.com/static/modules/<module>/<version>/index.js` | nginx alias 直出（发布目录） |
| 网关文档 | `http://127.0.0.1:6000/docs`、聚合页 `:6000/swagger` | gateway |

备用/调试端口：`8080`（301→8443）、`8443`（HTTPS 反代 6000）、`8081`（portal 静态）、`8082`（admin 静态 + mcp-admin）。

> **证书**：HTTPS 走自签 `dev.kedouai.com.crt`。未信任会 `ERR_CERT_AUTHORITY_INVALID` → shell 资源加载失败 → 白屏。
> 一次性信任：`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $HOME/local/nginx/conf/ssl/dev.kedouai.com.crt`

---

## 2 服务清单（本地开发 + 调试视角）

端口/pm2 名以 `ecosystem.config.cjs` 为准。

| 服务 | 端口 | pm2 名 | 启动脚本 | 外部依赖 | Swagger | 探活 |
|---|---|---|---|---|---|---|
| gateway | **6000** | `web-gateway` | `dev`/`start`/`build` | MySQL（主库 + `web_system_deploy` 只读）、`JWT_SECRET` | `/docs`、`/swagger` | ✅ `/health`、`/api/health`（免鉴权） |
| auth-service | **6101**（非 6001） | `web-auth` | `dev`/`start`/`seed` | MySQL + **Redis** + 微信/公众号凭据 | `/docs` | ❌ 端口探活 |
| user-service | **6002** | `web-user` | `dev` | MySQL + SMTP | `/docs` | ❌ |
| ai-service | **6003** | `web-ai` | `start:dev`（无 `dev`） | MySQL + Redis + LLM Key + 腾讯云 Secret（TTS/OCR）+ 图片生成 Key | `/api-docs` | ❌ |
| system-service | **6004** | `web-system` | `dev`/`start` | MySQL（+可选只读账号） | `/docs` | ❌ |
| todo-service | **6005** | `web-todo` | `dev`/`start` | MySQL + Redis | `/docs` | ❌ |
| mcp-gateway | **6006** | `web-mcp-gateway` | `dev` | MySQL + LLM Key + SMTP + 服务间 Bearer | 无 | ❌（用 `/mcp` initialize 或 `test/e2e-keys.sh`） |
| content-hub | **6007** | `web-content-hub` | `dev` | MySQL + LLM Key | 无 | ❌ |
| upload-service | **6008** | `web-upload` | `dev` | MySQL（缺 `JWT_SECRET` 启动即 exit 1） | `/docs` | ❌ |
| ai-agent | **6010** | `web-ai-agent` | `start:dev`（无 `dev`） | MySQL + TokenHub Key + mcp-gateway/ai-service；**需先 `pnpm --filter @kedouai/agent-core build`** | `/api-docs` | ❌ |
| knowledge-service | **6011** | `web-knowledge` | `dev` | **独立库 `web_system_knowledge`** + TokenHub embedding Key | `/api-docs` | ❌ |
| deploy-console | **6200** | `web-deploy-console` | `start:dev`（无 `dev`） | MySQL(`web_system_deploy`) + SSH 私钥 + node 路径 | `/api/docs`（非 prod） | `/api/monitor/health`（需 JWT）、`/api/monitor/local/health` |

> ⚠️ **端口三轨（别混）**：上表是**本机**端口。dev 的 auth=6001（本机 6001 被其它项目占用才改 6101），
> **prod 走 3000 系列**（gateway 3000 / auth 3001 …）。三环境完整矩阵与「服务指向」语义见
> `local-release-runbook.md` §1.1；权威源：本机 `ecosystem.config.cjs`、服务器 `ecosystem.config.js`。

### 2.1 `/api/*` → 服务映射（gateway 侧）

| 前缀 | 目标 |
|---|---|
| `/api/auth*` | auth-service |
| `/api/users`、`/api/keys`、`/api/admin/permissions`、`/api/admin/roles`、`/api/permissions/my` | user-service |
| `/api/ai*`（含 `chat/stream`、`tts/speak` SSE）、`/api/admin/skills`、`/api/agent-runs`、`/api/agent-defs`、`/api/bianbian` | ai-service |
| `/api/ai-agent*`（含 `agent/run`、`agent/admin-run` SSE） | ai-agent |
| `/api/admin/*`（兜底）、`/api/dict/*` | system-service |
| `/api/todos*` | todo-service |
| `/api/mcp/*` → rewrite 成 `/api/*` | mcp-gateway |
| `/api/content-hub/*`（Bearer `CONTENT_HUB_SERVICE_KEY`，兼容旧名 `FINNEWS_SERVICE_KEY`） | content-hub（财经资讯 + 内容管道） |
| `/api/knowledge/*` | knowledge-service |
| `/api/uploads/bianbian/*` → ai-service；`/api/uploads/*` → **user-service** | ⚠️ 见 §6 已知问题 |
| `/api/*` 兜底 | DB 动态路由（`deploy_service_routes`），未命中 → 404 `Unknown API route` |

> `/mcp`、`/console/` **不经 gateway**，由 nginx 直连 6006 / 6200。

### 2.2 单测与脚本现状

| 服务 | spec 数 | 备注 |
|---|---|---|
| deploy-console | 43 | `jest.config.js` |
| ai-agent | 5 + 1 e2e | `pnpm test:e2e` |
| auth-service / system-service | 3 / 3 | auth 有 `scripts/seed.ts` |
| gateway | 2 | 动态路由 + static |
| user / todo / ai / mcp-gateway / content-hub / upload / knowledge | 0 | 靠集成脚本验证 |

---

## 3 通用 & 基础能力：本地支持情况

| 能力 | 本地支持 | 怎么用 / 证据 |
|---|---|---|
| **JWT 鉴权** | ✅ 完全本地 | auth-service 签发（access `7d` + refresh `30d`）；`JWT_SECRET` 为空或 `change_me_in_dev` → `process.exit(1)`（`auth-service/src/app.module.ts:108-117`、`upload-service/src/main.ts:59-64`） |
| **种子用户** | ✅ 三入口，默认 `admin` / `admin123` | ① `servers/auth-service` → `pnpm seed`（`ADMIN_INIT_PASSWORD`）② `node scripts/seed-admin.mjs`（upsert）③ `bash scripts/local-up.sh --seed`；统一入口 `scripts/seed.sh dev admin` |
| **自动 seed（服务启动即写）** | ✅ 无需人工 | user-service 权限/角色、system-service 字典、ai-service `agent_definitions`（5 个代码兜底）、mcp-gateway `mcp_modules`/`mcp_tools`（6 模块）、deploy-console 环境/模块/模板/阶段脚本 |
| **数据库** | ✅ 本地 MySQL | 库：`web_system`（主）、`web_system_deploy`（发布平台）、`web_system_knowledge`（RAG）、`ai_agent` |
| **迁移** | ✅ 双轨 | 开发态靠 TypeORM `synchronize`（`NODE_ENV !== 'production'` 为真；gateway 的 deploy 连接恒 false、deploy-console 恒 true）；正式迁移走 `bash scripts/apply-migrations.sh local`（幂等，记录落 `schema_migrations`，支持 `DRY_RUN=1`） |
| **日志** | ⚠️ 本地走 pm2 默认路径 | 本地 `ecosystem.config.cjs` **未配 `out_file/error_file`** → `~/.pm2/logs/<name>-*.log`；查看 `pm2 logs <name> --lines 200`。生产 `ecosystem.config.js` 才写 `logs/<svc>-{out,error,combined}.log` |
| **上传 / 静态资源** | ✅ | 落盘**统一根** `<storage.upload_dir>/<category>/`（默认 `~/web_system/uploads`；分类 avatars/drawing/bianbian/general，按需建子目录）。根目录在 upload-service **启动时**解析：system-service 配置 → `STORAGE_UPLOAD_DIR` → 默认；不可写则**拒绝启动**（不静默回落 cwd）。改配置后需重启 upload-service。服务间写入口 `POST /internal/uploads/store`（`x-internal-key`）。对外 URL 契约不变 `/api/uploads/<cat>/<file>`；`/materials/*` 由 gateway SPA 白名单放行。见 `specs/backend-consolidation/design.md` §1 |
| **Redis** | ⚠️ 非必需但建议起 | 仅 auth-service 真依赖（登出 token 黑名单），Redis 不可用时**放行**并有内存兜底；`scripts/local-db.sh` 一并拉起 6379 |
| **MCP / 知识库** | ⚠️ 能跑但无文档 | 两者已在 pm2 托管，**均未登记 `scripts/modules.json`**（流水线管不到）。验证：`servers/mcp-gateway/test/e2e-keys.sh dev`、`servers/knowledge-service/scripts/e2e-check.mjs` |
| **微前端（admin/portal）** | ✅ 四步铁律 | 见 `docs/development/admin-dev.md` §一·C：构建 → 拷贝 → 改版本表（`web_system_deploy.deploy_deployments`）→ 等 10s 缓存 / 重启。**纯看页面直接访问 `https://local.kedouai.com/admin/`，不需要起 vite dev** |
| **发布流水线** | ✅ 控制台页面化 | `https://local.kedouai.com/console/`；deploy-console 自身走 `./scripts/publish-deploy-console.sh`（不能走流水线，会自杀式 restart） |
| **一键验证** | ✅ | `bash scripts/dev-verify.sh` —— [1/4] DB（MySQL 必过 / Redis 仅 warn）→ [2/4] 单测 → [3/4] 集成（真实 DB）→ [4/4] 服务健康 + 登录自检；可 `--unit` / `--integ` / `--health` 单跑 |

### 3.1 `/__manifest__` 是怎么工作的（微前端排障必读）

- **唯一来源**：`IndexHtmlService.buildManifest()` —— 注入 shell 的 `window.__MODULES_MANIFEST__` 与 `/__manifest__` 接口返回**同一份数据**，所以 `curl` 接口即可判断浏览器会加载什么。
- **站点解析**：`?site=` 优先，否则按请求 `Host` 匹配 `deploy_sites`；匹配不到 → `source: 'new:nosite'`（只返回旧结构）。
- **版本读取**：`deploy_deployments` / `deploy_app_env_versions` → `currentVersion`，**TTL 10s 内存缓存**（改完版本表要等 10s+ 或 `pm2 restart web-gateway`）。
- **回退**：`DEPLOY_LEGACY_READ=1` 强制只读旧表（`source: 'legacy'`）。
- **新结构**：`byEnv[envId][appKey].entry = /static/modules/<appKey>/<envId>/index.js`（入口不含版本，切版本只改磁盘指针）；`css` 按磁盘 `index.css` 是否存在给 `null`。兼容字段 `env`/`modules`/`canary` 始终保留。

---

### 3.2 本地开发验证路径（改完怎么看到效果）

> 2026-09-20 定稿（用户口径）：
> **deploy-console 自身不走流水线**（它是发布工具，restart 会自杀式中断）→ 走专用脚本；
> **其他模块（admin / portal / gateway …）的本地验证走发布流水线**，提交 `env=local` 即可。
> 流水线支持多环境 = 支持按环境（分支）使用不同脚本，见 `specs/pipeline-env-scripts/design.md`。

| 改什么 | 验证路径 |
|---|---|
| **deploy-console 自身** | `./scripts/publish-deploy-console.sh`（工作区构建→复制→重启→复检） |
| **其他模块**（前端 + 后端） | 发布流水线：提交 `{"env":"local","moduleKey":"<key>",...}` → 审批 → 生效 → 页面硬刷新 |

#### 用流水线做本地验证

```bash
curl -X POST http://127.0.0.1:6200/api/pipelines \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"env":"local","moduleKey":"admin","branch":"<你的分支>","mode":"direct"}'
# 轮询 GET /api/pipelines/:jobId；遇 gate 节点需审批：POST /api/pipelines/:id/approve
```

#### 部署：发布之后的第二个动作

流水线跑完只完成**发布**（投递产物 + 写版本记录），**还要部署才会生效**：

| 类型 | 部署动作 |
|---|---|
| 前端 | 切入口指针 `<key>/<envId>/index.js`（两行 A′ 写法） |
| 后端 | 版本目录 → dist + 重启 + 探活 |

**部署不是流水线内置动作**。流水线只负责构建并发布；部署由**流水线脚本或控制台**显式调用
对应域的接口完成。系统不做域归属判断 —— 哪个模块是应用（切指针）、哪个是服务（重启），
是运维知识，见 `deploy-target-knowledge.md`。

```bash
# 应用（前端 admin / portal）：切入口指针
curl -X POST http://127.0.0.1:6200/api/apps/admin/switch \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{\"envId\":\"local\",\"version\":\"$VER\"}"

# 服务（后端 gateway / system / auth…）：重启 + 探活
curl -X POST http://127.0.0.1:6200/api/services/gateway/deploy \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"envId":"local"}'
```

或在控制台操作：「应用 → 环境 → 切换版本」「服务 → 部署」。

⚠️ **前提**：本地脚本须把产物投到 `<key>/<envId>/<版本>/`，否则切指针会报
「版本产物不存在」（这是预期报错，用于暴露布局不一致，不做静默降级）。

> 前端构建须用微前端模式（`vite build --mode mf`）；普通 `npm run build` 产出的是 SPA，
> shell 加载不了。流水线里的 build 脚本已经是 mf 模式。

#### 不生效时，按这个顺序查

1. **构建源错位**（最静默）：脚本若默认在发布目录构建，而发布目录通常停在 `master`，
   工作区的分支改动永远进不去产物 —— 表现是"发布成功但行为没变"且无任何报错。先确认 cwd 与分支。
2. **孤儿进程**（头号原因）：端口持有者 ≠ pm2 记录的 pid（runbook §4.6）。
3. **启动即崩**：pm2 `online`、端口在听，但接口返回 `000`；看 `restarts` 是否 5 秒内增长（runbook §4.8）。
4. **浏览器缓存**：入口 `index.js` 是 no-cache，分包带 hash；仍不生效就硬刷新。

#### 配置化（P0–P3，2026-09-20）

产物目录、pm2 入口、网关静态根**都可以配**，不必改代码：

| 配置 | 作用 | 缺省 |
|---|---|---|
| `DEPLOY_ROOT` / `ARTIFACT_SUBPATH` | 模块部署位置 | 空 = 发布目录根 / 按类型推导 |
| `PM2_SCRIPT` / `PM2_CWD` | 后端进程入口与工作目录 | `dist/main.js` / `servers/<dir>` |
| `STATIC_PUBLIC_ROOT`（gateway） | 网关静态根 | `servers/gateway/public` |
| `PIPELINE_CONFIG_INJECT=false` | 关掉配置中心注入（回退旧行为） | 默认开启 |

设计见 `specs/config-driven-deploy/design.md`。

#### 配置下发到服务进程（`.env.generated`）

配置中心的第二层投递：**部署/重启服务前**，控制台把 `resolve(envId, 服务)` 的结果写进
`<发布目录>/servers/<dir>/.env.generated`（0600，文件头逐键标来源作用域），服务侧
`ConfigModule.envFilePath` 把它排在 `.env` **之前** → 重启即读到配置中心的值（服务启动不反向依赖平台）。

| 项 | 口径 |
|---|---|
| 触发 ①（正式发布） | 流水线 `restart`（后端）动作脚本：`curl $CONSOLE_API/config/internal/dispatch/<模块>?envId=<环境>`（`x-internal-key: $CONSOLE_TOKEN`）→ 写 `.env.generated`。**仅 `DEPLOY_ENV=local` 生效**；`200` 落盘 / `204` 无 module 级条目则跳过 / 其它**fail-fast（不落地、不重启）**。脚本段由 `scripts/migrations/p25-restart-config-dispatch.mjs` 注入（`ROLLBACK=1` 可回退） |
| 触发 ②（控制台动作） | 控制台「部署/重启服务」（`DeployService.applyBackendVersion`）：先下发、后落地/重启，下发失败即中止（不重启、指针不推进） |
| 范围 | 只下发**后端服务**，且该「环境 × 服务」在配置中心有 `module` 级条目（按需） |
| 过滤 | `CONFIG_MASTER_KEY` / `INTERNAL_API_KEY` / `MYSQL_*` / `REDIS_*` / `PM2_*` / `PATH` / `HOME` / `CONSOLE_*` 永不下发 |
| 备份 | 旧版改名 `.env.generated.bak-<ts>`，留最近 3 份 |
| 回退 | `rm <发布目录>/servers/<dir>/.env.generated` + 重启服务 → 回到纯 `.env` |
| 密钥不进脚本 env | 流水线脚本注入走 `resolveForScripts`（跳过 `is_secret=1`），日志注明「已排除 N 个密钥项」 |

设计见 `specs/service-config-delivery/design.md`。

---

## 4 一键脚本索引

| 脚本 | 用途 |
|---|---|
| **`scripts/bootstrap.sh --env local`** | **从零首选**：建库 → 迁移 → 构建 → 启动 → seed → 验证（`--dry-run` / `--skip-build` / `--no-start` / `--with-front` / `--admin-password`） |
| `scripts/local-db.sh` | 无 brew/sudo 拉起 `~/local` 的 MySQL(3306) + Redis(6379)，建库 `web_system` |
| `scripts/local-up.sh` | 构建共享包 + 全部后端 → pm2 启/重启 → 健康检查（`--no-build` / `--front` / `--seed`） |
| `scripts/start-frontend.sh` | 前端 dev：portal(5173) + admin(5174) + docs(4173) |
| `scripts/apply-migrations.sh local` | 幂等应用 `migrations/*.sql` |
| `scripts/dev-verify.sh` | 一键验证（§3 末行） |
| **`scripts/health-check.sh local`** | **服务巡检首选**：12 服务端口 + gateway 接口 + MCP initialize + AI 链路（knowledge_list）；`dev`/`prod` 走 SSH（auth 分别 6001/3001） |
| `scripts/check-env.sh` | `.env` vs `.env.example` 差异巡检 |
| `scripts/build-externals.mjs` | 生成 `gateway/public/static/cdn/` 共享依赖（**缺它会导致 shell 白屏**，该目录是构建产物不入库） |
| `scripts/publish-deploy-console.sh` | deploy-console 传统发布（含 6200 孤儿进程清理） |
| `scripts/seed-admin.mjs` / `reset-auth-admin-password.mjs` / `seed.sh` | 账号种子与密码重置 |
| `ecosystem.config.cjs` | `pm2 start ecosystem.config.cjs` 全量起 12 个服务 |

---

## 5 专题文档地图

| 主题 | 文档 |
|---|---|
| **总纲**（架构/端口/启动流程/发布/FAQ/脚本速查） | `docs/development-guide.md` |
| 新机器从零起（MySQL+Redis / .env / 种子用户） | `docs/development/local-dev-setup.md`（仅基础设施部分可用） |
| **换机器初始化权威清单** | `docs/development/from-zero-init-data.md` |
| **本地发布运维（发布目录 / pm2 / 流水线 / 踩坑）** | `docs/development/local-release-runbook.md`（端口表权威、§四踩坑、§五验证清单） |
| admin / 前端开发 + nginx 集成 + 微前端四步 | `docs/development/admin-dev.md`（§一·B 地址、§一·C 四步权威） |
| 发布流水线 / 发布 MCP / 发布 Agent | `docs/development/deploy-pipeline-dev.md` |
| 控制台验收 | `docs/development/local-console-acceptance.md` |
| Agent 能力体验与走查 | `docs/development/agent-capability-playbook.md` |
| 自动发布（GH Actions） | `docs/development/gh-actions-release.md` + `gh-actions-setup.md` |
| 三区分离工作流 / 集成分支 | `docs/development/dev-workflow.md`、`integration-branch.md`（后者已停用） |
| 架构总览 / 网络拓扑 / URL 规划 / 微前端设计 | `docs/architecture/技术架构.md`、`kedou-network-architecture.md`、`网关URL规划.md`、`micro-frontend-technical-design.md` |
| 静态产物缓存与保留策略 | `docs/architecture/static-artifact-cache-and-retention.md` |

---

## 6 已知问题与文档空白（待办）

| # | 问题 | 影响 |
|---|---|---|
| 1 | `local-dev-setup.md` / `whistle-local-dev.md` 的端口与目录名落后于代码 | 照抄会连错端口；以本文 §2 为准 |
| 2 | `/api/uploads/*` 实际反代到 **user-service**（`proxy.service.ts` 的 uploadProxy 用 `userServiceUrl`），`UPLOAD_SERVICE_URL` 未被消费；upload-service 无 gateway 路由 | 上传链路与 README 表述不一致。**加剧**：A3 已把 upload-service 的落盘改到统一根（`~/web_system/uploads`），而路由仍指向 user-service → **A4 未切之前，经 gateway 的新上传文件会 404**（直连 6008 正常）。A3 与 A4 必须同批发布 |
| 3 | knowledge-service 未登记 `scripts/modules.json`，本地缺 `.env` 与 `dist/` | pm2 直接失败；需 `cp .env.example .env` + `pnpm build` + 建库 |
| 4 | knowledge-service(6011) / mcp-gateway(6006) 的本地启动与验证无文档 | 只能靠 `e2e-check.mjs` / `e2e-keys.sh` |
| 5 | 无独立的「日志查看与排障」文档；本地与生产 pm2 日志路径不同 | 排障靠口口相传 |
| 6 | 仅 gateway 有真实 health 端点（`/health`、`/api/health`），其余服务只能端口探活 | 探活语义弱 |
