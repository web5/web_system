# 技术方案 · deploy-console 双域重构（微前端 / API 网关）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 状态：**待评审**（2026-09-18）
> 上游：`requirements.md` v1.1（需求·EARS） / `design.md` v2（模型·契约） / `page-spec.md` v1.3（页面） / `review-01-requirements.md`（Q101–Q112 确认）
> 本文定位：**实现方案**（改哪些文件、关键算法、分期与验收），模型与契约以 `design.md` v2 为准，不重复
> 评审方式：按 §1 影响面 + §2 关键技术决策 + §6 分期验收 三层过

---

## 0. 方案摘要

| 项 | 内容 |
|---|---|
| 改造性质 | 增量重构（保留流水线，改造注册/环境/部署三处） |
| 核心变更 | ① 环境模型换代（site + envId）② 产物改 `envId/<version>/` + 入口指针 ③ 部署执行按域分双策略 ④ gateway 按 Host + envId 解析 |
| 新增表 | 10 张（见 design v2 §2） |
| 退役表 | 5 张（`deploy_modules` / `deploy_deployments` / `deploy_env_service_routes` / `deploy_servers` / `deploy_environments`） |
| 改造服务 | `deploy-console`（主）、`gateway`（运行时） |
| 改造应用 | `shell`（挂件 + 加载）、`admin`（挂件兜底）、`portal`（同 admin） |
| 前端已就绪 | console 6 个页面 + 共享 `EnvSwitcher` + 顶部一级/左侧二级框架（原型即代码） |
| 分期 | P0 模型 → P1 微前端域 → P2 网关域 → P3 双策略与流水线接线 → P4 迁移与退役 |
| 最大技术不确定点 | **T1 入口指针实现**（见 §2.1），需先做 30 分钟可行性验证 |

---

## 1. 影响面清单（评审重点：范围是否可接受）

### 1.1 后端 `servers/deploy-console`（主战场）

| 模块 | 改造 | 说明 |
|---|---|---|
| `src/entities/*` | **新增 10 个 Entity** + 删除 5 个（`deploy-module` / `deploy-deployment` / `deploy-env-service-route` / `deploy-server` / `deploy-environment`） | 按 design v2 §2 |
| `src/environment/*` | **重写**：环境 CRUD（envId 自增 + 全局回退 `dev` + prod 唯一 + 目录名校验）+ 站点 | 新增 `site` 模块 |
| `src/app/*`（新） | 应用 CRUD + 挂载路由 + 版本指针 | 从原 module 模块拆分 |
| `src/service/*`（新） | 服务 CRUD + 网关路由 + 接口 + 探活 | 从原 module 模块拆分 |
| `src/env-service-route/*` | 改为「环境详情 → 后端服务指向」的读写 | 复用 `deploy_service_envs` |
| `src/pipeline/*` | ① `TargetResolver` 接入 ② 阶段 skip 由策略决定 ③ upload/pointer 阶段改为 `envId/<version>/` + 写指针 ④ cleanup 加版本保留 | **流水线表结构不动** |
| `src/deploy/*` | 28 处 `type` 分支收敛为「按 domain 分派」 | 逐个清单见原 design v1 §1.4（已并入本文 §3.1） |
| `src/registry/*` | `setPointer` 改为写 `deploy_app_env_versions` | |

### 1.2 后端 `servers/gateway`

| 模块 | 改造 |
|---|---|
| `deploy-version/version.controller.ts` | `__manifest__` 按 `Host` 匹配站点，返回 `{site,defaultEnv,switchable,envs,byEnv}`（保留旧字段兼容） |
| `deploy-version/index-html.service.ts` | 注入新 manifest；env 解析改为「Host → site → defaultEnv」 |
| `proxy/*` | 转发规则优先读 `deploy_service_routes`（env + priority）；上游按 envId 解析 `deploy_service_envs`；未命中回落硬编码 |
| 缓存 | manifest 与路由各自 TTL 缓存（≤60s）+ `/api/internal/gateway/reload` |
| 开关 | `DEPLOY_LEGACY_READ=1` 时双读并优先旧表 |

