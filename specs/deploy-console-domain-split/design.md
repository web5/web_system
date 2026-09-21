# 设计稿 · deploy-console 双域重构（微前端 / API 网关）v2

> 状态：**已评审确认 v2**（2026-09-18，Q101–Q112 全部确认，见 `review-01-requirements.md`）
> 需求来源：`requirements.md` v1.1（FR-1 ~ FR-10）
> **唯一事实源声明**：本文是数据模型与接口契约的唯一权威；`environment-design.md` 的环境模型结论**已并入本文 §4.2**，该文档降级为设计过程记录
> 已落地原型（实现基线）：`apps/deploy-console/src/views/{AppManager,AppDetail,EnvironmentManager,EnvironmentDetail,ServiceManager,ServiceDetail}.vue`、`layouts/MainLayout.vue`、`packages/ui/src/components/EnvSwitcher.vue`

---

## 0. 确认结论（Q101–Q112）

| # | 结论 |
|---|---|
| Q101 | 环境模型以 **`deploy_sites` + `deploy_envs`（envId 自增，无 slot）** 为准 |
| Q103 | 版本指针表 = **`deploy_app_env_versions(appKey, envId)`**（去 slot） |
| Q105 | **产物保留版本**：`envId/<version>/` 存历史产物，`envId/index.js` 为指向当前版本的入口指针（代价接受） |
| Q106 | 环境切换**保留 token**（同域切换，后端 JWT 兜底） |
| Q107 | **shell 基座与小程序都不纳入 envId 目录**（shell 走"站点 + 版本"，小程序另议） |
| Q102 | `requirements.md` 按新模型修订（已完成 → v1.1） |
| Q104 | 服务"指向"编辑入口 = **环境详情**（服务详情只读） |
| Q108 | 本期先跑通 env 目录，**灰度后续**叠加 |
| Q109 | 旧 `local/dev/prod` 原样保留为内置 envId，历史 `deploy_deployments` 数据平移 |
| Q110 | 环境切换**记录审计事件** |
| Q111 | 1 个 envId 属于 **1 个站点** |
| Q112 | 版本保留：**5 版且不超过 7 天**（先到者） |

---

## 1. 架构总览

```
┌─ 基础设施（跨域）────────────────────────────────────────────┐
│ deploy_hosts   主机/主机组（含 runtime: pm2|docker）           │
└──────────────────────────────────────────────────────────────┘
        ┌───────────────────────────┴───────────────────────────┐
        ▼                                                        ▼
┌─ 微前端域 app ──────────────────────┐   ┌─ API 网关域 svc ──────────────────┐
│ deploy_sites      站点（入口域名）    │   │ deploy_services      服务          │
│ deploy_envs       环境（envId 目录）  │   │ deploy_service_routes 转发规则      │
│ deploy_apps       应用（含子模块）    │   │ deploy_endpoints      接口清单      │
│ deploy_app_routes shell 挂载路由      │   │ deploy_service_envs   服务×环境指向 │
│ deploy_app_env_versions 版本指针      │   │                                    │
└─────────────────────────────────────┘   └───────────────────────────────────┘
        └──────────────────────┬──────────────────────────┘
                               ▼
                 流水线层（结构不动，仅 targetRef 解析）
                               ▼
                 部署执行双策略（App / Service）
```

**核心不变量**：
1. **envId 决定"前端加载哪份产物"与"后端指向哪里"** —— 两侧必须同时切换（FR-3.8）。
2. **两个域互不写对方的表**（AppDeployStrategy 不碰 pm2；ServiceDeployStrategy 不写版本指针）。
3. **流水线表结构不变**，只加 `targetRef` 解析。

---

## 2. 数据模型

> 约定：`utf8mb4_0900_ai_ci`；时间 `DateTime(6)`；软删除 `deletedAt`；表前缀 `deploy_`。

### 2.1 基础设施

#### `deploy_hosts`（主机，替代 `deploy_servers`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `name` | varchar(64) UNIQUE | 主机**组**名（同组多副本共享） |
| `host` | varchar(128) | SSH 主机 |
| `sshUser` | varchar(64) | |
| `sshKeyPath` | varchar(255) NULL | |
| `remoteDir` | varchar(255) | 部署根目录 |
| `runtime` | enum(`pm2`,`docker`) default `pm2` | |
| `labels` | json NULL | |
| `enabled` / `createdAt` / `updatedAt` | | |

