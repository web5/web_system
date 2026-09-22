# 微前端产物按环境目录（env-dir）对齐

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：**微前端应用（deployMode=env-dir）的「构建 base / 投递目录 / 入口指针」三者必须逐段一致**——
> 本文给出该约束的推导、当前缺口清单与两种候选方案，供评审选定后再动代码与流水线配置。
> 分支：`feat/deploy-console-domain-split` ｜ 建立：2026-09-21 ｜ 范围：仅本地（local）验证

前置阅读：`specs/deploy-console-domain-split/design.md`（§3 产物结构、Q105-B）、`tech-design.md`（§2.1 T1 入口指针）、`specs/config-driven-deploy/design.md`（§3.3 配置项）、`specs/pipeline-env-scripts/design.md`

---

## 1. 背景（事故实证）

`local.kedouai.com` 门户加载失败：

```
模块 portal@env:local 加载失败。System: Unexpected token 'export'；
UMD: 模块 portal@env:local 未暴露 lifecycle（缺 mount）: /static/modules/portal/local/index.js
```

根因是**两条独立缺陷叠加**，任一条都会让 env-dir 应用整模块加载失败（白屏级）。

---

## 2. 三条硬约束（均为实测，非推论）

### C1 加载器只认 SystemJS 与 UMD，原生 ESM 会整模块失败

`packages/shell-loader` 的 `loadModule` 固定走 `System.import(entry)`，失败才回退 UMD 经典脚本
（`packages/shell-loader/src/loader.ts:146-171`）。产物以 `MF_FORMAT=system` 构建
（`scripts/deploy.sh:148`、`scripts/deploy-local.sh:76`）。

实测（systemjs 6.15.1，复刻「指针 → 版本入口 → main 分包」链路）：

| 指针写法 | 结果 |
|---|---|
| `export * from './<v>/index.js'; export { default } from './<v>/index.js';` | **THROW `Unexpected token 'export'`** |
| `System.register(['./<v>/index.js'], … _export(m) …)` | PASS，`default.mount` 为函数 |

原生 `export` 在 **SystemJS 解析阶段**即报错，文件体从未执行 ——
因此 loader 的 ③ `window.__MODULES__[name]` 全局兜底**也一并失效**
（指针没跑起来，产物自然没被加载），两条路径同时失败，错误信息即第 1 节所示。

> 注：`window.__MODULES__` 兜底只在「产物已执行、但导出名被压缩」时才有救；
> 指针语法错误时它不构成兜底。

### C2 构建 base 被烘成绝对路径，且含「产品线段」

`scripts/vite-micro-frontend.mjs` 的 `resolveMfBase(name, RELEASE_TAG)`：
`base = /static/modules/<name>/<产品线>/<版本>/`，由 Vite 烘进产物。

实测 portal 产物内烘焙的路径：

```
/static/modules/portal/portal-dev/16865ad/
/static/modules/portal/portal-dev/16865ad/logo.svg
```

→ public 资源（`logo.svg` / `favicon.svg` / `avatars/*`）按**该绝对前缀**请求。

### C3 env-dir 布局只认 `<key>/<envId>/` 下的版本目录

`servers/deploy-console/src/apps/entry-pointer.ts`：

- 指针位置：`<key>/<envId>/index.js`
- 版本目录：`<key>/<envId>/<version>/`（`envVersionDir`）
- `hasEnvVersion` / `listEnvVersions` 只扫 `<envId>/` 一层（或其二级命名空间）

`IndexHtmlService.buildManifest` 的 `byEnv` 亦固定给出
`/static/modules/<appKey>/<envId>/index.js`（`servers/gateway/src/deploy-version/index-html.service.ts:173-190`）。

### 推论（本 spec 的核心命题）

> env-dir 应用的**构建产品线段必须等于 envId**。

否则 C2 与 C3 不可同时满足：产物被烘成 `<产品线>/<版本>` 前缀，
而指针只会在 `<envId>/` 下找版本目录 —— 二者要么对不上（404/指针失效），
要么只能靠「拷贝 + 依赖原目录存活」勉强成立（见 G4）。

---

## 3. 缺口清单

