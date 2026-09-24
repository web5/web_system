# 流水线并发 · 任务清单

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> **定位**：把 `design.md` 的技术方案拆成可独立验证的实施任务，**每项绑定判据编号 V#**（判据表唯一真相源见 [`requirements.md` §6](./requirements.md)）。
> 建立：2026-09-24 ｜ 状态：决策已确认，可执行 ｜ 范围：local 验证

**执行纪律**：判据编号为空的任务**禁止进入执行**。完成后由 `rd-execute` 的「完成验证门」按**同一编号**逐条给证据，不存在第二份清单。
**历史包袱**：H1–H7 是各任务的**同行义务**（`design.md` §6.4），不是追加任务——本任务本来就要改到那些地方。

---

## 1 任务清单

### 阶段 A｜队列地基（先实现）

| # | 任务 | 交付物 | 同行义务 | 依赖 | 判据 |
|---|---|---|---|---|---|
| **T0** | 迁移前数据快照（**一次性替换的前置动作**，不可跳过） | 导出 `deploy_release_locks` 与 `deploy_pipeline_runs` 全量数据到 `<WS>/.snapshots/p29-<时间戳>.sql`；保留到全部 V# 勾核。**连接参数取自 deploy-console 运行实例自身的数据源配置（实例的 `.env` / datasource），不硬编码、不凭推断选库——console 跑在哪台机器就导出那台机器对应的库** | — | — | **V8, V7′** |
| **T1** | 数据模型与迁移 | `deploy_resource_locks` 表；`deploy_pipeline_runs` 扩展列 `queue_seq` / `worker_id` / `lease_until`；`status` 枚举新增 `queued`；迁移脚本 `scripts/migrations/p29-pipeline-concurrency.mjs`（幂等 + `DRY_RUN` + 动库前打印将变更行 + `bash -n` 自检；**不做 `ROLLBACK` 脚本**） | — | T0 | **V8** |
| **T2** | 资源锁服务 | `ResourceLockService`（acquire / release / renew，TTL + 持有者校验），按 `artifact` / `pointer` / `runtime` / `cleanup` 四 kind 取 key；`run()` 接入 | **H2**：`ReleaseLockService` 与 `deploy_release_locks` 直接删除并 DROP，**不做兼容 shim** | T0, T1 | **V12, V13** |
| **T3** | 队列与 worker pool | `PipelineQueue`（enqueue / claim / complete）；进程内 worker loop；`PIPELINE_WORKER_CONCURRENCY`（**已定 2**，Q3）；启动 reconcile（孤儿 run 重置为 `queued`、过期 lease 回收） | **H7**：删除后台 fire-and-forget `execAsync git fetch` | T2 | **V1, V2, V13** |
| **T4a** | `queued` 状态与接口透出（后端） | `submit` 软校验改造：同一 resourceKey 已有 queued/running 时**不再抛 `ConflictException`**；`approve` / `retry` 走入队；列表接口返回 `queue_seq` 与排队位置 | — | T3 | **V1, V2** |

### 阶段 B｜per-run 工作区

| # | 任务 | 交付物 | 同行义务 | 依赖 | 判据 |
|---|---|---|---|---|---|
| **T5** | `WorkspaceContext` 与路径派生 | 贯穿单次 run 的 `WorkspaceContext`；注入 `WS_BUILD_DIR` / `WS_ARTIFACT_DIR` / `WS_DEPLOY_TARGET`（`design.md` §4.3.3）；`resolveStageCwd`（`pipeline.service.ts:108-111`）改造 | **H3**：删 `PUBLISH_PATH` 等旧变量注入，artifacts 统一走 `WS_ARTIFACT_DIR`；**H6**：`parseReleaseRef` 统一 `<pipelineKey>/<commit>` 写法 | T1 | **V3（前提）, V13** |
| **T6** | worktree 生命周期管理 | `<ws>/.runs/<pipelineId>/` 创建与销毁；GC 策略（成功即回收、失败保留最近 `PIPELINE_WORKSPACE_RETAIN`=3）；`git worktree prune` + 启动 reconcile | — | T5 | **V9** |
| **T7** | 依赖安装去重复 | 统一 pnpm `--store-dir`（走硬链）；workspace 包（`@web-system/{shared,types}`）由「每 run 各自 build」改为「一次构建产出归档 → 每 run 解包」 | **H4**：删除 `.deploy-lock-hash` 指纹文件及其读写逻辑 | T6 | **V6, V13** |
| **T8** | action 脚本改造与资源打标 | `p29` 扫描 `deploy_pipeline_actions.script` 打 resource kind 标记；改造硬 `cd "$RELEASE_DIR"` 的脚本（已知 `p21-pipeline-node-scripts.sql:27-31`）转向 `WS_BUILD_DIR` | **H5**：删除 `WS_SAFE_DELETE` / `SAFE_DELETE_STRATEGY` 策略开关 | T5, T7 | **V3, V4, V13** |
| **T9** | 验证脚本 | `scripts/pipeline/verify-concurrency.sh`，cases：`parallel-submit` / `queue-window` / `sentinel` / `approval-slot` / `gc` / `perf` / `pointer-exclusive` / `bypass` | — | T3, T6 | 支撑 V1–V13 |
| **T10** | 回滚说明（**不是灰度开关**） | 写进 `docs/development/local-release-runbook.md`：`git revert` + T0 快照恢复两步动作、适用环境、耗时预期；**另记「并发发布期间禁止手工执行 `scripts/publish-*.sh`」**（Q4 决策：这两个脚本绕过平台，是本期仍未受保护的写入路径） | **H1**：**不引入** `PIPELINE_WORKSPACE_MODE` 或任何运行时兼容模式 | T5 | **V7′** |

