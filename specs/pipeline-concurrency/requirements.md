# 流水线并发 · 需求与验收

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> **定位**：「同一台机器上多条发布流水线并发执行会争抢同一个发布目录」这一问题的需求定义、EARS 验收标准与**验证判据表（V1…V13，唯一真相源）**。
> 建立：2026-09-24 ｜ 状态：决策已确认，可执行 ｜ 范围：local 验证
>
> 技术方案见同目录 `design.md`；任务清单见 `tasks.md`。**判据编号三者共用一套，不存在第二份清单。**

---

## 1 需求一句话

> 单机场景下，多条发布流水线应能**同时被接收、排队可见、安全并行地构建、有序地生效**，不再因争抢同一个发布目录而失败或产出串味。

## 2 需求辨证

| 项 | 内容 |
|---|---|
| **做成 =** | 两条以上流水线并发推进时：① 无一条被拒绝；② 各自在独立目录中构建，互不干扰；③ 产物与单独串行发布逐字节一致；④ 共享的写指针 / 重启操作被精确串行；⑤ 结束后临时工作目录与孤立 worktree 无残留；⑥ 改动路径上的历史包袱已清零且被机器断言锁定 |
| **不算做成（边界）** | ① 只有「不报冲突」但实质串行，总耗时没降；② 隔离生效但产物一致性无人证明；③ 只在单条流水线场景下跑过；④ 「日志没报错」当作通过；⑤ 并发数上升后磁盘线性膨胀（说明没走硬链）；⑥ 留了运行时开关或兼容 shim，靠"两套实现"收场 |
| **为什么现在做** | 本地联调一次改动常需发多模块，`specs/ci-cd/gh-actions-release.md:84-86` 目前靠 GitHub `concurrency` group + 串行提交把风险推出平台外；`specs/pipeline-node-model/design.md:261` 已把「同一 host 上的发布需串行」列为 P1 待办——本需求是它的前置 |
| **不做的损失** | ① 每次多模块联调必须人工排队串行；② 远端发布（P1）落地时同一问题会在 SSH 场景放大；③ 依赖纪律而非结构保证正确性，一次手工脚本就破功 |

## 3 使用场景

| # | 场景 | 现状 |
|---|---|---|
| S1 | 开发者一次改动波及 `admin` + `portal`，几乎同时提交两条发布 | 第二条被 `ConflictException` 拒绝（不同模块本不该互斥） |
| S2 | 两条流水线分别处于拉码 / 构建阶段 | 互删 dist、`pnpm install` 重建共享 `node_modules`（`pull.executor.ts:11-18` 已记录该竞态） |
| S3 | 一条流水线停在审批节点等人批 | 它占着发布锁，其它流水线在等待窗口里被拒（可达数小时） |
| S4 | 需要回退 | 无开关，回滚靠改代码重新发布自身（改进后：标准化的 `git revert` + 快照恢复，见 V7′） |
| S5 | CI 触发批量发布 | 目前只能在 CI 侧串行排队，平台侧无能力 |

---

## 4 EARS 验收标准

> 格式：`When <触发>, 系统应 <行为>` / `While <状态>, when <触发>, 系统应 <行为>`。每条至少对应一个 V#。

| # | EARS | 对应 V# |
|---|---|---|
| **E1** | When 多条流水线并发提交至同一发布机，系统应**全部接收**并按队列顺序领取执行，**不得**因"已有运行中的流水线"拒绝后续提交 | V1, V2 |
| **E2** | When 流水线执行拉码 / 安装依赖 / 构建动作，系统应在**该次运行专属的工作目录**内完成，且不得读写其它运行的工作目录 | V3 |
| **E3** | When 多条流水线在同一机器上并行执行，系统应保证每次运行的产物与**单独串行发布**的结果逐字节一致 | V4 |
| **E4** | While 某条流水线处于 `awaiting-approval`，when 提交其它流水线，系统应释放挂起者的执行槽位使其它可以立即出队执行；挂起者被批准后应从锚点续跑 | V5 |
| **E5** | When 多条流水线并行安装依赖，系统应复用共享包存储，使磁盘增量**不随并发数线性增长** | V6 |
| **E6** | When 需要回滚本改动，系统应可通过 `git revert` 代码 + T0 数据快照恢复两条标准动作回到可用状态，**且不得依赖运行时开关或兼容模式** | **V7′** |
| **E7** | When 需要结构性变更数据（动作资源标记、新表），系统应提供**幂等**迁移，并支持试运行 | V8 |
| **E8** | When 运行到达终态或被执行器异常终止，系统应回收其专属工作目录，且不在仓库留下孤立 worktree | V9 |
| **E9** | When 多条流水线同时推进至"写环境版本指针 / 重启服务"阶段，系统应对这些共享资源的操作**串行化**，不得互相覆盖 | V10, V12 |
| **E10** | When 并发执行，系统应使构建 / 安装段可重叠执行（总耗时下降），同时对 E9 的共享资源操作保持互斥 | V10 |
| **E11** | When 本次改动落定，代码中**不得**残留被拆除的历史包袱标识（旧兼容变量 / 旧锁表 / 策略开关），由机器断言锁定 | **V13** |

