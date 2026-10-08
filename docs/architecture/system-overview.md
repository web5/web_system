# web_system 系统平台架构与部署总览

> **定位**：本文是**现状**总览（single source of truth），描述截至 2026-10-08 代码与线上实际情况。
> 目标态（AIOps 四层架构、拉模式 runner）见 [`aiops-console-target-architecture.md`](./aiops-console-target-architecture.md)，专项细节见各子文档。
>
> | 版本 | 日期 | 说明 |
> |---|---|---|
> | v1.0 | 2026-10-08 | 首版。取代已废弃的 `DEPLOYMENT.md` 与 `kedou-network-architecture.md` |

---

## 1. 仓库组成

`pnpm-workspace.yaml` 仅三条 glob：`apps/*`、`servers/*`、`packages/*`。

| 顶层目录 | 说明 |
|---|---|
| `apps/` | 6 个前端应用（`mini-app` 为空壳残留，源码已迁 `kedou-ai-minigram`） |
| `servers/` | 12 个 NestJS 服务 |
| `packages/` | 8 个共享包 |
| `specs/` | **设计/变更规格 59 项**。新机制先在此定稿再落地，是"最新事实"的高密度来源 |
| `migrations/` | 迁移 SQL，由 `scripts/apply-migrations.sh` 按 `-- @database <db>` 注解路由目标库 |
| `scripts/` | 发布 / 巡检 / 构建 / 迁移 / 密钥 等运维脚本 |
| `assets/` | `shared-public/` 公共素材源，编译进 `/static/cdn/pub/**` |
| `mcp-skills/` | MCP/AI 侧技能包（finnews、kedou-deploy、wechat-mp、paper…） |
| `agents/` `hooks/` `wiki/` `raw/` `archive/` | 技能脚本、遗留 hook、外部知识库、归档迁移 |
| `common/` + `rush.json` | **Rush 配置残留**，与 pnpm 并存，基本未启用 |

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 微前端基座 | 自研 `packages/shell-loader` + `window.__SHARED__`（**不是** qiankun / import maps） |
| 前端 | Vue 3 + Vite 5 + Ant Design Vue + Pinia |
| 小程序 | 微信原生 + TS（**历史文档写 UniApp 是误记**） |
| 后端 | NestJS 10 + TypeORM（`SnakeNamingStrategy`） |
| 数据库 | **MySQL**（运行时唯一）；PostgreSQL 仅存在于 `docker-compose.yml` |
| 进程管理 | pm2 |
| 网关/SSL | nginx（GATEWAY 机终止 SSL） |
| CI | GitHub Actions + self-hosted runner |

## 3. 后端服务目录

| 服务 | 职责 | 端口 |
|---|---|---|
| `gateway` | 统一入口：SPA 回退、`/api/*` 反代、静态托管、manifest 分发、灰度命中 | 6000 |
| `auth-service` | 认证：账密/JWT/微信 OAuth/小程序登录 | 6001 |
| `user-service` | 用户 CRUD、API Key、权限、记忆、术语表 | 6002 |
| `ai-service` | AI 对话/生图/TTS/变变/作品/Agent 定义与日志 | 6003 |
| `system-service` | 系统配置、字典、操作日志、存储、库浏览器 | 6004 |
| `todo-service` | 待办任务 | 6005 |
| `mcp-gateway` | MCP 网关：streamable-http + 声明式 HTTP→MCP | 6006 |
| `content-hub` | 内容中枢：财经/论文/资讯采集、LLM 处理、公众号发布 | 6007 |
| `upload-service` | 统一文件上传 | 6008 |
| `ai-agent` | Agent 运行时/编排（ReAct）、OCR、MCP、技能 | 6010 |
| `knowledge-service` | RAG 知识库：分块、embedding、余弦检索（独立库） | 6011 |
| `deploy-console` | 发布平台：流水线、环境、应用/服务、版本指针、审批、灰度、配置中心 | 6200 |

