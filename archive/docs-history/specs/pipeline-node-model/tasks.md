# 任务清单 · 流水线节点模型 P0（两类节点执行闭环）

> 来源：`specs/pipeline-node-model/design.md`（决策 D1–D8、§7 落地阶段）
> 状态：**P0 已完成**（2026-09-14 开工并跑通；T1–T5 全绿）
> 方式：TDD（红 → 绿 → 重构），每任务独立可回退
>
> **变更日志**
> - 2026-09-14 P0 落地：T1 `ApprovalNode` / T2 `how='approval'` / T3 挂起与恢复 / T4 多操作回归 / T5 本机端到端。
>   新增可注入 `ShellRunner`（引擎首测的基础设施）、`nodeKey` 审批维度、`awaiting-approval` 状态；
>   详见 §6「实现记录」。

---

## 1. 范围

**做**：节点类型收敛为 `shell` + `approval` 两类；本机执行闭环 —— shell 节点顺序执行多 action，approval 节点在 `run()` 循环中挂起并可恢复。

**不做**（后续阶段）：

| 排除项 | 阶段 |
|---|---|
| 节点 `host` + SSH 远程执行 | P1 |
| 变量管理（配置中心 `scope=template` + 管理页） | P2 |
| 前端画布 `PipelineEdit.vue` | P3 |
| 存量模板迁移、`check-base`/legacy/`locked` 退役 | P4 |
| `service` action 完整语义（版本表 + 指针 + 灰度） | P4（P0 仅最小实现，见 R1） |

---

## 2. 现状锚点（要改的文件）

| 文件 | 现状 | P0 改动 |
|---|---|---|
| `src/pipeline-template/template-node.ts` | `TemplateNode.kind = platform \| script`；`normalizeNodes` 校验保序/唯一/watchdog | 新增 `ApprovalNode`；`normalizeNodes` 支持 approval |
| `src/pipeline/steps/node-exec-plan.ts` | `NodeExecPlan.how = check-base \| script \| git \| builtin`；`planNodeExec` 纯函数 | `how` 增加 `'approval'` |
| `src/pipeline/pipeline.service.ts` | `run()` 主循环（L911-1097）；`executeV5Node`（L1189）；`runStageCommand`（L1399）；`runShell`（L1584） | approval 分支 + 挂起/恢复；`run` 支持从指定节点继续 |
| `src/entities/deploy-approval.entity.ts` | 流水线级审批单（无节点维度） | 加 `nodeKey` |
| `src/approval/approval.service.ts` | `needsApproval`/`create`/`resolve`，前置门禁语义 | 节点级创建/决议（按 `pipelineId`+`nodeKey` 去重） |

**测试现状**：`node-exec-plan.spec.ts` 已覆盖四种分派；`pipeline.service.spec.ts` 纯函数直测；`steps/pull.executor.spec.ts` 用 `Test.createTestingModule` + `makeCtx()`。

**缺口**：全仓 **0 处** mock `child_process.spawn`，`run`/`executeStage`/`runShell` 无集成测试 ⇒ T3/T4 需引入**可注入的 shell runner**（或把判定逻辑抽成纯函数）才可测。

---

## 3. 任务（全部 ✅ 完成）

### T1 节点类型：新增 `ApprovalNode`　—　✅ 完成

- 文件：`src/pipeline-template/template-node.ts`
- 验收：
  - V1 类型定义含 `key` / `label` / `approvers?` / `timeoutSec?` / `onTimeout?` / `onReject?`
  - V2 `normalizeNodes` 接受 approval 节点，与 shell 节点混合时**保序**
  - V3 approval 节点 key 重复 ⇒ 报错
  - V4 approval 节点**不占用** watchdog 唯一性（watchdog 只统计 shell 节点）
- 测试：`template-node.spec.ts`（**已存在**，追加 7 个用例）
- 实现：`ApprovalNode` + `APPROVAL_TIMEOUT_ACTIONS` / `APPROVAL_REJECT_ACTIONS` 白名单；
  approval 与 script 共用 key 格式 / 保留字 / label 约束，但**不参与 watchdog 计数**。
  注：目标模型的「shell 节点」当前仍叫 `script`（platform 三节点降级改名属 P4），故本阶段 `script` 即 shell 节点。