### 2.2 微前端域

#### `deploy_sites`（站点，新增）

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | varchar(32) PK | `local` / `dev` / `prod` |
| `host` | varchar(128) UNIQUE | 入口域名（`dev.kedouai.com`） |
| `name` | varchar(64) | |
| `defaultEnvId` | varchar(64) | 该站点默认环境（缺省 `dev`） |
| `switchable` | bool default false | 是否在产品页渲染环境切换挂件（prod = false） |
| `enabled` | bool | |

#### `deploy_envs`（环境，envId 即产物目录名）

| 字段 | 类型 | 说明 |
|---|---|---|
| `envId` | varchar(64) **PK** | 内置保留字 `dev`/`local`/`prod`；用户创建为**系统自增数字**（`1`/`2`…） |
| `name` | varchar(64) | 用户填写的展示名 |
| `siteKey` | varchar(32) | 归属站点（**1 个 envId 属 1 个站点**，Q111） |
| `isProd` | bool default false | 全局**至多一条**（部分唯一索引） |
| `builtin` | bool default false | 内置不可删 |
| `sort` | int | 挂件内排序 |
| `enabled` | bool | |
| `createdAt` | datetime(6) | |

**约束与规则**
- `envId` 生成：内置保留字 + 用户创建时取当前最大数字 envId + 1；**用户不填 ID**（FR-3.2）。
- **回退**：运行时传入的 envId 查不到 → 用站点 `defaultEnvId`（缺省 `dev`）（FR-3.3 / B3）。
- **安全校验**：`envId` 必须匹配 `^[a-z0-9_-]+$`（作为 URL 段与目录名，B9）。

#### `deploy_apps`（应用）

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | varchar(64) PK | 创建后不可改（B2） |
| `name` | varchar(128) | |
| `kind` | enum(`shell`,`micro-frontend`,`spa`,`mini-app`) | |
| `parentKey` | varchar(64) NULL | 子模块归属（仅展示/分组，不影响发布逻辑） |
| `repoDir` | varchar(128) | `apps/<dir>` |
| `entry` / `publicPath` / `externals` | | 构建产物约定 |
| `deployMode` | enum(`env-dir`,`site-version`) default `env-dir` | **Q107**：shell 用 `site-version`（不走 envId 目录） |
| `description` / `builtin` / `enabled` / `deletedAt` | | |

#### `deploy_app_routes`（shell 挂载路由）

| 字段 | 说明 |
|---|---|
| `id` uuid PK / `appKey` / `mountPath` / `activeRule` / `requireAuth` / `sort` / `enabled` | `UNIQUE(appKey, mountPath)` |

#### `deploy_app_env_versions`（版本指针，Q103）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `appKey` | varchar(64) | |
| `envId` | varchar(64) | **无 slotKey** |
| `currentVersion` | varchar(64) | git short sha（指向 `envId/<version>/`） |
| `previousVersion` | varchar(64) NULL | 回滚默认目标 |
| `status` / `deployedAt` / `deployedBy` / `taskId` | | |

**UNIQUE(`appKey`, `envId`)**

### 2.3 API 网关域

#### `deploy_services`（服务）

| 字段 | 说明 |
|---|---|
| `key` PK（沿用旧值，不重命名）/ `name` / `kind`(`nest`,`express`,`mcp`,`static`) | |
| `repoDir`（`servers/<dir>`）/ `pm2Name` / `defaultPort` / `healthPath` | |
| `unknownPolicy` enum(`allow`,`deny`) default `allow` | 未登记接口策略（FR-6.4） |
| `deployChannel` enum(`managed`,`legacy`) default `managed` | **G6**：`deploy-console` 自身 = `legacy`（传统发布，不自杀式重启） |
| `description` / `builtin` / `enabled` / `deletedAt` | |

#### `deploy_service_routes`（转发规则，前缀级）

| 字段 | 说明 |
|---|---|
| `id` / `serviceKey` / `envId` NULL（NULL=全环境） | |
| `pathPrefix` / `stripPrefix` / `rewriteTo` / `upstreamOverride` | |
| `timeoutMs` / `authMode` / `priority` / `enabled` | |

**UNIQUE(`serviceKey`, `envId`, `pathPrefix`)**

#### `deploy_endpoints`（接口清单，方法 + 路径级）★ 核心新增

