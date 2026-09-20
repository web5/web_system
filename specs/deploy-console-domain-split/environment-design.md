# 设计稿 · 微前端环境模型与切换机制（envId 作为目录）

> ⚠️ **本文结论已并入 `design.md` v2（§2.2 / §3）**，本档降级为**设计过程记录**，不再作为事实源；实现以 `design.md` v2 + `tech-design.md` 为准。
> 状态：**已并入 design v2**（2026-09-18）
> 背景：上一版把「环境」设计成基础设施通用环境（`deploy_environments` + `deploy_env_slots`）是**理解偏差**。本文按用户澄清重做：环境属于**微前端域**，是"用户可选择、微前端据此加载不同 js 目录"的加载维度。
> 关联代码：`servers/gateway/src/deploy-version/version.controller.ts`、`index-html.service.ts`、`apps/shell/src/main.ts`、`packages/shell-loader/src/loader.ts`、`servers/deploy-console/src/pipeline/steps/upload.executor.ts`、`release-paths.ts`

---

## 0. 理解复述（先对齐，错了我立刻改）

1. **环境管理是微前端域的二级菜单**（与「应用管理」并列），不是基础设施概念。
2. **环境 = 微前端加载维度**：用户在一个"环境"下，微前端框架加载该环境目录里的 js 文件。
3. **prod 只有一个环境；dev 可以有多个环境**（dev1 / dev2 / …）。
4. **切换方式**：dev 域名下的产品页面上有一个"插件"（环境切换器），用户点它选环境 → 回到页面 → 微前端按选中环境加载对应 js。
5. **目录约定**：不同环境的 js 以「环境 id（envId）作为目录」区分。

一句话：**把现在的 `DEPLOY_ENV_ID` 进程级单一环境，升级为「站点 + 多环境 + 页面可切换」，产物路径从 `/<key>/<version>/` 改为 `/<key>/<envId>/`。**

---

## 1. 现状链路 vs 目标链路

```
【现状】
gateway 读 DEPLOY_ENV_ID(单值, dev)
   → __manifest__ 查 deploy_deployments(envId,moduleKey) 取 version
   → 注入 window.__MODULES_MANIFEST__ = { env, modules:[{key,entry:/static/modules/<key>/<version>/index.js}] }
   → shell System.import(entry)
   └ 无切换：换环境 = 重启 gateway 改环境变量

【目标】
gateway 读 Host header → 匹配站点(site)
   → __manifest__ 返回该站点的 { envs:[dev1,dev2,...], defaultEnv, switchable, byEnv:{dev1:{admin:entry},...} }
   → shell 读 localStorage['kedou.env'] || defaultEnv → 取 byEnv[envId] → System.import(/static/modules/<key>/<envId>/index.js)
   └ 切换插件(仅 switchable 站点) → 改 localStorage → reload
```

---

## 2. 数据模型（微前端域，替代上一版的 `deploy_environments` / `deploy_env_slots`）

### 2.1 `deploy_sites`（站点 / 入口域名）

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | varchar(32) **PK** | `local` / `dev` / `prod` |
| `host` | varchar(128) UNIQUE | 域名，如 `local.kedouai.com` / `dev.kedouai.com` / `portal.kedouai.com` |
| `name` | varchar(64) | 展示名 |
| `defaultEnvId` | varchar(64) | 该站点默认加载的环境 |
| `switchable` | bool default false | 是否在页面上显示"环境切换插件" |
| `enabled` | bool | |

> 站点回答了"用户访问哪个域名时，能在哪些环境之间切"。

### 2.2 `deploy_envs`（微前端环境，envId 作为唯一标识）

| 字段 | 类型 | 说明 |
|---|---|---|
| `envId` | varchar(64) **PK** | 环境标识 = 目录名。**内置保留字** `dev`/`prod`/`local`；**用户创建的环境为系统自增数字**（`1`/`2`/…，字符串形式） |
| `name` | varchar(64) | 展示名（用户填），如「开发环境 1」「联调环境」 |
| `siteKey` | varchar(32) | 归属站点（`dev` 站点的 `dev`/`1`/`2`…；`prod` 站点的 `prod`） |
| `isProd` | bool default false | 生产环境标记 |
| `builtin` | bool default false | 内置环境（dev/prod/local），不可删 |
| `sort` | int | 切换插件里的排序 |
| `createdAt` | datetime(6) | 创建时间 |
| `enabled` | bool | |

