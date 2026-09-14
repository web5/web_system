# P0 开工上下文（给新对话用）

> **用法**：新对话开场只需说「读 `specs/pipeline-node-model/P0-handoff.md` 与 `specs/pipeline-node-model/tasks.md`，从 T1 开始做 P0」，即可直接开工，**无需重新探索代码**。
> 本文件由 2026-09-14 的调研结果整理，含已探明的代码锚点与行号。
>
> **状态：P0 已交付（2026-09-14）** —— T1–T5 全完成，`servers/deploy-console` 单测 34 suites / 348 tests 全绿、本机端到端跑通。
> 下方 §1–§9 保留开工时的原始调研锚点（部分行号已位移）；实施后的实际落点与差异见 `tasks.md` §6。
>
> **变更日志**
> - 2026-09-14 P0 交付：结果回填 `tasks.md`（§3 任务状态 / §4 五条决策 / §6 实现记录含文件清单与已知缺口）；本文新增 §11「新增锚点与已定决策」。

---

## 0. 一句话目标

把 deploy-console 的流水线节点模型收敛为 **`shell`（执行）+ `approval`（审批）两类**，实现**本机**执行闭环：shell 节点顺序执行多个 action，approval 节点能在 `run()` 循环中**挂起、并在批准后从该节点继续**。

验收（design §7）：三节点模板 `shell → approval → shell` 跑通 —— 审批前不执行第三段，approve 后继续执行并最终 `succeeded`。

---

## 1. 必读文件

| 文件 | 内容 |
|---|---|
| `specs/pipeline-node-model/tasks.md` | **任务清单** T1–T5，含每条 V 判据（开工依据） |
| `specs/pipeline-node-model/design.md` | 设计稿：§0.3 决策 D1–D8、§3 节点模型定义、§4 变量、§7 落地阶段、§8 风险 R1–R5 |

---

## 2. 代码锚点（已探明，行号为当前 master 状态，可能微漂）

| 文件 | 关键符号（行号） | P0 改动 |
|---|---|---|
| `servers/deploy-console/src/pipeline-template/template-node.ts` | `PlatformNode`/`ScriptNode`(L27-44)、`TemplateNode`(L46，kind 仅 `platform`\|`script`)、`PLATFORM_RESERVED=['git','version','pointer']`(L23)、`normalizeNodes`(L60，校验保序/唯一/watchdog≤1)、`isV5NodesEnabled`(L104)、`legacyStepsToNodes`(L133)、`resolveNodeRunPlan`(L192) | **T1**：新增 `ApprovalNode`；`normalizeNodes` 支持 approval |
| `servers/deploy-console/src/pipeline/steps/node-exec-plan.ts` | `NodeExecPlan`(L17-25，how: `check-base`\|`script`\|`git`\|`builtin`)、`planNodeExec`(L28-35，**纯函数，重构主入口**) | **T2**：how 增加 `'approval'` |
| `servers/deploy-console/src/pipeline/pipeline.service.ts` | `run()` 主循环(L911-1097)、`resolveRunStages`(L103)、`executeStage`(L1107)、`buildStepContext`(L1164)、`executeV5Node`(L1189，`switch(plan.how)` L1198-1240)、`runStageCommand`(L1399)、`runShell`(L1584，`spawn('bash',['-c'])`)、`resolveStageVars`(L191-225，19 个内置变量)、`resolveInjectEnv`(L1376)、`enterStage`(L1684)、`save`(L1674)、`assertNotCancelled`(L1678)、`submit`(L410-496，命中审批 ⇒ `pending-approval` 且**不 run**)、`approve`(L670-720)、`reject`(L723) | **T3**：approval 分支 + 挂起/恢复；`run` 支持从指定节点继续。**T4**：shell 多 action 行为 |
| `servers/deploy-console/src/entities/deploy-approval.entity.ts` | `deploy_approvals`(L14)、`ApprovalStatus`(L3) | **T3**：加 `nodeKey` |
| `servers/deploy-console/src/approval/approval.service.ts` | `needsApproval`(L47)、`create`(L59，同 env+module 去重)、`byPipelineId`(L90)、`resolve`(L105) | **T3**：节点级 create/resolve（按 `pipelineId`+`nodeKey` 去重） |
| `servers/deploy-console/src/entities/deploy-pipeline-step-command.entity.ts` | `StepActionType='shell'\|'service'`(L12)、`StepAction`(L19-34)、`command`(L62)、`actions`(L69)、`locked`(L80) | 参考（P0 不改，P4 退役 `locked`） |
| `servers/deploy-console/src/pipeline/steps/step.types.ts` | `StepCategory`(L4)、`StepContext`(L17)、`CommandMode`(L40)、`BuiltinStepDef`(L49) | 参考 |
| `servers/deploy-console/src/pipeline/steps/step-registry.ts` | `buildBuiltinSteps`(L35，9 个内置步骤) | 参考 |
| `servers/deploy-console/src/pipeline-template/pipeline-template.service.ts` | `needsApprovalForTemplate`(L122，`always/never/inherit`) | 参考 |

