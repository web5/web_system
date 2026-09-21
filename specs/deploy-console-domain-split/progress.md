# 双域重构 · 实施进度与验证证据

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 分支：`feat/deploy-console-domain-split`
> 分期依据：`tech-design.md` §6（P0 模型 → P1 微前端域 → P2 网关域 → P3 运行时接线 → P4 迁移退役）
> 规则：完成声明必须附**可复现证据**（命令 / 文件 / HTTP 结果），不接受"应该没问题"。

---

## P0 · 模型与可行性（已完成）

| 项 | 结果 |
|---|---|
| **10 张新表实体**（与 `design.md` M1 清单一致） | ✅ `src/entities/`：`deploy-host` / `deploy-site` / `deploy-env` / `deploy-app` / `deploy-app-route` / `deploy-app-env-version` / `deploy-service` / `deploy-service-route` / `deploy-endpoint` / `deploy-service-env`（旧表未动） |
| 跨域寻址 `TargetResolver` | ✅ `src/target/target-resolver.service.ts` + 单测 7/7 通过（含历史值兜底解析） |
| T1 入口指针可行性 | ✅ 结论：**写法 A′（两行，命名导出 + default 双透传）**；`export *` 不透传 `default` 已实测 |

> 无 `deploy_env_slots`、无 `deploy_service_deployments`：Q103 已废弃 slot（dev1/dev2 = 并列 envId）；
> 服务域部署记录复用既有 `deploy_versions` / 流水线运行表，不新增独立表。文档中若出现这两张表属历史稿，以本行为准。

---

## P1 · 微前端域（进行中）

### 已完成

| 模块 | 交付物 | 验证 |
|---|---|---|
| 环境域 | `src/envs/`（站点 + 环境 + 环境详情服务指向） | **V4 ✅** |
| 应用域 | `src/apps/`（应用 + 挂载路由 + 版本矩阵 + 切换/回滚） | **V6 ✅ / V7 ✅** |
| 产物投递激活 | **已于 2026-09-20 移除**：`app-artifact.service.ts`（`publishLocal`）、`POST /api/apps/:key/publish`、`UploadExecutor` 的环境目录分支（含 `PIPELINE_APP_ENV_DIR` 开关）全部删除；`entry-pointer.ts` **保留**，供切换/回滚改写指针 | 见「变更日志」 |
| 单测 | `entry-pointer.spec.ts`(8)（`app-artifact.service.spec.ts` 随能力一并删除） | ✅ 8/8 通过 |
| 前端接线 | `api/index.ts` 新增 `envsApi` / `appsApi`；`EnvironmentManager.vue`、`AppManager.vue`、`AppDetail.vue`、`EnvironmentDetail.vue` 去 mock | ✅ `vue-tsc --noEmit` 零错误 |
| 文档对齐 | `design.md` §4 REST 表改为实际路径（`/api/apps`、`/api/envs`）并标注实现状态 | ✅ |

### 验收判据证据（V4–V7）

| 判据 | 证据 |
|---|---|
| **V4** 新建环境得到自增 envId | `POST /api/envs {name,siteKey}` 连建两次 → `envId=1`、`envId=2`；`DELETE /api/envs/dev` → `400 内置环境 dev 不可删除`；`GET /api/envs/resolve?envId=999` → `{"envId":"dev"}`（回退） |
| **V5** 发布后 `/<key>/<envId>/index.js` 可加载 | ⚠️ **历史证据，接口已下线**（2026-09-20 随 `publishLocal` 一并删除）：当时 `POST /api/apps/admin/publish {envId:"1",version:"e2e1"}` → 产物落 `<ws>/servers/gateway/public/static/modules/admin/1/e2e1/`，指针 `admin/1/index.js` 内容为 A′ 两行；`curl http://localhost:6000/static/modules/admin/1/index.js` → `200 application/javascript`。**现今改由流水线投递 + `POST /api/apps/:key/switch` 切指针** |
| **V6** 切换版本只改指针且刷新生效 | `POST /api/apps/admin/switch {envId:"1",version:"v2"}`：指针文件 `v1→v2` 改写，`v1` 版本目录原封不动；版本表 `currentVersion=v2 / previousVersion=v1`；`POST /api/apps/admin/rollback {envId:"1"}` 回滚成功 |
| **V7** 删除环境被占用时阻断 | `DELETE /api/envs/1` → `400 仍有 1 个应用在该环境有部署记录：admin。请先清理后再删除。` |
| 单测 | `npx jest src/apps/` → 15 passed；`npx vue-tsc --noEmit` → 无输出（零错误） |

### 未完成（P1 收尾）

| 项 | 说明 |
|---|---|
| 服务管理相关页面 | 属 **P2**（API 网关域），`ServiceManager.vue` / `ServiceDetail.vue` 仍为 mock |
| 流水线调用「投递激活」原语 | **已关闭**（2026-09-20）：原语与流水线接线一并删除。原因：模板 `release` 节点被 DB 里的 shell 命令接管，内置 `UploadExecutor` 永不执行，开关形同虚设；且本地/远程投递已由**按环境区分的流水线**承担（本机线=cp、dev/prod 线=scp） |
| 旧表退役 | P4（`deploy_modules` / `deploy_deployments` / `deploy_env_service_routes` / `deploy_servers` / `deploy_environments`） |