**端口矩阵差异**：本机 local 的 `auth-service` 是 **6101**（6001 被他项目占用，写在 `ecosystem.config.cjs`）；dev/prod 用 6001（写在发布目录的 `ecosystem.config.js`）。

> ⚠️ `ecosystem.config.cjs`（本机）与 `.js`（发布目录）**双文件漂移**是已知技术债：pm2 名前者 `web-*`、后者裸名，是排查时的高频误导源。

## 4. 前端应用

| 应用 | 角色 | 说明 |
|---|---|---|
| `shell` | **微前端基座** | 提供 `window.__SHARED__` + loader + 版本检查；整页 HTML |
| `portal` | 子应用 | 用户门户，dev 5173 |
| `admin` | 子应用 | 管理后台，dev 5174 |
| `deploy-console` | **独立 SPA**（非微前端） | 运维控制台，由 6200 自身 serve `/console/`，dev 5174（与 admin 撞端口） |
| `kedou-ai-minigram` | 微信小程序·科豆 AI | 2026-09 由 `mini-contract` 更名（更早 `mini-app`） |

**微前端规范**
- 模块格式：`MF_FORMAT=system`（2026-09-28 起默认），`umd` 仅作旧产物兼容
- CSS 隔离：postcss 给每条选择器加 `:where([data-module="<name>"])`，优先级归零避免误伤 antdv
- 产物目录（env-dir）：`static/modules/<key>/<envId>/<commit>/` + **无版本入口指针** `static/modules/<key>/<envId>/index.js`
- 缓存三段式（gateway `isContentAddressed()`）：固定名入口 → `no-cache`+ETag；带 hash 分包 → `immutable`；`/static/cdn/**` → `no-cache`

## 5. 共享包

`shared`（跨端配置收口 + 命名策略 + 服务 URL fail-fast）、`types`、`ui`（设计 token + AntD 主题）、`shell-loader`（微前端加载器）、`agent-core`（ReAct 引擎）、`kedou-agent`（CLI）、`mcp-core`（MCP 模块注册 + 声明式转换）、`agent-message`（消息 blocks 解析，三端复用）。

## 6. 数据层

| 库 | 用途 |
|---|---|
| `web_system` | 业务主库 |
| `web_system_knowledge` | RAG 知识库 |
| `web_system_deploy` | 发布平台（版本指针 + 配置表） |
| `web_system_deploy_shadow` | 影子库演练 |

- **运行时全部 MySQL**。`docker-compose.yml` 用 PostgreSQL、`docker-compose.prod.yml` 用 MySQL，**两者自相矛盾且都不反映真实运行时**（pm2 + 12 服务）——新人按 compose 部署必然错。
- 各服务**直连**本机/云库，不经堡垒机。

### 6.1 deploy-console 双数据源（2026-10-08 起）

这是 2026-09-30 基座事故（dev 写本机库、prod gateway 读云库 → 指针分裂）的根治方案：

| 环境 | 写哪 | 说明 |
|---|---|---|
| **prod** | 云数据库 | **严格模式**（`DEPLOY_CLOUD_DB_STRICT=true`）：写失败抛 503「prod 指针未生效」 |
| dev / local | 本机 MySQL | **不镜像** |

- 实现：`servers/deploy-console/src/cloud-db/`（`cloud-db.module.ts` / `cloud-db.service.ts` / `env-split-writer.service.ts`）
- 配置镜像（M4）：10 张配置表接入镜像写，**异步队列 + 同键去重，业务写路径永不 await**
- 安全：独立 DataSource `synchronize:false` + `entities:[]` 防止对云端做 DDL；错误公网地址脱敏

## 7. 版本指针与发布数据模型

### 7.1 NEW 域（gateway 默认读取源，2026-09-30 后）

| 表 | 作用 |
|---|---|
| `deploy_app_env_versions` | **主指针**：`(appKey, envId) → currentVersion` |
| `deploy_apps` / `deploy_sites` / `deploy_envs` | 应用注册表（含 `deployMode`）、站点、站点下环境 |
| `deploy_services` / `deploy_service_envs` | 服务注册表 + 各环境 host/port（gateway `resolveUpstream` 用） |
| `deploy_app_routes` / `deploy_service_routes` / `deploy_endpoints` | 路由与端点 |
| `deploy_canary_rules` | 灰度规则 |

