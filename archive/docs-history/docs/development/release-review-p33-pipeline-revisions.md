# 发布评审报告：p33 流水线配置版本化（deploy-console）

```
阻塞: 4
重要: 9
```

- 评审角色：`release-reviewer`（独立第三方，不执行发布、不改码）
- 判据源：`docs/development/release-review-checklist.md`（A 运行 / B 配置 / C 数据 / D 前端 / E 特殊通道）
- 改动面：A（运行）+ B（配置）+ C（数据，`scripts/migrations/*` 属 C 组，contract-reviewer 未装配前由本角色代审）；**D 前端面本轮不涉及**（前端 UI 单独一轮）
- 环境事实（执行方陈述，本角色未代为执行）：dev 机 203.0.113.10，deploy-console :6200，库 127.0.0.1:3306 / web_system_deploy；部署走 git push → 页面流水线（dev 机 git pull + build + pm2 重启）
- 结论：**❌ 阻塞（未清零，退回整改）**

---

## A. 运行面：改的东西真的会被加载吗

| # | 结论 | 依据 / 怎么验 |
|---|---|---|
| A2 | ❌ **阻塞** | 见阻塞 ① |
| A1 | ⚠️ **重要** | 见重要 ① |
| A4 | ⚠️ **重要** | 见重要 ② |
| A3 | ✅ N/A | 本次无 `packages/*` 改动，不存在「只 tsc 不 build」的半构建风险 |
| A5 | ✅ 通过 | `ecosystem.config.cjs:31` 已登记 `web-deploy-console`（cwd `servers/deploy-console`，script `dist/main.js`，PORT 6200），非孤儿进程 |
| 实体加载 | ✅ 通过 | `app.module.ts:53` 实体为 glob `__dirname + '/**/*.entity{.ts,.js}'`，新实体 `deploy-pipeline-revision.entity.ts` 在覆盖范围内，无需改 glob |
| 模块注册 | ✅ 通过 | `pipeline-orchestration.module.ts` 已 `forFeature` 增列 `DeployPipelineRevisionEntity` / `DeployPipelineTemplateEntity`，providers+exports 增列 `PipelineRevisionService`；`DeployPipelineTemplateEntity` 多处 `forFeature` 注册为 TypeORM 允许用法 |

## B. 配置面

| # | 结论 | 依据 |
|---|---|---|
| B1 | ⚠️ **重要** | 见重要 ⑨ |
| B2 | ✅ N/A | 无跨服务密钥改动 |
| B3 | ✅ 通过 | 无新增依赖配置项；`rev` 非配置项 |
| B4 | ✅ 通过 | 无 `REPLACE_` 类占位符新增 |
| B5 | ⚠️ 提示（并入重要 ③） | 运行时读 `MYSQL_*`（`app.module.ts:48-52`），迁移脚本读 `DB_*` / `.env` 的 `DB_DATABASE`（`p33:56-62`）。实测 `servers/deploy-console/.env` **只有 `MYSQL_*` 五键、无 `DB_*`** → 不显式传 env 时脚本抛「缺少 DB_NAME」（fail-safe，不会静默写库），但两套前缀并存易误判 |

## C. 数据面（重点）

**DDL ↔ 实体一致性：✅ 逐项对齐**（命名策略 SnakeNamingStrategy 下）：`id` varchar(36) PK / `pipeline_id` varchar(64)+索引 / `rev` int / `source` varchar(16) / `summary` varchar(255) NULL / `snapshot` json NOT NULL / `restored_from_rev` int NULL / `created_by` varchar(64) NULL / `created_at` datetime(6) DEFAULT CURRENT_TIMESTAMP(6) / UNIQUE(pipeline_id, rev)。`deploy_pipelines.rev` int NOT NULL DEFAULT 0 与实体 `@Column({type:'int', default:0})` 一致。

