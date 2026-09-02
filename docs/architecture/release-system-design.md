# 多模块 + 多版本 + 多环境发布系统设计

> 状态：设计稿（待实施）
> 关联：`docs/architecture/micro-frontend-technical-design.md`（微前端加载与样式隔离）
> 代码基线：`7b61e3d`（gateway 灰度命中已实现并验证）

---

## 1. 现状梳理（基于代码事实）

### 1.1 数据模型（`web_system_deploy` 库）

| 表 | 作用 | 关键字段 |
|---|---|---|
| `deploy_environments` | 环境注册表（一等公民） | `id`(PK), `name`, `host`, `sshUser`, `sshKeyPath`, `remoteDir`, `publicUrl`, `ports`(json), `builtin` |
| `deploy_modules` | 模块注册表（可部署单元） | `key`(unique), `name`, `type`(backend/frontend/micro-frontend/mini-app), `dir`, `pm2`, `publicPath`, `buildCmd`(**已废弃**，见下表), `entry`, `entryUrl`, `externals`, `isShell`, `builtin`, `enabled` |
| `deploy_module_stage_commands` | 阶段命令（发布执行唯一真相源，2026-09-02 新增） | `module_key`+`stage`(unique), `command`, `enabled`, `timeout_sec`, `updated_by` |
| `deploy_versions` | 发布版本历史 | `env`, `component`, `versionTag`, `gitCommit`, `gitBranch`, `releasedBy`, `releasedAt`, `taskId`, `status`, `note` |
| `deploy_deployments` | 环境×模块 → 当前版本指针 | `envId`, `moduleKey`, `currentVersion`, `status`, `deployedAt`, `deployedBy`, `taskId` |
| `deploy_tasks` | 部署任务（SSE 推流 + 落库） | `id`, `type`(build/deploy/rollback), `env`, `component`, `tag`, `status`, `logs`(json), `error`, `operator` |
| `deploy_canary_rules` | 灰度规则 | `id`, `envId`, `moduleKey`, `canaryVersion`, `matchRule`(json), `enabled` |

### 1.2 发布链路（`servers/deploy-console/src/deploy/deploy.service.ts`）

| 入口 | 路径 | 说明 |
|---|---|---|
| `publishModule(env, moduleKey)` | 微前端专用：本地 `build-module.mjs` 构建 → `deploy.sh micro-frontend:<key>` SSH 上传 → 写 versions + deployments | 版本号 = git commit 短哈希 |
| `startDeploy(env, component)` | 通用：spawn `deploy.sh`，脚本内按模块类型分发 | 版本号 = `YYYYMMDD-HHMMSS-<commit>` |
| `startPublishVersion(env, versionTag)` | 指定版本秒切：只改 deployments 指针 | 不重新构建 |
| `startRollback(env, tag)` | 回滚：spawn `rollback.sh` | 快照式 |
| `startBuild(component)` | 本地构建：spawn `build-all.sh` | 不部署 |

### 1.3 网关版本解析（`servers/gateway/src/deploy-version/`）

- `IndexHtmlService.render('shell')` → `resolveModulesManifest(envId)`：
  1. 查 `deploy_modules`（`type = micro-frontend` 且 `enabled`）
  2. 对每个模块 `getCurrentVersion`（查 `deploy_deployments`，TTL 10s 缓存）
  3. `resolveCanary`（查 `deploy_canary_rules`，三种匹配：`user-list` / `percent` / `header`）
  4. 拼 manifest 注入 shell `index.html` 的 `<head>`
- 公开端点：`GET /__version__?module=<key>`、`GET /__manifest__`
- 环境来源：`DEPLOY_ENV_ID`（gateway `.env` 写死，当前 = `dev`）

### 1.4 产物目录