### 1.3 前端

| 应用 | 改造 |
|---|---|
| `packages/ui/src/components/EnvSwitcher.vue` | **已实现**；待接真实 `envs`（去掉 dev 兜底）+ 切换时上报审计事件 |
| `apps/shell` | `main.ts` 按 `localStorage['kedou.env'] → defaultEnv → dev` 解析并加载 `byEnv[envId]`；挂件已挂 |
| `apps/admin` / `apps/portal` | 仅挂载点（已实现 `v-if="!inShell"`）；把 mock 数据换成真实 API |
| `apps/deploy-console` | 6 个页面已就绪，替换 mock：`EnvironmentManager/Detail`、`AppManager/Detail`、`ServiceManager/Detail` |

### 1.4 脚本 / 静态

| 项 | 改造 |
|---|---|
| `scripts/migrations/p10-deploy-console-domain-split.mjs` | 新增（M1–M9） |
| 产物目录搬迁脚本 | 新增（旧 `<key>/<version>/` → `<key>/<envId>/<version>/` + 生成指针） |
| nginx | **无需改**（`/static/modules/` 前缀不变） |
| `ecosystem.config.cjs` | 新增 `DEPLOY_LEGACY_READ`（迁移期） |

**影响面结论**：`deploy-console` 是重写级改动，`gateway` 是模块级改动，前端已基本就绪。流水线 UI 与表结构不动（G6/NFR-6）。

---

## 2. 关键技术决策（评审重点：请逐条确认）

### 2.1 T1 · 入口指针 `index.js` 的实现方式 ★ 最高优先级

需求（design v2 §3）：`/<key>/<envId>/index.js` 为固定入口（`no-cache`），指向当前版本目录；切换版本只改指针。

| 候选 | 写法 | 优点 | 风险 |
|---|---|---|---|
| **A（推荐）** | `export * from './<version>/index.js'` | 一行、零构建、ESM 标准 | 需验证 shell-loader 在 SystemJS 下能拿到 lifecycle（`mount`/`unmount`） |
| B | 显式转发：`export const mount = (...a) => import('./<v>/index.js').then(m => m.mount(...a))` | 不依赖 re-export 语义 | 需枚举全部 lifecycle 导出名，耦合 loader 协议 |
| C | nginx 内部重写（指针落到 nginx 配置或符号链接） | 前端零感知 | 需 nginx 感知版本变化（reload 配置），运维复杂度高 |
| D（兜底） | manifest 直接给**版本化 entry**（不做指针），切换版本后靠 `?env=` 绕过缓存 | 实现最简单 | 偏离 Q105-B 决策；manifest 缓存需更短 TTL |

**P0 验证结论**：

| 项 | 结果 |
|---|---|
| 指针语法 | ❌ 原生 ESM 的 `export * from` 在 **SystemJS 解析阶段**即抛 `Unexpected token 'export'`，文件体不执行 |
| 连带影响 | loader 的 ③ `window.__MODULES__[name]` 全局兜底**同时失效**（指针没跑起来 → 产物未被加载），System / UMD 两条路径都失败，整模块白屏 |
| ESM 语义（本架构不适用，仅备查） | `export *` 不透传 `default`（实测输出 `default: undefined`） |
| 产物导出形态 | ✅ 现有产物（`apps/admin/src/lifecycle.ts`）**同时**提供命名导出与 `export default { bootstrap, mount, unmount }`（`preserveEntrySignatures: 'strict'` 保持开启） |

**定稿：写法 A′（System.register 版，命名导出 + default 双透传）**

```js
// 发布时生成：/<appKey>/<envId>/index.js
System.register(['./<version>/index.js'], function (_export) {
  'use strict';
  return {
    setters: [function (m) { _export(m); }],
    execute: function () {}
  };
});
```

- **前提**：产物以 `MF_FORMAT=system` 构建（`scripts/deploy.sh` / `scripts/deploy-local.sh`），
  `packages/shell-loader` 只走 `System.import()`（失败才回退 UMD 经典脚本）
