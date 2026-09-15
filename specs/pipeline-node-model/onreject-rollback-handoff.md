# 实现交接文档 · `onReject=rollback`（审批拒绝后回滚）

> 日期：2026-09-15 ｜ 状态：**待实现**（本文档供另一对话直接开工）
> 来源：流水线节点模型 P0 交付后的收尾项；设计口径见 `design.md` D8、`tasks.md` §4 决策 4
> 前置：P0 已完成（审批成为节点、挂起/恢复可用）、流水线变量已落地

## 1. 目标（一句话）

审批节点被拒绝、且该节点配置了 `onReject=rollback` 时，流水线**不是简单地置失败**，而是把该环境**回滚到本次发布前的版本**，并把结果（成功/失败、探活结论）写进日志与审计。

## 2. 现状与代码锚点

| 位置 | 现状 |
|---|---|
| `servers/deploy-console/src/pipeline/pipeline.service.ts` `reject()`（约 880–940 行） | 节点级拒绝：置 `status='failed'`、`error=审批拒绝: …`；当 `onReject==='rollback'` 时**只在日志追加一句「尚未实现（P4），按 abort 终止」**（约 907 行），没有实际回滚动作 |
| 同上 `run()` catch 块（约 1273–1310 行） | **已有可复用的回滚实现**：`isRollbackAnchor(...)` 判定 → `this.deployService.startRollback(p.env, prevVersion, p.operator, p.moduleKey)` → `await this.deployService.waitTask(taskId)`（必须等，否则"发起就算成功"）→ 后端模块再 `this.probeBackendHealth(p)` 探活确认 |
| `servers/deploy-console/src/pipeline-template/template-node.ts` | `ApprovalNode.onReject?: 'abort' \| 'rollback'`（`APPROVAL_REJECT_ACTIONS`），`normalizeNodes` 已校验取值白名单 |
| `apps/deploy-console` | **目前 0 处** `onReject`：节点配置抽屉没有暴露"拒绝动作"选项，UI 侧需补 |
| 原型 `docs/ui/prototypes/release-platform-v14-整合框架.html` | 编辑流水线 → 节点抽屉（approval）已有「拒绝动作 abort/rollback」的设计口径 |

可复用的既有能力：`DeployService.startRollback / waitTask`（`deploy/deploy.service.ts`）、`PipelineService.switchPointer`（改指针）、`probeBackendHealth`（后端探活）、`AuditService.log`（留痕）。

## 3. 必须先拍板的 4 个决策

| # | 议题 | 建议（待确认） |
|---|---|---|
| D1 | **回滚到哪个版本** | 回滚到**该环境在本次发布前的当前版本**（即 `run()` 里解析出的 `prevVersion`）。不建议"上一个已发布版本"的另一种解释（历史倒数第二），二者在连续发布时会分叉 |
| D2 | **已执行节点的副作用** | 拒绝发生时可能已跑过 git/build/甚至部分发布动作。建议：只做**指针回滚 + 版本记录标记**，不做产物删除（与"失败自动回滚"现有语义保持一致） |
| D3 | **回滚失败怎么办** | 保留 `status='failed'`，`error` 追加"回滚失败：<原因>"，并发通知（`deploy.rejected` + 告警）；**不要**伪装成成功 |
| D4 | **门禁级拒绝（pending-approval）要不要支持** | **不支持**：门禁在"尚未执行任何阶段"时阻断，没有可回滚的现场；该场景仍置 `cancelled`。仅节点级 `awaiting-approval` 支持 rollback |

## 4. 实现任务（T1–T4，建议 TDD）

### T1 抽出回滚动作为可复用方法（重构，先补测试）
- 把 `run()` catch 块里的「startRollback → waitTask → probeBackendHealth → 写日志」抽成 `private async rollbackTo(p: DeployPipelineEntity, targetVersion: string, reason: string): Promise<{ ok: boolean; note: string }>`
- 测试：抽取后既有"失败自动回滚"行为不变（`pipeline.service.spec.ts` 已有相关用例作为回归基线）

### T2 `reject()` 节点级分支接上回滚
- 在 `reject()` 判定 `onReject==='rollback'` 后：
  1. 解析 `prevVersion`（与 `run()` 同源：该环境当前指针版本，且必须 `!== p.versionTag`）
  2. 调用 `rollbackTo(p, prevVersion, '审批拒绝')`
  3. 按 D3 处理回滚失败
  4. 终态：`status='failed'`（保持"拒绝=失败"语义）+ 日志/审计记录回滚结果；建议新增审计 action `pipeline.reject.rollback`
- 无 `prevVersion` 或 `prevVersion === p.versionTag`（首次发布）→ 退化为 abort，并在日志写明"无可回滚版本"

### T3 前端暴露 `onReject`
- 编辑流水线：approval 节点配置抽屉加「拒绝动作」单选（abort / rollback），默认 abort
- 详情/列表：拒绝弹窗在命中 rollback 的节点上给出二次确认文案（"拒绝将回滚到上一版本"）
- 保存走 `PUT /pipeline-templates/:id`（`nodes` 已支持）

### T4 端到端验证
- 建一条「build → approval(onReject=rollback) → 发布」的流水线：先跑一次成功（留下 v1），再跑第二次到审批节点拒绝 → 断言指针回到 v1、日志有回滚与探活结论、审计有记录

## 5. 验收判据

| # | 判据 |
|---|---|
| V1 | `onReject=rollback` 的审批被拒绝后，该环境 `deploy_deployments.currentVersion` 回到本次发布前的版本 |
| V2 | 回滚**等任务真正结束**（`waitTask`），日志能看出回滚成功/失败，不是"发起即算" |
| V3 | 后端模块回滚后有探活结论并写入日志；前端模块跳过探活并注明原因 |
| V4 | 无可回滚版本（首次发布）时退化为 abort，且日志明确说明 |
| V5 | 回滚失败时流水线仍为 `failed`，错误信息含"回滚失败"，并发出告警通知 |
| V6 | 门禁级拒绝行为不变（仍 `cancelled`，无回滚） |

## 6. 影响文件清单

| 文件 | 改动 |
|---|---|
| `servers/deploy-console/src/pipeline/pipeline.service.ts` | 抽 `rollbackTo()`；`reject()` 节点级分支接回滚；审计留痕 |
| `servers/deploy-console/src/pipeline/pipeline.service.spec.ts`（+ 可能新增 spec） | 回滚/退化/失败三类用例 |
| `apps/deploy-console/src/views/PipelineCenter.vue`（或编辑流水线页） | 节点抽屉加「拒绝动作」 |
| `apps/deploy-console/src/views/PipelineDetail.vue`、`PipelineCenter.vue` | 拒绝二次确认文案（命中 rollback 时提示会回滚） |
| `docs/ui/prototypes/release-platform-v14-整合框架.html` | 若交互有调整，同步原型 |

## 7. 注意与坑

- `startRollback` 是**异步 spawn**，必须 `waitTask`，否则"自动回滚"变成"发起了但失败了没人知道"（现有代码已踩过并修，注释在 1290–1292 行）
- 只有**后端模块**才做端口探活；前端模块跳过并在日志写明（1300–1306 行）
- 回滚会改指针 —— 注意与**发布锁**的关系：拒绝路径当前是否已持锁、要不要先释放
- `onReject` 取值白名单已在 `normalizeNodes` 校验，**不要**放宽到其它值
- 节点级拒绝与门禁级拒绝是两条分支，改 `reject()` 时不要误伤门禁语义（D4）
