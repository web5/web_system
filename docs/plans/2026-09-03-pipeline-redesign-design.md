# 流水线页面原型重设计（2026-09-03）

> 状态：**设计定稿（已获用户逐项确认）** → 下一步 writing-plans 拆实现计划。
> 范围：deploy-console 控制台「发布流水线」前端重构 + 后端 1 个新删除端点。

## 一、背景与目标

现状流水线入口（`PipelineCenter` 模块卡片栅格 → `PipelineDetail` 2 Tab → `PipelineRunDetail` 三级页面）卡片密集、模板与执行关系不直观、历史记录入口分散。

目标（用户 5 条需求 + 逐项澄清）：

1. 列表页 = **摊平的流水线记录表格**（保留模板体系），默认以模块名为流水线名，重名加后缀。
2. 流水线记录行操作：**详情 / 编辑 / 执行**。
3. 详情页 2 Tab：Tab1 当前实例执行流程图（节点点击查看 命令+日志+结果）、Tab2 历史记录。
4. 历史记录行支持：**详情 / 删除 / 重试**；点实例 ID / 「详情」切回 Tab1 展示该实例流程图。
5. 详情页对当前选中实例支持 **重试 / 停止**。
6. 列表页顶部为**筛选表单**（四维度），取消「执行记录」「发起发布」全局按钮，仅保留「+ 新建流水线」。

## 二、关键决策记录（用户已确认）

| # | 决策点 | 结论 |
|---|--------|------|
| D1 | 流水线实体模型 | **保留模板体系**，列表摊平「模块×模板」；流水线名默认取模块名，同模块多模板加后缀展示 |
| D2 | 列表形态 | **表格列表**（含搜索/模块筛选） |
| D3 | 行内「执行」 | **弹参数面板**（发起发布抽屉：env 必选 / branch 默认模块最近分支 / mode+灰度可调 / prod confirm） |
| D4 | 详情 Tab 结构 | Tab1「执行流程」= 当前选中实例流程图（默认最新一次，空态引导发起）；Tab2「历史记录」= 全部执行记录表格 |
| D5 | 历史「删除」语义 | **纯清理记录**（不动版本指针/产物）；running/pending 不可删（400，提示先停止）；终态（succeeded/failed/cancelled）可删；后端新增 `DELETE /pipelines/:id` |
| D6 | 节点点击交互 | **右侧抽屉三合一**：Tab ①命令（`pipeline-script-view`）②执行日志（按阶段过滤）③结果（状态/耗时/产物/错误）——改造复用 `StageCommandDrawer` |
| D7 | 列表页筛选区 | 四维度筛选表单：关键字 / 模块 / 类型(内置·自定义) / 最近执行状态；右侧「查询/重置」 |
| D8 | 全局入口处置 | 取消「执行记录」抽屉与全局「发起发布」按钮；筛选区保留「**+ 新建流水线**」；发起由行内「执行」承担 |
| D9 | Tab1 实例摘要条 | Tab1 流程图上方**展示摘要条**（短ID+状态tag+版本+耗时+操作人），running 自动轮询刷新 |
| D10 | 历史表格行交互 | **仅实例 ID 列与「详情」按钮**可点切 Tab1（非整行可点，避免误触） |

## 三、信息架构（路由收敛）

| 路由 | 页面 | 说明 |
|------|------|------|
| `/pipelines` | 流水线列表（表格） | 摊平「模块×模板」记录行 + 筛选表单 |
| `/pipelines/:id` | 流水线详情（2 Tab） | `:id`=模板 id；支持 `?run=xxx` 深层链接选中实例 |
| ~~`/pipelines/:id/:runId`~~ | ~~PipelineRunDetail~~ | **废弃**（功能并入详情 Tab1），文件移除 |

## 四、页面原型

### 4.1 列表页 `/pipelines`

```
┌──────────────────────────────────────────────────────────────────────┐
│ 发布流水线                                                             │
│ [关键字____] [模块▼] [类型▼] [最近执行状态▼] [查询] [重置]   [+ 新建流水线]│
├──────────────────────────────────────────────────────────────────────┤
│ 流水线名称        │ 类型  │ 模块   │ 最近执行        │ 成功率 │ 操作       │
│ 管理后台 Admin    │ 内置  │ admin  │ ✓ succeeded     │ 23/25 │ 详情 编辑 执行│
│ 管理后台 Admin-灰度│ 自定义│ admin  │ ✗ failed @build │  1/2  │ 详情 编辑 执行│
│ 业务门户 Portal   │ 内置  │ portal │ ● running       │ 18/20 │ 详情 编辑 执行│
└──────────────────────────────────────────────────────────────────────┘
```