## 5 边界与反例（明确不算做成）

| # | 边界 | 说明 |
|---|---|---|
| B1 | 不承诺绝对耗时下降 | V10 要求下降，但允许在 IO 瓶颈机器上收益有限；届时必须**如实报告**，不得用部署段数据充数 |
| B2 | 本期不覆盖旁路脚本 | `scripts/publish-*.sh` 仍绕过平台，并发使用它们的冲突不在本期保证范围内 |
| B3 | 本期不做跨机 worker | 抽象按"可以是别的机器"设计，但不实现远程 worker |
| B4 | pnpm store 内部串行不算失败 | pnpm 自带 store 锁会使并发 install 在 store 层排队，这是**包管理器的正确性保证**，V6 只看磁盘是否走硬链 |
| B5 | 单条流水线的现有行为不得改变 | 除新增 `queued` 状态与排队可见外，成功 / 失败 / 取消 / 审批语义与现状一致 |
| B6 | 不做分钟级构建加速（缓存 CDN / 远程构建等） | 见 `design.md` §2 N1 |
| **B7** | **不接受以"兼容层 / 双写 / 运行时开关"作为交付方式** | 这类实现即便功能通过也不算做成，由 V13 机器断言拦截 |

---

## 6 验证判据表（V1…V13）

> 本表为**唯一真相源**：`tasks.md` 每项绑定 V#，`rd-execute` 收尾的完成验证门按同一编号逐条给证据。
> **禁用伪判据**：「看着对」「改完看效果」「日志没报错」一律退回重写。四列缺任一列 = 判据未定义。

统一约定：

- `CONSOLE_API` = deploy-console 接口地址（本地直连 `http://127.0.0.1:6200/api`，经域访问为 `https://local.kedouai.com/console/api`）。
- `WS` = `RELEASE_WORKSPACE`（本地 `~/web_system_release`）。
- `VERIFY` = `bash scripts/pipeline/verify-concurrency.sh`（**本期交付物**，见 `tasks.md` T9）；每个 case 退出码非 0 即判 FAIL。