| 类型 | 目录 | 说明 |
|---|---|---|
| 微前端模块 | `static/modules/<key>/<version>/`（nginx 直出） | 正确，版本化 |
| 旧 frontend（shell） | `gateway public/shell/`（覆盖式） | 无版本化 |
| 旧 frontend（其他） | `gateway public/versions/<pub>/<tag>/` + `public/<pub>/` 兜底 | 冗余两套目录 |
| 后端 | 远端 `git reset --hard` + `tsc` + `pm2 restart` | git 发布模式 |

---

## 2. 现状问题清单

1. **版本号命名不一致**：`publishModule` 用纯 commit（`a1f5301`），`startDeploy` 用 `YYYYMMDD-HHMMSS-<commit>`。版本表 `versionTag` 两种格式混存，排序、追溯混乱。

2. **component 命名不一致**：`publishModule` 写 `deploy_versions.component = "mf:<moduleKey>"`，但 `deploy_deployments.moduleKey = "<moduleKey>"`（不带前缀）。`startDeploy`/`startPublishVersion` 又直接用 `moduleKey`。导致 `versions.component` 与 `deployments.moduleKey` **无法直接关联**。

3. **`deploy_deployments` 数据重复**：实测 dev 下 admin 有 4 条、portal 有 24 条重复记录（均 `a1f5301`）。`recordDeployment` 的 upsert 逻辑不健壮（`findOne` 匹配多条只更新一条），且**无唯一约束**。

4. **manifest `canary` 字段只支持单模块**：`canary: { module, version } | null`，多模块同时灰度时只记录第一个（虽然 `modules[].version` 已各自正确，但标记信息丢失）。

5. **构建在 deploy-console 运行时本地执行**：`publishModule` 里 `execSync(build-module.mjs)`，要求 deploy-console 与源码仓库同机，且**每个环境重复构建**（dev/prod 各构建一次），无法保证多环境产物一致性。

6. **shell 基座无版本化**：shell 走旧 `deploy_frontend`（覆盖式），不纳入 `static/modules` 版本体系，manifest 里也没有 shell 自身版本，无法版本化回滚。

7. **旧 frontend 产物目录冗余**：`public/versions/<pub>/<tag>/` 与 `public/<pub>/` 两套并存，与微前端的 `static/modules/` 三套目录并存，规范不统一。

8. **回滚机制割裂**：微前端是"指针秒切"，后端是"快照恢复"（`releases/<tag>/web_system.tar.gz` 全量打包），两种回滚模型并存未统一。

9. **环境与 gateway 强绑定**：一个 gateway 实例只服务一个环境（`DEPLOY_ENV_ID` 写死），多环境 = 多套 gateway。可行但缺乏统一的环境路由抽象。

10. **后端单机部署模型**：`deploy_environments.host` 只有单台服务器，`deploy.sh` 的 `SERVER` 是单变量，所有后端服务（serviceName）只能部署到同一台机器。无法支持「一个环境多台服务器、服务按 serverName 分布部署」的场景（如 gateway/auth 在 web 机器、ai-service 在 gpu 机器）。

---

## 3. 设计目标与原则

1. **版本是构建产物，不是环境动作**：一次构建产出一个不可变版本，多环境只做指针切换，不重复构建。
2. **唯一指针**：`deploy_deployments` 的 `(envId, moduleKey)` 唯一，是"某环境某模块当前版本"的唯一真相源。
3. **统一命名**：全链路（模块、版本、产物目录、API）用同一套 key / versionTag 约定。
4. **秒级切换与回滚**：前端/微前端模块发布、回滚、灰度均为指针/规则变更，无构建、无重启。
5. **环境是一等公民**：环境定义（连接信息、端口映射）集中在 `deploy_environments`，控制面（deploy-console）与数据面（gateway）通过环境 ID 关联。
6. **向后兼容**：分阶段实施，每阶段可独立上线，不破坏现有微前端加载与灰度能力。

---

## 4. 目标架构

### 4.1 核心概念

```
模块(Module)  ──构建──▶  版本(Version/产物)  ──指针──▶  环境(Environment)
  admin                    admin@a1f5301                dev → admin@a1f5301
  portal                   portal@b2c4d5e               prod → admin@a1f5301（同产物）
  gateway(后端)           ...                          staging → admin@c3d5e6f（不同产物）
```