- 数据源：`pipelineTemplateApi.list()` 全模板 + `moduleRegistry`（模块名/类型）+ `pipelineApi.summary()`（每模板 total/ok/latest）。
- 行对象：`template` + `module` + `summary`。流水线名 = 模块名，模板名非空且与模块名不同时追加 `-模板名`。
- 操作：`详情`→`/pipelines/:id`；`编辑`→模板编辑抽屉（复用现状字段）；`执行`→发起发布抽屉 → 提交成功跳 `/pipelines/:id`（跑新实例）。
- 筛选维度在**前端过滤**（数据量级小：模板数十条，无需后端分页）；最近执行状态来自 summary.latest.status（running/succeeded/failed/无执行）。

### 4.2 详情页 `/pipelines/:id`（Tab1 执行流程）

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← 返回  流水线名（模块名+模板名）   [内置]  [12 次 · 成功 11]            │
│ 操作栏（作用于当前选中实例）: [发起发布] [重试/再次发布] [停止]           │
├──────────────────────────────────────────────────────────────────────┤
│ Tab1 ● 执行流程                    Tab2 ○ 历史记录                      │
│──────────────────────────────────────────────────────────────────────│
│ 摘要条: #a1b2c3 · dev · 分支 feature/x · 版本 abc1234 · admin · 12:00  │
│         [succeeded] [耗时 3m12s]                                       │
│                                                                        │
│   ┌校验✓┐→┌拉取✓┐→┌构建✓┐→…→┌探活✓┐  (ProgressFlow 仅渲染实例步骤集)    │
│   └─────┘ └─────┘ └─────┘   └─────┘                                   │
│      ↑点击节点 → 右侧抽屉 StageDetailDrawer                            │
│       ┌ Tab①命令(scriptView) │ Tab②执行日志 │ Tab③结果(状态/耗时/产物/错误)┐│
│       └──────────────────────┴────────────┴──────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

- 选中实例 `selectedRun`（默认 `?run=` 或最近一次；运行中 3s 轮询 `pipelineApi.get`）。
- 节点点击打开三合一抽屉（含该阶段当前配置命令 + 该实例该阶段日志 + 该实例该阶段结果）。
- 操作按钮可用性：重试（failed/cancelled → `retry`；succeeded → 「再次发布」以相同参数新跑）；停止（running/pending → `cancel`）；均仅当前选中实例为对应状态时可用。
- 轮询策略：仅 selectedRun 处于 running/pending 时轮询（3s）；页面卸载/切走取消。

### 4.3 详情页 Tab2 历史记录

```
│ Tab1 ○ 执行流程                    Tab2 ● 历史记录                      │
│ [环境筛选] [状态筛选] [刷新]                                            │
│ 实例ID(短) │ 环境 │ 版本 │ 状态   │ 阶段 │ 操作人 │ 开始时间 │ 操作       │
│ a1b2c3     │ dev  │ abc1 │ succeeded │ -  │ admin  │ 12:00 │ 详情 删除 │重试│
│ f9e8d7     │ dev  │ 9ab2 │ failed  │ build│ admin │ 11:00 │ 详情 删除 │重试│
```

- 数据源：`pipelineApi.list({ templateId })`。
- 点**实例 ID**（短 hash，router-link 样式）或**「详情」** → 切 Tab1 + 加载该实例（URL 同步 `?run=`，支持刷新/分享）。
- 删除：弹确认框（提示"仅移除记录，不影响当前版本指针与产物"）；running/pending 行「删除」禁用/隐藏。
- 重试：failed/cancelled 显示「重试」；succeeded 显示「再次发布」；点击后跳 Tab1 跟踪新实例。

### 4.4 阶段详情抽屉（三合一）

