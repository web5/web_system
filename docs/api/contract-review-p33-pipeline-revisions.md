# 契约评审报告 — deploy-console 流水线配置版本化（p33，2026-09-29）

> 角色：contract-reviewer（独立第三方，不代改 / 不代登记）
> 判据源：`docs/api/contracts.md` §1 C1（对外 HTTP 接口，真相源＝controller 装饰器）、§2（变更纪律「先文档后实现」）、§6 C5（路由顺序）、§7（变更纪律 5 条，尤第 1 / 5 条）
> 结论三态：**❌ 阻塞（退回整改）**

```
阻塞: 5
重要: 5
```

---

## 0. 消费方清单（§7 第 5 条：破坏性变更必备）

| # | 消费方 | 位置 | 依赖的假设 |
|---|---|---|---|
| U1 | 前端编排编辑器保存 | `apps/deploy-console/src/components/pipeline/OrchestrationEditor.vue:176-208` | **依赖 `saveSteps` 返回整树**做 `id` 配对（`saved.find(s => s.id === local.id)`），再逐步骤 `saveTasks`；`catch` 直接 `message.error('保存失败')` |
| U2 | 流水线编辑页页头保存 | `apps/deploy-console/src/views/PipelineEdit.vue:534-552` | 编排子保存失败 → 整页 `catch` → `dirty` 不复位、不 `load()` |
| U3 | 前端 API 层（手写型） | `apps/deploy-console/src/api/index.ts:766-782`（`getTree/saveSteps/saveTasks/deleteStep`）、`:217` 删步骤 | 4 个调用点，全部假设「2xx = 已落库」 |
| U4 | 未来 AI Agent / MCP | 尚未接入（controller 注释「仅控制台 JWT，不暴露 MCP」） | 契约尚未登记，`:id` 语义无文档（见 I3） |
| U5 | 新增 3 个 revisions 接口 | 前端**零调用**（`grep` 无命中） | 接口先行于消费方，改动窗口尚在 → 现在是修契约的最佳时机 |

无 import 型共享类型消费方（本改动未动 `packages/types` / `agent-core` 接口）。

---

## 1. 阻塞项（R13 非零即不放行）

### B1 ★ 副作用颠覆既有写接口的「成功」语义 —— 保存已提交却返回 500/400

- **判据**：§7.5（破坏性变更须列消费方与迁移路径）+ C1。
- **反例**：`PUT /:id/steps`（controller:102）在 `saveSteps` 事务**已提交之后**才调 `snapshot()`；快照失败即 `throw`。此时前端 U1 收到 500 → 提示「保存失败」，但**步骤已真实落库** → 用户重试点保存 → 一次改动产生 2 个 rev、审计两条；若失败发生在 `saveTasks` 之后的某一步，则形成**半棵树**（步骤已改、任务未改）且前端 `dirty` 不复位（U2）。「原本成功可能变 500」在改动说明里被写成可接受副作用，但对前端是**语义倒转：写入成功却报失败**。
- **修法**（择一，不许维持现状）：
  1. 把 `snapshot()` 移进 `saveSteps/saveTasks/deleteStep` 的同一 `dataSource.transaction`（`orchestration.service.ts:109/184/232` 已有事务边界）→ 快照失败即整笔回滚，语义回到「要么全成要么全败」；**或**
  2. 快照降级为「尽力而为」：失败不抛，写审计 + 在响应体附加 `rev: null, snapshotWarn: true`，HTTP 仍 200。
  - 无论哪种，U1/U2 的错误文案与 `dirty` 复位逻辑须同步（U1 的 `catch` 目前不分「编排失败」与「仅快照失败」）。

### B2 版本号取号无并发保护，撞唯一键时业务已生效却返回 400