---

## P2 · API 网关域（已完成）

### 交付物

| 模块 | 交付物 | 验证 |
|---|---|---|
| 服务域后端 | `src/services/`：服务 CRUD、转发规则（前缀级）、接口清单、服务×环境（只读）、手动探活 | **V8 ✅** |
| 服务种子 | `ServicesService.onModuleInit`：服务 ← 旧 `deploy_modules`（backend），指向 ← 旧 `deploy_env_service_routes`（envId 原样平移） | ✅ 12 个服务落库 |
| 前端接线 | `api/index.ts` 新增 `servicesApi`；`ServiceManager.vue`、`ServiceDetail.vue` 去 mock（详情默认落「接口」页签） | ✅ `vue-tsc` 零错误 + `vite build` 通过 |
| 网关 DB 路由 | `servers/gateway/src/dynamic-route/`：只读实体 + 纯匹配函数 + 服务 + 兜底接入 | **V9 ✅ / V10 ✅** |
| 单测 | `services.service.spec.ts`(7) + `route-match.spec.ts`(18) | ✅ 25/25 |

### 网关接入方式（重要设计取舍）

- **单点兜底**：不新增 catch-all 控制器，而是在 `ProxyController` 既有的最终 404 分支
  （`@All(':path(*)')`）里先尝试 DB 路由；**未命中保持原 404 逐字节不变**（FR-10.2 双轨零破坏）。
  这样无需操心 Nest 路由注册顺序。
- **默认关闭**：`GATEWAY_DB_ROUTES=1` 才启用；关闭时 `tryHandle` 立即返回 false。
- **只读连接复用**：读的是 gateway 已有的 `deploy` 命名连接（`DEPLOY_DB_NAME` 默认 `web_system_deploy`，
  与 deploy-console 同库），`synchronize: false`，网关绝不建表。
- **鉴权姿态不变**：`/api/*` 沿用「下沉到各微服务」（`ProxyController` 为 `@Public()`）；
  规则可选 `authMode=jwt|service_key` 做**加严**（已验证 jwt 无令牌 401 / 有令牌放行）。
- **环境维度**：请求头 `x-env-id` > Host 命中站点默认环境 > 回退 `dev`（Q1）。
- **缓存**：TTL 60s；`POST /api/internal/gateway/reload`（`x-service-key` 校验）立即失效。

### 验收判据证据（V8–V10）

| 判据 | 证据 |
|---|---|
| **V8** 接口导入幂等（重复导入只补空字段） | 第 1 次 `created=3`；第 2 次同批 `created=0/filled=0/skipped=3`；第 3 次只带新字段 → `filled=1, fields=['rateLimitPerMin']`，**已有 summary 未被覆盖**（列表页读到仍是「列表」） |
| **V9** 改路由后生效（reload 立即 / TTL ≤60s） | 建规则 `/api/dbroute`（strip `^/api/dbroute` → rewrite `/api`，上游覆盖回显服务）→ `GET /api/dbroute/ping` 经网关转发得 `{"method":"GET","path":"/api/ping"}` 200（**重写生效**）；禁用规则 + reload 后同一请求立即回到 404；未命中路径仍是原 404 文案 |
| **V10** 未登记接口按 `unknownPolicy` | `todo-service.unknownPolicy=deny` 时：`GET /api/todo/42/logs`（路径未登记）→ 403；`DELETE /api/todo`（方法未登记）→ 403；`GET /api/todo`（已登记，规则 `authMode=jwt`）→ 无令牌 401 / **带令牌 200 并转发到该环境的指向** |
| 单测 | `npx jest src/services/` → 7 passed；`npx jest src/dynamic-route/` → 18 passed |

### 未完成（P2 收尾）

| 项 | 说明 |
|---|---|
| 服务发布接流水线 | 服务侧「构建 → 上传 → 重启 → 探活」在 **P3** 接通（本阶段部署页为只读视图 + 探活） |
| 灰度叠加 | Q108 明确列为后续（与 env 目录正交） |
| 网关默认开启 DB 路由 | 需在观察期后把 `GATEWAY_DB_ROUTES=1` 落到环境配置（P4 双读/切换） |

---

## P3 · 运行时接线（进行中）