| # | 缺口 | 状态 | 证据 |
|---|---|---|---|
| **G1** | 入口指针写成原生 ESM，SystemJS 无法解析 | ✅ 已修 | `entry-pointer.ts` 改 System.register；单测 9/9；浏览器 `loader.loaded=[portal,admin]` |
| **G2** | 构建产品线段 ≠ envId（portal 线用 `portal-dev`，envId 是 `local`） | ✅ 已实施（`p22`） | 构建动作按环境取 `RELEASE_TAG`（local = `<DEPLOY_ENV>/<纯commit>`，dev/prod 不变）；local 投递落 `modules/<PUBLIC_PATH>/<DEPLOY_ENV>/<纯commit>/` |
| **G3** | 发布成功后 env-dir 指针与版本表的推进 | ✅ 已完成 | 激活收敛到平台一处：`/internal/release/pointer` 的 env-dir 分支 → `AppsService.switchVersion`（写磁盘指针 + upsert `deploy_app_env_versions`）；`p24` 让 local 投递脚本改调该接口 |
| **G4** | 历史 env-dir 产物是「不自洽副本」（烘的 base 指向别的目录） | ✅ local 已重建 | `portal/local/20d1380`、`admin/local/20d1380` 均按 envId 口径重建且 base 自洽；旧的不自洽副本（`admin/local/2861340` 等）仍留在磁盘，可随 P4 清理 |
| **G5** | 「未匹配站点」（localhost/IP 直连）回落 legacy `modules` 字段，其入口是 `<流水线key>/<纯commit>` | 🟡 接受失效（不做兼容） | 用户 2026-09-21 定：历史产物不再考虑兼容。`p23` 已移除 `p22` 落的 legacy 兼容副本段并回收 `<key>/<流水线key>/` 目录 —— 非站点直连不再加载微前端；经站点域名（`local.kedouai.com`）访问不受影响 |

**G2 与 G3 的叠加效果**：site 匹配路径（`local.kedouai.com`）走 `byEnv` → env-dir 指针；
而流水线产物永远落在 `<产品线>/` 下 → 该路径**结构性地永远无法被满足**。
未匹配站点的路径（`localhost:6000`）回落旧表 `modules` → 版本目录直出，因此**只有这条路径是好的**
（这解释了「有时好有时坏」）。

---

## 4. 候选方案

| | 方案 A（推荐） | 方案 B |
|---|---|---|
| 做法 | env-dir 应用构建时 `RELEASE_TAG=$DEPLOY_ENV/$COMMIT_ID`（产品线段 = envId） | 保持产品线段 = 模板 key，把 env-dir 指针目录改为「产品线感知」 |
| 落盘 | `modules/<key>/<envId>/<commit>/` | `modules/<key>/<产品线>/<commit>/` 直接作为指针目标 |
| 与 C2 | ✅ base == 指针目录，天然自洽 | ⚠️ 需指针跨目录指（`../<产品线>/<commit>/`）或 manifest 直接用版本化 entry |
| 代价 | release 脚本需按 env 拼 RELEASE_TAG（M14/p13 的 env 分支机制已具备） | 等于放弃 Q105-B「envId 目录」决策，回退到 Q105-D |
| 风险 | 存量脏数据（G4）需一次性重建 | 与环境维度的绑定期望冲突（同模块同版本跨环境共享产物，`x-env-id` 语义变模糊） |

**决策：采用 A（2026-09-21，用户确认）。** 它让「一条 `envId` = 一个目录」重新成立，
`hasEnvVersion` / `listEnvVersions` / 切换回滚 / 清理策略全部无需改动，且与
`config-driven-deploy` 的配置化方向一致（`STATIC_PUBLIC_ROOT` 管根，环境段由 envId 管）。

实施范围收敛：**只改 local**。构建动作是非环境分支的平台托管脚本，因此用 bash 内条件
（`DEPLOY_ENV == local` 才走 env 段）区分，dev/prod 的 `RELEASE_TAG` 保持 `<流水线key>/<纯commit>` 不变
—— 远程线行为零变化。

---

### 4.1 A 的落地设计：指针写入收敛到平台一处

**问题**：现在「切 env 指针」有两套实现 —— 流水线脚本用 heredoc 自己拼 `System.register` 文本（`p22`），
平台里又有 `entry-pointer.ts#writeEnvEntryPointer`（带单测）。两处写法必然漂移。