- **复验点**：用**真实发布产物**（非手造文件）在浏览器验证 ——
  `await window.__LOADER__.preload(['portal','admin'])` 后 `debug().loaded` 含目标模块，
  且 `typeof window.__MODULES__.<name>.mount === 'function'`
- **关联约束**：env-dir 应用的**构建产品线段必须等于 envId**，否则「构建 base / 投递目录 / 指针目录」三者对不上 → `specs/app-artifact-env-dir/design.md`

**实现落位（P1）**：
- 指针生成/读回/版本列举：`servers/deploy-console/src/apps/entry-pointer.ts`
  （单测 `entry-pointer.spec.ts` 锁定写法；`readEnvEntryPointer` 兼容新旧两种指针）
- 投递：**由流水线脚本按环境承担**（本机线 cp / dev 线 scp）；console 侧只有
  `POST /api/apps/:key/switch`、`/:key/rollback` 负责改写指针（不重建产物）
- 指针表：`deploy_app_env_versions`；磁盘指针：`<key>/<envId>/index.js`（`no-cache`）
- 版本保留清理（T2）沿用既有 `ArtifactStoreService.cleanup`（5 版 / 最短 24h），P4 迁移时对齐 env 层级
- **未接线**：发布成功后不自动切指针 —— `PointerExecutor` 只写旧表 `deploy_deployments`，
  env-dir 指针需手动 `POST /api/apps/:key/switch`；与「产品线段须等于 envId」一并见
  `specs/app-artifact-env-dir/design.md`

### 2.2 版本保留与清理（T2）

- 保留：每个 `envId` 保留最近 **5 个版本**且不超过 **7 天**（Q112）。
- 执行位置：**流水线 cleanup 阶段**（已有该阶段，零新增调度），扫 `envId/*` 目录按 mtime 排序清理。
- 保护：`currentVersion` 与 `previousVersion` **永不清理**（即使超出保留数）。

### 2.3 前后端环境联动（R4）

```
envId 是唯一"环境开关"：
  前端 → byEnv[envId] 取产物入口
  后端 → gateway 按 (envId, serviceKey) 查 deploy_service_envs 解析上游
```
- 切换环境 = 整页 reload → 前端重新取 manifest、后端按新 envId 解析，**两侧同时生效**。
- 兜底：某服务在某 envId 未配置指向 → 使用服务默认 `pm2Name/port`（**不得**回落 localhost，B4）。

### 2.4 网关按 envId 解析上游的缓存（T4）

- 缓存键：`(envId, serviceKey)`；TTL 60s；变更后由 console 侧调 `POST /api/internal/gateway/reload`（service_key 鉴权）即时失效。
- 理由：未命中 DB 查询会打在每次 `/api/*` 请求上，必须有缓存。

### 2.5 环境切换审计（Q110 / T3）

- 复用现有审计通道（不新增表）：写一条 `audit` 事件 `{ action: 'env.switch', actor, envId, siteKey, at }`。
- 上报点：`EnvSwitcher.choose()`（前端 → 后端一个轻量接口 `POST /api/dc/envs/switch-log`，失败不阻断切换）。

### 2.6 流水线接线（G6 / NFR-6）

- **不新增列也不删列**：`deploy_pipelines.module_key` 保留；`TargetResolver` 在读取时解析为 `{domain,key,kind,repoDir,rootDir,deployMode}`。
- 历史值（无前缀如 `admin`）解析顺序：`deploy_apps` → `deploy_services`（FR-9.2）。
- 阶段 skip 规则从 `moduleType === 'backend'` 迁移到 `strategy.shouldSkipStage(stage)`（严格等价改写，不引入行为变化）。

---

## 3. 关键实现细节

### 3.1 28 处 `type` 分支收敛（逐条映射）