- **模块**：`deploy_modules.key`，构建/部署的最小单元。
- **版本**：一次构建的产物标识 = `versionTag`，产物持久化在 `static/modules/<key>/<version>/`（前端）或 git commit（后端）。
- **环境**：`deploy_environments.id`，一组运行实例 + 一份版本指针集合。
- **服务器**（后端）：物理机，归属某个 serverName（服务器组）。
- **serverName**（服务器组）：一个逻辑组名，指向多台服务器（一对多，如 `dev-web` / `prod-gpu`）。
- **服务**（后端）：即 `deploy_modules.key`（serviceName）。
- **环境服务路由**：每个环境独立定义「服务名(serviceName) → serverName」的映射，是实现多环境指向的核心。
- **发布指针**：`deploy_deployments(envId, moduleKey) → currentVersion`，唯一（前端/微前端）。

### 4.2 版本号规范（统一）

```
versionTag = <gitCommit7>          # 前端/微前端：产物与 commit 一一对应
            └ 例：a1f5301
后端 tag  = <gitCommit7>          # 后端同理，以 commit 为版本
```

**决策**：统一废弃 `YYYYMMDD-HHMMSS-<commit>` 混合格式，所有模块（含后端）以 **git commit 短哈希** 为版本标识。
- 优点：不可变、可追溯、天然去重（同一 commit 只构建一次）、跨环境复用同一产物。
- 时间信息由 `deploy_versions.releasedAt` / `deploy_tasks.startTime` 提供，不再编码进 tag。
- 需要人工可读时，前端 UI 展示 `commit + releasedAt` 组合。

> 兼容：现有 `a1f5301` 格式的存量数据无需迁移；`startDeploy` 的旧格式停止新产生即可。

### 4.3 统一命名

- `deploy_versions.component` **统一 = `deploy_modules.key`**（废弃 `mf:` 前缀）。
- 后端模块的 `component` = `gateway` / `auth-service` / ...（与 modules.json key 一致）。
- 灰度规则 `moduleKey`、`deploy_deployments.moduleKey`、manifest `name` 全部对齐同一 key。

### 4.4 数据模型改造

#### 4.4.1 `deploy_deployments`（核心改造）

```sql
-- 唯一约束：一个环境一个模块只有一条当前版本指针
ALTER TABLE deploy_deployments ADD UNIQUE KEY uk_env_module (env_id, module_key);
-- 清理存量重复（保留 deployed_at 最新的一条）
```

配套：`recordDeployment` 改为 `upsert`（`ON DUPLICATE KEY UPDATE` 或先查后插的原子化），消除重复插入。

#### 4.4.2 `deploy_canary_rules`（灰度多模块化）

现有结构不变（`envId + moduleKey` 已支持多模块多条规则）。改造点在 **manifest 消费端**（见 §6）。

#### 4.4.3 新增 `deploy_versions` 的产物索引（可选）

前端模块的产物是否仍可加载，可用 `static/modules/<key>/<version>/manifest.json` 是否存在来判断，无需新增字段。若引入 COS/对象存储，再在 `deploy_modules.entryUrl` 扩展。

#### 4.4.4 新增服务器组与环境服务路由（后端多环境核心）

```sql
-- 服务器表：物理机，归属某个 serverName（组）
deploy_servers(
  id varchar(36) PK,
  server_name varchar(64),     -- 所属 serverName（组名，多台服务器共享同名）
  host varchar(128),           -- SSH 主机
  ssh_user varchar(64),
  ssh_key_path varchar(255),
  remote_dir varchar(255),     -- 该服务器部署根目录
  UNIQUE(server_name, host)
)

-- 环境服务路由：每个前端环境独立定义「服务名 → serverName」
deploy_env_service_routes(
  id varchar(36) PK,
  env_id varchar(32),          -- 前端环境（dev/prod/staging）
  service_name varchar(64),    -- 服务名 = deploy_modules.key
  server_name varchar(64),     -- 指向哪个服务器组（serverName）
  port int NULL,               -- 可选：该服务在目标组的端口（覆盖环境默认）
  UNIQUE(env_id, service_name)
)
```