**验证命令（发布前在目标库执行，须留存输出）**：
```sql
SHOW CREATE TABLE deploy_pipeline_revisions;
SHOW COLUMNS FROM deploy_pipelines LIKE 'rev';
SELECT COUNT(*) FROM deploy_pipeline_revisions WHERE source='seed';  -- 期望 16
SELECT COUNT(*) FROM deploy_pipelines WHERE rev = 0;                 -- 期望 0
```

| # | 结论 | 依据 |
|---|---|---|
| C1 | ⚠️ **重要** | 见重要 ③ |
| C2 | ⚠️ **重要** | 见重要 ④ |
| C3 | ⚠️ **重要** | 见重要 ⑤ |
| C4 | ✅ 通过（执行侧） | dev 已真实执行且不可回退；脚本带 `DRY_RUN=1` / `EMIT_SQL=1`，prod 执行前须先 `DRY_RUN=1` 演练 |
| C5 | ❌ **阻塞** | 见阻塞 ② |
| C6 | ❌ **阻塞** | 见阻塞 ①（恢复无回滚锚点）、阻塞 ④（自动 DDL 无回滚路径）；另见重要 ⑥ |

## D. 前端面

本轮不涉及（无 `apps/deploy-console` 产物/版本指针改动）。**D1–D4 判为 N/A，不在本轮放行范围内**；版本列表/恢复 UI 另走 design 门 + UI 门。
⚠️ 另注：当前工作区含无关改动 `apps/portal/vite.config.ts`（`git status` 可见 4 行变更），若与本次一起提交将把未过 UI 门的 portal 前端面改动夹带上线——见阻塞 ③。

## E. 特殊通道

| # | 结论 | 依据 |
|---|---|---|
| E1 | ⚠️ **重要** | 见重要 ⑦ |
| E2 | ⚠️ **重要** | 见重要 ⑧ |
| E3 | ⚠️ **重要** | 见重要 ⑨-附：发布后须留验证据（`curl -sS :6200/api/health`、`GET /api/pipelines/:id/revisions` 返回 200 且非空、`pm2 logs web-deploy-console --lines 200` 无 QueryFailedError） |

---

## 阻塞项（N=4，每条给具体修法）

### 阻塞 ① · C6 · 恢复操作无「恢复前快照」→ 存在不可逆数据丢失窗口
- **反例**：迁移在 T0 为 16 条流水线种下 rev=1 基线；代码在 T1 才上线。T0→T1 之间在控制台做的任何编排修改**不产生快照**（快照由新代码写）。T1 之后调用 `POST /pipelines/:id/revisions/1/restore`，`restore()`（`pipeline-revision.service.ts:218-277`）先 `delete` 当前全部 actions/tasks/steps、再按 rev=1 重建——当前树**无任何副本**，200 返回，数据永久丢失。
- **期望**：任何破坏性写入前，被覆盖的当前状态必须先有快照（回滚锚点）。
- **修法（二选一，推荐全做）**：
  1. `restore()` 在事务前先调用一次 `snapshot(pipelineId, 'restore', '恢复前自动快照')`（`restoredFromRev` 留空，source 建议新增 `pre-restore`），确保当前树进历史；
  2. 上线后立即对全部流水线补一次快照并**比对与 rev=1 的差异**，把 T0→T1 窗口的改动固化进历史（可复用 `EMIT_SQL`/一次性脚本），差异非空须人工确认后再开放恢复入口。
- **验收**：在 dev 造一条「seed 后手工改过、未保存快照」的流水线，恢复至 rev=1 后仍能列出包含改动内容的版本并再次恢复成功。