| 项 | 状态 | 证据 |
|---|---|---|
| gateway `__manifest__` 改 `envs/byEnv` | ✅ 已完成 | `GET /__manifest__?site=dev` → `site=dev / defaultEnv=dev / switchable=true / envs=[dev,1,2] / byEnv={dev:{admin},1:{admin},2:{}}`；`Host: portal.kedouai.com` → `site=prod / defaultEnv=prod / switchable=false / envs=[prod]`（prod 唯一且不可切换）；**未匹配站点（localhost）→ `site=null` + 仅旧字段**，行为不变 |
| **注入 shell 的 manifest 同源**（关键收口） | ✅ 已完成 | 组装唯一来源 `IndexHtmlService.buildManifest(req)`，`/__manifest__` 端点与 `<script id="__MODULES_MANIFEST__">` **同一份数据**（已验证两者输出一致）。`byEnv` 值为 `{entry, css}`，`css` 按磁盘存在性给出（避免前端引 404） |
| shell 按 envId 加载 | ✅ 已完成 | `apps/shell/src/main.ts`：解析 env → 注册 `byEnv[envId]` 模块（固定入口，不含版本）→ 请求带 `x-env-id`；`byEnv` 缺失时回落旧 `modules` 结构 |
| 环境解析共享（防三处漂移） | ✅ 已完成 | `packages/ui/src/composables/env.ts`：`localStorage > defaultEnv > dev`，与网关侧 `route-match.resolveEnvId` 同语义；单测 8/8（含「环境被删后残留旧值必须回退」） |
| EnvSwitcher 接真实环境 + 审计 | ✅ 已完成 | 挂件读 `manifest.envs`（`switchable=false` 不渲染）；切换写 `localStorage['kedou.env']` → 上报 `POST /console/api/envs/switch-log`（**最多等 800ms，不阻断切换**）→ 整页重载 |
| 流水线调用「投递激活」原语 | ⛔ 已移除（2026-09-20） | 原实现为 `UploadExecutor` 追加 `AppArtifactService.publishLocal`（`PIPELINE_APP_ENV_DIR=1` 开关）。实测结论：模板 `release` 节点的 shell 命令优先，内置执行体不执行 → 开关对带壳命令模板无效；且对 `deployMode=site-version` 的应用会误抛错。现**按环境区分流水线脚本**实现投递（本机线 cp / 远程线 scp），原语、开关、接口全部删除 |
| **构建发布 / 部署 语义分离** | ✅ 已完成 | 用户 2026-09-19 定稿：**构建发布 = 流水线**（拉码 → 构建 → 上传产物，**不动进程**）；**部署 = 独立动作**（重启进程 + 探活，**不重新构建**）。后端 `POST /api/services/:key/deploy {envId}`（`ServicesService.deploy` + `restartLocal`）；前端 `servicesApi.deploy`，部署 tab 每行三个动作（构建发布 / 部署 / 探活），文案改为「上传后不会自动生效」 |
| **旧表读取源切换**（M9 前置） | ✅ 已完成 | `ModuleRegistryService` 改为**双域适配层**：主源 = `deploy_services` + `deploy_apps`（`kind→type` 映射：micro-frontend→micro-frontend；shell/mini-app/spa→frontend；service→backend，与 `modules.json` 三值域一致），旧 `deploy_modules` 降级为**兜底补漏**。写路径（旧 `/modules` controller）已删 |
| 真实流水线发布复验 | 待做 | 需一次完整流水线（build→upload→activate→verify）验证产物落盘到 `<key>/<envId>/<commit>/`；与 T1 复验点同批做（避免手造文件造成的假阳性） |

### 顺带修复（P3 过程中发现）

| 问题 | 处理 |
|---|---|
| `apps/shell` 的 `@web-system/ui/components` 未配 vite 别名 + tsconfig paths，`vue-tsc` 报 TS2307（EnvSwitcher 引用失败） | 按 admin / deploy-console 既有约定补齐：`vite.config.ts` 别名 + `tsconfig.json` paths（含新增的 `composables/*`），并补 `types: ["node","vite/client"]`（组件用 `import.meta.env.DEV`）→ shell 类型检查通过 |
| manifest 组装逻辑一度在控制器里重复实现 | 收口到 `IndexHtmlService.buildManifest`，控制器只透传 |

---

## 联调问题修复（2026-09-19，用户实测反馈）

| 现象 | 根因 | 处理 | 验证 |
|---|---|---|---|
| **应用管理报错 `Cannot GET /api/apps`** | 前端是工作区新代码，但 dev server 代理到 **6200（release 旧后端，无 `/api/apps`）** | `apps/deploy-console/vite.config.ts` 代理目标改为可配：`CONSOLE_API_TARGET`（默认仍 6200，不改变他人行为） | `6200/api/apps → 404`；`5174/console/api/apps → 401`（路由存在）；带令牌经代理返回真实应用列表 ✅ |
| **历史多环境流水线「进去没有环境部署的选择」** | 三层拦截：① 前端 `executeTpl` 把环境锁定只读；② `resolveForSubmit` 只按「模块×环境」匹配（新环境找不到流水线）；③ `submit` 强制「模板 env === 提交 env」；④ 另有硬编码环境白名单 `local/dev/staging/prod` | ① 前端环境可改（模板默认环境仅作预选）；② 解析加「模块级」回落；③ 不一致只记 warn，按提交 env 执行；④ 白名单改为**查环境表**（内置四个保留兜底） | `POST /api/pipelines {moduleKey:'admin', env:'1', pipelineId:'tpl-admin-local'}` → **201**（此前 400「不支持的环境: 1」+「与环境 local 不一致」）；实例 `env=1`；已即时取消（停在 git 阶段，未构建）✅ |

> **语义变更（已写入 tech-design）**：模板 `env` 由「强绑定」降级为「默认环境」，
> 流水线真相源改为**运行实例的 env**（投递目标与 `<key>/<envId>/` 产物目录都看它）。
> 依据：环境是用户自建、envId 自增的动态集合，为每个环境复制一份流水线不可维护。

---

## 门户加载失败事故与 env-dir 对齐修复（2026-09-21）