**envId 生成规则（Q1 确认）**：
- **内置**：`dev`（主开发环境，默认回退目标）、`prod`（生产，唯一）、`local`（本机）。
- **用户创建**：**不填 ID，系统自增数字**（取当前最大数字 envId + 1，字符串形式）；用户只填 `name` + 选择归属站点。
- **回退**：运行时传入的 envId 在 `deploy_envs` 中查不到时，**默认回退到 `dev`**。

**约束**：
- `isProd=true` 全局**至多一条**（部分唯一索引），落地"prod 只有一个环境"。
- 同一 `siteKey` 下 `envId` 唯一（一个站点下环境列表）。
- `envId` 作为目录名，须满足安全校验（数字或 `[a-z0-9_-]+`，禁止 `/` `..`）。

> 迁移映射：旧 `deploy_deployments.envId ∈ {local, dev, prod}` → 新内置环境 `local` / `dev` / `prod` 一一对应，历史 `dev` 数据不断链。

### 2.3 `deploy_app_env_versions`（应用 × 环境的当前版本指针，替代 `deploy_app_deployments` 的 env 维度）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `appKey` | varchar(64) | |
| `envId` | varchar(64) | FK → `deploy_envs.envId` |
| `currentVersion` | varchar(64) | git short sha（审计/回滚用，**不出现在 URL**） |
| `previousVersion` | varchar(64) NULL | 回滚目标 |
| `deployedAt` / `deployedBy` / `taskId` | | |

**UNIQUE(`appKey`, `envId`)**

> 与上一版 `deploy_app_deployments(appKey, envKey, slotKey)` 的关键区别：**去掉了 slot**。因为"并行实例（dev1/dev2）"在本模型里不是"同一环境的多套部署"，而是"**多个并列环境**"——每个 envId 本身就是一个独立的加载上下文，天然并行，无需 slot 概念。这是理解纠偏的核心。

---

## 3. 目录结构（envId 作为目录）

```
servers/gateway/public/static/modules/
  admin/
    dev1/
      index.js                 ← 固定入口，Cache-Control: no-cache
      index.css                ← 固定入口，no-cache
      assets/index-<hash>.js   ← 带 hash 分包，Cache-Control: immutable
    dev2/
      index.js  index.css  assets/...
    prod/
      index.js  index.css  assets/...
  portal/
    dev1/...  dev2/...  prod/...
  shell/                       ← 基座（见 §8 待确认 Q2，是否走 env 目录）
```

- **URL 不再带 `<version>`**：`/static/modules/admin/dev1/index.js`。
- **发布 = 覆盖式**：构建产物清空覆盖到 `/static/modules/<appKey>/<envId>/`；`index.js`/`index.css` 固定名 `no-cache`，所以发布后用户刷新即拿新产物；分包带 hash `immutable` 可长缓存（沿用 `docs/architecture/static-artifact-cache-and-retention.md`）。
- **切环境 = 换 URL 里的 `<envId>` 段**，无需重建、无需改 manifest 缓存。

---

## 4. gateway manifest 改造

`__manifest__`（由 `version.controller.ts` / `index-html.service.ts`）改造为按 **Host** 返回站点级配置：

```jsonc
// GET /__manifest__  （gateway 读 req.headers.host 匹配 deploy_sites）
{
  "site": "dev",
  "defaultEnv": "dev1",
  "switchable": true,
  "envs": [
    { "id": "dev1", "name": "开发环境 1" },
    { "id": "dev2", "name": "开发环境 2" }
  ],
  "byEnv": {
    "dev1": { "admin": "/static/modules/admin/dev1/index.js", "portal": "/static/modules/portal/dev1/index.js" },
    "dev2": { "admin": "/static/modules/admin/dev2/index.js", "portal": "/static/modules/portal/dev2/index.js" }
  }
}
```