### 阻塞 ② · C5 · 迁移与代码上线顺序错 → 保存即故障（且数据已改、接口报错）
- **反例**：prod 库未执行 p33。代码先上线后，用户点「保存步骤」→ `saveSteps` 主事务提交成功 → 随后 `this.revisions.snapshot(...)`（`pipeline-orchestration.controller.ts:98-105`）写 `deploy_pipeline_revisions` 报 `Table doesn't exist` → 接口 500。实际编排已落库，前端却提示失败；`saveTasks`/`deleteStep` 同病。**无任何编译期报错，只在运行期暴露。**
- **期望**：代码依赖的新表，其 DDL 必须在代码生效前于**同一环境**生效。
- **修法**：
  1. 发布单固定顺序：目标库执行 p33（`DRY_RUN=1` 演练 → 实跑 → 执行上文 4 条核验 SQL 并留存输出）**→** 再 git push 触发代码发布；
  2. 兜底：`controller` 中三处 `snapshot` 调用包 try/catch，失败降级为 `logger.error`（保存仍返回成功），并在响应里带 `revisionFailed: true`，避免「数据已改却报 500」的假失败。
- **验收**：p33 未执行的库上调用保存，返回 200 且带 `revisionFailed`；已执行的库上保存返回 200 且 revisions +1。

### 阻塞 ③ · A2 · 改动未提交且所在分支与发布目录预期分支不一致（本项目最高频「改了不生效」根因）
- **反例**：`git status` 显示 6 个文件为未提交改动/未跟踪，当前分支 `fix/portal-qrcode-poll-stop`（HEAD `c95e48b`），而部署链路是「git push → 发布目录 git pull + build」。若发布目录 checkout 的是其他分支（或本次改动未 push 到发布目录所 pull 的分支），构建产物里**根本没有** revision 实体与服务，接口全部 404，且**无任何报错**。
- **期望**：发布目录的 git HEAD 指向包含本次改动的 commit。
- **修法**：
  1. 单独开分支（如 `feat/pipeline-revisions`）提交本次 6 个文件，**剔除** `apps/portal/vite.config.ts`（无关且未过 UI 门）；
  2. push 后在发布目录核验：`git -C <发布目录> log --oneline -1` 与本地 commit sha 一致、`git -C <发布目录> status --short` 干净、且无流水线正在跑（避免 checkout 到别的分支）。

### 阻塞 ④ · C5/C6 · 陈述「synchronize: false」与代码事实不符，须先核实再放行
- **反例**：执行方陈述「服务 synchronize: false（新表须靠迁移）」，但 `servers/deploy-console/src/app.module.ts:54` 为 `synchronize: true`。若目标环境实际为 true，则启动即由 TypeORM 自动建表/加列：① 迁移不再是唯一建表途径，「迁移已执行」的证据失去意义；② TypeORM synchronize 对**库中多余列**会生成 DROP（无回滚路径）；③ 自动 DDL 无任何报错、只在启动瞬间发生。二者必有一错，**未核实前不得放行**。
- **修法**：
  1. 核实：`grep -n synchronize servers/deploy-console/src/app.module.ts`（发布目录）、`pm2 describe web-deploy-console` 看 exec cwd/script path 指向哪份代码；
  2. 若为 true：发布前对 `deploy_pipelines`、`deploy_pipeline_steps/tasks/actions` 做一次全量备份（`mysqldump` 单表），并书面确认接受启动期自动 DDL；长期应改为生产关闭 synchronize、统一走迁移；
  3. 若为 false：修正发布说明中的环境事实，阻塞 ② 的顺序要求即为硬性前置。

---

## 重要项（N=9，不阻塞但须在上线条/发布时闭合）