- **判据**：§7.5 + C1。
- **反例**：`pipeline-revision.service.ts:132-157` 是「读 `pipeline.rev` → +1 → insert → update rev」跨请求、跨事务的读-改-写。两个并发保存（或 U1 一次点击的串行链被另一会话插入）取到同一 `nextRev` → 其一命中 `uq_pipeline_rev` → `BadRequestException('版本 N 已存在（并发保存）：请刷新后重试')`。而编排树**已写入**，错误提示「请刷新重试」会诱导用户重复保存。
- **修法**：原子取号 —— `UPDATE deploy_pipelines SET rev = LAST_INSERT_ID(rev + 1) WHERE id = ?`（或事务内 `SELECT ... FOR UPDATE`），再以取到的号 insert；仍撞键则重试一次取号，不要向用户抛 400。

### B3 `POST .../restore` 破坏性写：缺幂等键 / 缺确认 / 缺乐观锁基准，且快照在事务外

- **判据**：§7.5（破坏性变更）+ §2（破坏性语义须写明）+ 仓库既有先例 `pipeline.controller.ts:36`（prod 操作须 `confirm=true`）。
- **反例（三则）**：
  1. **无 `expectedRev`**：当前 rev=20，恢复到 rev=3 → 静默丢弃 rev 4–20 的全部改动（历史表仍有，但当前树被覆盖），接口无从判断「用户是否知道自己在覆盖什么」。
  2. **无幂等键 / 无 confirm**：双击或前端重试 → 两次 restore，产生 rev 21、22（内容相同），版本列表污染；且无任何「是否确定」的强制确认。
  3. **快照在事务外**（service:218-285）：`dataSource.transaction` 只包住删+重建，`snapshot()` 在其后调用。若快照失败 → 当前树已被替换为旧版，而 `rev` 未推进、版本表无对应记录 → **当前态与版本链脱节**，返回 500。
- **修法**：
  - 入参加 `body?: { expectedRev?: number; confirm?: true; idempotencyKey?: string }`：`confirm !== true` → 400（对齐 prod 先例）；`expectedRev` 与 `pipeline.rev` 不符 → 409；`idempotencyKey` 落库去重（重复提交返回首次结果）。
  - `snapshot()` 纳入同一事务（与 delete+insert 同一 `em`），失败整笔回滚。
  - **审计补内容**：controller:58-65 只记 `{field:'rev', before, after}`。破坏性写必须能回答「这次恢复覆盖了什么」——至少记 `beforeRev`（当前 rev）、被删除的步骤/任务/动作 id 数与脚本名清单（或 `beforeSnapshotRev` 指针）。
  - 是否需要 dry-run：**建议但不阻塞** —— 有了 `expectedRev` + `GET /:id/revisions/:rev` 可预览快照，dry-run 属增强（无判据，见建议区）。

### B4 鉴权缺口：restore 等价于「改写生产发布脚本」，却只有 JWT

- **判据**：§7.1（先判影响面）+ C1/C4（`packages/types` 权限码契约）。
- **反例**：`servers/deploy-console/src/auth/auth.module.ts:32` 仅注册 `APP_GUARD JwtAuthGuard`，全服务无权限码守卫；`restore` 未加任何角色/权限校验。而本服务**已有**审批能力（`pipeline.service.ts:644` 的 `APPROVE_PERMISSION`、`GET /pipelines/meta/approvers`）。后果：任何能登录控制台的账号可把任意流水线（含 prod）的脚本动作**回退到任意历史版本**——历史脚本可能含已修复的漏洞或被撤下的口令写法，这是对「审批制」的旁路。
- **修法**：restore 要求写权限（如 `deploy:pipeline:*` 写权限码）或审批人角色（复用 `APPROVE_PERMISSION`）；同时禁止对 `builtin` 模板恢复（或要求更高权限）。前端入口须二次确认弹窗。

### B5 契约登记缺失：新增 3 个对外接口未落 `api-design.md`