| 现状位置 | 现状判断 | 改为 |
|---|---|---|
| `pipeline.service.ts:102` `resolveStageCwd` | `type === 'backend' ? servers : apps` | `resolved.rootDir` |
| `pipeline.service.ts:284` BUILD_OUTPUT_DIR | 同上 | 同上 |
| `pipeline.service.ts:1090` | `type !== 'micro-frontend'` | `domain==='app' && kind==='micro-frontend'` |
| `pipeline.service.ts:1353` | `moduleType === 'backend'` | `strategy.activate()` |
| `deploy.service.ts:352` | `type !== 'backend'` return | 进入 `AppDeployStrategy` |
| `deploy.service.ts:644` | 前端类型白名单 | `domain === 'app'` |
| `deploy.service.ts:700` | `type !== 'micro-frontend'` | `kind === 'micro-frontend'` |
| `deploy.service.ts:852` | `type === 'backend'` | 按 domain 分组 |
| `environment.service.ts:61,78` | `type !== 'backend'` | `ServiceEnvService.resolve()` |
| `server.service.ts:130` | `type === 'backend'` | 查 `deploy_services` |
| `steps/step-registry.ts:61,67,77,88` | `moduleType` 四跳 skip | `strategy.shouldSkipStage()` |
| `steps/verify.executor.ts:37`、`cleanup.executor.ts:25` | `moduleType === 'backend'` | `strategy.verify/cleanup` |
| `steps/check.executor.ts:27` | 类型白名单数组 | `TargetResolver` 成功即可 |

### 3.2 发布/切换/回滚的动作差异（实现要点）

| 动作 | 文件系统 | DB |
|---|---|---|
| **发布** | 写 `envId/<newVersion>/` → 改写 `envId/index.js` 与 `index.css` | `currentVersion=newVersion`，`previousVersion=旧值` |
| **切换版本** | **只改写** `envId/index.js`（产物已存在，无需构建） | 同上 |
| **回滚** | 同上（目标 = `previousVersion` 或用户在弹窗选的版本） | 同上 |
| **清理** | 删超出保留策略的版本目录（跳过 current/previous） | — |

> 切换/回滚**不触发构建**——这是本方案比"每次发布重建"更省时的关键点（前提：版本产物已保留，Q105-B）。

### 3.3 迁移执行顺序（幂等 + 可回退）

```
M1 建表 → M2 站点种子 → M3 环境种子 → M4 应用/服务导入
→ M5 版本指针平移 → M6 服务指向平移 → M7 产物目录搬迁 + 生成指针
→ M8 gateway 切读取源（开关）→ 观察一周期 → M9 DROP 旧表
```
- 每步独立可重跑（按业务主键 UPSERT）。
- M7 采用「**并存搬迁**」（旧目录保留，新目录新建）→ 出问题可把 gateway 指回旧路径。
- 回退开关：`DEPLOY_LEGACY_READ=1`（gateway 双读优先旧表）。

### 3.4 前端接线（已就绪部分不再改）

| 页面 | 原「待替换 mock」 | 落地状态（2026-09-21 核对） |
|---|---|---|
| `EnvironmentManager` / `EnvironmentDetail` | 环境列表、后端服务指向 | ✅ 已接真实 API |
| `AppManager` / `AppDetail` | 应用列表、版本列表 | ✅ 已接真实 API |
| `ServiceManager` / `ServiceDetail` | 服务列表、接口清单、网关路由 | ✅ 已接真实 API |
| `EnvSwitcher` | `envs` 来自 manifest（去掉 dev 兜底） | ✅ 已接 manifest |

---

## 4. 兼容与回退

| 场景 | 机制 |
|---|---|
| 迁移期新旧表并存 | `DEPLOY_LEGACY_READ`（gateway 优先旧表） |
| 前端旧客户端（未升级） | manifest 保留 `env` / `modules` 旧字段 |
| 流水线历史数据 | `moduleKey` 无前缀解析（FR-9.2），零改造 |
| 产物路径回退 | M7 并存搬迁，路径可回切 |
| 紧急停止 | 关闭 gateway 新读取源 → 回到当前运行时行为 |

---

## 5. 测试策略