1. **A1 构建发生在发布目录**：`pm2 describe web-deploy-console | grep -E "script path|exec cwd"` 须指向发布目录；工作区 build 不生效。
2. **A4 端口占用者 == pm2 当前进程**：`lsof -ti tcp:6200` 与 `pm2 list` 的 pid 比对一致；不一致时只 kill **非 pm2 纳管**的占用者后干净重启。
3. **C1 迁移未声明目标库**：`p33-pipeline-revisions.mjs` 无 `-- @database <db>` 注解，默认库靠 `DB_NAME` / `.env` 的 `DB_DATABASE` 兜底。修法：文件头补 `-- @database web_system_deploy`，并在 `main()` 开头断言 `cfg.database === 'web_system_deploy'` 否则退出，杜绝跨库误写。
4. **C2 幂等成立但无记账**：脚本靠 `information_schema` 守卫（可重复执行 ✅），但不写 `schema_migrations`，无法机读「prod 跑过没有」。修法：纳入记账，或在发布单固定记录执行人 + 上文 4 条核验 SQL 的输出作为证据。
5. **C3 `.mjs` 不在 `apply-migrations.sh` 扫描范围**（该脚本只扫 `*.sql`）。与 p16/p30 等既有约定一致（同目录已有 20+ 个 `.mjs`），但必须在发布单写明 p33 的**独立执行方式、目标机路径、执行人**，不得默认「跑过 apply-migrations 就等于跑过 p33」。
6. **C6（部分）恢复语义不全等**：`restore()` 只回放 `steps` 树，`pipeline` 元数据副本（`approval`/`approvers`/`defaultTarget`/`nodes`/`skipVerify` 等，见实体注释 73 行）明确不回放；且删除+重建同 id、无 dry-run、无二次确认，接口返回 200 无差异提示。修法：接口在返回体中显式列出「未回放字段」，由 UI 门在恢复弹窗提示。
7. **E1 deploy-console 自身不走流水线**：本次部署链路是「页面流水线在 dev 机 git pull + build + pm2 重启」，须确认该流水线的执行器是外部脚本/runner 而**非 deploy-console 自身进程**（否则重启会自杀式中断发布）；且发布过程中若有保存编排的动作，不得被自身重启打断。
8. **E2 后端发布确实重启**：确认模块类型字段已写入、restart 守卫生效，`pm2 list` 中 `web-deploy-console` 的 uptime 在发布后重置；否则代码不生效且无报错。
9. **B1 重启方式不得用 `--update-env`**：须为 `pm2 delete web-deploy-console && pm2 start ecosystem.config.cjs --only web-deploy-console`；`--update-env` 会把执行会话变量固化进 `pm2_env`，而 dotenv 不覆盖已存在的 `process.env` → 服务实际用错误来源配置。**附（E3）**：发布后留证据——`curl -sS :6200/api/health`、一次 `GET /api/pipelines/:id/revisions` 返回非空、`pm2 logs web-deploy-console --lines 200` 无 `QueryFailedError`。

---

## 建议区（无判据，属个人偏好，可驳回）

- **并发保存的错误语义**：`snapshot()` 在保存事务之外计算 `nextRev`（`pipeline-revision.service.ts:135`），并发两次保存 → 后者 `ER_DUP_ENTRY` → 抛 400「版本已存在（并发保存）」，但保存本身已成功落库，前端提示与实际状态不一致。建议冲突时重试取号或把 rev 推进并入同一事务。（无判据编号）
- **恢复入口权限**：`POST .../restore` 仅受全局 JWT 保护，无角色/二次确认约束，是本次唯一具备破坏性的写接口。建议至少加页面级权限或二次确认。（无判据编号，可驳回）
- **快照容量与保留策略**：每次保存全量落整棵编排树（含脚本正文），随保存次数线性增长，无裁剪策略。建议后续定保留条数/归档策略。（无判据编号，可驳回）

---

## 放行条件

阻塞 ①～④ 全部清零并给出验收证据后，可转 **⚠️ 有条件放行**；重要项 1/2/8/9 为发布时核验动作，须随发布单留档。裁决权在人（◆④ 放行上线）。

commit trailer 建议：`Release: docs/development/release-review-p33-pipeline-revisions.md`

---

# 复审（第二轮 · 2026-09-29）

```
阻塞: 3
重要: 6
```

结论：**❌ 不可放行**（1 条为整改引入的回归风险，2 条为发布前一步动作）

## 一、上轮 4 条阻塞逐条验证