### 7.2 legacy 域（仅 `DEPLOY_LEGACY_READ=1` 应急回退）

`deploy_deployments`（旧 `(envId, moduleKey) → currentVersion`）、`deploy_modules`、`deploy_versions`、`deploy_environments`、`deploy_servers`、`deploy_env_service_routes`。

> ⚠️ 旧文档（`release-system-design.md`）通篇以 legacy 七表为"现状"，**已被本文取代**。

### 7.3 两种部署模式

| 模式 | 适用 | 产物目录 | 入口 | 参与环境切换 |
|---|---|---|---|---|
| `env-dir` | admin / portal | `<key>/<envId>/<commit>/` | 固定 `<key>/<envId>/index.js` | ✅ |
| `site-version` | **shell 基座** | `shell/<envId>/<纯 commit>/` | 整页 HTML | ❌ |

**关键约束**：基座是整页 HTML、`<script src>` 用烘焙的**绝对 base**，所以 shell 构建必须 `RELEASE_TAG=${DEPLOY_ENV}/${COMMIT_ID##*/}`，否则产物 404。已由 `scripts/pipeline-lint.mjs` 的 **L7 规则**卡位。

## 8. 发布与部署通道

三条通道并存：

1. **流水线**（主力）：`GitHub Actions release.yml` → HMAC 签名投递 `POST /api/hooks/release` → 平台流水线 → 轮询终态。七阶段：pull / build / upload / restart / version / pointer / verify / cleanup，动作脚本存在 DB。
2. **传统发布**：`scripts/publish-deploy-console.sh --env dev|prod`（deploy-console 专用，带备份替换 + 探活 + 失败自动回滚）。
3. **本地调试**：本机 nginx + `local.kedouai.com`。

门禁：`quality-gate.yml`（红线扫描 R9–R14 + 改动包 build/test，**lint 档已关闭**，全仓无 ESLint flat config）、`pipeline-lint.mjs` L7。

## 9. 环境拓扑

| 环境 | 域名 | 机器 | 说明 |
|---|---|---|---|
| local | `local.kedouai.com` | 本机 Mac，发布目录 `~/web_system_release` | 本机 nginx |
| dev | `dev.kedouai.com` | 南京 `ap-nanjing-3` / VPC `vpc-ljskd1kp` / `10.206.16.0/20` | dev 现网 + **deploy-console 主运行环境** |
| prod | `kedouai.com` | 广州 `ap-guangzhou-4` / VPC `vpc-hiltvaat` / `172.16.16.0/20` | 静态外置 `/data/web_system_static` |

- SSL 在 **GATEWAY 机 nginx** 终止 → 反代到 dev/prod 的 6000 与 6006。
- `portal.kedouai.com` 已于 2026-09-10 下线：DNS A 记录保留但证书 SAN 不含、nginx 无 server 块 → 能解析但访问必失败。

### 9.1 静态资源根

| 环境 | 静态根 |
|---|---|
| local | `~/web_system_release/servers/gateway/public/static/modules/` |
| dev | dev 机 gateway `public/static/modules/` |
| prod | **外置** `/data/web_system_static/public`（由根 `.env.production` 的 `STATIC_PUBLIC_ROOT` 注入；必须写在根 env 因其在 import 期求值，早于 `@nestjs/config`） |

## 10. 配置与密钥

- 三层优先级：**根 `.env.production` > 服务级 `.env` > 代码默认值**。
- pm2 铁律：`pm2 delete && pm2 start`，**禁用 `--update-env`**（裸 `pm2 start ecosystem.config.js` 会注入 0 个变量导致 JWT_SECRET 缺失启动失败）。
- `CONFIG_MASTER_KEY` 只注入**文件路径**（`scripts/provision-master-key.sh`），不注入值。