- **判据**：§2「新增 / 改接口 → 先落 `specs/<svc>/api-design.md`（或改注解后重生成），再谈实现」。
- **反例**：`specs/deploy-console/api-design.md:6` 把流水线类接口指向 `specs/pipeline-node-model/api-design.md`，而后者 `grep 'steps\|revisions'` **零命中** —— 即既有的 `PUT /pipelines/:id/steps` 系列与本次 3 个新接口**均未在派生文档登记**。R13 会命中本 controller 文件。
- **修法**：补 Swagger 注解（`@ApiParam` 声明 `:rev` 取值域与 400/404 语义、`@ApiResponse`）后执行 `node scripts/gen-api-design.mjs`，产物随本次改动一起提交。

---

## 2. 重要项（不阻塞，但须在本次或紧随其后处理）

### I1 一次「保存」产生 N+1 个版本，且中间版本是半棵树

U1 的保存链 = 1 次 `saveSteps` + N 次 `saveTasks`（N = 步骤数）→ 每次都 `snapshot()`。5 个步骤的流水线点一次保存落 6 个 rev；版本列表失去「一次改动 = 一个版本」的语义；**恢复到中间的某个 rev 会得到「步骤已更新、任务未更新」的半棵树**（这正是 B1 反例里那个中间态）。
修法：后端按保存批次聚合（请求头/body 带 `batchId`，同批次只落一个终态快照），或前端改为单次批量保存接口。

### I2 `:rev` 入参校验语义不明确

`ParseIntPipe` 对 `rev=1.5` 会**静默取整为 1**（返回 rev 1 的正文，调用方以为拿到了 1.5→ 实为静默错版本）；`0` / 负数能通过 pipe 一路走到 service，靠「查不到」兜成 404（service:191 / 212），与「参数非法」的 400 混为一谈；Swagger 未声明取值域与错误码。
修法：自定义 `PositiveIntPipe`（`Number.isInteger && > 0`，否则 400），并在 `@ApiParam` / `@ApiResponse` 写明：非正整数 → 400，不存在 → 404。

### I3 `GET /:id/revisions` 对不存在/异类 id 返回 200 + `[]`，静默吞错

`list()`（service:162-186）不做流水线存在性校验 → 不存在的 id 返回空数组；而 `get()` 抛 404。两个相邻接口行为不一致。叠加既有前缀歧义：`/pipelines/:id`（controller `pipeline.controller.ts:85`）是**执行实例**详情，而 `/pipelines/:id/steps`、新增 `/pipelines/:id/revisions` 用的是**模板** id（`deploy_pipelines`）→ 未来 MCP/Agent（U4）拿 run id 查 revisions 会得到 200 空列表，**不报错、静默失效**。
修法：`list()` 增加存在性校验（不存在 → 404），或在契约文档显式声明「`:id` = 模板 id，非执行实例 id」。

### I4 restore 绕过 managed 动作保护

`orchestration.service.ts:166-215` 明确保护 managed 动作（不可删除 / 不可改名）；而 restore（service:262-274）从快照**原样 insert** `managed` 字段，可把已托管动作覆盖为旧形态。
修法：restore 重建时以库中现有 managed 集合为准做一次校正，或对含 managed 差异的快照拒绝恢复并提示。

### I5 restore 只回放编排树，未在契约声明

快照含 `pipeline` 元数据副本（`nodes` / `approval` / `approvers` / `defaultTarget`），而 restore 只重建 steps → tasks → actions（service:234-276）。消费方若按「完全回到旧版」理解会误判（审批配置不回退）。
修法：接口摘要与 `api-design.md` 明确写「restore 仅回放编排树（steps/tasks/actions），流水线元数据与 `nodes` 不在回放范围内」。

---

## 3. 专项结论（针对本次 5 个提问）