语义：
- **serverName 是服务器组**：一个 serverName 指向多台服务器（`deploy_servers` 中同 `server_name` 的多行），实现多副本/负载均衡。
- **每个环境独立定义路由**：`deploy_env_service_routes(env, serviceName) → serverName`，不同环境可把同一服务指向不同服务器组。
- `deploy_environments` 的 `host/sshUser/sshKeyPath/remoteDir` 下沉到 `deploy_servers`；环境保留 `id/name/publicUrl`（`ports` 暂作环境级默认，路由层 `port` 可覆盖）。

### 4.5 产物目录规范（统一）

```
<named static root>/static/modules/
├── shell/<version>/            # 基座也版本化（改造）
│   ├── index.js
│   ├── index.css
│   └── manifest.json
├── portal/<version>/
├── admin/<version>/
└── ...（每个 micro-frontend / frontend 模块一个目录）
```

- **shell 纳入版本化**：shell 构建产物落 `static/modules/shell/<version>/`，与其它模块同构。nginx 对 `static/modules/` 配 `expires + immutable`（版本化内容可永久缓存）。
- **废弃**旧 `gateway public/versions/`、`public/<pub>/` 覆盖目录（过渡期保留，新发布不再写入）。
- 后端模块无静态产物，仍走 git 发布 + pm2。

---

## 5. 发布流程设计

### 5.1 构建与发布分离（核心演进）

**现状**：`publishModule` 在 deploy-console 运行时构建 + 上传（构建与发布耦合，每环境重复构建）。

**目标**：引入独立的"构建产物"环节，构建一次、多环境复用。

```
[构建]                    [分发/上传]              [发布(指针切换)]
build-module.mjs  ──▶  static/modules/<key>/   ──▶  deploy_deployments
(一次性，产出 commit     <commit>/                (env, key) → <commit>
 对应不可变产物)          上传到目标环境服务器        （秒级，无构建）
```

流程拆为两个原子动作：

1. **Build（构建）**：`POST /api/deploy/build { moduleKey }` → 本地构建 → 产出 `dist/` + `manifest.json`，版本 = 当前 commit。**构建只发生一次**（同一 commit 幂等，已构建则跳过）。
2. **Publish（发布）**：`POST /api/deploy/publish { env, moduleKey, versionTag }` → 将已有产物分发到目标环境 + 切换指针。

> 演进：`Build` 可迁移到 CI（GitHub Actions），产物上传对象存储/CDN；`Publish` 只改指针，彻底解耦构建机与目标环境。

### 5.2 微前端/前端模块发布（目标流程）

```
1. Build:   build-module.mjs <key> → dist/index.js + index.css + manifest.json（version=commit）
2. Upload:  dist → <env>.host:<static_root>/static/modules/<key>/<commit>/
3. Publish: upsert deploy_deployments(env, key).currentVersion = <commit>
4. 生效:    gateway versionCache TTL 10s 过期后，manifest 指向新版本（无需重启）
```

### 5.3 后端模块发布（按环境服务路由分发）

发布单元 = 服务（serviceName）。流程：

1. 查 `deploy_env_service_routes(env, serviceName)` → 得到 serverName（服务器组）。
2. 查 `deploy_servers(serverName)` → 该组下的多台服务器。
3. 对每台服务器，按连接信息执行 `deploy_backend_git`（git fetch + reset --hard + tsc + pm2 restart）。
4. 版本记录统一用 commit，`component` = key，并记录 `serverName`（新增字段或并入 note）。

无路由的服务，回退到环境默认服务器（兼容旧数据）。一个 serverName 下多台服务器时，逐台串行或并行执行（副本场景）。

### 5.4 指定版本发布（秒切）

`startPublishVersion` 保留，语义统一为：**只改指针**（前端）或**重新 checkout 对应 commit**（后端）。