注入 `window.__MODULES_MANIFEST__` 时保持兼容字段（`env`、`modules`），新增 `site/defaultEnv/switchable/envs/byEnv`。

> 版本号（git hash）不再进 URL，但可放在 manifest 的可选字段供调试（如每个 app 附带 `version`），或由 deploy 表查询。

---

## 5. shell 加载 + 环境切换插件

### 5.1 加载逻辑（`apps/shell/src/main.ts` 改造）

```ts
const m = window.__MODULES_MANIFEST__;
const picked = localStorage.getItem('kedou.env') || m.defaultEnv;
// 找不到该环境时回退主开发环境 dev（Q1）
const envId = m.byEnv?.[picked] ? picked : 'dev';
const entries = m.byEnv?.[envId] || {};
// 逐模块 System.import(entries[key])
```

- 当前选中 envId 持久化在 `localStorage['kedou.env']`（用户本机选择，刷新/下次访问保持）。

### 5.2 切换插件（仅 `switchable=true` 的站点渲染）

- **形态**：产品页右下角**常驻挂件**（轻量胶囊，显示当前 envId）→ 点击打开**大弹窗选择器**（详见 §5.2.1）。
- **行为（关键）**：点选某环境 → 写入 `localStorage['kedou.env']` → **`location.reload()` 整页重载** → 按新环境加载产物。
- **为什么必须整页重载（不是局部更新）**：环境切换改变的是**整套前端产物与接口上下文**（micro-app 代码、API 基址、可能的环境变量注入）。若只做局部更新，已挂载的 micro-app 仍是旧环境代码、页面数据来自旧环境接口，会出现**新旧混杂的不一致状态**。因此规定「**切换即整页重载**」，用一个明确的加载遮罩承接，避免用户以为页面卡死。
- **重载后**：仍停留在当前路由（URL 不变），只是按新 envId 重新拉取产物与数据。
- **安全**：`prod` 站点 `switchable=false`，不渲染挂件；只出现在 dev/local 站点（Q5：local 也支持多环境）。
- **权限（Q3）**：不做鉴权，有 console 权限的开发者均可切换。

#### 5.2.1 环境多（几十个）时的呈现 —— **大弹窗选择器**

> 结论（2026-09-18 用户确认）：**不用小下拉面板**（装不下、易误选）。点击挂件打开**大弹窗覆盖当前页面**（宽 680 / 最大高 620），空间足够容纳几十个环境 + 搜索 + 分组。

| 手段 | 说明 |
|---|---|
| **大弹窗覆盖** | 点挂件 → 居中大弹窗（遮罩 + 圆角 16），不跳路由、不打断当前页；点遮罩或关闭按钮退出 |
| **ID 前置** | 每行左侧固定列展示 `envId`（等宽字号 + 徽标底，当前项反白橙底），**名称在后** —— 避免不同环境重名导致选错 |
| **四列对齐** | `envId ｜ 名称 ｜ 站点 ｜ 当前`，列位固定，扫读快 |
| **搜索过滤** | 弹窗内搜索框，按 `envId` 或名称即时过滤（纯前端，无请求） |
| **常用置顶** | `deploy_envs.pin`（或本地"最近使用"）置顶为「常用」分区 |
| **分组标题吸顶** | 「常用」/「全部环境（N）」两组，组标题 `position: sticky` 吸顶 |
| **列表内滚动** | 仅列表区滚动（`flex:1`），弹窗整体高度恒定 |
| **计数与出口** | 底部「共 N 个环境」+「在控制台管理环境」链接 |
| **空结果** | 搜索无命中显示「没有匹配的环境」 |

> 不做的事：不做树形多级（环境是扁平列表）；不做虚拟滚动（几十项 DOM 足够，上百再评估）。
> 配套：`/environments` 管理页同样要支持 **搜索 + 按站点分段 + 分页（每页 20）**。
- **实现位置**：作为 shell 的一个轻量组件（`apps/shell/src/components/EnvSwitcher.vue`），由 manifest 的 `switchable + envs` 驱动渲染；`envs.length<=1` 时不显示。

### 5.3 与路由/挂载的关系

