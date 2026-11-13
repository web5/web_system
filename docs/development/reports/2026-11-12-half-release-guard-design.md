# 半发布治理三合一 · 设计（唯一原子步 + 三方对账 + 直写库检测/修复通道）

| 项 | 内容 |
|---|---|
| 日期 | 2026-11-12 |
| 产出角色 | rd-engineer（TDD：red-green-refactor），**本文不授权任何发布/改库/改配置动作** |
| 对象 | worktree `~/workspace/web_system-half-release-fix`，分支 `fix/half-release-guard-20261112`（基于 origin/master `11af32e6`） |
| 依据 | 专项真源 `30-任务产物/2026-11-12-…/05a-微前端版本标记问题专项.md`（P0-1/P0-2）、`06-架构问题全量清单汇总.md` §一、`03-技术架构与实现Review` §一.2/S2；源码只读核查（apps.service.ts / pointer.executor.ts / internal-release.controller.ts / release-registry.service.ts / consistency-watch.service.ts / retention.service.ts / pipeline.service.ts / orchestration-schema.ts / release-verify/* / entry-pointer.ts / env-artifact.service.ts / http-probe.service.ts / gateway-cache.service.ts） |
| 用户已拍板方向 | 批次①「半发布治理三合一」立项（2026-11-12 12:26）：P0-1 唯一原子步 + P0-2 半发布判据 + 03 直写库检测与半发布正规修复通道 |
| 脱敏 | 全文只出现键名、路径、行号；🔴 不含任何密钥/连接串/配置值 |

---

## 0. 需求三件齐

- **【需求】** env-dir 应用「激活」没有唯一原子步：四条写路径各写一半（脚本自写磁盘指针不落表 = 11-09 portal 半发布实证；内置 pointer 步骤只写表不写盘），且半发布**无机器判据**（盘↔表↔manifest 三方无人对账、GC 保护名单不含磁盘指针指向的版本），直写库改配置/修指针无审计、无正规修复通道。
- **【目标用户】** 发布运维（rd-releaser / 橙子哥哥）与巡检 agent：发布时防住新的半发布；巡检时发现存量撕裂；修复时走受控通道而非人工写库。
- **【成功判据】** ① 编排数据里脚本自写磁盘指针 = 保存即 400；② 流水线 env-dir 切版本全部经过「表→盘→云库镜像 + 失败补偿」原子步；③ 发布收尾 manifest 版本 ≠ 本次 versionTag → 流水线判 failed 且 `verify_release` 同口径判 fail；④ 盘↔表↔manifest 漂移 ≤1 个巡检周期内被发现（报告 + 错误日志）；⑤ GC 保护名单覆盖磁盘指针解析版本；⑥ config_items 无审计修订的行出现在巡检报告；⑦ 存在带审计的「指针修复」入口，半发布可经它收敛。

---

## 1. 只读核查结论（设计的事实底座）

### 1.1 四条写路径实证（与 05a §一.1 一致，补行号）

| 路径 | 入口 | 盘 | `deploy_app_env_versions` | legacy `deploy_deployments` | 云库镜像 |
|---|---|---|---|---|---|
| A UI 切换/回滚 | `AppsService.doSwitchVersion`（apps.service.ts:538-619） | ✅ + 失败补偿回滚表 | ✅ `setAppEnvPointer` | ❌（env-dir 本就不写） | ✅ strict |
| B 脚本接口 env-dir 分支 | `internal-release.controller.ts:118-138` → A | ✅ | ✅ | ❌ | ✅ |
| C 内置 pointer 步骤 | `pointer.executor.ts:51-57` → `registry.setPointer` | ❌ **从不写盘** | ✅（setPointer 双写） | ✅ | ✅ |
| D 编排收尾兜底 | `pipeline.service.ts:2233-2249`（编排模式 succeeded 段）→ `registry.setPointer` | ❌ | ✅ | ✅ | ✅ |
| E 脚本自写盘指针（编排数据，11-02 起） | 编排 action 脚本正文 | ✅ 自写 | ❌ 只调 `/internal/release/versions` | ❌ | ❌ |

> 结论：「表 + 盘 + 镜像」三面被拆在 A~E 五条路径里；A 是唯一原子步但流水线不用它（C/D 绕过 A 直接调 registry）。**修复 = 让 C/D 改走 A，让 E 在保存期被禁。**

### 1.2 判据/治理缺口实证

- `ConsistencyWatchService.check()`（consistency-watch.service.ts:137-148）只比对本地库 vs 云库两张**指针表**；盘/表/manifest 三方无人比对。
- `RetentionService.protectedVersionKeys()`（retention.service.ts:154-179）只读两张 DB 指针表；磁盘指针解析值（`readEnvEntryPointer`）不在保护集合。
- `config_items` 全部正规写路径经 `ConfigService.writeRevision`（config.service.ts:502-537，失败只告警不阻断）落 `config_revisions`；直写库的行 = 无修订记录或值指纹与最新修订 `after_fingerprint` 不符，**现状无任何比对**。
- 既有可复用件：`HttpProbeService.fetchGatewayManifest`（probe/http-probe.service.ts:94-104，现无生产调用方）、`GatewayCacheService.urlFor(env)`（`GATEWAY_INTERNAL_URL_<ENV>` 按环境取值）、`EnvArtifactService.readPointer`（env-artifact.service.ts:188-202，CDN 模式返回 null）、`toCommitId` 归一化（pipeline/release-paths.ts）。
- manifest 形态：gateway `GET /__manifest__`（version.controller.ts:47-60 → `IndexHtmlService.buildManifest`）返回 `byEnv[env][app]={entry,css,version}`，version 已经过读取侧 G1 归一化；版本缓存 TTL 10s，写方经 `notifyVersionChange` 主动失效。

---

## 2. 方案总览（三合一）

| 子项 | 问题 | 修复 |
|---|---|---|
| F1 唯一原子步 | P0-1：五条写路径各写一半 | ① 编排保存期禁脚本自写盘指针（检出即 400）；② C/D 两处流水线切版本改走 `AppsService.switchVersion`（原子步）；③ 发布收尾 manifest==versionTag 硬门禁 + `verify_release` 新增同口径检查 |
| F2 三方对账 | P0-2：无判据、GC 放大撕裂 | 新增 `PointerReconcileService`（盘↔表↔manifest 巡检，report-only）；`protectedVersionKeys` 并入磁盘指针解析值 |
| F3 直写库治理 | 03-S2：直写库无检测、半发布无正规修复通道 | 新增 `ConfigAuditWatchService`（config_items ↔ config_revisions 比对，report-only）；`AppsService.repairPointer` + 控制台端点（对齐原子步、强制盘指针收敛、写审计） |

### 2.1 非目标

- 不改 P1 系列（版本串拼写归一 P1-b、unchanged 自愈 P1-c、回落首项 P1-d）——批次②；但 F3 修复通道内部**局部**豁免 unchanged 短路（仅 repair 入口，默认路径语义不变）。
- 不动 CDN 布局行为（CDN 模式无磁盘指针，对账自动降为「表↔manifest」两方）。
- 不做自动修复/自动回滚：所有巡检 report-only，所有修复走人工触发入口。
- 不处理 remote-cleanup-watch 的清理目标枚举扩面（05a 提及；`remote-cleanup` 默认只观测，列为遗留风险 R5）。

---

## 3. 技术方案

### 3.1 F1-① 编排保存期禁脚本自写盘指针（检出即报错）

- 新增纯函数 `findSelfPointerWrites(script: string): string[]`（放 `pipeline-orchestration/orchestration-schema.ts` 同文件导出，纯函数便于单测）。命中即返回命中形态描述列表：
  1. 重定向/heredoc/`tee` 写入 `static/modules/<app>/<env>/index.js|index.css`（盘指针文件）；
  2. `cp`/`mv`/`ln -sf` 以盘指针文件为目标；
  3. 脚本内拼 `System.register(['./<v>/index.js']` 并写文件（自制指针文本）；
  4. `node -e`/`node -e "…writeEnvEntryPointer…"` 等直接调用指针写函数。
- `validateTree` 对每个 script 动作追加该校验（与 bash -n、变量检查同级），命中 → 错误文案指明「磁盘入口指针只允许平台原子步写入：改用 `POST /internal/release/pointer`（env-dir 自动含盘写）或内置 pointer 步骤」。`saveTasks`/`saveSteps` 现状即调 validateTree → 保存即 400，无新端点。
- 存量编排数据：保存期门禁拦不住「已在库里、不再保存」的旧脚本 → 由 F2 巡检兜底发现漂移，并在设计评审后由运维对存量编排做一次人工核查（一次性，列入实施顺序 S1）。

### 3.2 F1-② 流水线切版本收敛到原子步

- `PointerExecutor.run`（pointer.executor.ts:50-59）direct 分支：模块在 `deploy_apps` 登记且 `deployMode='env-dir'` → 改调 `appsService.switchVersion(moduleKey, env, versionTag, operator, runId)`（runId 作 lockOwner，与流水线自持锁同源 = 重入）；否则保持 `registry.setPointer`（后端 / site-version shell 语义不变）。
- 编排收尾兜底（pipeline.service.ts:2233-2249）：`moduleType!=='backend'` 段先查 `appsService.findAppOrNull`：env-dir → 同上走 switchVersion；其余前端（site-version shell）保持 `registry.setPointer` + `toCommitId` 兜底不变。
- 语义对齐点：switchVersion 对 env-dir 本就**不写 legacy 表**（与现状路径 B 一致；legacy 表仅服务后端与应急读取开关，05a §一.1 已注明以新表为准），不算回归。
- 模块 wiring：`PipelineModule` 新增 `AppsModule` import（AppsModule 依赖 CloudDb/ReleaseRegistry/Shell/Common/Envs/Audit，不回指 PipelineModule，无环）。

### 3.3 F1-③ 发布收尾 manifest==versionTag 硬门禁

- 新增纯函数 + 服务方法：`assertManifestVersion({probe, gatewayUrl, env, moduleKey, expectVersion, attempts})`（放 `pipeline/release-final-guard.ts`）：
  - `gatewayUrl = gatewayCache.urlFor(env)`；未配置 → **跳过并 warn**（不阻断：无 gateway 地址的环境无法取 manifest，按「判不了不判 fail」处理，与 verify_release 的 unknown 语义对齐）；
  - `fetchGatewayManifest(url)` → `byEnv[env][moduleKey].version`（兼容回落 `modules[]` 中同名模块）；
  - 比对两侧均过 `toCommitId` 归一；不一致 → 间隔重试（默认 4 次 × 3s，覆盖 gateway 版本缓存 TTL 10s 的边界）；仍不一致 → 抛 `ManifestGateError`。
- 接入点（两处成功出口，仅 `moduleType!=='backend'`）：经典模式 `pipeline.service.ts:1904` 前置；编排模式 succeeded 段指针切换之后。失败 = run 判 failed（错误文案含盘/表/manifest 三方值），**不自动回滚指针**（拍板项 P1）。
- `verify_release` 同口径：`release-verify.types.ts` 的 `VERIFY_CHECK_KEYS` 新增 `manifestMatches`（core，前端模块适用；后端/取不到 gateway 地址 → skipped）；`ReleaseVerifyService` 用同一纯函数实现检查。L1 只读红线不破（fetch manifest 是 GET）。
- 变异思维：旧行为下「表已切、盘/manifest 滞后于缓存」会被门禁误杀吗？—— 原子步内已 `notifyVersionChange` 主动失效缓存，重试窗口再覆盖 TTL；蒙混反向（盘新表旧）在 11-09 形态下 manifest 由 DB 驱动 = 旧值 ≠ versionTag → 必被抓。

### 3.4 F2 三方对账巡检 `PointerReconcileService`（reconcile/ 新增）

- 枚举：`deploy_apps`（`deploy_mode='env-dir'`）× `deploy_envs`（enabled）；逐对取三方值：
  - 盘：`EnvArtifactService.readPointer(env, app)`（CDN 模式返 null → 该侧 skipped）；
  - 表：`deploy_app_env_versions.current_version`（无行 = null）；
  - manifest：按 env 分组每组取一次 `/__manifest__`，取 `byEnv[env][app].version`（gateway 地址未配置/请求失败 → 该侧 unknown，不判 drift）。
- 判据：三方均按 `toCommitId` 归一后比较；任一可得侧不一致 → drift（diff 记录三方**原始值** + 归一值，便于识别拼写漂移 vs 真漂移）。
- 产出：`PointerReconcileReport{ranAt,status:ok|drift|error,checkedPairs,diffs[]}`；drift → `logger.error` + `lastReport()`；端点 `GET /api/reconcile/pointers`（`?run=1` 立即跑）。间隔 `POINTER_RECONCILE_INTERVAL_MS`（默认 6h，0=关），风格与 ConsistencyWatchService 对齐。
-  wiring：ReconcileModule 加 `AppsModule`（EnvArtifactService）+ `ProbeModule`（HttpProbeService）；CommonModule 已提供 GatewayCacheService（经 PipelineModule 传递不可用时直接 import CommonModule）。

### 3.5 F2 GC 保护名单并入磁盘指针

- `RetentionService.protectedVersionKeys()` 追加：枚举 env-dir 应用 × 启用环境 → `readPointer` 解析值（原始值 + `toCommitId` 归一值，两种拼写都进保护集合，防 P1-b 拼写差被误删）。
- 读远端失败 → 跳过该对并 warn（宁可少保护一条也不让 GC 整体崩；该对同时会被 F2 巡检以 unknown 记录）。
- 依赖：RetentionService 注入 EnvArtifactService（ReconcileModule import AppsModule，与 3.4 共用）。

### 3.6 F3 直写库检测 `ConfigAuditWatchService`（reconcile/ 新增）

- 纯函数 `diffConfigAudit(items, latestRevisions)`：
  - 行存在但业务键（scope,env,module,key）**无任何修订** → `unaudited-row`（直写新增）；
  - 行存在、最新修订 action='delete' → `resurrected-row`（直写复活）；
  - 行值指纹 ≠ 最新修订 `after_fingerprint` → `value-drift`（直写改值；指纹 = 与 writeRevision 同款 `valueFingerprint`，密文对密文，不解密）；
  - 修订存在（create/update）但行已被删 → `unaudited-delete`（直写删除）。
- 服务：定时（`CONFIG_AUDIT_WATCH_INTERVAL_MS`，默认 6h，0=关）+ report-only（`ConfigAuditReport{ranAt,status,checkedRows,diffs[]}`），drift → `logger.error`；端点 `GET /api/reconcile/config-audit`（`?run=1`）。**不自动改任何数据。**
- 存量基线：11-12 人工补录的微信键等历史直写行首次巡检必然上报 → 拍板项 P3（基线确认机制）。

### 3.7 F3 半发布正规修复通道 `repairPointer`

- `AppsService.repairPointer(appKey, envId, to?, operator, reason?)`：
  1. 目标版本解析：显式 `to` > 表 `current_version` > 盘指针解析值；三者皆空 → 400「无可收敛目标」；
  2. 产物存在性校验（复用 doSwitchVersion 同款 fail-fast）；
  3. **强制收敛**：即使表已是目标值（unchanged），仍重写磁盘指针并校验读回值 == 目标（repair 入口对 P1-c 短路的局部豁免，仅限本入口）；
  4. 表不在目标值 → 走 `setAppEnvPointer`（含云库镜像 strict）先落表，再写盘，失败补偿回滚（= 原子步本体）；
  5. 写审计（action=`apps.pointer.repair`，含 from（盘/表原值）/to/reason）+ gateway 缓存失效通知；
  6. 返回 `{appKey, envId, from:{table,disk}, to, repaired:boolean}`。
- 端点：`POST /api/apps/:key/envs/:envId/pointer/repair`（JWT 控制台通道，人在回路；body `{to?, reason?}`，prod 时 reason 必填）。

### 3.8 接口约束汇总

```
POST /api/apps/:key/envs/:envId/pointer/repair   (JWT)
Body:  { to?: string, reason?: string }
200:   { appKey, envId, from: {table,disk}, to, repaired }
400:   无可收敛目标 / 产物不存在 / prod 缺 reason
404:   应用未登记或非 env-dir

GET /api/reconcile/pointers       (?run=1 立即跑)   → PointerReconcileReport
GET /api/reconcile/config-audit   (?run=1 立即跑)   → ConfigAuditReport
```

编排保存门禁无新端点：`POST /api/pipelines/:id/steps|tasks` 现状即返 400 + 错误文案。

### 3.9 测试（六维）

TestScope: 定向=`pipeline-orchestration/orchestration-schema.spec.ts`（自写指针检出）、`pipeline/steps/pointer.executor.spec.ts`（env-dir 走原子步）、`pipeline/pipeline.service.spec.ts`（收尾门禁 + env-dir 收敛）、`pipeline/release-final-guard.spec.ts`（新增，纯函数）、`release-verify/release-verify.service.spec.ts` + `release-verify-rules.spec.ts`（manifestMatches）、`reconcile/pointer-reconcile.service.spec.ts`（新增）、`reconcile/retention.service.spec.ts`（盘指针并入保护）、`reconcile/config-audit-watch.service.spec.ts`（新增）、`apps/apps.service.spec.ts` / `apps/switch-version.spec.ts`（repairPointer）；抽样=`deploy/internal-release-lock-owner.spec.ts`、`pipeline/steps/step-registry.spec.ts`、`pipeline-orchestration/orchestration-engine.spec.ts`、`reconcile/consistency-watch.service.spec.ts`；共享面=`pipeline/pipeline.service.ts`、`apps/apps.service.ts`、`reconcile/retention.service.ts`、`release-verify/*`（这些文件全部既有 spec 随 MR 跑绿）。

| 维度 | 内容 |
|---|---|
| 单元 | V1–V8（见 §4），全部先红后绿 |
| 契约 | 保存编排含自写盘指针 → 400；repair 端点参数负例 |
| 回归 | 上列共享面既有 spec 全绿；legacy/后端路径行为零变化断言（pointer.executor 非 env-dir 仍走 setPointer） |
| 安全 | prod repair 缺 reason → 400；审计必含 from/to/operator |
| 变异 | 每条新判据附「旧行为能否蒙混」分析（设计 §3.3 已示范；单测用旧行为构造反例） |
| 验收 | 代码与单测层面全绿；不碰 dev/prod 环境（纯单测，无实发） |

---

## 4. 验证判据

| # | 判据 | 验证方式 |
|---|---|---|
| V1 | `findSelfPointerWrites` 命中 4 类形态（重定向/tee/cp-mv-ln/自制 System.register 指针文本/node 调 writeEnvEntryPointer）；正常脚本（curl `/internal/release/pointer`、读指针、写 `$WS_RESULT_FILE`）不误伤 | orchestration-schema.spec 正反例 |
| V2 | 保存含自写盘指针动作的 tasks → 400 且文案指明正规通道 | orchestration-schema/service 层 spec |
| V3 | PointerExecutor：env-dir 应用 → 调 switchVersion（断言 registry.setPointer **未**被调）；后端/shell → setPointer 不变；grayscale 分支零变化 | pointer.executor.spec |
| V4 | 编排收尾：env-dir → switchVersion；site-version → setPointer+toCommitId 兜底不变 | pipeline.service.spec |
| V5 | manifest 门禁：byEnv 版本==versionTag（含 `<ns>/<commit>` vs 纯 commit 拼写差）→ 放行；不一致重试后 → run failed；gateway 地址未配 → 跳过不判 fail | release-final-guard.spec + pipeline.service.spec |
| V6 | verify_release 新增 manifestMatches：一致 pass / 不一致 fail（core）/ 后端 skipped / 取不到 unknown；L1 只读红线 spec 仍绿 | release-verify spec |
| V7 | 三方对账：盘≠表、表≠manifest、盘缺失、CDN 模式盘侧 skipped、归一化拼写差不误报 | pointer-reconcile.spec |
| V8 | GC：`protectedVersionKeys` 含盘指针解析值（两种拼写）；readPointer 失败不影响整体 | retention.spec |
| V9 | 直写库检测：无修订行 / delete 后复活 / 值指纹漂移 / 直写删除 四类全检出；正规变更（有修订且指纹一致）零误报 | config-audit-watch.spec |
| V10 | repairPointer：表盘撕裂（盘新表旧/盘旧表新/表空盘有值）三种形态均收敛到目标；unchanged 时仍重写盘；审计留痕 | apps.service.spec |

## 5. 文件面预估

| 文件 | 改动 |
|---|---|
| `pipeline-orchestration/orchestration-schema.ts`（+spec） | +`findSelfPointerWrites` + validateTree 接线 |
| `pipeline/steps/pointer.executor.ts`（+spec） | env-dir → AppsService.switchVersion |
| `pipeline/release-final-guard.ts`（+spec，新） | manifest 门禁纯函数 |
| `pipeline/pipeline.service.ts`（+spec） | 编排收尾 env-dir 收敛 + 两处成功出口挂门禁 |
| `pipeline/pipeline.module.ts` | +AppsModule import |
| `release-verify/release-verify.types.ts` / `release-verify.service.ts`（+specs） | +manifestMatches 检查 |
| `reconcile/pointer-reconcile.service.ts`（+spec，新） | 三方对账巡检 |
| `reconcile/config-audit-watch.service.ts`（+spec，新） | config_items ↔ config_revisions 比对 |
| `reconcile/retention.service.ts`（+spec） | 保护名单并入盘指针 |
| `reconcile/reconcile.module.ts` / `reconcile.controller.ts` | wiring + 2 个只读端点 |
| `apps/apps.service.ts`（+spec） | +repairPointer |
| `apps/apps.controller.ts` | +repair 端点 |

命中共享面：**pipeline.service.ts、apps.service.ts、retention.service.ts、release-verify/**——按门禁规范，其全部既有 spec 必须跑绿。

## 6. 实施顺序

| 序 | 步骤 |
|---|---|
| S1 | 设计评审 + 拍板（P1–P3）；运维对存量编排数据做一次人工核查（自写盘指针脚本清单） |
| S2 | TDD 实现 F1 → F2 → F3（本 worktree，不 commit） |
| S3 | 共享面全量 spec + 定向 spec 全绿取证 |
| S4 | 交付 team-lead；后续发版/上线另立审批（deploy-console 永远手动发布） |

## 7. 回滚

全部为**新增判据与收敛入口**，回滚 =  revert 对应文件；门禁类（manifest 硬门禁、保存期 400）回滚后即恢复旧行为，无数据迁移、无 DDL。巡检服务默认间隔可配 0 关闭，本身就是软开关。

## 8. 风险

| # | 风险 | 爆炸半径 | 缓解 |
|---|---|---|---|
| R1 | manifest 门禁在 gateway 缓存刷新失败的极端情况下误杀发布 | 该次发布判 failed（指针已是新值，实际已生效） | 门禁前原子步已 notify 缓存 + 重试窗口盖 TTL；失败文案给三方值便于人工确认；不自动回滚 |
| R2 | 保存期门禁误伤合法脚本（正则误命中） | 该流水线编排无法保存 | 命中形态白名单化（只认盘指针确切路径形态）+ 单测正反例；误伤时可把路径写入变量规避（文档注明） |
| R3 | 存量编排里仍有自写盘指针脚本，在下次编辑保存时才被拦 | 存量撕裂继续靠 F2 巡检发现 | S1 人工核查清单；F2 巡检 6h 内必报 |
| R4 | 三方对账给 gateway 增加每组一次 `/__manifest__` 请求 | 可忽略（6h × 环境数） | 按 env 分组去重；失败降级 unknown 不判 drift |
| R5 | remote-cleanup-watch 清理目标枚举仍只读指针表（05a 提及的另一半） | 半发布 (app,env) 表无行时远端清理扫不到它 | 本期只并入 retention 保护名单；remote-cleanup 默认只观测，列为批次②候选 |
| R6 | repair 入口被当日常切版本用（绕过审批） | 语义等同 UI 切版本 | 仅 JWT 控制台通道 + reason 审计；prod 强制 reason；文档注明「修复专用」 |

## 9. 需要用户拍板（附默认建议）

| # | 问题 | 默认建议 |
|---|---|---|
| P1 | manifest 门禁失败的收尾行为：判 failed 不回滚 vs 自动回滚指针 | **判 failed + 告警，不自动回滚**（指针已是新值且大概率已生效，自动回滚会把「判据发现滞后」变成二次变更） |
| P2 | site-version shell 是否一并收敛进 switchVersion 原子步 | **本期只收敛 env-dir**（shell 无磁盘指针，setPointer 双写+镜像已完备；改动面最小） |
| P3 | 直写库检测的存量基线：全量上报 vs 提供「基线确认」白名单 | **全量上报 + 报告内标记 `knownLegacy` 需人工逐条确认**（不建白名单机制，避免白名单成为新的绕过通道；存量消化靠人工补审计或走正规通道重写一次） |

## 10. 执行闭环：本地写失败→抛出（PR #657，2026-11-13）

本设计 §1.2 指出的缺口——「第 1 条（本地写失败）被旧注释『只告警（2026-10-08）』挡住」——已由独立修复方案落地，现记录闭环：

- **修复方案实例（本文子项）**：`docs/development/reports/2026-11-13-release-registry-throw-on-write-failure.md`（rd-dept 出具方案、rd-engineer 编码 + TDD 红转绿）
- **合入**：PR #657（merge `58d549bf`，commit `de73269d`）已由 auto-merge 入 master（2026-11-13）
- **改动**：`servers/deploy-console/src/registry/release-registry.service.ts` 的 `syncAppEnvPointerInner` catch 由 `warn + return` 改为 `warn + throw e`；保留 warn 日志、不改写错误信息（保住 spec 的 `'db down'` 断言）；三处注释记录 2026-11-13 决策翻转。
- **调用方影响面**：`pointer.executor` / `pipeline.service` 编排收尾兜底 / `internal-release.controller` 均直接 `await` 在开放处（controller 经 `InternalGuardService.run`，其 catch 审计失败后仍 re-throw），无外层 catch 把新抛错再吞掉 → 抛出正确上抛为发布失败。
- **验证**：单 spec 33/33 全绿；真实 CI「改动包 build/test」全绿触发 auto-merge（`gc-runtime.executor.spec.ts` 在本地沙箱的环境相关失败已证为预存、与本次无关）。
- **风险**：R1 新表写失败发布判 failed 比例上升（仅影响本就不该成功的发布，符合半发布治理意图）；R2 瞬时 DB 抖动被放大为发布失败（保留 warn 供排障，与云库镜像失败既有语义一致）。详见修复方案实例文档 §7。

> 本设计其余子项（F1 唯一原子步 / F2 三方对账 / F3 直写库治理）仍待按 §9 拍板后实施，不在 PR #657 修复范围。