| 现象 | 根因 | 处理 | 验证 |
|---|---|---|---|
| `local.kedouai.com` 门户整模块加载失败：`System: Unexpected token 'export'` + `UMD: 模块 portal@env:local 未暴露 lifecycle（缺 mount）: /static/modules/portal/local/index.js` | ① **入口指针写成原生 ESM**，而产物是 `MF_FORMAT=system`：`System.import()` 在解析阶段即抛 `Unexpected token 'export'`，文件体不执行 → loader 的 ③ `window.__MODULES__` 兜底**一并失效**（System/UMD 两条路径都失败）。② **portal 的构建产品线段是 `portal-dev` ≠ envId `local`**，`byEnv` 走 `<key>/<envId>/` → 结构性无法满足 | ① `entry-pointer.ts` 指针改 `System.register`、`readEnvEntryPointer` 兼容新旧写法、单测补锁定；p11 迁移脚本同步。② 按 envId 口径重建并落位 `portal/local/20d1380`、`admin/local/20d1380`，写 System.register 指针 + 样式指针，同步 `deploy_app_env_versions` | 单测 9/9；systemjs 6.15.1 实测（ESM 指针 THROW / System.register PASS）；浏览器 `loader.loaded=[portal,admin]`、`window.__MODULES__.{portal,admin}.mount` 均为 function、portal 实际 mount 渲染 8842B 真实 DOM、控制台 **0 错 0 警** |

> **约束沉淀**（详见 `specs/app-artifact-env-dir/design.md` §2）：env-dir 应用有三条硬约束 ——
> ① 指针必须 System.register（加载器只认 SystemJS/UMD）；② 构建 `base` 被烘成绝对路径且含「产品线段」；
> ③ 指针/版本目录只认 `<key>/<envId>/`。推论：**产品线段必须等于 envId**，否则三者对不上。
>
> **按方案 A 落地**（2026-09-21，`specs/app-artifact-env-dir/design.md` §4/§5）：
> `scripts/migrations/p22-app-env-dir-artifact.mjs` 改流水线 DB 脚本 —— 构建动作在 local 用
> `RELEASE_TAG=<DEPLOY_ENV>/<纯commit>`（dev/prod 不变），local 投递落
> `modules/<PUBLIC_PATH>/<DEPLOY_ENV>/<纯commit>/` 并改写 env 入口指针（System.register），
> 另落一份 legacy 兼容副本使「未匹配站点」不 404。首跑 4 条动作、复跑零差异；投递脚本沙箱实跑通过。
> 剩余：G3 的 DB 侧（`deploy_app_env_versions` 同步，`PointerExecutor` 只写旧表 —— 不影响加载，
> 只影响控制台版本矩阵显示）、dev/prod 是否同口径（待定）。
>
> **历史记录瘦身 + 兼容下线**（2026-09-21，`scripts/migrations/p23-cleanup-history.mjs`）：
> 用户定「历史构建产物不再考虑兼容」。DB：流水线运行 53→10、审批 47→9、版本记录 257→19，
> 遗留 `_bak_*` 表 DROP 10 张（261 行）；磁盘：`modules/` 下历史产物目录共 130 个移入
> `/tmp/p23-trash-*`，只留指针指向的版本（`portal/local/20d1380`、`admin/local/20d1380`、
> `portal/dev/b2b6d4a`、`shell/shell-dev/16865ad`）；同时移除 `p22` 落的 legacy 兼容副本段，
> 并把最后 1 个残留 ESM 指针（`portal/dev/index.js`）转为 System.register。
> 回滚：DB 行 dump 在 `/tmp/p23-db-backup-*.json`，磁盘产物可直接从垃圾站改回。
>
> ⚠️ 该脚本首版有两处误伤（已修，第 3 次执行才正确）：① 保留判断只比对一层目录，
> `shell/shell-dev/16865ad` 保住了自己却没保住父目录 `shell/shell-dev` → 整个 shell 被移走
> （站点 404），改为**前缀匹配**；② 遍历了 `modules/` 下**所有**目录，而 `deploy_apps` 只认识 4 个应用，
> 其余（gateway / todo-service / …）的子目录被整批移走，改为**应用白名单**。
> 两次均从垃圾站全量恢复后重跑，最终浏览器回归通过（`loaded=[portal,admin]`、控制台 0 错 0 警）。
> 教训：批量清理必须先「白名单 + 前缀匹配」并 DRY_RUN 打印待删清单。
>
> **G3 收口：env-dir 应用激活收敛到平台一处**（2026-09-21，`specs/app-artifact-env-dir/design.md` §4.1）：
> 脚本不再自拼 `System.register` 指针文本（两处实现必然漂移 —— 第一次故障正是平台侧写法错），
> 改为投递完成后调 `POST /api/internal/release/pointer`；该接口对 `deploy_mode='env-dir'` 的应用走
> **应用域激活**：校验产物存在（fail-fast）→ `writeEnvEntryPointer` 写磁盘指针 →
> upsert `deploy_app_env_versions`（current/previous）。改动：`InternalReleaseController`（+env-dir 分支、
> 注入 `AppsService`）、`DeployModule`（导入 `AppsModule`）、`AppsService.findAppOrNull`、
> `scripts/migrations/p24-app-pointer-via-platform.mjs`（改 2 条 local 投递动作，幂等）。
> 已验证：幂等 / 401 / 不存在版本 fail-fast 400 / 真实切换时磁盘指针与版本表同时更新 / 浏览器回归通过。
> **缓存结论**：本路径无缓存（控制台读表与磁盘指针都是直连）；gateway 的 10s 版本缓存读的是旧表，
> env-dir 加载路径不吃它 —— 无需额外失效。
>
> **site-version（shell / 小程序）口径与「部署」分流**（2026-09-21，`specs/app-artifact-env-dir/design.md` §4.2）：
> 排查 `shell` 发布链路后确认 —— shell 与 portal/admin 的发布脚本**形状相同**（投递产物 + write-version），
> 但**不写加载指针**；shell 的加载指针是 `deploy_deployments`（gateway `getCurrentVersion(envId,'shell')`
> 决定加载哪个版本目录的 index.html），由控制台「部署」写入。修复两项：
> ① `DeployService.deployVersion` 过去**无条件**写 `deploy_deployments` → 对 portal/admin 是**空转**
> （它们的加载路径是 env 指针，不读这张表，表现为「部署成功但页面没变」）；现按 `deployMode` 分流
> （env-dir → `AppsService.switchVersion`；site-version → legacy 指针 + 清缓存）。
> ② gateway `versionCache`（TTL 10s）失效通路：扩展 `/api/internal/gateway/reload` 一并清版本缓存
> （响应回报 `versionCacheCleared`），控制台在 site-version 部署后 best-effort 调用；
> 配置补 `GATEWAY_SERVICE_KEY`（gateway 与 console 两侧一致，沿用 gateway 原 FINNEWS 值）。
> 实测：console `已通知 gateway 刷新缓存` → gateway 同刻 `版本缓存已失效：3 条`。
> 踩坑：**不能用 Node 全局 `fetch`** 调 6000（undici 按 WHATWG 拒连 bad port，表现为与网络无关的
> `fetch failed`）—— 改用 Node `http` 模块。未对齐项：shell 的**发布**仍不自动切指针（见 spec §7 Q6）。
>
> console 侧已生效：`deploy-console` 于 2026-09-21 21:13 按「工作区构建 → 复制 dist → 干净重启」重发，
> 运行实例（pid 75948，21:13:43 启动）加载的 `dist/apps/entry-pointer.js` 内为 System.register 写法
> （旧 `export * from` 写法残留 0 处）—— 从 UI「切换版本」不再会写回 ESM 指针。