**设计**：脚本不再自己写指针，只负责「把产物放到 `<key>/<envId>/<纯commit>/`」，
然后调**平台内部接口**完成激活（指针 + 版本表），指针格式只在 `entry-pointer.ts` 一处实现。

**接口**：扩展现有的 `POST /api/internal/release/pointer`（`x-internal-key` 鉴权，发布节点脚本既有调用姿势）：

| moduleKey 类型 | 行为 |
|---|---|
| `deploy_apps.deploy_mode = 'env-dir'` | 走**应用域激活**：校验 `<key>/<envId>/<纯commit>/index.js` 存在（fail-fast）→ `writeEnvEntryPointer` 写磁盘指针 → upsert `deploy_app_env_versions`（`current_version=纯commit`、`previous_version=旧值`） |
| 其余（后端服务 / site-version） | 保持现状：只 upsert `deploy_deployments`（legacy 指针） |

入参（env-dir 分支）：`{ moduleKey, env, versionTag: <纯commit>, operator }`。

**缓存**：本路径**不需要额外清缓存**，依据：

| 读取方 | 是否缓存 | 结论 |
|---|---|---|
| 控制台 `AppsService.listAppEnvs` / `listVersions`（读 `deploy_app_env_versions`） | 无缓存（每次 `repo.find` 直连 DB） | 写完立即生效 |
| 控制台读磁盘指针 `readEnvEntryPointer` | 无缓存（每次读文件） | 写完立即生效 |
| gateway `buildManifest` 读 `deploy_app_env_versions` | 无缓存 | `byEnv` 入口不含版本，切指针本就不需要刷新 |
| gateway `htmlCache`（index.html） | 按文件 mtime | 不涉指针改动 |
| gateway `versionCache`（10s TTL，读**旧表** `deploy_deployments`） | 有 | 仅服务 shell 基座版本解析与非站点回落字段；env-dir 应用的加载路径不读它 |

> 遗留提示：**shell 换版本**仍受 `deploy_deployments` 的 10s TTL 影响（`getCurrentVersion(envId,'shell')`
> 决定加载哪个 `shell/<version>/index.html`）—— 与本文无关，但排障时要知道最多等 10s。

**验证证据（2026-09-21，local）**：

```
① 幂等：POST /api/internal/release/pointer {portal,local,20d1380}
   → {"mode":"env-dir","from":"20d1380","unchanged":true}
② 鉴权：x-internal-key 错误 → 401
③ fail-fast（指针不前进）：versionTag=nosuchver
   → 400 "版本产物不存在，无法切换：portal/local/nosuchver（产物目录缺 index.js）"
④ 真实切换（临时版本 zz-verify）：
   磁盘 portal/local/index.js → System.register(['./zz-verify/index.js'], …)
   DB   portal@local current=zz-verify / previous=20d1380 / deployed_by=p24-verify   ← 两处同时更新
⑤ 切回 20d1380 后：磁盘指针 → ./20d1380/index.js；DB current=20d1380
⑥ 回归：浏览器 loader.loaded=[portal,admin]、__MODULES__.{portal,admin}.mount=function、控制台 0 错 0 警
```

### 4.2 site-version 应用（基座 shell / 小程序）与「部署」语义

**与 env-dir 的差别**（三者对照）：

| | env-dir（portal / admin） | site-version（shell / mini-contract） |
|---|---|---|
| 加载路径 | `/static/modules/<key>/<envId>/index.js`（**磁盘指针**）→ `byEnv` | `/static/modules/shell/<version>/index.html`（**`deploy_deployments` 指针** → `getCurrentVersion(envId,'shell')`） |
| 产物落盘 | `modules/<key>/<envId>/<纯commit>/` | `modules/<key>/<流水线key>/<纯commit>/`（产品线段 = 流水线 key，**不带 env**） |
| 版本段来源 | `${COMMIT_ID##*/}`（纯 commit） | 整个 `COMMIT_ID`（如 `shell-dev/16865ad`） |
| 指针写入口 | 平台接口 env-dir 分支（`writeEnvEntryPointer` + 版本表） | `deploy_deployments`（控制台「部署」/ 平台接口 legacy 分支） |
| 缓存 | 无（读表与磁盘指针均直连） | **有**：gateway `versionCache`（TTL 10s） |