| 字段 | 说明 |
|---|---|
| `id` / `serviceKey` / `method`(`GET`…`ALL`) / `pathPattern`（`/api/todo/:id`） | |
| `code` / `summary` / `authMode`(`inherit`/`passthrough`/`jwt`/`service_key`/`none`) | |
| `permissionCode` / `rateLimitPerMin` / `timeoutMs` | |
| `deprecated` / `source`(`manual`,`openapi`,`scan`) / `enabled` | |

**UNIQUE(`serviceKey`, `method`, `pathPattern`)**（导入幂等依据）

#### `deploy_service_envs`（服务 × 环境 = "指向"）

| 字段 | 说明 |
|---|---|
| `id` / `serviceKey` / `envId` | **无 slotKey**（Q104） |
| `hostName`（FK `deploy_hosts.name`）/ `port` / `replicas` / `runtime` | |
| `upstreamUrl` / `healthPath` / `pm2Name` / `config` json / `status` | |

**UNIQUE(`serviceKey`, `envId`)** —— **编辑入口在环境详情**（FR-3.6），服务详情只读。

---

## 3. 产物结构与缓存（Q105-B 定案）

```
servers/gateway/public/static/modules/
  admin/                          ← 应用 key
    dev/                          ← envId 目录
      index.js                    ← 入口指针（no-cache）：指向当前版本
      index.css                   ← 入口样式（no-cache）
      d4e5f6/                     ← 版本目录（immutable）
        index.js  index.css  assets/*-<hash>.js
      7c1e9a/                     ← 历史版本（保留 5 版 / 7 天）
        ...
    prod/
      index.js  <version>/ ...
  shell/                          ← 基座：不走 envId 目录（Q107，按站点 + 版本）
```

| 关切 | 结论 |
|---|---|
| 缓存 | `index.js` / `index.css` 固定名 → `no-cache`；`<version>/assets/*` 带 hash → `immutable` |
| 发布 | 产物写入 `envId/<version>/`，随后**改写 `envId/index.js` 指针**指向新版本 |
| 切换版本 / 回滚 | **只改写指针**（不重新构建、不删旧版本），用户刷新即生效 |
| 为什么不会 404 | 旧版本目录仍在（保留策略）→ 正在运行旧版本的浏览器其分包仍可命中（R1 对策） |
| manifest 是否受影响 | **不受影响**：manifest 里给的是 `/<key>/<envId>/index.js`（不含版本），切换版本不必改 manifest，绕开 60s 缓存（R5 对策） |
| 保留策略 | 每个 `envId` 保留最近 **5 个版本**且不超过 **7 天**，超出由发布收尾阶段清理（Q112） |

> ⚠️ 技术方案须验证的一个点：入口指针 `index.js` 的具体写法（`export * from '<version>/index.js'` / SystemJS 等价写法 / nginx 内部重写三选一），需与 `packages/shell-loader` 的加载协议对齐。**这是实现前必须定稿的技术细节。**

---

## 4. 接口契约（REST）

> **前缀约定（2026-09-18 实现对齐）**：沿用 deploy-console 既有约定 —— 全局前缀 `api` + 资源名，
> 即 `/api/apps`、`/api/envs`（**不是** `/api/dc/apps`；console 前端 baseURL 为 `/console/api`）。
> 列表统一 `{ items, total, page, pageSize }`。✅ = 已在 P1 实现并验证。

### 4.1 基础设施 / 环境

| 方法 | 路径 | 说明 | 状态 |
|---|---|---|---|
| GET | `/api/envs/sites` | 站点列表（local/dev/prod） | ✅ |
| GET | `/api/envs?siteKey=&q=&page=&pageSize=` | 环境列表（筛选 / 搜索 / 分页，FR-3.1） | ✅ |
| POST | `/api/envs` | 新建（**envId 由服务端自增**，只收 name + siteKey） | ✅ |
| GET/PUT/DELETE | `/api/envs/:envId` | 详情 / 更新（名称/排序/启用）/ 删除（有部署记录时拒绝） | ✅ |
| GET | `/api/envs/resolve?envId=` | 运行时解析（**查不到回退 dev**） | ✅ |
| GET | `/api/envs/:envId/service-routes` | 该环境的**后端服务指向**列表（含未配置项占位） | ✅ |
| PUT | `/api/envs/:envId/service-routes/:serviceKey` | 改某服务的指向（host/port/upstreamUrl/runtime），主机必填 | ✅ |
| POST | `/api/envs/switch-log` | 环境切换审计上报（不阻断切换） | ✅ |
| GET/POST/PUT/DELETE | `/api/hosts` `/api/hosts/:id` | 主机管理 | 待 P2/P4 |
| GET | `/api/targets?q=` | 跨域目标搜索（流水线用，返回 `targetRef`） | ✅ P0 |