---

## P4 · 迁移（进行中）

| 步骤 | 状态 | 说明 / 验证 |
|---|---|---|
| **M4-lite**（前端模块 → 应用域） | ✅ 已完成 | `AppsService.onModuleInit` 幂等种子：历史前端模块按类型映射进 `deploy_apps`（`isShell→shell`、`mini→mini-app`、`micro-frontend→micro-frontend`、`frontend→spa`），后端不进应用域。只补不覆盖 → 应用列表出现 `portal / shell / mini-contract / admin` |
| **M5 + M7**（旧版本指针 + 产物 → `envId` 布局） | ✅ 已完成 | 幂等脚本 `scripts/migrations/p11-app-env-artifacts.mjs`：`deploy_deployments` → `deploy_app_env_versions`（版本归一化纯 commit）+ 复制产物到 `<key>/<envId>/<commit>/` + 生成 A′ 入口指针 |
| M1–M3（建表 / 站点 / 环境种子） | ✅ | 由 `synchronize` + `EnvsService.ensureBuiltin` 承担 |
| M6（服务指向） | ✅ | 由 `ServicesService.ensureSeeded` 承担（旧 `deploy_env_service_routes` → `deploy_service_envs`） |
| **M12**（同模块多环境流水线合并为 1 条） | ✅ 已完成 | 幂等脚本 `scripts/migrations/p12-merge-module-pipelines.mjs`：每模块保留 1 条（优先 env=dev），`env` 置 NULL（环境无关）、名称去环境后缀；冗余模板连同 `deploy_pipeline_step_commands` / `deploy_pipeline_vars` 一并清理。**48 → 16 条**（清理 160 行节点命令 + 64 行变量），复跑幂等 |
| **M21**（微前端发布落盘路径修复 p20） | ✅ 已完成 | 事故：门户加载失败（`portal@portal-dev/65c00a9` 404）。根因：网关按指针值直出 `/static/modules/<key>/<currentVersion>/index.js`，而 release 落盘与指针值不一致——portal/shell/mini-contract 无条件远程直投（local 发布投到远程机、本机无产物）；admin 落 `modules/<key>/<ENV_ID>/<commit>`（指针是 `<流水线key>/<commit>`）。修复：4 条微前端线按环境分支（local 落本机 `modules/<PUBLIC_PATH>/<COMMIT_ID>` 与指针值逐段一致；dev 保持远程 scp）；admin 复制补齐历史产物路径。**验证**：重新发布 portal/local → 产物落位 + 指针一致 + 网关直出 200；admin/portal 四环境指针路径全部 FS✓HTTP200；根页 200（shell 正常）|
| **M20**（旧链路数据退役 p17） | ✅ 已完成 | `scripts/migrations/p17-retire-legacy-tables.mjs`：RENAME 归档（库内 _bak 惯例，可回退）——step_commands(90 行，含废弃列 env_branches) / step_branches(2 行) → `_bak_20260921`；前置校验新表有数据防断粮。**退役后回归全绿**：admin/local 新引擎全链路（提交→审批挂起/恢复→执行→版本+指针落库 30d9b1f）不依赖旧表；旧表由 synchronize 重建为空表、seed 服务回写 48 行平台脚本（代码兼容层保留，新链不读，下批删代码） |
| **M19**（编排新模型 P4：前端三层画布） | ✅ 已完成 | `OrchestrationEditor.vue`（对接 /console/api/pipelines/:id/steps 整树接口）：步骤→任务→动作三层画布（测量式 SVG 连线、分叉/箭头/中点＋插入步骤、动作块紧贴任务头圆角 2px、任务 tag「任务」/动作 tag「脚本」、hover × 删除、managed 动作禁删）；两态抽屉（任务总览/单动作，无保存无删除）；页头按钮组（取消/保存；删除走画布与删除流水线）。PipelineEdit「流程编排」tab 双轨：新表有数据→新画布，否则旧节点画布。**实测**（浏览器+截图基线 docs/ui/baselines/deploy-console-pipeline-edit-orchestration-after.png）：admin 发布树正确渲染（4 步骤/5 任务/6 动作、分叉连线、if 徽标）；踩坑：命令式创建的连线＋号吃不到 scoped CSS（改非 scoped 样式块） |
| **M18**（编排新模型 P3：迁移 + 主链路接入） | ✅ 已完成 | ① 引擎增强：挂起恢复 skipThroughStep / afterTask 平台收尾 / PipelineSuspended 透传；runScript 改传 baseEnv+taskEnv 两段（调用方惰性重组——一次性快照会让 build 拿到回填前的空 COMMIT_ID，已实测踩坑）。② 接入主 run()：实例 orchestration 快照列（新表有数据→新引擎，否则旧链路并存）；提交时 getTree 固化；审批经 approvals.createNode + PipelineSuspended 挂起，approve 恢复跳过已完成步骤；成功 setPointer。③ write-version 动作脚本化：平台工具 write-version.mjs（直连部署库，随 console assets 分发）。④ p16 迁移（幂等）：16 条流水线 → 64 步骤/65 任务/66 动作；旧默认分支补互斥条件（`DEPLOY_ENV != local`）——旧「兜底」≠新「恒执行」，不补会让 local 发布时 dev 分支并行执行（已实测踩坑）。**端到端（admin/env=local）**：快照→git→build→审批挂起→恢复跳过已完成→local 命中（投递+write-version 串行）→dev 条件跳过→版本记录+指针落库，全绿 |
| **M17**（编排新模型 P2 执行引擎·调度器） | ✅ 已完成 | `orchestration-engine.ts` 纯依赖注入调度器（14 单测，V2/V4/V5 语义全覆盖）：步骤串行/步骤内并行、条件过滤（非法 fail-fast / 未命中跳过留痕 / 全不命中步骤失败）、动作串行链失败即断、审核挂起（拒绝/超时按 onReject/timeoutAction）、env 合成（任务级覆盖 baseEnv）、取消中止。脚本执行/审批等待以回调注入，不依赖容器与 DB；P3 接入主 run() 与 p16 迁移 |
| **M16**（编排新模型 P1 骨架） | ✅ 已完成 | 三张新表实体（steps/tasks/actions）+ `pipeline-orchestration` 模块：整树读取（IN 查询无 N+1）、步骤按名 upsert（id 稳定保任务）、任务+动作全量保存、managed 动作保护（不可删/不可改名）、条件与 bash -n 校验（`orchestration-schema.ts` 纯函数 11 单测）。**实测**：保存/managed 保护 400/非法条件 400/upsert 幂等 id 稳定/级联删除全过（6211 验证实例）。P2 执行引擎、P3 p16 迁移待做 |
| **M14**（节点「环境分支」可编辑） | ✅ 已完成 | 设计 `specs/pipeline-env-branch/design.md`：每环境一段脚本，保存时拼装成单一执行体（同步写 `command` 与 `actions[shell].code`），未配置脚本的环境 fail-fast。纯函数 `pipeline/steps/env-branch.ts`(8 单测) + service/controller 接线 + 前端 `EnvBranchEditor.vue`；`admin 发布` 的 release 已落 `local`（本机 cp）/ `dev`（远程 scp）两段 |
| **M13**（流水线配置完善：git URL 显式化 + 发布节点按环境分支 + admin 线合并） | ✅ 已完成 | 幂等脚本 `scripts/migrations/p13-pipeline-release-config.mjs`（设计 `specs/pipeline-release-config/design.md`）：① 配置中心 global 写入 `REPO_URL`（`git@github.com:web5/web_system.git`）；② 16 条流水线 git 脚本加「origin 与 REPO_URL 一致性校验 + 回显」；③ admin 两条线合并为「admin 发布」一条，release 脚本改 `case $DEPLOY_ENV`（local=本机 cp / 其他=scp），删除 `admin-local` 模板。**复跑幂等**（配置 0 / git 0 / release 0） |
| **M8**（gateway 双读开关 `DEPLOY_LEGACY_READ` / 默认切新） | ✅ 已完成 | `IndexHtmlService.buildManifest`（唯一来源）加开关：`DEPLOY_LEGACY_READ=1` → 短路 `buildLegacyManifest()`，只从 `deploy_modules` + `deploy_deployments` 组装，**输出与新格式同构**（`site/defaultEnv/switchable/envs/byEnv`），前端无需分支即可整体回退。启动打一条读取源日志；返回体带 `source`（`new` / `new:nosite` / `new:error` / `legacy`）便于排障 |
| M9（旧表 DROP + 旧页面清理） | ⏸️ 半成品（有明确阻塞） | 已完成：① `/modules` CRUD controller 删除；② `ModuleRegistry` 读源切新表；③ 旧页面 `ModuleDetail/ModuleEdit` 早已不存在。**阻塞见下方 M9 阻塞清单** |

