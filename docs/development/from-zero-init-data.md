# 工程首次运行 · 初始化数据清单

> 适用：换机 / 新环境 / 新部署点从零跑起。
> 定位：**「要准备什么数据」的唯一清单**。启动步骤的权威教程见 `local-dev-setup.md`（本机，注意其端口章节已过时），生产部署见 `prod-release-plan.md`。
> 结论口径：**开发环境靠 TypeORM `synchronize` 自动建表 + 各服务 `onModuleInit` 自动 seed；生产环境 `synchronize=false`，必须先跑 `apply-migrations.sh`**。

---

## 0. 一图看依赖链

```
基础设施(MySQL/Redis) → 库存在 → 共享包 build → 后端启动(synchronize 建表 + 自动 seed)
                                             → 手工 seed(管理员/agent/出版本指针) → 可登录
```

三处最容易漏：
1. **只建了 `web_system`** —— 还有 `web_system_deploy`（发布平台）与 `web_system_knowledge`（RAG）；
2. **生产直接起服务** —— 生产 `synchronize=false`，表不存在会「进程 online 但端口不监听」；
3. **只 build 了 shared/types** —— `ai-service` 还依赖 `@kedouai/agent-core`。

---

## 1. 数据库与表结构

### 1.1 库清单与归属

| 库 | 用途 | 连接方 | 配置变量 |
|---|---|---|---|
| `web_system` | 主库（业务） | auth / user / ai-service / system / todo / content-hub / mcp-gateway | `DB_DATABASE`；gateway 与 upload 用 `MYSQL_DB` |
| `web_system_deploy` | 发布平台（环境/模块/模板/命令/版本指针） | deploy-console（读写）、gateway（只读） | `MYSQL_DB`（deploy-console）/ `DEPLOY_DB_NAME`（gateway） |
| `web_system_knowledge` | RAG（集合/文档/分块） | knowledge-service | `DB_DATABASE` |
| `ai_agent` | ai-agent 自身（对话记忆） | ai-agent | `DB_DATABASE`（默认 `ai_agent`） |

> ⚠️ 微前端版本表 `deploy_deployments` 在 **`web_system_deploy`**，不在 `web_system`（主库里那张是 0007 遗留的同名表，易混）。

### 1.2 表结构怎么来

| 环境 | 机制 | 说明 |
|---|---|---|
| 开发（`NODE_ENV != production`） | TypeORM `synchronize: true` | 服务启动即建表/改表 |
| 生产（`NODE_ENV=production`） | **必须先跑 `./scripts/apply-migrations.sh prod`** | synchronize 关闭，漏跑 → 启动即崩 |
| `web_system_deploy` | deploy-console **恒 `synchronize: true`** | 该库**没有 migrations 文件**，启动一次 deploy-console 即建表 |
| `web_system_knowledge` | `0008_knowledge_tables.sql` | 或开发环境 synchronize |
| gateway 的 deploy 只读连接 | `synchronize: false` | 从不建表 |

### 1.3 `migrations/` 清单（由 `scripts/apply-migrations.sh` 调用）

| 文件 | 目标库 | 内容 |
|---|---|---|
| `0001_standardize_business_tables.sql` | web_system | 存量表规范化 ALTER（**非幂等**，存量库需 `--baseline-through`） |
| `0002_upload_gateway_admin_tables.sql` | web_system | upload_files / gateway_routes / gateway_access_logs / config_change_logs |
| `0003_content_hub.sql` | web_system | content_sources / pipelines / items / publications / media |
| `0004_mcp_jobs.sql` | web_system | mcp_jobs |
| `0005_rename_mini_app_to_mini_contract.sql` | web_system | 小程序模块改名 |
| `0006_dict_tables.sql` | web_system | dict_types / dict_fields / dict_items |
| `0007_baseline_tables.sql` | web_system | **27 张存量业务表基线**（agent_*、mcp_*、roles/permissions、users、deploy_deployments、system_configs…），全 `CREATE TABLE IF NOT EXISTS` |
| `0008_knowledge_tables.sql` | **web_system_knowledge** | knowledge_chunks / collections / docs |

用法：
```bash
./scripts/apply-migrations.sh local|dev|prod    # 幂等（目标库 schema_migrations 记账）
DRY_RUN=1 ./scripts/apply-migrations.sh prod    # 预演
./scripts/apply-migrations.sh dev --baseline-through 0006_dict_tables.sql  # 存量库首次接入
```