| 提问 | 结论 | 判据 |
|---|---|---|
| ① 三个既有接口的副作用是否破坏现有消费方 | **是**（B1 / B2 / I1）：U1 依赖「保存成功即返回树」做 id 配对，任何新增 5xx/4xx 都会让保存链断裂在中途；响应体虽未变，错误面变了 | §7.5 + C1 |
| ② restore 是否缺幂等 / 审批 / 审计 | **缺全部三项**（B3 / B4）：无 `expectedRev`、无 confirm、无幂等键；审计只记版本号不记被覆盖内容；鉴权仅 JWT。dry-run 属增强 | §7.5 + §2 + 仓库 prod `confirm` 先例 |
| ③ 路由是否歧义 | **无歧义 ✅**：`:id/revisions`、`:id/revisions/:rev`、`:id/revisions/:rev/restore` 与 `:id/steps`、`:id/steps/:stepId[/tasks]` 静态段不同，HTTP 方法也不冲突，Nest 按声明顺序注册即可正确匹配。但 `pipelines` 前缀被两个 controller 共用（`pipeline.controller.ts:22` 与 `pipeline-orchestration.controller.ts:28`），匹配正确性依赖 module 注册顺序，属**既有脆弱点**（判据 §6 C5「特化先于通配」的同源风险），建议后续收敛 | §6 C5 |
| ④ `:rev` 校验 | **不明确**（I2）：`1.5` 静默取整、`0`/负数走 404 而非 400，Swagger 未声明 | §7.1 + C1 |
| ⑤ 鉴权缺口 | **是**（B4）：restore 应要求写权限或审批人角色 | §7.1 + C4 |

---

## 4. 建议区（无判据，属个人偏好，可驳回）

1. 提供 `POST .../restore?dryRun=1`（返回将删除/重建的步骤与动作差异清单，不落库）——有了 `expectedRev` + 快照预览即非必需。
2. 快照保留策略：每次保存全量存整树（含脚本正文），无清理/归档策略 → 表会持续膨胀；建议保留最近 N 版 + 按时间归档，或加体积告警。
3. 未来若经 MCP 暴露 revisions/restore，须同步 §4 C3（工具命名前缀 + 能力绑定 + `MCP_CLIENT_KEY`）登记，且 restore 一类破坏性工具应默认不绑定。

---

## 5. 放行条件

阻塞项 B1–B5 全部闭环 + 重跑 `node scripts/gen-api-design.mjs` + U1/U2 前端回归（保存失败态、重复点击、并发保存）后方可放行。本角色不改码、不改登记，结论回流 `rd-execute` / `rd-plan`。

---
---

# 复审（2026-09-29，第 2 轮）

> 范围：只读核验整改代码 + 更新结论。未改任何业务代码。
> 判据不变：`docs/api/contracts.md` §1 C1 / §2 / §6 C5 / §7。

```
阻塞: 2
重要: 7
```

**是否可放行：❌ 否（阻塞非零）。** 但剩余 2 条均为低成本项（一条改取号的连接持有方式、一条跑一次生成脚本），改完即可放行，无需再走完整评审。

## R0 逐条清零核验

| 项 | 整改 | 核验证据 | 结论 |
|---|---|---|---|
| B1 | `safeSnapshot()` 降级不抛 | `controller.ts:46-64` 私有方法，catch → 审计 `status='error'` + 返回 `null`；三处保存（:152/:190/:212）全部改走它；响应体仍 `return after` / `return result` 未变 | ✅ **清零**（残留见 R1） |
| B2 | 原子取号 | `pipeline-revision.service.ts:133-142` `UPDATE ... SET rev = LAST_INSERT_ID(rev+1)` + `SELECT LAST_INSERT_ID()` | ❌ **未清零 → 见 R-B1** |
| B3 | confirm / 乐观锁 / 审计 | `controller.ts:89-91` 缺 confirm → 400；`service.ts:247-254` `expectedRev` 不符 → `ConflictException`(409)；`service.ts:257-262` 恢复**前**先打一份当前树快照（这一点超出要求，正面） | ✅ **清零**（残留见 R2/R3/R4） |
| B4 | 权限门禁 | `controller.ts:93-98` `ApproverService.canApprove()` → 403；`gate.degraded` → `status='warn'` 审计放行；`ApprovalModule` 已导出 `ApproverService`（`approval.module.ts:19`），DI 无缺口。降级放行与 `approver.service.ts:15-16` 明文策略一致 | ✅ **清零** |
| B5 | 契约登记 | `specs/pipeline-step-task/design.md` §5 接口表补 3 个端点 + §5.1 语义/约束（含降级语义、只增语义、只回放编排树） | ⚠️ **有条件清零 → 见 R-B2** |
| I3 | 存在性校验 | `service.ts:185-189` `list()` 不存在 → 404 | ✅ **清零** |
| I5 | 只回放编排树 | §5.1 末条已声明 | ✅ **清零** |
| 路由 | 复核是否歧义 | 见 R-路由 | ✅ **无歧义** |