### p11 迁移验证证据

```
首次执行：迁移 3 / 已存在跳过 1 / 缺产物 0 / 非 env-dir 应用 12
  admin@local → 3679b51 · portal@local → b2b6d4a · portal@dev → b2b6d4a
复跑（幂等）：迁移 0 / 已存在跳过 4            ← 重跑零差异
指针文件：/static/modules/portal/dev/index.js = export * from './b2b6d4a/index.js';
                                               export { default } from './b2b6d4a/index.js';
manifest：byEnv.dev = { admin: …, portal: … }   ← 迁移后的入口进入清单
真实网关(6000)：/static/modules/portal/dev/index.js            → 200（指针）
                /static/modules/portal/dev/b2b6d4a/index.js    → 200（版本产物）
                /static/modules/admin/local/3679b51/index.js   → 200
基座（site-version，不参与迁移）：/static/modules/shell/shell-local/8009883/index.html → 200（未受影响）
```

### p13 配置完善验证证据（本机库）

```
迁移首次：配置 +1 / git 脚本 17 / release 改写 1 / 删除 admin-local（5 行节点命令）
复跑：配置 0 / git 0 / release 0（admin-local 已不存在）        ← 重跑零差异
库内：pipelines=16；admin 恰好 1 条（env=NULL）；git 含 REPO_URL 校验 16 条
      config_items: scope=global, key=REPO_URL, value=git@github.com:web5/web_system.git
单测：npx jest src/pipeline/step-scripts.spec.ts src/pipeline-step-command/ → 23 passed

V3 来源拦截：REPO_URL 临时改为 wrong-repo → 提交 admin/local
   → [git] origin=git@github.com:web5/web_system.git
   → [stderr] [git] 代码来源不符: 期望 ...wrong-repo 实际 ...web_system → status=failed（停在 git，未构建）
V4 本机投递：恢复 REPO_URL → 提交 admin/local（审批后）
   → status=succeeded；日志含 [release] local delivery
   → 产物 ~/web_system_release/servers/gateway/public/static/modules/admin/local/76fd02a/
   → curl https://local.kedouai.com/static/modules/admin/local/76fd02a/index.js → 200 application/javascript
```