**「部署」动作的分流（本次修复）**：`DeployService.deployVersion` 过去**无条件**写 `deploy_deployments` ——
对 portal/admin 而言那等于空转（它们的加载路径是 env 指针，根本不读这张表），
表现为「部署成功但页面没变」。现按 `deployMode` 分流：

- `env-dir` → `AppsService.switchVersion`（写 env 指针 + 版本表），与流水线激活**同一实现**；
- `site-version` → 写 `deploy_deployments` + **通知 gateway 失效版本缓存**（否则最多 10s 仍加载旧基座）；
- 后端服务 → 保持原行为（落地 dist + 重启 pm2），不涉及前端指针。

**缓存失效通路**：复用了既有的 `POST /api/internal/gateway/reload`（`x-service-key` 鉴权）——
它原先只刷 DB 路由缓存，现一并清 `IndexHtmlService.versionCache`，响应回报 `versionCacheCleared`。
控制台通过 `GATEWAY_INTERNAL_URL` + `GATEWAY_SERVICE_KEY` 调用（**best-effort**：失败只告警，
最多 10s 缓存自然过期，不影响部署结果）。

> ⚠️ 实现坑：**不能用 Node 全局 `fetch`** 调这个接口 —— undici 按 WHATWG 规范拒连「bad port」，
> 而 gateway 本地端口 6000 正在黑名单里，表现为与网络无关的 `fetch failed`。
> 控制台侧因此改用 Node `http`/`https` 模块（`DeployService.postNoBody`）。

**仍未对齐的一项**：shell 的**发布**不会自动切指针（只有「部署」会），
而 portal/admin 的发布经 `p24` 已自动激活 —— 即「前端发布即生效」这条语义目前只覆盖 env-dir 应用。

> **决策（2026-09-21，用户确认）：保持现状** —— shell 的发布不自动切指针，基座切换保留为
> 人工「部署」动作（基座影响所有访客，人工闸门有意保留）。

---

## 5. 影响清单

| # | 文件 / 位置 | 改动 | 风险 | 状态 |
|---|---|---|---|---|
| I1 | 流水线 DB 脚本（`deploy_pipeline_actions.script`） | ① 构建动作：local 的 `RELEASE_TAG` 改 `<DEPLOY_ENV>/<纯commit>`；② 发布·local 投递动作：落 `<PUBLIC_PATH>/<DEPLOY_ENV>/<纯commit>/` + 写 env 指针 + legacy 兼容副本 | 中：模板级脚本，改错影响所有环境 → 已用 bash 条件把 dev/prod 隔离 | ✅ `scripts/migrations/p22-app-env-dir-artifact.mjs`（幂等、`bash -n` 前置校验、备份可回退） |
| I2 | `deploy_apps.public_path` | env-dir 应用的构建段不再由它决定（改由 envId）；它仍用于 legacy 直出目录 | 低 | 🟡 语义已落实，字段保留（P4 再议） |
| I3 | `/internal/release/pointer` + `AppsService` + `DeployModule` | env-dir 应用走**应用域激活**（校验产物 → 写磁盘指针 → upsert 版本表）；指针格式收敛到 `entry-pointer.ts` 一处 | 中：写路径变更 | ✅ 已实施（`p24`；端到端已验证） |
| I4 | 存量 env-dir 产物 | 按 envId 口径重建 | 低（仅磁盘产物） | ✅ local 两个应用已重建为 `<key>/local/20d1380/` |
| I5 | `scripts/migrations/p11-app-env-artifacts.mjs` | 迁移时校验产物 base 自洽性，不满足则告警跳过 | 低 | ⬜ 未做 |
| I6 | 双源真相（`deploy_app_env_versions` vs `deploy_deployments`） | env-dir 应用以新表为准，旧表 P4 退役 | 中 | ⬜ 随 P4 |
| I7 | legacy 兼容副本（G5） | 不再做兼容，移除 `p22` 落的副本段 | 低 | ✅ 已移除（`p23`） |
| I8 | 历史记录与产物目录瘦身 | 流水线运行/审批/版本记录只留当前；遗留 `_bak_*` 表 DROP；磁盘只留指针指向的版本 | 中（不可逆，已做备份） | ✅ `scripts/migrations/p23-cleanup-history.mjs`（DB dump + 磁盘 mv 垃圾站，可回滚） |
| I9 | `DeployService.deployVersion`（控制台「部署」） | 按 `deployMode` 分流：env-dir → env 指针；site-version → legacy 指针 + 清缓存 | 中：改的是所有模块共用的部署入口 | ✅ 已实施（端到端已验证：portal `mode=env-dir`、shell `mode=legacy`） |
| I10 | gateway `versionCache` 失效通路 | 扩展 `/api/internal/gateway/reload` 一并清版本缓存；控制台在 site-version 部署后调用 | 低：best-effort，失败只告警 | ✅ 已实施（console `已通知` → gateway `版本缓存已失效：3 条` 同刻） |