其它建表来源（非首次主路径）：
- `scripts/sync-schema.sh`：只做加列/补表，当前无待同步项；
- `scripts/migrations/*`：历史数据迁移（p0 去重、p2 端口格式转换），非建表；
- `servers/mcp-gateway/sql/mcp_keys_tables.sql`：**生产手工执行**（`mcp_api_keys` / `mcp_key_codes`，因为生产 synchronize 关闭）。

---

## 2. 自动 seed（服务启动时 `onModuleInit`，无需人工）

| 服务 | 写入数据 | 代码位置 | 幂等策略 |
|---|---|---|---|
| user-service | `permissions` / `roles`(admin/editor/viewer) / `role_permissions` | `permission.service.ts` `seed()`（真相源是 `packages/types` 的 `PERMISSIONS`/`ROLE_PERMISSIONS`） | 权限 upsert；内置角色权限全量覆盖 |
| system-service | 字典 `llm_models`(仅结构) / `contract_scene` / `contract_risk_level` / `operation_log_type` | `dict.service.ts` `BUILTIN_DICTS` + `ensureBuiltin()` | 类型/字段补缺；**初始行仅在该字典 0 条时插入** |
| ai-service | `agent_definitions`（**代码兜底 5 个**：contract-risk / study-assistant / bianbian / deploy / web-system-dev） | `agent-def.service.ts` `builtinSeeds()` | 按 id 缺失补录，不覆盖运营改过的 |
| mcp-gateway | `mcp_modules` / `mcp_tools`（6 个模块：finnews / wechat_mp / paper / institution / deploy / knowledge） | `mcp.service.ts` seed 系列 | 模块 upsert + 工具差量补齐 |
| deploy-console | `deploy_environments`（dev/prod）、`deploy_modules`（读 `scripts/modules.json`）、默认流水线模板、平台阶段脚本 | `environment.service.ts` / `module-registry.service.ts` / `pipeline-template.service.ts` / `platform-script-seed.service.ts` | 多为「表为空才 seed」或 upsert |

> `deploy_servers`（发布目标机）**无代码 seed**，需在控制台维护（或历史脚本 `scripts/migrations/p1-seed-servers-routes.sql`）。

---

## 3. 手工 / 脚本 seed（必须或按需执行）

| 数据 | 脚本 / 入口 | 命令 | 必需 |
|---|---|---|---|
| 管理员 admin / test 用户 | `servers/auth-service/scripts/seed.ts` | `ADMIN_INIT_PASSWORD='xxx' pnpm seed`（admin 缺密码直接报错） | **是**（否则无法登录） |
| 重置 admin 密码 | `scripts/seed-admin.mjs` / `reset-auth-admin-password.mjs` | `node scripts/seed-admin.mjs`（默认 admin123，upsert 可改密） | 按需 |
| 发布平台前端指针 | `scripts/seed-dev-deployment.mjs` | `node scripts/seed-dev-deployment.mjs`（写 deploy_modules/deploy_deployments/deploy_versions，幂等） | 按需（微前端动态版本必需） |
| RAG 知识集合与语料 | `scripts/self-knowledge/load.mjs` | 先生成语料（`corpgen.mjs`）→ `node scripts/self-knowledge/load.mjs`（建 `ws-arch`/`ws-agent-platform`/`ws-dev-guide`） | 按需（`web-system-dev` agent 依赖） |
| 变变默认素材 | admin REST `POST .../seed`（`bianbian-admin.service.ts`） | 控制台触发 | 按需 |
| 模型单价迁字典 | `scripts/db/migrate-model-pricing-to-dict.mjs` | `node ... --apply` | 按需 |
| super_admin 角色 | `scripts/db/grant-super-admin.mjs` | `node scripts/db/grant-super-admin.mjs admin` | 按需 |

**无任何初始数据**：content-hub（`content_sources`/`content_pipelines` 需手工维护）、todo-service、upload-service、gateway 路由表（代理路由是硬编码）。

---

## 4. 非数据库初始化