### 5.5 回滚

- **前端/微前端**：回滚 = 指针切回历史版本（`startPublishVersion` 指向旧 tag），秒级。
- **后端**：回滚 = 远端 `git reset --hard <commit>` + 重启。
- 快照式（`releases/<tag>/web_system.tar.gz`）降级为**灾备兜底**，不再作为常规回滚主路径。

---

## 6. 灰度设计

### 6.1 manifest 结构（canary 数组化）

**现状**：`canary: { module, version } | null`

**目标**：

```jsonc
{
  "env": "dev",
  "modules": [
    { "name": "admin",  "version": "a1f5301", "entry": "...", "css": "...", "assetsBase": "...", "canary": false },
    { "name": "portal", "version": "b2c4d5e", "entry": "...", "css": "...", "assetsBase": "...", "canary": true  }
  ],
  "canary": [
    { "module": "portal", "version": "b2c4d5e" }
  ]
}
```

- `modules[].version` 已是"该请求命中的最终版本"（stable 或 canary），前端无需感知灰度，直接加载即可。
- `modules[].canary` + 顶层 `canary[]` 仅供**观测/调试/UI 展示**（如基座右下角"灰度中"标识）。
- 改造点：`IndexHtmlService.resolveModulesManifest` 的 `canary` 由单对象改为数组。

### 6.2 匹配规则（保留现有三种，扩展）

| 类型 | 语义 | 现有实现 |
|---|---|---|
| `user-list` | 指定用户列表命中 | ✅ |
| `percent` | 按 userId FNV-1a hash 比例命中 | ✅ |
| `header` | 指定 header 值命中 | ✅ |

**保留现有三种，不做额外扩展**（够用且已验证）。注意事项：

- `header` 匹配依赖 nginx 将目标 header 透传给 gateway（`resolveCanary` 读 `req.headers`）。需在 nginx 配置确认灰度专用 header（如 `x-canary`）未被丢弃。
- 灰度规则表 `deploy_canary_rules` 由 deploy-console `CanaryService` CRUD，gateway 只读镜像 entity（当前已是此架构，验证通过）。

### 6.3 灰度生命周期

```
创建规则(env, module, canaryVersion, matchRule) → 启用 → 部分流量命中 canary
    → 全量（percent=100 或删除规则，指针切到 canaryVersion 成为 stable）→ 完成
```

---

## 7. 多环境设计

### 7.1 后端多环境：serverName（服务器组）＋ 环境服务路由

**现状**：`deploy_environments` 只有单 `host`，`deploy.sh` 的 `SERVER` 是单变量——一个环境一台服务器，所有后端服务部署其上。

**目标**：引入「serverName 服务器组」概念——一个 serverName 指向多台服务器；每个环境独立定义「服务名 → serverName」的路由，实现多环境指向。

```
serverName（服务器组，指向多台服务器）
  dev-web  ──▶ 服务器A (host=175.x.x.1)
           └─▶ 服务器B (host=175.x.x.2)     # 多副本
  dev-gpu  ──▶ 服务器C (host=175.x.x.3)
  prod-web ──▶ 服务器D / 服务器E
  prod-gpu ──▶ 服务器F

每个前端环境（env）独立定义「服务名 → serverName」：
  dev  环境：  gateway      → dev-web
              ai-service   → dev-gpu
              auth-service → dev-web
  prod 环境：  gateway      → prod-web
              ai-service   → prod-gpu
              auth-service → prod-web
```

- **serverName 是分组**：一个 serverName 对应多台服务器（多副本/负载均衡），发布时逐台分发。
- **每个环境独立定义路由**：`deploy_env_service_routes(env, serviceName) → serverName`，同一服务在不同环境可指向不同服务器组。
- **端口**：跟随「服务在服务器组上的实例」。过渡期沿用 `deploy_environments.ports` 作环境级默认，路由层 `port` 可覆盖。

### 7.2 数据模型（服务器组维度，见 §4.4.4）