| # | 判据（做成 = 一句话可验证） | 验证手段（可跑的命令 / 测试名） | PASS 条件 | 不通过如何处理 |
|---|---|---|---|---|
| **V1** | 并发提交不再被拒：`admin@local` 与 `portal@local` 同时提交，两条均达终态 `succeeded` | `VERIFY case=parallel-submit` | 两条 `status=succeeded`；第二条响应体**不含** `ConflictException` / 「正在运行的流水线」字样，其 `logs` 含排队记录、`queue_seq` 非空 | 明确告知用户，不得静默降级：执行 `git revert` + T0 快照恢复发布能力，保留失败 run 的 `logs` 与 `.runs/<id>` 现场上报 |
| **V2** | 排队可见且自动推进：等待期的第二条可从接口查到 `queued` 与排队位置 | `VERIFY case=queue-window` | 等待期 `GET $CONSOLE_API/pipelines?moduleKey=portal` 返回 `status=queued` 且 `queue_seq` 有值；第一条终态后 **≤5s** 第二条转为 `running` | 同上 |
| **V3** | 并行隔离哨兵：4 条并发流水线各自的 sentinel 全程不被删除、不串目录（证明 `clean -fd` / `reset --hard` 不再波及他人） | `VERIFY case=sentinel` | 4/4 哨兵 `<WS>/.runs/<runId>/<runId>.sentinel` 在各自 run 全程存在，且不出现在他人目录下。**本条在改动前必失败** | 同上；本条失败即说明隔离未生效，**立即停止后续实现** |
| **V4** | 产物一致性：并发产出的同一 commit 产物与串行基线逐字节一致 | `VERIFY case=sentinel` 后 `diff -r <baseline-dist> <concurrent-dist>` | `diff` 无输出（退出码 0），且 `md5` 汇总值相同 | 同上 |
| **V5** | 挂起不占 worker slot：`admin@local` 置 `awaiting-approval` 后 `portal@local` 仍能立即出队；approve 后从锚点续跑 | `VERIFY case=approval-slot` | 挂起期间 portal 进入 `running`；admin 的 `logs` 出现出队记录；approve 后 admin 从 `resumeAfter` 锚点继续（不重跑已完成节点），语义同 `specs/pipeline-node-model/tasks.md:109` | 同上 |
| **V6** | 硬链生效（磁盘不物理膨胀）：4 个 worktree 后 `node_modules` 走硬链而非拷贝 | `du -sh <WS>/.runs` + `find <WS>/.runs/*/node_modules -type f -links +1 \| wc -l` | 磁盘增量 ≤ 裸源码尺寸 ×1.2，且 `node_modules` 中 link count > 1 的文件占比 ≥ 90% | 同上；此项不过说明 pnpm store 未统一，**优先修 `--store-dir` 而非放宽阈值** |
| **V7′** | **可恢复性（替代原 V7 灰度等价）**：本次改动可通过「`git revert` 代码 + T0 快照恢复数据」两条标准动作回到可用状态，且不依赖运行时开关 | ① `git revert` 本次全部改动后重建并启动 deploy-console；② 用 T0 快照 `mysql <WS>/.snapshots/p29-<ts>.sql` 恢复数据；③ 重跑 `VERIFY case=parallel-submit` | 服务可正常启动；单条流水线发布 `succeeded`；**且并发第二条重新返回 `ConflictException`**（证明确实回到了改动前语义），三条同时成立 | 说明 T0 快照不完整或 revert 不干净——**在补正之前禁止继续推进**（这是 N1 取消运行时开关后唯一的回滚通道，见 `design.md` §6.3 / R8） |
| **V8** | 迁移幂等：`p29` 首跑有变更、复跑零差异、`DRY_RUN` 零写 | `node scripts/migrations/p29-pipeline-concurrency.mjs` ×2，再 `DRY_RUN=1` | 首跑输出「>0 行变更」，复跑输出「没有需要变更的动作」，`DRY_RUN=1` 零写库且退出码 0 | 同上；**本迁移不带 `ROLLBACK` 脚本**（Q5），故执行前必须先完成 T0 快照，否则视为流程未完成而非判据失败 |
| **V9** | GC 与 reconcile：10 次发布后 `.runs` 不堆积；进程被强杀重启后能清理孤儿 worktree | `VERIFY case=gc` + `git -C <WS> worktree list \| wc -l` | 10 次发布后残留 ≤ `PIPELINE_WORKSPACE_RETAIN`（默认 3）；强杀重启后 `git worktree prune` 无残留、`.runs` 目录数回落 | 同上 |
| **V10** | 并行收益来自构建段：放开并发后总耗时下降，且下降不来自部署段 | `VERIFY case=perf` 对比 `PIPELINE_WORKER_CONCURRENCY=1` 与 `=2` | 总耗时下降；按 `taskStates` 时间戳计算**构建/安装段存在重叠**，而 pointer/runtime 段耗时无变化 | 同上；若总耗时未下降但其余全绿，**如实报告"隔离成立但收益未显现"**，不得用部署段数据充数 |
| **V11** | 旁路脚本不再与流水线争抢（后续批次） | `VERIFY case=bypass` | `publish-*.sh` 与流水线并发跑时不产生冲突 | 后续批次，本期不勾核 |
| **V12** | 写指针 / 重启的互斥：两条流水线并发推进至同一 `moduleKey@env` 的 pointer / runtime 动作时不得重叠 | `VERIFY case=pointer-exclusive` | 第二条 `logs` 出现资源等待记录；两段动作的时间区间**不重叠**；最终 `current_version` 等于最后完成 run 的 version，且两条 run 均可各自追溯 | 同上；本条失败 = E9 未满足，属正确性缺陷，不得放行 |
| **V13** | **无历史包袱断言（机器可核）**：代码中不残留被拆除的历史包袱标识 | `grep -rn "PUBLISH_PATH\|deploy_release_locks\|WS_SAFE_DELETE\|deploy-lock-hash\|PIPELINE_WORKSPACE_MODE" servers/deploy-console/src scripts/pipeline`；另查表：`SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('deploy_release_locks','deploy_resource_locks')` | grep **无命中**（退出码 1）；且 `deploy_resource_locks` 存在、`deploy_release_locks` 已不存在 | **视为交付未完成**（`design.md` §6.4 / 边界 B7）：禁止以"功能已通过"为由放行，必须先补齐 H1–H7 的拆除 |

---

## 7 与 EARS 的覆盖核对

| EARS | V# | 覆盖 |
|---|---|---|
| E1 | V1, V2 | ✅ |
| E2 | V3 | ✅ |
| E3 | V4 | ✅ |
| E4 | V5 | ✅ |
| E5 | V6 | ✅ |
| E6（可恢复性） | **V7′** | ✅ |
| E7（幂等迁移） | V8 | ✅ |
| E8（GC） | V9 | ✅ |
| E9（共享资源串行） | V10, V12 | ✅ |
| E10（并行收益） | V10 | ✅ |
| E11（无历史包袱） | **V13** | ✅ |

## 8 待确认

指向 `design.md` §10（Q3、Q4、Q6、Q8、Q9、Q10），本文件不复制。