| 项 | 内容 | 命令 / 位置 |
|---|---|---|
| 共享包构建 | `shared` / `types` / `mcp-core`（`local-up.sh` 清单）**+ `agent-core`**（ai-service 依赖，清单里漏了） | `pnpm --filter @kedouai/agent-core build` |
| CDN 共享依赖 | `servers/gateway/public/static/cdn/`：vue / vue-router / pinia / antd / axios / dayjs(+插件) + `manifest.json` | `node scripts/build-externals.mjs`（按 cwd 输出） |
| 微前端产物 | `public/static/modules/<key>/<version>/` | 各 app `RELEASE_TAG=<hash> MF_FORMAT=system npx vite build --mode mf` |
| pm2 进程清单 | 12 个 `web-*`（开发）/ 12 个生产名（`ecosystem.config.js` 生产版，注入 DB/密钥） | `pm2 start ecosystem.config.cjs` + `pm2 save` + `pm2 startup` |
| Redis | **无需预置数据**（JWT/限流/缓存） | `local-db.sh` 起即可 |
| nginx | `local.nginx.conf` / `nginx-server.conf` / `micro-frontend.nginx.conf` | 手工部署 |

---

## 5. 「从零到可登录」最小顺序

```bash
# 0) 工具链与依赖
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install

# 1) 基础设施（MySQL 3306 + Redis 6379，自动建 web_system 库）
bash scripts/local-db.sh

# 2) 共享包（顺序：包 → 服务）
pnpm --filter @web-system/shared build
pnpm --filter @web-system/types build
pnpm --filter @web-system/mcp-core build
pnpm --filter @kedouai/agent-core build      # ai-service 依赖

# 3) 各服务 .env（gitignore，需自建；模板见各 servers/*/.env.example 与根 .env.example）
#    网关 / deploy-console 必须补 MYSQL_*（它们的 .env.example 无 DB 段）

# 4) 库与表
#    开发：起服务即 synchronize 建表，可跳过本步
#    生产：先建库再跑迁移（否则启动即崩）
#    CREATE DATABASE web_system_deploy;  CREATE DATABASE web_system_knowledge;
./scripts/apply-migrations.sh local          # 或 dev / prod

# 5) 构建并启动后端（建表 + 自动 seed）
bash scripts/local-up.sh                     # 共享包 + 全部后端 → pm2 → 健康检查
#    bash scripts/local-up.sh --seed         # 顺带重置 admin 密码

# 6) 建可登录账号
cd servers/auth-service && ADMIN_INIT_PASSWORD='xxx' TEST_INIT_PASSWORD='test123456' pnpm seed
#    或在根目录：node scripts/seed-admin.mjs

# 7) 可选：发布平台指针 / 知识库
node scripts/seed-dev-deployment.mjs
node scripts/self-knowledge/load.mjs

# 8) 前端（可选）
bash scripts/start-frontend.sh

# 9) 验证登录
curl -s -X POST http://127.0.0.1:6000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"xxx"}'
```

---

## 6. 常见「起不来」的根因对照

| 现象 | 根因 | 处置 |
|---|---|---|
| 进程 online 但端口不监听 | 生产 `synchronize=false` 且没跑迁移 | `./scripts/apply-migrations.sh <env>` |
| `local-db.sh` 报 `Access denied ... (using password: NO)` | 该脚本默认 MySQL root **无密码**（socket 直连）；root 一旦设过密码就失败 | `MYSQL_PWD='<密码>' bash scripts/local-db.sh`（`bootstrap.sh --env local` 已自动从 `.env` 的 `DB_PASSWORD` 注入 MYSQL_PWD） |
| 服务启动即 exit | `JWT_SECRET` 为空（gateway/ecosystem 内置校验） | 补 `.env.production` / 各服务 `.env` |
| `Cannot find module '@kedouai/agent-core'` | 只 build 了 shared/types | `pnpm --filter @kedouai/agent-core build` |
| 接口通但菜单不显示 | 权限未同步（代码常量 vs DB） | `POST /internal/permissions/sync`（`scripts/sync-permissions.sh`） |
| 前端白屏、`/static/cdn/vue.js` MIME 是 text/html | 缺 CDN 产物 | `node scripts/build-externals.mjs` |
| 微前端仍加载旧版本 | 版本表未更新 | 写 `deploy_deployments`（注意是 **web_system_deploy** 库） |

---

## 变更日志

- 2026-09-13 首版：基于代码与发布库实测梳理（含 `local-dev-setup.md` 已过时的说明）。