| 层 | 内容 | 判据 |
|---|---|---|
| 单测（新增） | `TargetResolver`（含历史值兜底）、`EnvIdAllocator`（自增 + 校验）、`AppDeployStrategy` vs `ServiceDeployStrategy` 的 skip 矩阵、版本保留清理（边界：current/previous 不删） | 覆盖率 ≥ 现有基线 |
| 集成（真实 DB） | 环境 CRUD → 应用注册 → 发布到 envId → manifest 输出 → 切换版本 → 回滚 | 每步断言 DB + 目录 |
| 端到端（本地） | ① console 发 admin 到 dev/1 ② 浏览器挂件切环境 → 产物换目录 ③ 切换版本 → 刷新生效 ④ 改后端指向 → 网关生效 | 与 §6 验收判据一致 |
| 回归 | 流水线原有功能（跑一次真实流水线）、网关原有转发（`/api/*` 全量） | 无新增 5xx |

---

## 6. 分期实施计划与验收判据

| 期 | 内容 | 验收判据（V） |
|---|---|---|
| **P0** 模型与可行性 | 建表 + 迁移脚本骨架 + **T1 指针可行性验证** + `TargetResolver` | V1 新表就绪且旧表未动；V2 T1 结论明确（A/B/D）；V3 `TargetResolver` 单测通过（含历史值） |
| **P1** 微前端域 | 环境（site/env + 指向）、应用、挂载路由、版本指针的 API + 页面接真实数据；产物写 `envId/<version>/` + 指针 | V4 新建环境得到自增 envId；V5 发布 admin 到 `1` 后 `/<key>/1/index.js` 可加载；V6 切换版本只改指针且刷新生效；V7 删除环境被占用时阻断 |
| **P1 进度**（2026-09-18） | ✅ V4–V7 全部通过（证据见 `progress.md`）；后端 API + 投递激活原语 + 前端 4 页接线完成。**剩余**：服务管理两页属 P2；流水线调用投递原语放 P3（避免在 `moduleKey` 未切 `targetRef` 前改共享流水线） | — |
| **P2** API 网关域 | 服务、网关路由、接口、环境指向的 API + 页面；gateway 转发规则改读 DB | V8 接口导入幂等（重复导入只补空字段）；V9 改路由后 ≤60s 生效（或 reload 立即）；V10 未登记接口按 `unknownPolicy` |
| **P2 进度**（2026-09-18） | ✅ V8/V9/V10 全部通过（证据见 `progress.md`）。实现取舍：**不新增 catch-all 控制器**，改在 `ProxyController` 既有最终 404 分支接入（`GATEWAY_DB_ROUTES=1` 开启，默认关闭；未命中行为逐字节不变）；只读复用 gateway 已有 `deploy` 连接；`authMode=jwt/service_key` 为可选加严。**剩余**：服务发布接流水线（P3）、灰度（后续） | — |

### 运行时契约补充（P2 定稿，P3 需对齐）

| 项 | 约定 |
|---|---|
| 环境传递 | 请求头 **`x-env-id`**（前端切换环境后随请求携带）> Host 命中站点 `defaultEnvId` > 回退 `dev` |
| 上游解析 | `route.upstreamOverride` > `deploy_service_envs(envId, serviceKey)`（`upstreamUrl` > `host:port` > `host` + 服务 `defaultPort`）> **null（fail-fast，禁止回落本机）** |
| 未登记接口 | 仅当服务 `unknownPolicy=deny` 时拦截（403）；`allow` 放行（迁移期默认） |
| 缓存与刷新 | TTL 60s；`POST /api/internal/gateway/reload`（`x-service-key` 校验）立即失效 |
| 开关 | `GATEWAY_DB_ROUTES=1` 启用 DB 路由；关闭时全部走既有硬编码路由 |

### 流水线的环境语义（2026-09-19 定稿，双域重构连带调整）

环境是**动态创建**的（用户在「环境管理」自建 → envId 自增 `1/2/3…`），因此流水线不再「一环境一条」：