三层关系：**环境(env) × 服务(serviceName) → serverName（服务器组） → 多台服务器(server)**。`deploy_env_service_routes` 是「环境服务路由」真相源，`deploy_servers` 是「serverName → 服务器」真相源。

### 7.3 前端/微前端的环境路由

- **控制面**：`deploy_environments` 表定义环境（publicUrl、默认端口映射）。
- **数据面**：每个环境部署独立 gateway 实例，`.env` 的 `DEPLOY_ENV_ID` 指定环境，gateway 据此查 `deploy_deployments`。
- **关联**：两者通过环境 ID（`dev`/`prod`/`staging`）对齐。

**方案 A（推荐，当前即此）**：一环境一 gateway 实例。

```
dev.kedouai.com    ──nginx──▶ gateway(dev)   .env DEPLOY_ENV_ID=dev
portal.kedouai.com ──nginx──▶ gateway(prod)  .env DEPLOY_ENV_ID=prod
```

- 优点：环境彻底隔离、故障域独立、实现简单。
- 缺点：每环境一套 gateway 进程。

**方案 B（演进）**：单 gateway 多环境，按 Host 路由。

```ts
// gateway 读 req.headers.host → 映射 envId（配置表或环境变量）
const envId = hostEnvMap[req.headers.host] || 'dev';
```

- 优点：少一套进程；缺点：环境间共享进程、隔离性弱、灰度规则/缓存需按 env 分片。

**决策**：保留方案 A；在 gateway 内部把 `envId` 从"读配置"抽象为 `resolveEnv(req)` 方法（默认读 `DEPLOY_ENV_ID`），为将来方案 B 预留接口。

### 7.4 环境与产物

- 产物目录 `static/modules/<key>/<version>/` 在同一服务器的各环境间**共享**（版本化内容幂等）。多服务器环境（dev/prod 不同主机）各自独立上传同一版本产物。
- 同一 commit 的产物可在 dev/prod 间复用，保证"dev 验证的版本 = prod 上线的版本"。
- 后端无静态产物，环境隔离靠「各环境独立服务器 + 独立 pm2 进程 + 独立 .env」，与前端产物体系解耦。

---

## 8. API 设计（deploy-console）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/deploy/build` | `{ moduleKey }` → 构建产物，返回 `{ versionTag, manifest }` |
| POST | `/api/deploy/publish` | `{ env, moduleKey, versionTag }` → 分发 + 指针切换 |
| POST | `/api/deploy/deploy` | `{ env, moduleKey }` → 构建 + 发布（快捷，等价 build+publish） |
| POST | `/api/deploy/publish-version` | `{ env, versionTag }` → 指定版本秒切（保留） |
| POST | `/api/deploy/rollback` | `{ env, moduleKey, versionTag }` → 指针回滚 |
| GET | `/api/deploy/versions` | `?env=&moduleKey=` → 版本历史 |
| GET | `/api/deploy/current` | `?env=` → 各模块当前版本 |
| GET | `/api/deploy/tasks/:id/events` | SSE 任务进度（保留） |
| GET | `/api/modules` | 模块注册表 CRUD（保留） |
| GET | `/api/environments` | 环境 CRUD（保留） |
| GET | `/api/servers` | 服务器 CRUD（`?serverName=`，新增） |
| GET | `/api/env-service-routes` | 环境服务路由 CRUD（`?env=`，新增） |
| GET | `/api/canary/rules` | 灰度规则 CRUD（保留） |

---

## 9. 分阶段实施计划

### P0：数据一致性与命名统一（低风险，先做）

1. `deploy_deployments` 加 `UNIQUE(env_id, module_key)`，清理存量重复。
2. `recordDeployment` 改原子 upsert。
3. `deploy_versions.component` 统一为 `moduleKey`（去掉 `mf:` 前缀），存量数据 `UPDATE ... SET component = REPLACE(component, 'mf:', '')`。
4. 版本号统一为 commit 短哈希（`publishModule` 保持不变，`startDeploy` 停用混合格式）。