### 4.2 微前端域

| 方法 | 路径 | 说明 | 状态 |
|---|---|---|---|
| GET | `/api/apps?kind=&q=&parentKey=&page=` | 应用列表（含各环境版本概览） | ✅ |
| GET | `/api/apps/meta` | 类型 / 部署模式枚举 | ✅ |
| POST | `/api/apps` | 新建（key 唯一且创建后不可改，FR-1.3） | ✅ |
| GET/PUT/DELETE | `/api/apps/:key` | 详情 / 更新（不含 key）/ 软删（返回仍在生效的环境） | ✅ |
| GET/POST | `/api/apps/:key/routes` | 挂载路由（跨应用同路径冲突阻断，FR-2.2） | ✅ |
| PUT/DELETE | `/api/apps/:key/routes/:id` | 改 / 删挂载路由（只改配置不发布，FR-2.3） | ✅ |
| GET | `/api/apps/:key/envs` | 环境 × 版本矩阵（含磁盘指针与可用版本） | ✅ |
| GET | `/api/apps/:key/versions?envId=` | 该环境的可选版本列表（供弹窗选择，FR-4.2） | ✅ |
| POST | `/api/apps/:key/publish` | `{ envId, version }` 投递并激活：写 `<key>/<envId>/<version>/` + 改指针 | ✅ |
| POST | `/api/apps/:key/switch` | `{ envId, version }` 切换版本（**只改指针、不重建**） | ✅ |
| POST | `/api/apps/:key/rollback` | `{ envId, version? }` 回滚（默认 previousVersion） | ✅ |
| POST | `/api/apps/:key/deploy` | `{ envId }` 触发流水线 | **未实现**（2026-09-21 核对：应用域用 `switch`/`rollback`；发起构建发布走 `POST /pipelines`） |

> 实现说明（2026-09-18）：`publish` 的产物源目录由 `apps/<repoDir>/dist` **推导**，
> 不接受调用方传路径（避免任意目录拷贝）。流水线接线后由流水线调用同一「落盘 + 激活」原语。

### 4.3 API 网关域

| 方法 | 路径 | 说明 | 状态 |
|---|---|---|---|
| GET/POST | `/api/services` | 服务列表（含接口数/路由数/已配环境）/ 新建 | ✅ |
| GET | `/api/services/meta` | 类型 / 方法 / 鉴权模式枚举 | ✅ |
| GET/PUT/DELETE | `/api/services/:key` | 详情 / 更新（不含 key）/ 软删（仍被环境指向时阻断） | ✅ |
| GET | `/api/services/:key/envs` | 各环境运行时与主机（**只读**，编辑在环境详情） | ✅ |
| GET/POST/PUT/DELETE | `/api/services/:key/routes` | 转发规则（同前缀冲突阻断；前缀包含返回 warnings） | ✅ |
| GET/POST/PUT/DELETE | `/api/services/:key/endpoints` | 接口清单（方法/关键字/废弃筛选 + 分页） | ✅ |
| POST | `/api/services/:key/endpoints/import` | 批量导入（UPSERT，只补空字段） | ✅ |
| POST | `/api/services/:key/health` | 手动探活（未配置主机时明确报错） | ✅ |
| GET | `/api/services/:key/deployments` | 部署记录 | **不做**（2026-09-21：控制台无独立「部署记录」屏） |
| POST | `/api/services/:key/deploy` | `{ envId }` | **已移除**（部署并入流水线 restart/verify；服务详情「环境与发布」= 只读指向 + 构建发布/配置指向/探活） |

### 4.4 gateway 内部契约

| 方法 | 路径 | 说明 | 状态 |
|---|---|---|---|
| GET | `/__manifest__` | 按 `Host` 匹配站点，返回下图结构（FR-10.1） | 待 P3（改 `envs/byEnv`） |
| ALL | `/api/*` | 优先按 `deploy_service_routes`（env + priority）转发，未命中回落硬编码（FR-10.2） | ✅ P2（`GATEWAY_DB_ROUTES=1` 开启） |
| POST | `/api/internal/gateway/reload` | 手动刷新缓存（service_key 鉴权，FR-10.3） | ✅ P2 |