### T2 执行分派：`how = 'approval'`　—　✅ 完成

- 文件：`src/pipeline/steps/node-exec-plan.ts`
- 验收：
  - V1 `planNodeExec({kind:'approval', …})` ⇒ `{ how: 'approval' }`
  - V2 既有 `check-base` / `script` / `git` / `builtin` 四种分派**不受影响**（回归）
- 测试：`node-exec-plan.spec.ts`（已有文件，追加 2 个用例；既有 4 种分派回归通过）

### T3 approval 节点执行与挂起 / 恢复（核心）　—　✅ 完成

- 文件：`deploy-approval.entity.ts`（加 `nodeKey`）、`approval.service.ts`、`pipeline.service.ts`
- 验收：
  - V1 执行到 approval 节点 ⇒ 创建**节点级**审批单（`pipelineId`+`nodeKey` 唯一）⇒ 流水线置 `awaiting-approval` ⇒ **后续节点不执行**
  - V2 `approve(pipelineId, nodeKey)` ⇒ 从该节点**之后**继续，**已完成的 shell 节点不重跑**
  - V3 `reject` ⇒ 流水线 `failed`（`onReject='abort'`）
  - V4 三节点端到端（`shell → approval → shell`）：审批前停在节点 2；approve 后节点 3 执行，最终 `succeeded`
- 测试：新增 `src/pipeline/node-approval.spec.ts`（8 个用例，`Test.createTestingModule` + 假 shell runner，**不打真实子进程**）
- 前提改动（见 §6）：抽出可注入 `ShellRunner`；`deploy_approvals` 加 `nodeKey` / `nodeLabel`；
  `deploy_pipelines.status` 放宽到 `varchar(24)`；新增状态常量 `PIPELINE_AWAITING_APPROVAL = 'awaiting-approval'`。

### T4 shell 节点行为确认与回归保护　—　✅ 完成

- 文件：`src/pipeline/pipeline.service.ts`（`runStageCommand` / `runShell`）
- 验收：
  - V1 多 action 顺序执行；action 退出码非 0 且 `continueOnError !== true` ⇒ 节点失败，后续 action 不执行
  - V2 `continueOnError = true` ⇒ 记录失败但继续执行后续 action
  - V3 `WS_RESULT_FILE` 由前序 action 写入、后续 action 可读
  - V4 `timeoutSec` 生效（超时判失败）
- 说明：若现有实现已满足，仍须补测试作为回归保护（当前该路径**零测试**）
- 处理：原有行为均满足 ⊢ 抽出纯编排 `src/pipeline/steps/action-sequence.ts`（`runActionSequence`），
  `runStageCommand` 改为调用它，并补 9 个用例。顺带把「节点级 `timeoutSec`」接上了
  （此前 `ShellNode.timeoutSec` 定义了但从未生效，操作未配超时时不会回落节点级）。

### T5 本机端到端验证　—　✅ 完成

- 方式：临时脚本起 Nest 应用上下文（真实 MySQL + 真实 TypeORM + 真实 bash），建三节点模板
  「`hello`（echo 变量）→ `gate`（审批）→ `stamp`（echo 时间）」并提交，**验完已删除脚本**。
- 结果：
  - 审批前：`status=awaiting-approval`、`stage=gate`，日志只有第一段，**第三段未执行**；
  - 审批后：`继续执行：跳过已完成节点 hello → gate` → 第三段执行 → `succeeded`；
    第一段真实输出**只出现一次**（未重跑）。

---

## 4. 关键决策点（已确定）