> 踩坑（2026-09-20）：节点**执行体在 `actions` 列**（`pickStepActions`：actions 非空取 `actions[].code`，
> 为空才回落 `command` 列）。p13 首版只改 `command` 列 → 页面显示已生效、执行仍是旧 scp 脚本，
> 一次 `env=local` 验证发布把产物投到了 dev 机（`modules/admin/admin-dev/76fd02a`，未切指针，dev 页面不受影响）。
> 修正：release 的 `actions[shell].code` 与 `command` 列同步写入。

### p12 流水线合并验证证据

```
执行：收敛模块 16 / 删除冗余 32（清理节点命令 160 行、变量 64 行）
复跑（幂等）：收敛 0 / 已合规跳过 16                ← 重跑零差异
API：GET /api/pipeline-templates → 16 条，每模块恰好 1 条，env 全为 null
     示例：admin 发布 / ai-agent 发布 / portal 发布 …
提交：POST /api/pipelines {moduleKey:"admin", env:"1"}（不带 pipelineId）
      → 201；实例 env=1、templateKey=admin-dev        ← 自动解析到唯一流水线
```

> 前端连带调整（环境不再属于流水线）：「环境」列改为**回显最近一次执行的环境**（无则「运行时选」+ tooltip）；
> 环境筛选改为按「最近执行环境」过滤（否则会因模板 env=null 而筛出空列表）。
> 回退备份：`/tmp/p12-backup-<ts>.json`（48 模板 + 245 节点命令）。

---

## 复现命令

```bash
# 后端单测
cd servers/deploy-console && npx jest src/apps/ src/services/ src/target/
cd servers/gateway && npx jest src/dynamic-route/

# 起临时网关（DB 路由开启）
cd servers/gateway && npm run build
PORT=6099 GATEWAY_DB_ROUTES=1 GATEWAY_SERVICE_KEY=testkey node dist/main.js
# 刷新路由缓存（规则改动后立即生效）
curl -X POST -H 'x-service-key: testkey' http://localhost:6099/api/internal/gateway/reload

# 共享 env helper 单测
cd packages/ui && npx jest

# 起临时 console（环境目录投递开关已于 2026-09-20 移除，勿再带 PIPELINE_APP_ENV_DIR）
cd servers/deploy-console && npm run build
PORT=6299 node dist/main.js

# 起临时验证实例（release 实例在 6200，勿冲突）
cd servers/deploy-console && npm run build
PORT=6299 ADMIN_USER=t ADMIN_PASS=t CONSOLE_ALLOW_LEGACY_LOGIN=1 node dist/main.js

# 登录取 token
curl -s -X POST http://localhost:6299/api/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"t","password":"t"}'

# 前端类型检查
cd apps/deploy-console && npx vue-tsc --noEmit
```