---

## 6. 验证方式（本地）

1. 单测：`cd servers/deploy-console && npx jest src/apps/`（入口指针写法锁定）
2. 迁移幂等 + 语法：`node scripts/migrations/p22-app-env-dir-artifact.mjs`（首跑变更、复跑零差异；写库前 `bash -n`）
3. 投递脚本功能验证（沙箱，不动真实目录）：
   `RELEASE_DIR=/tmp/p22-sandbox PUBLIC_PATH=portal DEPLOY_ENV=local COMMIT_ID=portal-dev/<sha> BUILD_OUTPUT_DIR=apps/portal/dist bash <投递脚本>`
   → 期望产出 `local/<sha>/`（产物）+ `local/index.js`（System.register 指针）+ `local/index.css` + `<流水线key>/<sha>/`（兼容副本）
4. 指针协议：浏览器（`https://local.kedouai.com`）执行
   `await window.__LOADER__.preload(['portal','admin'])` → `debug().loaded` 含两者，
   且 `typeof window.__MODULES__.<name>.mount === 'function'`
5. 端到端：流水线发 `portal@local` → 产物落 `modules/portal/local/<纯commit>/` → 指针随发布切换
   → 页面刷新加载新版本（不接受手造文件造成的假阳性）

### 本次验证证据（2026-09-21）

```
p22 首跑：已更新 4 条动作（admin/portal 的「构建」+「发布·local·投递产物」）；dev 任务判为非 local，未动
p22 复跑：没有需要变更的动作                        ← 幂等
投递脚本沙箱执行：
  [release] local delivery: …/apps/portal/dist -> …/modules/portal/local/20d1380
  [release] env 指针已切到 local/20d1380
  [release] legacy 兼容副本: …/modules/portal/portal-dev/20d1380
指针内容：System.register(['./20d1380/index.js'], function (_export) { … _export(m) … })
样式指针：@import url('./20d1380/index.css');
浏览器：loader.loaded=[portal,admin]、__MODULES__.{portal,admin}.mount=function、控制台 0 错 0 警
```

---

## 7. 待确认项

| # | 问题 | 结论 / 建议 |
|---|---|---|
| Q1 | 选方案 A 还是 B | **A**（2026-09-21 用户确认，见 §4） |
| Q2 | env-dir 应用的「产品线段」是否彻底废弃（统一为 envId） | 是（local 已按此实施）；`public_path` 保留给 `site-version` 类应用（shell / 小程序） |
| Q3 | 发布即切指针是否符合预期（无审批闸门） | 现状：local 投递即切 env 指针（前端「切指针即生效」）。若需要人工闸门，在投递动作后加审批任务，或加 `AUTO_SWITCH=off` 开关 |
| Q4 | 存量不自洽副本清理时机 | 随 P4（legacy 读取源退役）一并清理：`<key>/<流水线key>/` 段与旧 envDir 残留 |
| Q5 | dev/prod 是否也切到 env 段 | 待定。切过去需要远程线同时产出并投递指针文件（远端 gateway 静态目录），收益需先确认；当前**仅 local** |
| Q6 | shell 的**发布**是否也自动切指针 | 建议对齐（前端统一「发布即生效」）：在 shell 的 local 发布任务末尾加一次 `/internal/release/pointer`（legacy 分支，`versionTag=${COMMIT_ID}`）。代价：发布即切基座版本，影响所有访客 —— 若要保留人工闸门则维持现状（发布后需手动「部署」）。**待定，当前维持现状** |