**现有测试（风格参考）**

- `src/pipeline/steps/node-exec-plan.spec.ts`(L11-38)：已覆盖四种分派，T2 在此追加。
- `src/pipeline/pipeline.service.spec.ts`(L18-66)：纯函数直测（`resolveRunStages`/`isRollbackAnchor`），不启 Nest 容器。
- `src/pipeline/steps/pull.executor.spec.ts`(L18-55)：`Test.createTestingModule` + `useValue` 假服务 + 手搓 `makeCtx()` 返回 `{ctx, logs, p}`。

---

## 3. 必须先解决的技术前提（开工第一件事）

**全仓 0 处 mock `child_process.spawn`；`run` / `executeStage` / `runShell` 目前没有任何测试。**

⇒ 在做 T3/T4 之前，要先把「跑命令」从 `pipeline.service.ts` 里抽成**可注入的 shell runner**（例如定义 `ShellRunner` 接口，`pipeline.service` 依赖注入，测试传 `FakeShellRunner` 返回预设 exit code 与输出）。

否则 approval 的挂起/恢复无法在单测里验证。这是设计稿里没写、但实现时第一个会挡路的点。

---

## 4. 待定决策（实现时确定并记录）

1. **恢复机制**：流水线实例如何记录「从哪个节点继续」
   - ① 实例存 `currentNodeKey`，`run(p)` 从该 key 起执行 —— **倾向**（design R2 要求挂起态可持久化，含服务重启后恢复）
   - ② `run(p, { resumeFrom })` 参数传入
2. **service action**：P0 只做最小实现（写版本表 + 切指针），灰度 `canary` 留 P4（design R1）。
3. **审批去重**：同一节点重复触发只保留一条待决审批单。

---

## 5. 范围之外（P0 不做）

| 排除项 | 阶段 |
|---|---|
| 节点 `host` + SSH 远程执行 | P1 |
| 变量管理（配置中心 `scope=template` + 管理页） | P2 |
| 前端画布 `PipelineEdit.vue` | P3 |
| 存量模板迁移、`check-base` / legacy 九阶段 / `locked` 托管退役 | P4 |

---

## 6. 本机开发环境

| 项 | 值 |
|---|---|
| 仓库 | `/Users/geekwen/workspace/web_system` |
| 跑测试 | `cd servers/deploy-console && npx jest <spec 路径>` |
| 本机发布目录 | `~/web_system_release` |
| MySQL 客户端 | `~/local/mysql-8.4.0-macos14-arm64/bin/mysql`（root / `KedouLocal@2026`） |
| 本机 deploy-console | `:6200` |
| dev 服务器 | `175.27.189.123`（`ssh -i ~/.ssh/id_ed25519_servers ubuntu@…`，发布目录 `/data/web_system`） |
| 云数据库 | dev 与 prod **共用** `gz-cdb-8y2lp8rt.sql.tencentcdb.com:27241`（MySQL 5.7.18，**用户已提交升级到 8.0，升级中**） |
| 提 PR | `gh`，token 取仓库根 `.env` 的 `GITHUB_PR_TOKEN`；分支从 `origin/master` 切 |

> 提交注意：不要把密钥、内网地址写进提交内容。

---

## 7. 完成验证门

- T1–T5 每条 V 判据都有对应断言；新增/修改的判定逻辑均有测试覆盖
- `npx jest` 相关 spec 全绿，且既有测试**无回归**
- T5 本机端到端通过（日志留证）

---

## 8. 已完成的周边工作（与本 P0 相关，避免重复）