| 项 | 旧语义 | 新语义 |
|---|---|---|
| 模板 `env` | **强绑定**：提交环境必须与之相同，否则 400 | **默认环境**：不一致只记日志，按提交的 env 执行 |
| 提交环境校验 | 硬编码白名单 `local/dev/staging/prod` | **以环境表为准**（`deploy_envs`），内置四个环境保留兜底 |
| 模板解析（未指定流水线） | 只按 `模块 × 环境` 匹配，新环境找不到 → 报错 | `模块 × 环境` → **模块** → 全局，逐级回落 |
| 真相源 | 模板的 env（投递目标/产物命名空间跟着它走） | **运行实例的 env**（投递目标、`<key>/<envId>/` 产物目录都看它） |
| 模板数量 | 每模块 × 每环境一条（admin 就有 dev/local/prod 三条） | **每模块一条**（`env=NULL`），环境在提交时选；迁移脚本 `p12` 已把 48 条收敛为 16 条 |

> 依据：用户 2026-09-19 反馈「历史的多环境流水线，进去没有环境部署的选择」——
> 三层拦截（前端锁定环境 + 模板只按模块×环境匹配 + 提交强制 env 相等）导致新环境无法发布，已全部放开。
>
> ✅ **已确认（2026-09-19）**：**不保留**「一环境一条流水线」的强绑定。
> 备选方案（新建环境时自动克隆该模块流水线）已否决 —— 会产生 `环境数 × 模块数` 条流水线。
> 前端相应改动：发起抽屉里**环境可改**（默认取模板绑定环境）、模板下拉按「本环境优先」排序、
> 环境筛选来自真实环境表；**服务详情「构建发布」原地打开共用抽屉 `PipelineSubmitDrawer`（不跳转，2026-09-21）**，
> 应用详情「部署」打开「选版本部署」抽屉（`VersionDeployDrawer`）。
| **P3** 运行时接线 | gateway manifest 改 `envs/byEnv`；shell 按 envId 加载；EnvSwitcher 接真实 envs + 审计 | V11 挂件列出真实环境；V12 切换后整页重载并加载对应目录；V13 后端指向随 envId 切换 |
| **P4** 迁移与退役 | 数据迁移 M1–M8、双读观察、旧表 DROP（M9）、旧页面清理 | V14 迁移幂等（重跑无差异）；V15 流水线历史记录零丢失；V16 关闭开关后行为与迁移前一致 |

依赖关系：P0 的 T1 结论是 P1 的前置；P1+P2 可并行（两域独立）；P3 依赖 P1/P2 接口就绪；P4 最后。

---

## 7. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 入口指针在 SystemJS 下不生效（T1） | P0 先验证；备选 B/D 已备好 |
| R2 | 迁移期双读引入不一致 | 双读期**只写新表**、只读旧表兜底；观察期内不删旧表 |
| R3 | 版本目录膨胀占磁盘 | 保留 5 版 / 7 天 + current/previous 保护；cleanup 阶段执行 |
| R4 | 网关按 envId 查上游增加延迟 | `(envId, serviceKey)` 缓存 60s + reload 即时失效 |
| R5 | 前端缓存导致"切了环境没变化" | `index.js` no-cache；切换为整页 reload；manifest 不含版本 |
| R6 | 一次性改动大（28 处分支） | 按 §3.1 清单逐条等价改写 + 单测覆盖 skip 矩阵；分 P1/P2/P3 三期小步 |
| R7 | 与 `pipeline-node-model` 重构冲突 | 严格限定：本次只加 `targetRef` 解析，不动节点/变量/审批模型 |

---

## 8. 评审要点（请重点看这几处）

1. **§2.1 T1**：入口指针方案（是否接受先做 30 分钟验证，再定 A/B/D）
2. **§2.2 T2**：版本保留清理放在流水线 cleanup 阶段（不新增定时任务）
3. **§3.2**：切换版本/回滚**不重建、只改指针**——确认这符合预期
4. **§6 分期**：P1/P2 并行、P4 最后，是否接受
5. **§1.1**：`deploy-console` 为"重写级"改动，工作量是否可接受（预计 P0–P3 为主要投入）

---

## 变更日志

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-18 | v1.0 | 初稿。基于 requirements v1.1 + design v2 + 已落地原型，输出影响面、6 项关键技术决策（T1–T4）、28 处分支收敛清单、分期计划与验收判据、测试与风险 |
