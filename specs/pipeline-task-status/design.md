# 流水线详情画布 · 任务级执行状态落库与路径高亮

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on

## 0 背景与目标

详情页「执行流程」目前是点状时间线（`ProgressFlow.vue`），只展示步骤级进度；编辑页画布是
「步骤节点卡 → 步骤任务分叉（4-1 local-1 / 4-2 dev-1）→ 箭头」结构。用户要求：详情页画布
与编辑页同构，且**实际走过的路径绿色高亮**（含条件分支命中/未命中）。

执行痕迹目前只在 `logs` 文本里（`[task] 步骤 / 任务 …`），无结构化数据。方案（用户 2026-09-21
确认）：**后端落库任务级状态**，前端直读；不采用前端解析日志的兜底方案（旧实例回退现有时间线）。

## 1 数据模型

`deploy_pipeline_runs`（`DeployPipelineEntity`）新增列：

```ts
@Column({ type: 'json', nullable: true, comment: '任务级执行状态（新引擎实例；null=未记录）' })
taskStates?: Record<string, TaskRunStatus> | null;
```

- **key** = `${step.id}/${task.id}`（orchestration 快照内的稳定标识；name 可能被改名/重名，id 快照内唯一）
- **value** = `TaskRunStatus`：

```ts
type TaskRunStatus =
  | 'running'    // 已开始执行（或审批等待前）
  | 'succeeded'  // 成功（含 approval 任务通过）
  | 'failed'     // 失败（含审批被拒按 fail 处置）
  | 'skipped'    // 条件未命中 / 任务停用 / 审批超时按 skip / 拒绝按 skip
  | 'awaiting'   // 审批挂起中（挂起恢复后按结果覆写 succeeded/failed/skipped）
  | 'cancelled'  // 取消信号命中时该任务中止
```

步骤级状态**不落库**：由前端从任务状态聚合（见 §4），避免双份状态源漂移。

## 2 引擎改造（orchestration-engine.ts）

`EngineContext` 新增可选回调：

```ts
onTaskStatus?: (step: EngineStep, task: EngineTask, status: TaskRunStatus) => void | Promise<void>;
```

上报时机（`runTask` / `runOrchestration` 内）：

| 时机 | 状态 |
|---|---|
| 条件未命中跳过（`[task] … 条件不满足，已跳过`） | `skipped` |
| 任务 `enabled === false` | `skipped` |
| 任务开始（shell 动作循环前 / approval waitApproval 前） | `running` |
| shell 动作全部成功（含 afterTask 成功） | `succeeded` |
| 动作失败 / afterTask 失败 | `failed` |
| 审批挂起（waitApproval 抛挂起信号前） | `awaiting` |
| 审批通过 | `succeeded`（覆写 awaiting） |
| 审批拒绝/超时按 fail | `failed`；按 skip → `skipped` |
| shouldAbort 命中（CANCELED） | `cancelled` |

规则：
- 挂起恢复（`skipThroughStep`）跳过的步骤**不重报**——其任务状态在挂起前已落库（succeeded/awaiting），
  恢复后审批任务会按结果覆写，天然正确。
- 回调异常不吞执行主流程（catch 后仅 logger.warn），状态丢失只影响展示不影响发布。

## 3 PipelineService 落库

`runOrchestration` 调用处实现回调：

```ts
onTaskStatus: async (step, task, status) => {
  p.taskStates = { ...(p.taskStates ?? {}), [`${step.id}/${task.id}`]: status };
  await this.save(p);
}
```

- 状态变化即 save（每任务约 2 次写库：running → 终态；与 enterStage 的落库节奏同级，频率可接受）。
- `awaiting` 由 waitApproval 现有挂起逻辑触发（挂起信号抛出前回调）。

## 4 前端（ProgressFlow.vue 升级）

### 4.1 渲染结构（与编辑页画布同构，只读）

数据源：`instance.orchestration`（步骤→任务树快照）+ `instance.taskStates`。

```
[① 步骤节点卡]  →  [② 步骤节点卡] → …
   │（分叉连线）
   ├─ 任务卡 4-1 local-1
   └─ 任务卡 4-2 dev-1（条件任务标注条件表达式）
```

- 步骤卡：序号 + 步骤名 + key（沿用编辑页视觉，去拖拽/删除/加号交互）。
- 任务卡：`任务名` + 条件任务的条件角标；点任务卡 → 触发现有 `stageClick`（阶段详情）。
- 审批任务卡加「审批」小标（沿用 `mini-tag.t-plat`）。

### 4.2 状态与高亮（token 引 `--ws-*`，禁裸色）

| 来源状态 | 步骤卡/连线 | 任务卡 |
|---|---|---|
| 聚合 succeeded（全部任务成功） | 绿色边框 + 绿色箭头（走过路径高亮） | 绿色边框 + ✓ |
| running | 蓝色 + 呼吸 | 蓝色 + 执行中 |
| awaiting | 橙色 | 橙色 + 待审批 |
| 聚合 failed | 红色 + ✗ | 红色 + ✗ |
| skipped | 灰虚线 | 灰虚线 + 「跳过」小标 |
| 无记录/未到 | 灰 | 灰 |

步骤聚合规则：任一 failed → failed；否则任一 running → running；否则任一 awaiting → awaiting；
否则有 succeeded 且全部终态 → succeeded；否则未执行。**走过路径的箭头连线在进入侧步骤终态
succeeded 时变绿**。

### 4.3 兼容与回退

- `orchestration == null`（旧链路 / v5 nodes / legacy 实例）：保持现有时间线不变（本方案只覆盖新引擎实例）。
- `orchestration` 存在但 `taskStates == null`（改动前已跑的新引擎实例）：画布渲染结构，
  状态按整体 status 粗粒度着色（succeeded 全绿 / failed 当前 stage 红 / running 当前面蓝），
  任务级无状态时显示「未记录」。
- 图例补充「跳过 / 待审批」两项。

## 5 API 与类型

- 实体新增字段随现有 `get`/`list` 全量序列化返回，无新端点、无接口签名变化。
- 前端 `api/index.ts` `PipelineItem` 补 `taskStates?: Record<string, string> | null`。

## 6 迁移与风险

- DB：新增 nullable JSON 列。云 MySQL 已是 8.0（JSON 支持 OK）；本地/新引擎环境 synchronize
  自动建列；prod 关 synchronize 的环境上线时需手工 DDL（`ALTER TABLE deploy_pipeline_runs
  ADD COLUMN task_states json NULL`）。
- 风险：任务状态 save 频率翻倍（每任务 +1~2 次写）——单实例任务数 <20，量级可忽略；
  回调失败不影响发布主流程（§2 规则）。

## 7 涉及文件

| 文件 | 改动 |
|---|---|
| `servers/deploy-console/src/entities/deploy-pipeline.entity.ts` | +`taskStates` 列与 `TaskRunStatus` 类型 |
| `servers/deploy-console/src/pipeline-orchestration/orchestration-engine.ts` | +`onTaskStatus` 回调与上报点 |
| `servers/deploy-console/src/pipeline/pipeline.service.ts` | 实现回调落库 |
| `apps/deploy-console/src/api/index.ts` | `PipelineItem` +`taskStates` |
| `apps/deploy-console/src/components/pipeline/ProgressFlow.vue` | 升级为同构只读画布 + 路径高亮 + 回退 |

## 8 待确认项

无（方案已与用户确认「后端落库」；本设计为其细化，确认后实现）。
