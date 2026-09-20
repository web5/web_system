# 「流水线模板」为什么还在：命名错位与收敛方向

> 触发：2026-09-17 用户看到新代码注释里写"由流水线模板决定是否启用"，问"咋还有流水线模板的概念"。
> 结论：**该消失的是"模板"这个词，不是那层关系**（定义 vs 执行是真实存在的两件事）。

## 1. 现状：两个实体，名字是反的

| 物理表 | 它实际是什么 | 现在被叫成 |
|---|---|---|
| `deploy_pipeline_templates` | **流水线（定义）**：模块 / 环境 / key / 节点序列 / 变量 / 启用 | ❌ "模板"（`tpl-xxx`） |
| `deploy_pipelines` | **发布单（一次执行）**：状态 / 日志 / commit / 灰度参数 | ❌ "流水线" |

类比 CI：**workflow（定义） 与 run（执行）** —— 两层都是必要的，问题只在于前者叫成了"模板"、
后者叫成了"流水线"，而 UI 从上到下对外说的都是"流水线"（指的是前者）。

## 2. 证据（名字已经骗了人）

- UI 列表进编辑页用的是**模板 id**：`PipelineCenter.vue:174` → `/pipelines/:id/edit`
- 创建后回跳的也是模板 id：`PipelineEdit.vue:426` 的 `created.id` 来自 `pipelineTemplateApi.create()`
- 变量表的字段叫 `pipeline_id`，**装的却是 `tpl-…`**：`scripts/migrations/p5-…mjs:302`
- 残留规模：前端 `pipelineTemplateApi` 18 处；后端 `templateId` / `tpl-` 87 处

也就是说：**"流水线"这个词在当前实现里指向两张不同的表，取决于你在哪一层说话** ——
这是新人必然踩的认知税，也是这次注释出错的直接原因。

## 3. 判断

不做合并（定义与执行必须分开：一张是改的，一张是跑出来的）；做**改名**：

```
流水线 Pipeline      ← deploy_pipeline_templates（定义）
发布单 PipelineRun   ← deploy_pipelines（执行）
```

## 4. 为什么至今没改

- 表名、`tpl-` 前缀的数据、外键（`vars` / `step_commands` / 版本指针…）都已落库，物理改名要停机窗口
- 代码面 ~105 处，一次性重命名风险高

## 5. 收敛三档（建议顺序）

| 档 | 内容 | 成本 | 风险 |
|---|---|---|---|
| 一档 | 本文档 + 注释/文案统一用「流水线 / 发布单」；新代码禁用 "template" 提法（DAO 层除外） | 半天 | 零 |
| 二档 | 代码层重命名：service / controller / DTO / API 路径 / 前端 store（`PipelineTemplate*Api` → `PipelinesApi`，执行侧 → `PipelineRunsApi`），**DB 不动**，仓储层做别名 | 1–2 天 | 低（纯机械 + 测试） |
| 三档 | 物理改名：`deploy_pipeline_templates` → `deploy_pipelines`，`deploy_pipelines` → `deploy_pipeline_runs`，迁移 `tpl-` 前缀数据 | 需窗口 | 中 |

**建议**：先做一档（本次已随注释落地），二档在日常迭代里分批做，三档等有发布窗口时一次做完。

## 6. 表名改名（2026-09-17，用户定调）

| 旧 | 新 | 语义 |
|---|---|---|
| `deploy_pipeline_templates` | **`deploy_pipelines`** | 流水线（定义） |
| `deploy_pipelines` | **`deploy_pipeline_runs`** | 发布单（执行实例） |

`deploy_pipeline_templates` 这个名字**就此释放**，留给将来的「用户模板」（见 §7）。

执行方式（`scripts/migrations/p9-rename-pipeline-tables.mjs`）：
先 `CREATE TABLE … AS SELECT` 备份两张表 → `RENAME TABLE` → 校验行数；
支持 `--rollback`（从备份表换回）。**改名期间需停 deploy-console**，改完发布新代码再启动。

同步改动：两个实体的 `@Entity()` 表名；`metrics.service.ts` 里 4 处原生 SQL
`FROM deploy_pipelines` → `FROM deploy_pipeline_runs`（含注释）。

### 二档：语义层改名（2026-09-17 已做，**不动物理列名**）

| 层 | 改动 |
|---|---|
| 后端实体 | `templateId` → **`pipelineId`**（71 处，8 个文件），`@Column({ name: 'template_id' })` 保持物理列名不变 → **零数据迁移** |
| 后端 | `deploy_pipeline_step_commands` / `deploy_pipeline_runs` 里"所属流水线"一律叫 `pipelineId`；`metrics` 原生 SQL 同步 |
| 前端 | `pipelineTemplateApi` → **`pipelinesApi`**（流水线定义，18 处）；`pipelineApi`（提交/执行）→ **`pipelineRunsApi`**（30 处） |

**故意留着**：

- 物理列名 `template_id`（避免又一次停机迁移，等下次有窗口时随其他变更一起改）
- API 路径 `/pipeline-templates`（外部脚本/文档有引用，改名需同步，留到三档）
- 实体类名 `DeployPipelineTemplateEntity`、TS 类型 `PipelineTemplate`（纯内部命名，收益小于风险，随日常迭代改）
- 数据里的 `tpl-` 前缀 ID（48 个定义 + 370 处引用，需整体字符串迁移）
- 「发布单侧」的 `pipelineId`（审批单 / 事件 / 锁指向的是**发布单**，语义上应叫 `runId`，本批未动）

## 7. 未来模板：与流水线解耦

用户 2026-09-17 定调 —— **现在不做，等流水线成熟后**：

- 用户可**手动把一条流水线另存为模板**；
- 模板与流水线**相互解耦**：从模板创建流水线 = **复制一份快照**成为新的流水线，
  之后模板改了不影响已创建的流水线，流水线改了也不回写模板；
- 因此未来的 `deploy_pipeline_templates` 是一张**新表**（本次改名后该名字已空出来），
  与本次"复制生成"语义一致：模板只是创建流水线的**起点**，不是它的父本。

## 8. 当前进度

- 2026-09-17：概念收口（本文档）；`apply.executor.ts` 注释改为「流水线 / 发布单」用词
- 2026-09-17：表名改名（p9 + 实体 + 原生 SQL），待执行与验证
- 待办：二档（实体类名 / 字段 `templateId` / API 名 / `tpl-` 前缀）