---

## M9 阻塞清单（2026-09-19 盘点，决定「哪些表现在能 DROP」）

结论：**还没有任何一张旧表现在能安全 DROP**，原因是前端/运行仍有活依赖，且
`deploy-console` 的 TypeORM 开了 `synchronize: true` —— 只要实体文件还在，DROP 后启动会自动重建。

| 旧表 | 剩余活依赖 | 解锁条件 |
|---|---|---|
| `deploy_environments` | `environmentApi.list()`（旧 `EnvironmentService`）× **6 处页面**：Dashboard / CanaryCenter / PipelineDetail / ConfigCenter / DiagnoseCenter / PipelineCenter | 这 6 处环境下拉改为 `envsApi.list()` / `envsApi.sites()`，再删 `EnvironmentService` + 实体 |
| `deploy_modules` | ① `deployApi.modules()` × 4 处（流水线/灰度模块下拉）；② `moduleApi.list()`（ConfigCenter）；③ `moduleApi.branches()`（BranchSelect 组件）；④ `ModuleRegistryService` 兜底读 | ①②④ 已由 `ModuleRegistry` 适配层覆盖（力度读），但 ③`branches` 端点直连旧表/g 目录，需单独切到 apps/services 的 `repoDir` |
| `deploy_deployments` | ① gateway `IndexHtmlService.getCurrentVersion`（**shell 基座版本加载**）；② 流水线「写版本」动作 | shell 版本须先迁到 `deploy_app_env_versions`（或独立版本账本），并让写版本双写到新表 |
| `deploy_env_service_routes` | `ServicesService` 种子导入源（M6-lite，读一次即止） | 种子已跑完即可删；需把种子代码改为「新表已有数据则跳过」 |
| `deploy_servers` | `server.service.ts` / `ServerModule` | 「主机管理」页面（对应新表 `deploy_hosts`）上线后，旧 server 模块即可退役 |

> 顺序建议：`deploy_env_service_routes`（最易）→ `deploy_servers` → `deploy_environments`
> → `deploy_modules` → `deploy_deployments`（最难，卡 shell 版本账本）。

---

## 已知偏差与决策

1. **REST 前缀**：设计写 `/api/dc/*`，实际按 console 约定 `/api/*`（全局前缀 `api` + 资源名）。文档已改。
2. **入口指针写法**：`export *` 不透传 `default` → 必须两行（单测锁定，防静默回归）。
3. **`deployMode=site-version`（shell 基座）**：不走 envId 目录、不写指针，manifest 直接用版本化 URL（Q107）。
4. **环境删除占用判定**：以 `deploy_app_env_versions.currentVersion` 非空为准（有版本指针即视为占用）。
5. **投递源目录**：由 `apps/<repoDir>/dist` 推导，不接受调用方传路径（防任意目录拷贝）。

---

| 日期 | 变更 |
|---|---|
| 2026-09-18 | 初稿：P0 完成 + P1 主体（环境域 / 应用域 / 投递激活 / 前端三页接线）与 V4–V7 证据 |
| 2026-09-20 | 原型稿交互定稿 + 方案文档同步（M15 预研）：框架改「顶部一级+左侧二级」导航、整稿亮色；画布定稿三层实体「步骤→任务→动作」（动作=脚本，write-version 脚本化；任务头 tag「任务」、动作块紧贴圆角 2px）；抽屉两态（任务总览/单动作聚焦）无保存；保存/取消/删除上移页头按钮组。`specs/pipeline-step-task/design.md` 全量同步：四层→三层模型、新增 `deploy_pipeline_actions` 表、service 操作脚本化迁移映射、验收 V1–V8 |
| 2026-09-20 | 节点「环境分支」可编辑（M14）：每环境一段脚本 → 拼装单一执行体，未配环境 fail-fast；踩坑：只传 envBranches 时 upsert 会清空 actions（丢 write-version），已修为「启用分支时保留已有操作」 |
| 2026-09-20 | p13 流水线配置完善（本机库）：配置中心 `REPO_URL` + git 来源校验；admin 两线合并为一条，release 按 `$DEPLOY_ENV` 分支（local=cp / 其他=scp）；补 `actions.code` 与 `command` 双写（执行体真相源） |
| 2026-09-20 | 移除「产物投递激活」链路：`app-artifact.service.ts`、`POST /api/apps/:key/publish`、`PublishAppDto`、`UploadExecutor.publishToEnvDir` 与 `PIPELINE_APP_ENV_DIR` 开关全部删除（`entry-pointer.ts` 保留给切换/回滚）；投递改由**按环境区分的流水线脚本**承担——新建「admin 本地发布」线（`tpl-1789875044581-vrnfbh1`，key `admin-local`）release 节点为本机 cp，dev 线仍为 scp；实测该线 `env=local` 发布成功（产物落 `modules/admin/admin-local/<commit>`）。同步修正 `EnvsModule` / `ServicesModule` 漏注册 `DeployHostEntity` 的 DI 缺陷 |