| 原阻塞 | 状态 | 依据 |
|---|---|---|
| ① C6 恢复前快照 | ✅ **清零**（附条件） | `pipeline-revision.service.ts:256-262`：`restore()` 在重建事务**之前**先 `snapshot(pipelineId,'restore','恢复前自动快照…')`；快照失败即抛出、恢复中止（fail-closed）。附条件：该快照复用 `allocateRev`，取号失效则恢复直接不可用 → 见 R1。另建议（无判据，可驳回）：该条 source 应改 `pre-restore`，否则历史里两条 `source=restore`，人读易混。 |
| ② C5 快照失败降级 | ✅ **清零** | `controller:46-64` `safeSnapshot()` try/catch + 审计 `action=pipeline-orchestration.revision.failed` / `status=error`，saveSteps / saveTasks / deleteStep 三处全部改用。残留风险转 I4。 |
| ③ A2 分支与夹带 | ⚠️ **未清零（待办型）** | 已核实 `apps/portal/vite.config.ts` 夹带**已清除** ✅；但 `git branch --show-current` 仍为 `fix/portal-qrcode-poll-stop`，7 项改动仍未提交，`feat/pipeline-config-revision` 尚未创建 → 转 R3。 |
| ④ synchronize 矛盾 | ✅ **清零**（转化为新增风险） | 确认 `app.module.ts:54` 为硬编码 `synchronize: true`。据此重判见 §二。 |

## 二、synchronize: true 的重判（本轮新增风险面）

1. **多余列/索引会被 DROP**：TypeORM synchronize 对「库中有、实体未声明」的**列与索引**生成 DROP（未注册实体的表不会删）。本次新增实体不触发删表，但 `deploy_pipelines` 若有实体未声明的历史列，将在**启动瞬间**被 DROP，无回滚、无报错 → 发布前须单表备份（C6）→ I3。
2. **双库风险（最要紧）**：p33 的目标库（dev 为 `web_system_deploy`）与服务实际连接的库（prod 未核实，你提到 prod 是 `web_system`）**必须是同一个**。若不同，则「p33 在 A 库建表 + 服务在 B 库自动建表」完全脱钩，「迁移已执行」不再等于「服务有表」，且 B 库建表时机不可控 → R2。
3. **json 列兼容性**：快照列用 `json`，MySQL <5.7 / 不支持 json 的 MariaDB 会**建表失败 = 服务启动失败**。dev 实跑通过只证明 dev → I2。
4. **基线快照不会自动生成**：synchronize 只建表加列，**不会**为存量流水线种 rev=1 基线。prod 若不跑 p33，则 prod 全部流水线 `rev=0` 且零快照，「恢复到版本 1」无起点 → I1。
5. **处置建议（推荐路径）**：prod 仍**显式执行 p33**（目标库 = 服务 `MYSQL_DB`），把它当「基线补种 + 记账」而非依赖 synchronize；synchronize 关闭单独立项，不在本轮改动（避免与既有运维习惯冲突）。

## 三、复核两个新增事实

- **原子取号**：❌ 方向正确、实现未闭合 → R1。
- **p33 dev 已执行 / prod 未执行**：已确认，据此 → R2 + I1。

## 四、新增/延续问题

### R1 · 阻塞 · C6 + A · 原子取号跨连接（本轮整改引入）
- **反例**：`allocateRev()`（`service.ts:133-142`）连续两次 `this.dataSource.query(...)`。TypeORM 每次 `query` 各自从连接池取一条连接，而 `LAST_INSERT_ID(expr)` 是**连接级**值 → 第二条 `SELECT LAST_INSERT_ID()` 若落在另一条连接上就读不到 → 返回 0 → 抛 `NotFoundException('流水线不存在（取版本号失败）')`。保存路径被 `safeSnapshot` 吞掉 = **快照静默丢失**（正是本轮要修的回滚锚点）；恢复路径直接 404 不可用。并发下必现，低并发也不保证同连接。
- **修法**：两条语句固定在同一连接上——用 `const qr = this.dataSource.createQueryRunner(); await qr.connect();` 内执行 UPDATE + SELECT，`finally` 里 `qr.release()`；或包进 `this.dataSource.transaction(async (em) => {...})`（事务内必为同连接）。
- **验收**：并发 20 次保存 → `deploy_pipeline_revisions` 新增条数 == 保存次数，且 `revision.failed` 审计为 0。