## 11. CI/CD

| workflow | 触发 | 产出 |
|---|---|---|
| `auto-pr.yml` | push 到 `feature/*` `fix/*`（排除 `feature/test`、`kedou-ai-minigram`） | 自动建 PR + 挂 auto-merge |
| `auto-merge.yml` | PR opened/synchronize | 幂等挂自动合入兜底 |
| `quality-gate.yml` | PR → master | 红线扫描 + 改动包 build/test |
| `release.yml` | push 到 **`feature/test`** 或手动 | self-hosted runner 发布 |

凭据用 `RELEASE_HOOK_SECRET`（HMAC-SHA256 + 300s 时间窗 + deliveryId 幂等），不用控制台 JWT。

## 12. 运维脚本索引

**发布/巡检（常用）**：`publish-deploy-console.sh`、`check-cloud-db-consistency.sh`（本地库 vs 云库 12 表巡检，**刻意不做 CI 门禁**，因 runner 不在云库白名单）、`pipeline-lint.mjs`、`release-deploy-console.sh`、`health-check.sh`

**构建**：`build-all.sh`、`build-module.mjs`、`build-externals.mjs`、`build-public-assets.mjs`
**迁移/数据**：`apply-migrations.sh`、`sync-schema.sh`、`db-shadow.mjs`
**密钥**：`provision-master-key.sh`、`verify-config-master-key.mjs`
**已弃用**：`deploy-local.sh`、`deploy-prod.sh`

## 13. 云数据库分流改造路线图的落地状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 独立 DataSource + 脱敏 + 硬超时 | ✅ |
| M2 | 按环境分流写指针（prod 严格模式） | ✅ |
| M3 | 配置表基线同步 | ✅ 实测原本已一致，仅补 legacy 表 |
| M4 | 配置镜像双写（30 个写入点） | ✅ |
| M5 | 两库一致性检查脚本 | ✅ |
| — | 公网链路改云联网走内网 | 🔜 进行中（见 `docs/operations/ccn-migration-runbook.md`） |

详见 [`../../specs/deploy-console-env-datasource/design.md`](../../specs/deploy-console-env-datasource/design.md)。

## 14. 已知技术债

| 债务 | 影响 |
|---|---|
| `ecosystem.config.cjs` / `.js` 双文件漂移 | pm2 名与端口口径不一，排查误导 |
| `docker-compose*.yml` 失真（PG vs MySQL 自相矛盾） | 新人按 compose 部署必然错 |
| `apps/mini-app` 空壳目录 | 误导文档与 grep |
| 全仓无 ESLint flat config | quality-gate 的 lint 档关闭，只有 build/test |
| 文档命名残留 `mini-contract` | `deploy-target-knowledge.md` 未同步更名 |

## 15. 相关文档

| 文档 | 状态 | 用途 |
|---|---|---|
| 本文 | ✅ 现状 | 总入口 |
| [`micro-frontend-technical-design.md`](./micro-frontend-technical-design.md) | ✅ | 微前端专项 |
| [`static-artifact-cache-and-retention.md`](./static-artifact-cache-and-retention.md) | ✅ | 静态产物与缓存 |
| [`gateway`](../../specs/gateway) / [`release-platform`](../../specs/release-platform) | ✅ | 规格原稿 |
| [`aiops-console-target-architecture.md`](./aiops-console-target-architecture.md) | 🎯 **目标态** | 与现状差距大，勿混读 |
| [`DEPLOYMENT.md`](../../DEPLOYMENT.md) | ❌ **已废弃** | 3000 系端口、scp 部署，已被本文取代 |
| [`kedou-network-architecture.md`](./kedou-network-architecture.md) | ❌ **已废弃** | 2026-08 拓扑（6 个 pm2 进程），已被本文 §9 取代 |
| [`release-system-design.md`](./release-system-design.md) | ⚠️ **内容最旧** | 仍以 legacy 七表为现状，已被本文 §7 取代 |