### P1：后端 serverName 服务器组 + 环境服务路由（结构改，新增）

5. 新增 `deploy_servers`（server_name 分组）表 + `deploy_env_service_routes`（环境服务路由）表；数据迁移：现有环境单 `host` 转为一条默认 serverName + 该环境各服务的默认路由。
6. `deploy_environments` 的 `host/sshUser/sshKeyPath/remoteDir` 下沉到 `deploy_servers`；环境表保留 `id/name/publicUrl/ports`。
7. `deploy.sh` 后端部署（`deploy_backend_git`）改造：`SERVER` 单变量 → 按「环境服务路由」解析 serverName → 遍历该组服务器逐台分发。
8. 端口映射/监控适配多服务器（`environment.ports` 作默认，路由层 `port` 可覆盖）。

### P2：manifest 灰度数组化 + 环境抽象（小改）

9. `resolveModulesManifest` 的 `canary` 单对象 → 数组；`modules[]` 增加 `canary` 布尔。
10. gateway `resolveEnv(req)` 方法抽象（默认读 `DEPLOY_ENV_ID`）。

### P3：构建与发布分离 + shell 版本化（结构改）

11. 拆 `build` 与 `publish` 两个 API/流程，构建幂等（同 commit 跳过）。
12. shell 纳入 `static/modules/shell/<version>/` 版本化，manifest 增加 shell 版本信息。
13. 废弃旧 `public/versions/`、`public/<pub>/` 覆盖目录（新发布不再写入，存量保留）。

### P4：CI 化 + 对象存储（演进，可选）

14. 构建迁移到 CI，产物上传对象存储/CDN，`publish` 纯指针切换。
15. 灰度规则 UI 完善（多模块、百分比可视化）。

---

## 10. 风险与兼容

- **存量数据兼容**：P0 的命名统一需对 `deploy_versions.component` 做一次性数据迁移；`versionTag` 存量两种格式共存（新旧发布不冲突）。
- **`deploy_deployments` 去重**：加唯一约束前必须先清理重复行，否则 `ALTER` 失败。清理策略：按 `(env_id, module_key)` 分组保留 `deployed_at` 最新。
- **构建位置迁移**：P2 把构建从 deploy-console 剥离后，deploy-console 不再要求与源码同机，但需保证构建机有完整 node_modules（pnpm）。
- **nginx 产物缓存**：`static/modules/` 若配 `immutable`，同一 commit 重复上传覆盖时客户端可能读到旧缓存。因版本 = commit 不可变，正常不会覆盖；异常重传需用新 commit。
- **灰度 header 透传**：`header` 匹配依赖 nginx 透传自定义 header，实施 P1 时需核对 nginx 配置。
- **后端多服务器迁移**：`deploy_environments.host` 下沉到 `deploy_servers` 需做数据迁移（现有环境 host 转为一条默认 serverName 组 + 该环境各服务的默认路由），否则 `deploy.sh` 找不到部署目标。迁移脚本需幂等，且迁移前确认无正在进行的部署任务。

---

## 附录：关键文件索引

| 模块 | 路径 |
|---|---|
| 部署服务（发布/回滚/版本） | `servers/deploy-console/src/deploy/deploy.service.ts` |
| 模块注册表 | `servers/deploy-console/src/module-registry/module-registry.service.ts` |
| 灰度规则（控制面） | `servers/deploy-console/src/canary/canary.service.ts` |
| 环境管理 | `servers/deploy-console/src/environment/environment.service.ts` |
| 网关版本解析 + 灰度（数据面） | `servers/gateway/src/deploy-version/index-html.service.ts` |
| 网关版本端点 | `servers/gateway/src/deploy-version/version.controller.ts` |
| 部署脚本 | `scripts/deploy.sh` / `rollback.sh` / `build-module.mjs` |
| 模块清单（种子） | `scripts/modules.json` |
| 网关 DataSource（注册 deploy 实体） | `servers/gateway/src/app.module.ts` |