> **P2 实现要点**（2026-09-18）：接入点是 `ProxyController` 的**既有最终 404 分支**
> （`@All(':path(*)')` → `DynamicRouteService.tryHandle`），因此不新增 catch-all、无需关心路由注册顺序，
> 且 `GATEWAY_DB_ROUTES≠1` 时行为与改造前**逐字节一致**。
> 环境由请求头 **`x-env-id`** 决定（Host → 站点默认环境兜底，最后回退 `dev`）；
> 上游按 `deploy_service_envs` 的指向解析，**未配置即 fail-fast，禁止回落本机**。
> 代码：`servers/gateway/src/dynamic-route/`（`route-match.ts` 为纯函数，18 条单测锁定语义）。

```jsonc
// GET /__manifest__
{
  "site": "dev",
  "defaultEnv": "dev",
  "switchable": true,
  "envs": [{ "id": "dev", "name": "主开发环境" }, { "id": "1", "name": "联调环境" }],
  "byEnv": {
    "dev": { "admin": "/static/modules/admin/dev/index.js", "portal": "/static/modules/portal/dev/index.js" },
    "1":   { "admin": "/static/modules/admin/1/index.js",   "portal": "/static/modules/portal/1/index.js" }
  },
  // 兼容期保留旧字段（env / modules），供未升级客户端回落
  "env": "dev",
  "modules": [ /* 旧结构 */ ]
}
```

---

## 5. 运行时链路（端到端）

```
① 发布：工作区 commit → 流水线 build → 产物写 envId/<version>/ → 改写 envId/index.js 指针
                → 更新 deploy_app_env_versions.currentVersion（+ previousVersion）
② 加载：用户访问 dev.kedouai.com/admin
        → gateway 按 Host 匹配 site=dev → __manifest__ 返回 envs/byEnv
        → shell 读 localStorage['kedou.env']（缺省 defaultEnv，查不到回退 dev）
        → System.import('/static/modules/admin/dev/index.js')（指针 → 当前版本）
③ 切换环境：点挂件选 envId=1 → 写 localStorage → location.reload()
        → 重新走 ②，加载 /static/modules/admin/1/index.js，后端指向也切到 env 1 的配置
④ 切换版本：应用详情「切换版本」选目标版本 → 改写 envId/index.js 指针 → 用户刷新即生效
⑤ 改后端指向：环境详情 → 后端服务指向 → 改写 deploy_service_envs → 网关缓存 ≤60s 生效
```

---

## 6. 部署双策略（保持 v1 结论）

```ts
interface DeployStrategy {
  domain: 'app' | 'svc';
  shouldSkipStage(stage: PipelineStage): boolean;
  buildEnvVars(ctx): Record<string, string>;
  resolveCwd(ctx): string;
  upload(ctx): Promise<void>;
  activate(ctx): Promise<void>;   // app: 改指针 / svc: 重启
  verify(ctx): Promise<HealthResult>;
  cleanup(ctx): Promise<void>;    // 版本保留清理也在此
}
```

| 域 | 动作链 | 硬约束 |
|---|---|---|
| **应用** | 构建 → 上传 `envId/<version>/` → 改指针 → 校验产物可访问 | 永不触碰 pm2（FR-4.3） |
| **服务** | 构建 → 上传 → pm2/docker 重启 → 探活 → 网关上游就绪 | 永不写 `deploy_app_env_versions`（FR-8.3） |
| **shell 特例** | 走 `deployMode=site-version`：产物按站点 + 版本目录（不做 env 切换） | Q107 |
| **deploy-console 特例** | `deployChannel=legacy`：走传统发布脚本 | G6 |

`TargetResolver`（流水线适配，v1 结论保留）：`app:<key>` / `svc:<key>`，历史无前缀值按「先 apps 后 services」解析（FR-9.2）。

---

## 7. 迁移方案（重写，去 slot）

脚本：`scripts/migrations/p10-deploy-console-domain-split.mjs`（幂等）