## R-B1（阻塞 1）原子取号跨连接，`LAST_INSERT_ID()` 不保证落在同一连接

- **判据**：§7.5（并发语义）+ C1。`allocateRev()` 是本轮 B2 的唯一修复，它失效即 B2 未清零。
- **证据链**：`DataSource.query()` 不传 `queryRunner` 时**每次新建并释放 QueryRunner**（`node_modules/typeorm/data-source/DataSource.js:351-358`）→ 每次从 `mysql.createPool`（`MysqlDriver.js:289`）**单独取连接**；`app.module.ts:44-59` 未设 `extra.connectionLimit`（mysql2 默认 10）。而 `LAST_INSERT_ID()` 是**连接级**值。
- **反例**：A/B 并发保存 → A 的 `UPDATE` 落在 conn1、A 的 `SELECT LAST_INSERT_ID()` 落在 conn2（conn2 刚被 B 或任一 insert 用过）→ 取到 **0 或别处的自增 id**。取到 0 → `allocateRev` 抛 `NotFoundException('取版本号失败')` → 保存路径被 `safeSnapshot` 吞掉 → **保存成功但静默丢版本**（可追溯性没了，正是本次改动的全部价值）；restore 路径（`service.ts:325` 裸调 `snapshot`）→ **树已替换后 500**。取到他处 id → 写入一个与 `pipeline.rev` 脱节的 rev（如 37 而当前是 5），版本链错序，后续还可能撞 `(pipeline_id, rev)` 唯一键。
- **修法**（择一）：
  1. 显式同一连接：`const qr = dataSource.createQueryRunner(); await qr.connect();` 连发 UPDATE + SELECT 后 `finally { await qr.release(); }`；
  2. 或事务内取号：`qr.startTransaction()` → `SELECT rev FROM deploy_pipelines WHERE id=? FOR UPDATE` → `UPDATE ... SET rev=rev+1`（我上一轮给出的备选）；
  3. 或一步到位：`INSERT INTO deploy_pipeline_revisions (...) SELECT ?, MAX(rev)+1, ... FROM ...`（取号与写入同一语句）。
  另建议：取号后加一次「rev 必须 > 0 且 > 上次已知 rev」的断言，失败即显式告警，别让 `safeSnapshot` 静默吞掉。

## R-B2（阻塞 2）未按 §2 重生成 `specs/<svc>/api-design.md`

- **判据**：§2「新增 / 改接口 → 先落 `specs/<svc>/api-design.md`（或改注解后重生成）」。
- **反例**：`grep -rln revisions specs/` 仅命中 `specs/pipeline-step-task/design.md`；`specs/deploy-console/api-design.md` 与它指向的 `specs/pipeline-node-model/api-design.md` **仍无这 3 个端点**。design.md §5 是团队实际权威表（controller 注释也指向它），但 §2 的派生真相源是自动生成的 api-design.md —— 两处并存即漂移源（§0 的教训）。
- **修法**：`node scripts/gen-api-design.mjs`（脚本按 `servers/*/src/**/*.controller.ts` 遍历，应覆盖本 controller），产物随改动提交；若产物确认不覆盖 deploy-console，则在 `specs/deploy-console/api-design.md:6` 的指向里补 `specs/pipeline-step-task/design.md §5/§5.1` 并说明理由。

## R-路由（复核结论：无歧义）