- 环境切换**只改变 js 产物来源**，不改变 shell 的路由挂载（`mountPath`/`activeRule` 与 env 无关）。
- 子模块内自己的路由（vue-router）按各自产物自带，不额外处理。

---

## 6. 发布 / 回滚 / 缓存

### 6.1 发布到环境

1. 用户选「应用 admin → 环境 dev2」发布。
2. 流水线 build → 产物覆盖到 `/static/modules/admin/dev2/`。
3. 更新 `deploy_app_env_versions(admin, dev2).currentVersion = <git sha>`，`previousVersion` 置旧值。
4. **无需**改 manifest（entry URL 不变），`index.js no-cache` 保证用户刷新即拿新产物。

### 6.2 回滚

- 从 artifact 存储（发布时保留的旧产物目录，见 `static-artifact-cache-and-retention.md` 的保留策略）取回 `<previousVersion>` 产物，覆盖回 `/static/modules/admin/dev2/`，更新指针。
- 或：保留「最近 N 个版本产物目录」在 `static/modules/admin/.rollback/<version>/`，回滚时覆盖。

### 6.3 缓存策略（沿用既有铁律）

| 文件 | 缓存头 | 说明 |
|---|---|---|
| `index.js` / `index.css` | `no-cache` | 固定名入口，发布即生效 |
| `assets/*-<hash>.js` / 图片 | `immutable` | 带 hash 分包，长缓存 |

---

## 7. 后端服务域的环境（不受本次影响，划清边界）

- 「环境管理」菜单归微前端域，只管微前端的加载环境。
- 后端服务（API 网关域）的"环境"是**服务部署环境**（host/port/运行时），继续放在**服务详情 → 环境 tab**里，不属于本菜单，也不与微前端 envId 混用（两个概念、两套数据）。

---

## 8. 待确认（全部已确认，2026-09-18）

| # | 结论 |
|---|---|
| Q1 | `dev` 保留为主开发环境；运行时传入 envId 找不到时默认回退 `dev`；**用户创建环境不填 ID，系统自增数字 envId** |
| Q2 | shell 基座**不走 env 目录**，与 gateway 交互直接加载对应 commit 版本，走通用逻辑 |
| Q3 | 环境切换**无需鉴权**，有 console 权限的开发者均可切换 |
| Q4 | 切换插件：dev 域名下**常驻、可折叠**小挂件 |
| Q5 | `local` 站点也支持多环境，方便 dev 多环境功能开发验证 |
| Q6 | 灰度适配后续再加 |

---

## 9. 影响面（改造清单）

| 层 | 改动 | 文件 |
|---|---|---|
| gateway | `__manifest__` 按 Host 出站点级 `envs/byEnv`；去掉进程级 env 单值依赖 | `version.controller.ts`、`index-html.service.ts` |
| shell | 按 `localStorage['kedou.env']` 选 env 加载；新增 EnvSwitcher 组件 | `apps/shell/src/main.ts`、新增 `EnvSwitcher.vue` |
| deploy-console | 新增 `deploy_sites` / `deploy_envs` 管理页（微前端域二级）；发布目标从 envId 列表选 | 新增 `EnvironmentManager`（微前端域）、`pipeline` 目标 env 列表数据源 |
| 产物路径 | `<key>/<version>/` → `<key>/<envId>/` | `upload.executor.ts`、`release-paths.ts`、`artifact-store.service.ts` |
| 版本指针 | `deploy_deployments` → `deploy_app_env_versions`（去掉 slot） | 新 Entity + 迁移 `p10-` |
| nginx/静态 | `/static/modules/` alias 不变，仅目录层级含义变 | `local.nginx.conf`（无需改，路径前缀相同） |

---

## 变更日志

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-18 | v1.0 | 初稿。按用户澄清重设计微前端环境模型：envId 作为目录、站点 + 多环境 + 页面切换插件、prod 唯一 dev 多实例 |
| 2026-09-18 | v1.1 | Q1–Q6 确认：envId 系统自增数字（内置 dev/prod/local 保留字）、找不到回退 dev、shell 不走 env 目录、无鉴权、常驻折叠挂件、local 多环境、灰度后续 |