- `scripts/pipeline/restart-backend.sh`、`scripts/pipeline/verify-backend.sh` 已落地并被流水线 restart/verify 阶段委托（design §7 的后台流水线节点 5/6 就是调它们）。
- `scripts/health-check.sh` 已含 AI 链路探活（`knowledge_list` 端到端，401 指向网关密钥不一致、4010 指向内部密钥不一致）。
- dev 的 pm2 进程环境污染已清理（服务改用各自 `servers/<svc>/.env` 为唯一配置源）。
- PR #56 已合入相关修复（MCP 网关未配置不再静默跳过）。

---

## 9. T5 本机端到端怎么跑（可复用）

> P0 验收时用过一次，**脚本已按约定删除**，此处留方法以免下次重新摸索。

绕 Gag HTTP/鉴权，直接起 Nest 应用上下文调 `PipelineService`（真实 MySQL + 真实 TypeORM + 真实 bash）：

| 步骤 | 要点 |
|---|---|
| ① 建模板 | `templates.create()` 会走 `normalizeNodes`，**仍强制要求 git/version/pointer 三个 platform 节点**（P4 才退役）⇒ 纯 `shell+approval` 模板需用 `tplRepo.save()` 直接写行绕过；模板 `moduleKey='*'`、`approval='never'`（关掉门禁级审批，只验节点级） |
| ② 配节点脚本 | `stepCommands.upsert(tplId, nodeKey, 'echo ...')`（`nodeKey` 不能是 `git/version/pointer`，`isWritableStageKey` 会挡） |
| ③ 提交 | `pipeline.submit({ env:'local', moduleKey, templateId })`；需 `PIPELINE_V5_NODES=on`（否则落 legacy 路径，nodes 不生效） |
| ④ 断言 | 轮询 `svc.get(id)` 直到 `awaiting-approval`；查日志确认第三段未执行；`svc.approve(id, reviewer)` → `svc.waitFor(id)` → 断言 `succeeded` |
| ⑤ 踩坑 | `awaiting-approval` 17 字符 > 原 `status varchar(16)`，MySQL strict 报 `Data too long` 且**被 `save()` 吞成 warn**（内存对、库里没落）⇒ 断言必须查 DB 而非内存对象 |

污染面：会写 `deploy_pipelines` / `deploy_approvals` / `deploy_pipeline_templates`；用完记得删样板模板（流水线保留作日志留证）。

---

## 10. P0 之外仍未解决的（按阶段归属）

| 项 | 阶段 |
|---|---|
| 控制台 UI 适配 `awaiting-approval`（`statusColor` / `statusText` / `isLive` 三张状态表 + 详情页审批按钮）—— 否则只能走 API 审批 | P3 |
| `normalizeNodes` 放开 platform 硬约束（允许纯 `shell + approval` 模板） | P4 |
| `service` action 完整语义：写版本表 + 切指针 + 灰度 `canary` | P4 |

---

## 11. 2026-09-14 新增锚点（实施后的真实落点）

| 文件 | 内容 |
|---|---|
| `src/shell/shell-runner.ts` | `ShellRunner` 接口 + `SpawnShellRunner` + token `SHELL_RUNNER`（**T3/T4 可测的技术前提**） |
| `src/shell/shell-process.ts` | `killShellProcess`（从 pipeline.service 迁出，原处再导出，既有单测不受影响） |
| `src/pipeline/pipeline-suspension.ts` | `PipelineSuspended` + `isPipelineSuspended` + `resolveStartIndex` |
| `src/pipeline/steps/action-sequence.ts` | `runActionSequence`（多操作纯编排，T4 回归保护对象） |
| `src/pipeline/node-approval.spec.ts` | 引擎层 8 用例（假 shell runner，`Test.createTestingModule` 注入 26 个依赖） |

**五条已落地决策**（详见 `tasks.md` §4）：

1. 恢复锚点复用实例既有 `stage` 列（不加表字段），配合 `run(p, target, { resumeAfter })`；锚点丢失则从头执行。
2. `service` action 保持最小实现（登记并跳过），完整语义留 P4。
3. 审批去重按 `(pipelineId, nodeKey)`，重复触发**复用**而非报冲突。
4. 节点级 reject ⇒ `failed`（区别于门禁级的 `cancelled`）。
5. 挂起用异常跳出主循环，**不是失败**：不写 `error`、不触发回滚，并释放发布锁。