| 步骤 | 内容 | 回退 |
|---|---|---|
| M1 | 建新表（`deploy_sites`/`deploy_envs`/`deploy_apps`/`deploy_app_routes`/`deploy_app_env_versions`/`deploy_services`/`deploy_service_routes`/`deploy_endpoints`/`deploy_service_envs`/`deploy_hosts`） | DROP 新表 |
| M2 | 站点种子：`local`/`dev`/`prod` + `switchable`（dev/local=true，prod=false） | — |
| M3 | 环境种子：内置 `dev`(主开发，defaultEnvId)/`local`/`prod`(isProd)，均标记 builtin | — |
| M4 | `scripts/modules.json` + 旧 `deploy_modules` → `deploy_apps`（前端类型）/ `deploy_services`（backend） | 仅删新表数据 |
| M5 | 旧 `deploy_deployments`（envId ∈ local/dev/prod）→ `deploy_app_env_versions`，**envId 原样平移**（Q109） | 保留旧表 |
| M6 | 旧 `deploy_env_service_routes` → `deploy_service_envs`（去 slot，envId 原样） | 保留旧表 |
| M7 | 产物目录迁移：旧 `/modules/<key>/<version>/` → `/<key>/<envId>/<version>/` + 生成 `envId/index.js` 指针 | 目录并存 |
| M8 | gateway 切新读取源（`DEPLOY_LEGACY_READ=1` 时双读并优先旧表） | 关闭开关 |
| M9 | 观察一个发布周期后 DROP 旧表（`deploy_modules`/`deploy_deployments`/`deploy_env_service_routes`/`deploy_servers`/`deploy_environments`） | 见 git |

---

## 8. 风险与对策（逐条对应评审 R1–R8）

| # | 对策（本文档已落位处） |
|---|---|
| R1 | §3 产物结构：**版本目录保留**，入口指针固定 → 旧版本分包不删，不 404 |
| R2 | §3：切换/回滚 = **只改指针**（不重建） |
| R3 | §5：环境切换（换目录）vs 切换版本（换指针）语义在 UI 文案上区分 |
| R4 | §1 不变量 1 + §4.4：**envId 同时决定产物与网关上游**（gateway 按 envId 解析 service 上游） |
| R5 | §3 表格末行：manifest 不含版本 → 切换版本不受 manifest 缓存影响 |
| R6 | Q108：本期不做灰度叠加，列为后续（两者正交） |
| R7 | M8：`DEPLOY_LEGACY_READ` 双读开关 |
| R8 | 路径前缀 `/static/modules/` 不变 → nginx 无需改 |

---

## 9. 待确认（技术方案阶段需定稿的实现细节）

| # | 待定项 | 影响 |
|---|---|---|
| T1 | 入口指针 `index.js` 的实现方式（ESM re-export / SystemJS 等价 / nginx 内部重写） | 决定 §3 能否落地，需与 `shell-loader` 协议对齐 |
| T2 | 版本保留清理的执行位置（流水线 cleanup 阶段 vs 定时任务） | 影响磁盘与实现复杂度 |
| T3 | 环境切换审计事件的落地表（复用 `deploy_tasks` vs 新增 audit 事件） | Q110 的实现载体 |
| T4 | 网关按 envId 解析服务上游的缓存粒度（per env × service） | 影响热更新与性能 |

---

## 10. 关联文档

| 文档 | 关系 |
|---|---|
| `requirements.md` v1.1 | 需求与 EARS 判据（本文输入） |
| `review-01-requirements.md` | 第 1 轮评审与 Q101–Q112 确认来源 |
| `environment-design.md` | 环境模型设计过程记录（**结论已并入本文 §2.2 / §3**） |
| `page-spec.md` v1.3 | 页面规格（与已落地原型一致） |
| `specs/pipeline-node-model/design.md` | 流水线节点模型（本文只加 targetRef 解析，不改其模型） |
| `docs/architecture/static-artifact-cache-and-retention.md` | 静态产物缓存与保留策略（本文 §3 与其对齐） |

---

## 变更日志

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-17 | v1.0 | 初稿（方案 B：双域分家 + 数据模型 + 接口契约 + 双策略 + 迁移） |
| 2026-09-18 | **v2** | 按第 1 轮评审确认重写：**废弃 slot 模型**（环境改为并列 envId）；新增 `deploy_sites`；版本指针改 `deploy_app_env_versions`；产物结构定案为 `envId/<version>/` + 入口指针（Q105-B）；manifest 改 `envs/byEnv`；服务指向入口归到环境详情；迁移计划重写；补 R1–R8 对策与 T1–T4 待定项 |