### 收尾

| # | 任务 | 交付物 | 依赖 | 判据 |
|---|---|---|---|---|
| **T11** | 单测补齐 | T1–T8 涉及的新服务与纯函数（`ResourceLockService`、`PipelineQueue`、`WorkspaceContext` 路径派生）单测 | T1–T8 | T1–T8 单测全绿 |
| **T12** | 端到端验收 | 按 `requirements.md` §6 逐条勾核并留证据 | T9, T10, T11 | **V1–V10, V12, V13** |

### 标注：**UI 动作门**触发项

**T4b**（可选，本期建议不做）：前端显示「排队中 · 前面 N 条」。

> 若要做，属 `apps/deploy-console` 的 UI 源码改动，按 `.codebuddy/CODEBUDDY.md` §2.5 必须：先改原型 + 页面规格 → 独立交互质检 → 设计评审（D2）→ **用户确认** → 原型单独 commit（记 sha）→ 才落码，commit message 必须带 `Proto: <sha>` 与 `Design: pass`。
> **本期拆出**：T4a 的后端状态与接口已能让 V1/V2 成立（接口可查到 `queued`），T4b 只影响可读性。

---

## 2 依赖关系

```
T0 ──> T1 ──┬──> T2 ──> T3 ──> T4a ──┐
            │                         │
            └──> T5 ──> T6 ──┬─> T7 ──> T8
                             │
                             └─> T9 ──┐
                   T5 ──> T10 ───────┤
                                     ├──> T11 ──> T12
                            T4a ─────┘
```

可并行：T2/T3 链路 与 T5/T6/T7 链路互不阻塞（T1 为公共前置）。
串行关键路径：T0 → T1 → T5 → T6 → T7 → T8 → T11 → T12。

---

## 3 执行门禁（不分期，一次交付）

> Q1 决策为一次性实现，因此这些是**推进过程中的校验点**，不是「做完一半先交付」的分批点。

| 门禁 | 判据 | 规则 |
|---|---|---|
| **G0 快照完备** | T0 | 未做 T0 数据快照不得执行 `p29`。Q5 取消了 `ROLLBACK` 脚本，N1 取消了运行时开关——**T0 是唯一止损手段** |
| **G1 迁移可用** | V8 | T1 未通过不得开始 T2/T5：`p29` 必须幂等、`DRY_RUN` 零写 |
| **G2 隔离生效（硬门禁）** | **V3** | 不通过立即停止后续实现，先按 T10 的回滚说明恢复到可用状态 |
| **G3 可恢复** | **V7′** | `git revert` + T0 快照能回到改动前语义（含 `ConflictException` 原文复原）。这是取消运行时开关后的替代保障，必须实测而非纸上推演 |
| **G4 无历史包袱** | **V13** | H1–H7 全部拆除且 grep 断言无命中；不通过即**交付未完成**，不得以"功能已通过"放行 |
| **G5 收尾** | V1–V10, V12, V13 | T12 逐条给证据，禁止「跑过了」式描述 |

---

## 4 实施约定

| 项 | 约定 |
|---|---|
| commit | 每个任务独立 commit；迁移脚本与业务代码不混入同一 commit |
| 迁移 | 一律 `scripts/migrations/p29-pipeline-concurrency.mjs` 幂等惯例（`specs/remote-backend-release/design.md:63,189`）；**不放 `migrations/*.sql`**；**不写 `ROLLBACK` 脚本**（Q5），改为 T0 快照前置 |
| 开关 | **不引入运行时兼容开关**（N1 / H1）。如需止血，只允许「停 queue worker」这类熔断，不得切回旧实现 |
| 旁路脚本 | Q4 决策：`publish-*.sh` 本期不改。交付前必须在 runbook 写明「并发发布期间禁止手工执行」，并在交付说明中提示 |
| 证据 | 每条 V# 的证据必须是**可复现的命令与输出片段**，不接受截图式「看着对了」 |
| 失败处理 | 任一 V# 不通过 → 明确告知用户，不静默降级；按 T10 回滚说明恢复 + 保留失败现场（`logs` 与 `.runs/<id>`） |
| 新文件 | 产出后立即 commit——未纳入版本控制的文件存在被清理的风险（本次已发生一次） |
| 数据库真相源 | 一律以**运行实例自身的数据源配置**为准（实例的 `.env` / datasource），禁止硬编码主机或凭推断选库。console 在哪台机器运行就操作哪台机器对应的库 |

---

## 5 原型稿判定

| 项 | 判定 |
|---|---|
| 本次是否需要原型稿 | **不需要**（后端 / 架构类改动，无新页面） |
| 建议补充的非 UI 类产物 | 一张「部署区 / 产物区 / 构建区」三类目录 + worker lease 的**时序图**，用于评审对齐（`design.md` §4.1 / §4.2.1 已有文字与布局，缺可视化） |
| T4b（若排期） | 属 UI 源码改动 → 需过 UI 动作门，见 §1 标注 |

> 以上由用户拍板；判定结果回填本行后，`rd-execute` 入口据此校验。