| # | 决策 | 结论 |
|---|---|---|
| 1 | **恢复机制** | 采用「**① 持久化锚点 + ② 参数恢复**」组合：实例 `stage` 记全局挂起节点（复用既有列，**不加表字段**，服务重启后仍可续跑），恢复时由 `run(p, target, { resumeAfter })` 传入，`resolveStartIndex` 从其后一个节点开始。锚点缺失/不在计划里 ⇒ 从头执行（宁可重跑也不静默跳过） |
| 2 | **service action** | P0 保持最小实现：登记并跳过（`tool` 已记录到日志），不实现写版本表/切指针 —— 那属于 P4 迁移的一部分，提前实现会与现存 `version`/`pointer` 平台节点双轨并存 |
| 3 | **审批去重** | 同一 `(pipelineId, nodeKey)` 只保留一条 pending；重复触发（重入/服务重启续跑）**复用**已有单据而非报冲突 —— 否则一次重入就让整条流水线失败 |
| 4 | **驳回语义** | 节点级 reject ⇒ `failed`（已跑过部分节点，需留痕区别于"没开始"）；门禁级 reject 仍为 `cancelled`（历史语义不变）。`onReject='rollback'` 暂未实现，命中时按 abort 处理并在日志显式标注（P4） |
| 5 | **挂起不是失败** | 用 `PipelineSuspended` 异常跳出主循环，主 catch 优先识别：不写 `error`、不触发回滚、非终态；释放发布锁（挂起可能持续数小时，不能一直占锁），恢复时重新获取 |

---

## 5. 完成验证门

- 每个 V 判据都有对应断言；新增/修改的判定逻辑均有测试覆盖 ✅
- `npx jest` 相关 spec 全绿，且既有测试无回归 ✅（34 suites / 348 tests 全绿，`tsc --noEmit` 无错）
- T5 本机端到端通过（日志留证，见 §3 T5）✅

---

## 6. 实现记录（2026-09-14）

### 6.1 新增 / 修改文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `src/shell/shell-runner.ts` | 新增 | 可注入的 shell 执行通道（`ShellRunner` / `SpawnShellRunner` / token `SHELL_RUNNER`）。原 `PipelineService.runShell` 的 spawn 逻辑整体搬入，行为不变（detached 进程组、超时整组终止、流式日志） |
| `src/shell/shell-process.ts` | 新增 | `killShellProcess` 从 pipeline.service 迁出（避免 shell 层反向依赖 pipeline）；原导出由 pipeline.service 再导出，既有单测不受影响 |
| `src/shell/shell.module.ts` | 修改 | 注册 `SpawnShellRunner` 并以 `SHELL_RUNNER` 导出 |
| `src/pipeline/pipeline-suspension.ts` | 新增 | `PipelineSuspended` 异常 + `isPipelineSuspended` 守卫 + 纯函数 `resolveStartIndex` |
| `src/pipeline/steps/action-sequence.ts` | 新增 | 节点内多操作顺序执行的纯编排（失败即停 / continueOnError / WS_RESULT_FILE / 超时） |
| `src/pipeline-template/template-node.ts` | 修改 | `ApprovalNode`、`APPROVAL_*_ACTIONS`、`normalizeNodes` 支持 approval |
| `src/pipeline/steps/node-exec-plan.ts` | 修改 | `how: 'approval'` |
| `src/pipeline/pipeline.service.ts` | 修改 | 注入 shell runner；`run` 支持 `resumeAfter`；`executeV5Node` approval 分支；suspend 捕获；`approve/reject` 支持节点级；`cancel` 关闭挂起单据；新增 `waitFor(id)` |
| `src/pipeline/pipeline.controller.ts` | 修改 | `approve/reject` body 增加可选 `nodeKey` |
| `src/entities/deploy-approval.entity.ts` | 修改 | 加 `nodeKey`（索引）+ `nodeLabel` |
| `src/entities/deploy-pipeline.entity.ts` | 修改 | `status` 长度 16 → 24 |
| `src/approval/approval.service.ts` | 修改 | `createNode` / `pendingForNode` / `pendingForPipeline` |
| `src/pipeline/node-approval.spec.ts` | 新增 | 8 个用例（引擎层） |
| `src/pipeline/steps/action-sequence.spec.ts` | 新增 | 9 个用例（多操作回归） |
| `src/pipeline-template/template-node.spec.ts` | 修改 | +7 用例（类型层） |
| `src/pipeline/steps/node-exec-plan.spec.ts` | 修改 | +2 用例（分派层） |