- 组件：`StageCommandDrawer.vue` 改造为 `StageDetailDrawer.vue`（或同组件内加 tab）。
- Tab① 命令：数据 `stageCommandApi.scriptView(moduleKey)` 取该阶段；configured 显示 shell（复制按钮）+ 编辑人/时间；builtin 显示内置说明；required-unset 红色警示；semantic 说明。
- Tab② 执行日志：从选中实例 `logs` 中过滤该阶段段落（依赖阶段标记行，见 §五日志切分）。
- Tab③ 结果：阶段状态、耗时（若有）、产物/版本指针（upload/version/pointer 阶段）、error 信息（verify/check 失败原因）。

## 五、后端改动（最小集）

### 5.1 新增删除执行记录端点

```
DELETE /api/pipelines/:id
```

- 行为：删除 `deploy_pipelines` 该实例记录（**纯清理**，不动 deploy_versions / deploy_deployments 指针、不回收产物）。
- 校验：实例不存在 → 404；`status ∈ {running, pending, pending-approval}` → 400（"执行中/待审批的记录不可删除，请先停止或等待结束"）。
- 安全：需登录 + 管理员角色；写审计日志（operation=delete_pipeline, 对象=实例id, operator）。
- 返回：`{ ok: true }`。

### 5.2 日志按阶段切分（实现阶段核查）

- 若实例 `logs` 每行已带阶段标记（现状以 `### [stage] xxx` 或 enterStage 行分割），前端按标记过滤即可，**无需后端改动**。
- 若不可靠：后端 `GET /pipelines/:id` 返回时附带 `stageLogs: Record<stage, string[]>`（service 内按标记切分），前端抽屉直接用。

## 六、组件与文件改动清单

| 文件 | 动作 |
|------|------|
| `apps/deploy-console/src/views/PipelineCenter.vue` | 重构：卡片栅格 → 摊平表格 + 四维筛选表单 + 「+新建流水线」；移除执行记录/全局发起入口（发起抽屉保留给行内执行与新建后用） |
| `apps/deploy-console/src/views/PipelineDetail.vue` | 重构：2 Tab + selectedRun 状态 + 摘要条 + 操作栏（发起/重试/停止）+ `?run=` 深层链接；历史 Tab 行交互（ID/详情可点切 Tab1） |
| `apps/deploy-console/src/components/pipeline/StageCommandDrawer.vue` | 扩展为三合一（命令/日志/结果 3 Tab），props 增加 `instance` |
| `apps/deploy-console/src/components/pipeline/ProgressFlow.vue` | 少量适配（非运行实例也可选中查看；暴露实例步骤集渲染逻辑复核） |
| `apps/deploy-console/src/views/PipelineRunDetail.vue` | 删除（路由不再挂载；功能并入详情 Tab1） |
| `apps/deploy-console/src/router/index.ts` | 移除 `/pipelines/:id/:runId` 路由 |
| `apps/deploy-console/src/api/index.ts` | `pipelineApi` 增加 `remove(id)`；可能加 `PipelineItem.stageLogs?` |
| `servers/deploy-console/src/pipeline/pipeline.controller.ts` | 新增 `DELETE /pipelines/:id` |
| `servers/deploy-console/src/pipeline/pipeline.service.ts` | 新增 `remove(id, operator)`（校验状态 + 审计） |

## 七、范围外（YAGNI）

- 模板实体合并 / 删除「全局模板(moduleKey='*')」能力。
- 执行记录删除时回收产物/回滚版本指针。
- 列表后端分页/服务端筛选（当前数据量级无需）。
- 模板导入导出。

## 八、验收标准（初稿，writing-plans 细化）

1. `/pipelines` 表格展示所有「模块×模板」，流水线名默认=模块名，多模板后缀可辨；四维筛选与重置生效。
2. 行操作 详情/编辑/执行 均可用；执行提交后进入详情页并跟踪新实例。
3. `/pipelines/:id` 默认 Tab1 展示最近一次执行流程图；无执行显示空态与发起引导。
4. 点击流程节点打开三合一抽屉：命令/日志/结果内容与所选实例该阶段一致。
5. Tab2 历史表格正确；点 ID/详情切 Tab1 加载该实例（URL 带 ?run=，刷新可复原）；删除仅限终态并二次确认；重试/再次发布跳新实例。
6. 顶部操作栏 重试/停止 状态可用性正确（对 running 实例可停止）。
7. `DELETE /pipelines/:id` 后端：终态 200、running 400、不存在 404、写审计。
8. 后端 tsc + 单测、前端 vue-tsc 全绿。