`:id/revisions`、`GET :id/revisions/:rev`、`POST :id/revisions/:rev/restore` 与既有 `:id/steps`、`PUT :id/steps/:stepId/tasks`、`DELETE :id/steps/:stepId`：**第二段静态字面量不同**（`revisions` vs `steps`），且 restore 是唯一的 `POST .../restore`，Nest 按声明顺序注册即可正确匹配，不存在 `:id/:a` 抢 `:id/:b` 的情形。同前缀被两个 controller 共用（`pipeline.controller.ts:22`）的既有脆弱点仍在，但本轮未新增风险 → 保持非阻塞。

## R-I2（用户提问：是否仍列阻塞）→ **不阻塞，维持重要**

`rev=1.5` 经 `ParseIntPipe` 静默取整为 1（`controller.ts:76/84`），理论上会「恢复到错误版本」；`0`/负数走 404 而非 400。判为重要的理由：触发面窄（rev 来自 `GET /:id/revisions` 下发的整数，非整数只可能来自手搓或 Agent 拼装），且已有 `confirm=true` + 可选 `expectedRev` 两道闸。
**但建议本次顺手修**（约 10 行）：自定义 `PositiveIntPipe`（`Number.isInteger(v) && v > 0`，否则 400），并在 `@ApiParam` 注明取值域与 400/404 语义。
**升级条件**：一旦经 MCP 暴露给 Agent（U4），非人工拼参成为常态路径 → 按 §7.1（影响面随消费方扩大）自动升级为阻塞。

## 复审后的重要项（7 条）

| # | 项 | 说明 | 修法 |
|---|---|---|---|
| R1 | 快照失败对调用方完全不可见 | `safeSnapshot` 只写审计，响应体无任何标记、无指标 | 响应附加 `snapshotRev: number \| null`（或在保存成功审计里带 rev），并加告警阈值 |
| R2 | restore 末次 snapshot 仍裸抛 | `service.ts:325` 直接 `snapshot()`；失败 → 树已被替换却返 500（有 `:257` 恢复前快照兜底，可反悔，故不阻塞） | 末次快照也走 `safeSnapshot`，或纳入 delete+insert 的同一事务 |
| R3 | 审计未记「被覆盖了什么」 | `controller.ts:114` detail 仍只记 `版本 N → 版本 M` | 补 `beforeRev`（覆盖前的当前版本）与恢复前快照的版本号，一键可查 |
| R4 | 幂等键未做 | 双击/重试 → 两次 restore、rev +2（内容相同，有历史可追，故不阻塞） | 前端按钮 loading 去重；后端可选 `idempotencyKey` |
| I1 | 一次点击产生 N+1 个版本（未处理） | U1 保存链 = 1 次 saveSteps + N 次 saveTasks，每个都打快照；恢复到中间 rev 会得到「步骤已改、任务未改」的半棵树 | 按 `batchId` 聚合，或改为单次批量保存接口 |
| I2 | `:rev` 校验（见上） | — | `PositiveIntPipe` |
| I4 | restore 绕过 managed 动作保护（未处理） | `service.ts:310-319` 原样写回 `managed`；而 `orchestration.service.ts:166-215` 明确保护托管动作 | 重建时以库中 managed 集合校正，或对含 managed 差异的快照拒绝 |

## 建议区（复审新增，无判据，可驳回）

1. `canApprove` 降级放行对**非紧急的破坏性写**尺度偏松（user-service 不可达时任何人可 restore）；与本服务既有审批策略一致，故不阻塞。可考虑：degraded 时对 `env=prod` 或 `builtin` 模板仍拒绝。
2. 快照保留策略仍缺（每次保存全量存整树 + 脚本正文），建议保留最近 N 版 + 归档，或加体积告警。

## 复审放行条件

1. R-B1（同一连接取号）修复并补并发用例；2. R-B2（重生成 api-design.md 或显式补登记）；3. U1/U2 前端回归（保存失败态、重复点击、并发保存）。三项闭环即 `阻塞: 0`，可放行。本轮仍不改码、不改登记。