### 6.2 落盘 / 兼容性注意

- `deploy_approvals.nodeKey`、`nodeLabel` 与 `deploy_pipelines.status varchar(24)` 依赖 **TypeORM `synchronize`**（app.module 中为 `true`）自动 ALTER；生产若已关闭 synchronize 需补迁移 SQL。
- T5 端到端踩到一个真实坑：`awaiting-approval` 17 字符超过原 `status varchar(16)`，MySQL strict mode 直接报
  `Data too long` 且**被 `save()` 吞成 warn**（状态在内存里对了、库里没落）—— 挂起态检查必须显式校验 DB 落盘值。

### 6.3 已知缺口（留给后续阶段）

- **节点边界变更（用户 2026-09-14，影响 P4 目标模型）**：
  ①`投递产物 + 写版本`合并为一个「**发布**」节点 —— 它是**普通 shell 节点、无内置语义**，
     脚本两步：上传文件（工具）+ 调用写版本接口（工具），走统一技术流程（用户 2026-09-14 澄清）；
  ②`切指针 + 验证`**移出流水线**，归「模块管理 → 环境部署」：部署 = 调用改指针接口，
     **本期不自动探活（人工确认）**，后续接 AI 验证 agent 时在该子模块加「AI 验证」按钮。
  即：P4 的 platform 节点不是简单降级为 shell，而是 `version` 并入发布节点、`pointer` 从流水线退役后独立提供给环境部署页调用。
  详见 `docs/ui/page-specs/pipeline-product-logic-v1.md` §9。

- **控制台 UI 未适配 `awaiting-approval`**：`statusColor` / `statusText` / `isLive` 三个状态表需加该项，
  否则挂起的实例会停止轮询、详情页不出现「审批通过 / 拒绝」按钮 —— 目前只能走 API（`POST /api/pipelines/:id/approve`）。
  涉及 `apps/deploy-console` 的 `components/pipeline/pipeline.stages.ts` + `views/PipelineDetail.vue` + `views/PipelineCenter.vue`，
  属 P3 前端范围（按项目 UI 规则需先出页面规格/影响清单）。
- `normalizeNodes` 仍强制要求 `git`/`version`/`pointer` 三个 platform 节点 —— **纯 `shell + approval` 的模板无法通过模板接口创建**，
  T5 是直接写模板行绕过的；「platform 降级为普通 shell 节点」属 P4。

---

## 5. 完成验证门

- 每个 V 判据都有对应断言；新增/修改的判定逻辑均有测试覆盖
- `npx jest` 相关 spec 全绿，且既有测试无回归
- T5 本机端到端通过（日志留证）

---

## 6. 后续（P1，2026-09-15 本轮）

本轮（UI 交互定稿 + 终态落地 + 环境归属合入 + 48 条流水线）的**开工上下文与未完成项**已单独落盘：

→ **`specs/pipeline-node-model/P1-handoff.md`**（新对话开场读它 + `specs/deploy-console/pipeline-edit-ui.md`）

已交付：PR #63–#70 全部合并发布；48 条流水线（16 模块 × 3 环境）全启用；
`admin local` / `mcp-gateway local` 回归跑通。

**未完成（按优先级）**：
1. 后台模块「部署生效」动作 —— 投递到版本目录而服务跑 `dist/`，需在「模块管理 → 部署」加
   「落到 dist + pm2 重启」（与前端切指针并列），保留版本化可回滚
2. 其余模块投递路径未逐个验证（尤其 `kedou-ai-minigram` 的构建是上传脚本，`PUBLISH_PATH` 可能要改）
3. 技术债：表名/字段/路由的「模板」命名；p3 迁移脚本保留为 DEPRECATED；流水线级 `defaultTarget` 仍被后端读取