### R2 · 阻塞 · C1/C5 · 迁移目标库与服务库必须一致
- **反例**：p33 默认取 `DB_NAME` 或 `.env` 的 `DB_DATABASE`（实测该文件只有 `MYSQL_*`），而服务连的是 `MYSQL_DB`；二者不同名 → 迁移写 A 库、服务同步 B 库，跨库误写且无报错。
- **修法**：执行前 `grep MYSQL_DB servers/deploy-console/.env`（prod 机上取）→ 显式 `DB_NAME=<该库> node archive/migrations/p33-pipeline-revisions.mjs` → 用文首 4 条核验 SQL **在同库**验证。**禁止**凭「dev 执行过」推断 prod。

### R3 · 阻塞 · A2 · 分支与提交尚未落地（待办型，一条命令可清零）
- **修法**：`git switch -c feat/pipeline-config-revision` → 只提交本次 5 个代码文件 + `p33-pipeline-revisions.mjs` + 相关文档 → push → 在发布目录 `git -C <发布目录> log --oneline -1` 核 sha 与本地一致。

### 重要项（6 条，不阻塞）
1. **I1 prod 无基线快照**：不跑 p33 则 prod 恢复无起点。修法：跑 p33 的 seed 部分或等价一次性补种。
2. **I2 json 列兼容性**：`SELECT VERSION();` 需 ≥5.7（MariaDB ≥10.2），否则启动失败。
3. **I3 synchronize 的 DROP 语义**：发布前单表备份 `deploy_pipelines`、`deploy_pipeline_{steps,tasks,actions}`。
4. **I4 降级静默化（E3）**：发布后 24h 内必须查审计 `pipeline-orchestration.revision.failed` 为 0；否则「表缺失/取号失败」无人知晓。
5. **I5 权限降级放行**：`approver.service.ts:114/118` degraded 时 `ok:true` → user-service 不可达时任意登录用户可恢复（破坏性）。建议 degraded 时拒绝或强制二次确认（部分无判据，可驳回）。
6. **I6 上轮未闭合 + 发布时核验**：C1（补 `-- @database` 注解与断言）、C2（`schema_migrations` 记账）、C3（`.mjs` 不在 `apply-migrations.sh`，发布单须写明执行方式）、A1/A4/B1/E2（exec cwd 指向发布目录；`lsof -ti tcp:6200` == pm2 pid；`pm2 delete + start` 而非 `--update-env`；重启后 uptime 重置）。

## 五、只读检查结果（未改任何业务代码）

- **类型检查通过**：`npx tsc --noEmit -p servers/deploy-console/tsconfig.json` 零错误。
- **新增依赖可解析**：controller 新增的 `ApproverService` / `APPROVE_PERMISSION` 由 `approval.module.ts` 的 `exports` 提供，`PipelineOrchestrationModule` 已 `imports: [ApprovalModule]`，无循环依赖 → DI 可解析 ✅。
- **上轮建议关闭情况**：「restore 无权限约束」已被 `confirm=true` + `APPROVE_PERMISSION` 门禁覆盖（残余降级态转 I5）；「并发保存错误语义」取号已原子化，仅连接作用域未闭合（R1）；「快照无保留策略」未处理，维持建议。

## 六、放行条件

R1 修复并验收 + R2/R3 落地 + I1~I4 有证据 → 可转 **⚠️ 有条件放行**。裁决权在人（◆④ 放行上线）。
