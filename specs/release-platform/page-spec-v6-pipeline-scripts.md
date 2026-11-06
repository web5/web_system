# 页面规格书 · 流水线级脚本 + 版本身份纳入流水线维度（v6 · R6 落地）

- 页面类型：列表页（`PipelineCenter` = 全部流水线列表，入口）+ 详情页（`PipelineDetail`：运行态 tab「当前运行 / 执行历史」+ 页头「编辑」「发起发布」两个抽屉）+ 详情页（`ModuleDetail` 瘦身）
- 参照页：主参照 `PipelineCenter.vue`（列表）+ `PipelineDetail.vue`（详情）；Token canonical 参照 `ServiceManager.vue`（design.md §1 双参照裁决）
- 需求一句话：把「阶段命令」从模块搬进流水线——节点（流程单元）与其命令（执行体）同属流水线，模块退化为纯目标与上下文；产物/版本身份升级为「模块 × 流水线 × 版本」；运行历史与回滚统一收敛到流水线详情。
- 关联规格：`specs/release-platform/design.md` §3.1（R6 落地 D-a/D-b/D-c + 八项确认 + 6b/6c IA 调整）
- 原型稿：`docs/ui/prototypes/release-platform-v9-pipeline-console.html`（当前版：运行/定义分离 + 编辑抽屉）；前序 v8 / v7 / v6（IA 演进留痕）
- 前置依赖：后端契约须先就绪（§5）——模板 `key` 字段、`deploy_pipeline_step_commands` 表与接口、产物命名空间下沉、数据迁移脚本；**本文档为写码前规格，用户过目确认后实施**

---

## 0. 改动边界

| 面 | 文件 | 改动 |
|---|---|---|
| A 流水线列表（入口） | `views/PipelineCenter.vue` | 侧栏「流水线」默认落地**全部流水线列表**：流水线（名 + `key`）/ 适用模块 / 最近运行（状态 tag + 时间 + 环境）/ 最近版本 / 执行次数 / 操作（进入详情 · 发起发布）。点行进详情；**移除**原页内「提交流水线」表单（发布改在详情内） |
| B 详情 · 当前运行 | `views/PipelineDetail.vue` | 第一个 tab：**最新一次实例**的运行情况——状态、环境/模块/版本/来源/耗时/操作人/产物目录 + 只读执行流程图（节点态着色）+ 成功可「回滚到此版本 / 再次发布」、失败给「日志尾部 / 重试」 |
| C 详情 · 执行历史 | `views/PipelineDetail.vue` | 第二个 tab：实例列表，**含「版本」列**；行内操作 = 详情 / **回滚到此版本** / 重试；下方跟随 **legacy 历史产物**表（只可回滚、不再新增）。**取消**原独立「版本与回滚」tab |
| D 编辑页（编排与命令） | 新路由 `/pipelines/:id/edit`（`PipelineEdit.vue`；`PipelineDetail.vue` 的「编辑」跳转过去） | **独立页面，非抽屉**（定义态长停留操作）。页头右侧：删除流水线（禁用 + tooltip）/ 取消 / 保存（primary，loading 防重复）。三段：基本信息（去掉「作用模块」下拉、新增「流水线 key（slug）」就地校验）/ 流程编排（画布）/ 节点命令（按 `模板 × 节点 key` 读写 + 变量 chips + 「按模块预览」；删除节点确认文案「命令随节点一并删除」）。未保存离开（取消 / 面包屑 / 侧栏）统一「放弃修改」确认 |
| E 详情 · 发布抽屉 | `views/PipelineDetail.vue` | 页头 primary「发起发布」打开**发布抽屉**（宽 ~640）：环境（tabs）+ 模块 + 分支/commit + 模式（灰度展开参数，backend 禁选）+ **产物与版本身份预览**；prod 出现审批提示条；提交二次确认含命名空间 |
| F 模块页 | `views/ModuleDetail.vue` | ① **移除** `key="script"`「发布脚本」tab 及相关逻辑；② 顶部提示条 + 「查看流水线」跳转；③「当前部署（环境 × 版本）」**只展示当前版本**，**不新增「所属流水线」列**（当前版本可能是多流水线交叉结果）；④ 保留「回滚」（可滚到该环境任意版本，含 legacy） |
| G 共享组件/契约 | `components/pipeline/StageActionsEditor.vue`、`api/index.ts` | 编辑器 props 由 `moduleKey` 改为 `templateId + nodeKey`；新增 `pipelineStepApi`（§5） |
| H 后端（另列） | `servers/deploy-console/src/**` | 模板 `key` 列/校验；`deploy_pipeline_step_commands` 表；`/pipeline-templates/:id/steps/:nodeKey` 接口；`release-paths`/`artifact-store` 命名空间下沉；`runStageCommand` 读路径切换；迁移脚本（已配命令模块 → 专用线）；下线 `deploy_module_stage_commands` |

> 本次**删除**模块页 9 阶段「发布脚本」视图（与 v5 规格 §0 的"不删"判断相反）——v6 起模块不再持有命令，该视图已无真相源。

---

## 1. 面 A：流水线列表（入口）

- 页头：h1「流水线」+ caption「全部流水线（全局线服务多模块；专用线只服务一个模块）。点行进入详情。」+ 主操作 primary「新建流水线」
- 表格列：

| 列 | 来源/展示规则 | 操作 |
|---|---|---|
| 流水线 | 名称（`builtin` 附 tag「内置」）+ 次行 `key = xxx`（`ws-mono`） | 点行进入详情 |
| 适用模块 | 全局线 =「全部模块」；专用线 = 模块名 | — |
| 最近运行 | 状态 tag（成功/失败/运行中）+ 时间 + 环境（次行 muted） | — |
| 最近版本 | `<流水线key>/<commit>`（`ws-mono`） | — |
| 执行次数 | `tabular-nums` | — |
| 操作 | — | 「发起发布」→ 进入详情「发起发布」分区 |

- 行整体可点（`clickable`），行内操作列 `stopPropagation`
- 空态：「尚未创建流水线 · 点右上『新建流水线』，或从『默认流程』复制一条专用线」（原因 + 出路）

---

## 2. 面 D：编辑页 · 编排与命令（独立路由，页头「编辑」跳转）

### 2.1 页头（详情页共用）
- 面包屑：`‹ 返回流水线列表`（topbar 左侧；`PipelineCenter` 已有此形态）
- 标题：流水线名（`builtin` 附 tag「内置 · 不可改名」）；副标题：`全局流水线 · key default · 适用全部模块 · 审批继承环境 · 失败回滚上一版本`
- 右上操作：**编辑**（default，跳转独立编辑页 = §2）+ **发起发布**（primary ≤1，打开发布抽屉 = §5）
- KPI 行：最近运行（状态）/ 最近版本（`ws-mono`）/ 执行次数（`tabular-nums`）/ 近 7 天失败率
- 运行态 tab 条（顺序固定）：**当前运行 → 执行历史**

### 2.2 基本信息卡
- 字段：流水线名（`builtin` 禁改 + 提示"可复制另建"）、**流水线 key（slug）**、适用模块、启用 switch、审批 radio-group、失败回滚 radio-group
- key 校验 `^[a-z0-9-]{1,32}$`；撞名 → 就地红字；改名后提示「产物将落在 `modules/<模块>/<新key>/`，历史产物仍在旧 key 目录，可回滚」
- 命名空间提示条（info）：`产物路径 = 模块 × 流水线 key × 版本`，附示例 `modules/admin/default/1a2b3c4/`

### 2.3 流程编排卡
沿用 v5 nodes 画布（platform 锁定 / script 可拖拽增删 / 连接线插孔）；仅改删除确认文案 → **「其 N 个操作（命令）随节点一并删除」**

### 2.4 节点命令卡
- 顶部**命令归属**标签（替换原「作用模块」下拉）：`命令归属：本流水线 · <名称> · <key>`
- 点 script 节点 → `StageActionsEditor`（多操作）：
  - 读写 `GET/PUT /pipeline-templates/:id/steps/:nodeKey`（含 `actions`）
  - 未配置展示内置说明（`source` 四态沿用）；platform 节点点选 → `message.warning`，不开编辑器
- 变量 chips（8 个）+ **按模块预览**（选模块 → 变量替换后的实际命令，等宽只读）
- 底部：「保存」（`saving` 锁）、「删除节点」（danger + 二次确认）

### 2.5 保存
- `PUT /pipeline-templates/:id`（name/desc/enabled/key/策略 + nodes）；前端先跑 `checkNodes`，后端 400 原样展示
- 节点命令单独保存（`PUT .../steps/:nodeKey`），成功仅刷新该节点与 `steps` 视图缓存
- 旧模板（`nodes=null`）打开仍走 v5 预转存预览（不变）

---

## 3. 面 B：详情 · 当前运行

- 顶部状态行：状态 tag（成功/失败/运行中）+ 实例 ID（`ws-mono`）
- 概览 kv：环境 / 模块 · 版本（`<key>/<commit>`，`ws-mono`）/ 来源（分支 @ commit）/ 耗时 · 操作人 / 产物目录（`ws-mono`）
- **只读执行流程图**：数据源 = 该实例 nodes 快照；节点态着色——完成 = success 语义、失败 = error 语义、未执行 = 中性；platform 节点锁定色，watchdog 节点角标
- 分区页脚操作（成功）：`查看完整日志`（default）· `回滚到此版本`（default）· `再次发布`（default）
- 失败态：失败阶段标红 + 日志尾部（深色 `logbox`，等宽）+ `重试` 按钮
- **只显示最新一次实例**；要看更早的走「执行历史」下钻详情（避免同页两个实例视图）

---

## 4. 面 C：详情 · 执行历史

### 4.1 实例列表
- 页头右侧：模块筛选下拉（默认「全部」；全局线服务多模块时必需）
- 列：

| 列 | 展示规则 |
|---|---|
| 实例 | ID（`ws-mono`） |
| 环境 / 模块 | 模块 `ws-mono` |
| **版本** | `<流水线key>/<commit>`（`ws-mono`）；当前线上版本附 `tag ok`「当前」 |
| 状态 | tag 语义色（成功 / 失败 · 失败阶段 / 运行中） |
| 时间 / 操作人 | 时间 `tabular-nums` |
| 操作 | `详情` · `回滚到此版本`（当前版本行不显示） · `重试`（仅失败行） |

- 表尾说明：「回滚只切**本流水线命名空间**内的版本；其它流水线的版本请到对应流水线回滚。」
- 回滚（破坏性）`Modal.confirm` 文案：
  > 将把 `<环境> / <模块>` 的线上指针切到 `<版本>`。
  > 影响：该环境用户即刻加载此版本产物（gateway 版本缓存 TTL 10s 后生效）。
  > 不做跨流水线互斥校验（决策 D-c）：其它流水线随后发布同一模块会再次覆盖指针。
- 失败：`message.error`，弹窗保留可重试

### 4.2 legacy 历史产物（跟随其下）
- 卡片标题「历史产物」+ 说明「legacy：无流水线命名空间 · 只可回滚，不再新增」+ 右侧 tag「legacy」
- 列：版本（`ws-mono`，纯 commit）/ 产物目录（`ws-mono`，次级色）/ 环境 / 时间 · 操作人 / 操作（回滚到此版本）
- 卡片底注：「legacy 与流水线命名空间按『一级目录是否含 index.js』区分，各自独立计保留数（保留 5）」
- 空组不渲染该卡

---

## 5. 面 E：发布抽屉 · 发起发布（页头 primary 入口）

- 发布环境：`a-select`（**动态集合**：选项来自环境管理、不预置枚举——环境数量不固定，本地/dev/test/stage/prod/…；R2 适用例外：动态选项用下拉）。选中后身份预览即时联动
- 目标模块：`a-select`，**按入口上下文联动**（design.md 6g）：
  - **列表行「发起发布」** → **可选**（不受 scope 限制，让用户选）
  - **详情页头 / 执行历史「再次发布」 / 当前运行「再次发布」 / 模块页「发起发布」** → **默认选中且禁用**：禁用 + 「已锁定」tag + 旁注「已默认锁定 · 模块 X（如需发其它模块，从列表入口选择）」
  - **专用线**的详情页头 / 记录入口 → 下拉只含其适用模块（scope 过滤）且直接锁定；旁注「专用线仅适用模块 X，不可修改」
- 分支（`ws-mono`）/ commit（`ws-mono`，占位"留空 = 分支最新"）
- 发布模式：`a-radio-group`（直接全量 / 灰度）；backend 模块灰度禁选 + tooltip 说明原因
- **产物与版本身份预览卡**（实时联动）：

| 行 | 内容 | 展示规则 |
|---|---|---|
| 版本标识 | `<流水线key>/<commit>` | `ws-mono` |
| 产物目录 | `modules/<模块>/<流水线key>/<commit>/` | `ws-mono`，断行不断词 |
| HTTP 入口 | `/static/modules/.../index.js` | `ws-mono` |
| 写入指针 | `deploy_deployments(<env>, <模块>).current_version` | `ws-mono` |
| 模块类型行为 | 前端/微前端 = 投递 + 切指针 + manifest 断言；backend = 重启 + 端口探活 | 纯文本，枚举不配色 |

- 警示条（warning）：指针按「环境 + 模块」唯一，多条流水线发布同一模块时后写生效，不提示、不拦截（D-c）
- 页脚：次操作「保存草稿」；主操作 primary「提交发布」（prod 二次确认，文案含命名空间）

---

## 6. 面 F：模块页瘦身（`ModuleDetail.vue`）

- **移除** `key="script"` tab（含 `showScriptTab`、`scriptViewMap`、`ensureScriptView`、9 阶段渲染块）
- 页头下方提示条（info）：`本模块不再持有构建/投递命令（R6）：命令已归流水线节点所有。查看流水线 →`（跳 `PipelineCenter`）
- 页头主操作 primary：「发起发布」→ 进流水线详情「发起发布」分区（默认带出该模块）
- 「当前部署（环境 × 版本）」表：列 = 环境 / 当前版本（`ws-mono`，完整 `<key>/<commit>`）/ 部署时间（`tabular-nums`）/ 操作（`回滚`）
  - **不新增「所属流水线」列**；表上方 muted 说明：「只展示当前线上版本；版本号含命名空间前缀。当前版本可能是多条流水线先后发布的结果。」
  - 空态：某环境无记录 → `未发布 · 去发布`
- 保留 tab：后台 / 服务环境（backend）· 前端（frontend/micro-frontend），不改

---

## 7. 契约（面 G/H 共同遵守）

### 7.1 类型与字段

```ts
interface PipelineTemplate {
  // ...既有字段
  key: string          // slug ^[a-z0-9-]{1,32}$，全局唯一；内置默认线 = 'default'
}

// 节点命令（新真相源：流水线 × 节点 key）
interface PipelineStepCommand {
  nodeKey: string                    // = TemplateNode.key（platform 保留字不可写）
  actions: StageAction[]             // 多操作（沿用 v4 StageAction：shell | service）
  timeoutSec?: number
  enabled: boolean
  updatedBy?: string
  updatedAt?: string
  source: 'configured' | 'builtin' | 'required-unset' | 'semantic'   // 合并视图
}

// 版本标识：<流水线key>/<commit>；legacy 历史版本 = 纯 <commit>（无 /）
type VersionRef = string
```

### 7.2 接口（控制台 JWT；不暴露 MCP）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/pipeline-templates/:id/steps` | 各节点命令合并视图（`source` 四态） |
| GET | `/pipeline-templates/:id/steps/:nodeKey` | 单节点命令（含 `actions`；未配置返回 null） |
| PUT | `/pipeline-templates/:id/steps/:nodeKey` | 保存（每个 shell 操作保存前 `bash -n`） |
| DELETE | `/pipeline-templates/:id/steps/:nodeKey` | 删除（该节点回落流程内置逻辑） |
| POST | `/pipeline-templates/:id/steps/:nodeKey/validate` | 仅语法校验 |
| GET | `/pipeline-templates/steps/templates?type=` | 按模块类型返回默认构建命令模板 |

> 原 `/modules/:key/stage-commands*`、`/modules/:key/pipeline-script-view` 随 R6 下线（硬切，不双读）。

### 7.3 产物路径（`release-paths.ts` 收口）

```
moduleArtifactsRoot(ws, module)            → <ws>/servers/gateway/public/static/modules/<module>
moduleArtifactsRoot(ws, module, pipeline)  → <ws>/servers/gateway/public/static/modules/<module>/<pipeline>
moduleArtifactUrl(base, module, version)   → <base>/static/modules/<module>/<version>/index.js   // version 已含 `<pipeline>/<commit>`
parseReleaseRef(ref) → { pipelineKey?: string, version: string }                                 // 新增纯函数，唯一解析点
```

- `deploy_deployments.current_version` = `<流水线key>/<commit>`；gateway 只做字符串拼接，**gateway/nginx 无需改动**
- legacy 一级目录（含 `index.js`）与流水线命名空间（一级目录无 `index.js`）据此区分；`listVersions`/`cleanup` 走 `parseReleaseRef`

---

## 8. 交互清单（状态矩阵逐格）

| 操作 | 触发 | 成功 | 失败 | 破坏性确认 | 完成后 |
|---|---|---|---|---|---|
| 进入详情 | 列表行点击 | 详情节显示 | — | — | 默认落「当前运行」 |
| 切换详情 tab | tab 点击 | 对应分区显示 | — | — | 进「发起发布」时刷新预览 |
| 新建流水线 | 列表页头 primary | 进入编辑 | `message.error` | — | 刷新列表 |
| 复制为专用线 | 详情页头次操作 | 新流水线进命名编辑 | `message.error` | — | 刷新列表 |
| 改流水线 key | 编排与命令 · 基本信息 | 就地校验 + 命名空间提示 | 撞名/格式 → 就地红字，恢复原值 | — | 随「保存流水线」落库 |
| 添加 script 节点 | "+ 添加节点" / 连接线 + | 插入画布并选中 | 校验错就地标红 | — | 保持编辑 |
| 删除 script 节点 | 节点 × / 面板删除 | 移除节点 + 其命令 | — | Modal.confirm「其 N 个操作随节点删除」 | 面板回空态 |
| 编辑节点命令 | 点 script 节点 | 编辑器回填该流水线该 key | `message.error` + 可重试 | — | 刷新该节点视图 |
| 插入变量 / 按模块预览 | chips / 模块下拉 | 预览更新 | 无 shell 操作 → `message.warning` | — | — |
| 点 platform 节点 | 点击 | — | — | — | warning 不可编辑 |
| 保存流水线 | 编排与命令 · 底部 primary | `message.success` | 400 原样展示 | — | 刷新画布与列表 |
| 发起发布 | 「发起发布」· primary | 进入执行/待审批 | `message.error` | prod：Modal.confirm（含命名空间） | 跳「当前运行」 |
| 执行历史切模块 | 模块下拉 | 列表过滤 | `message.error` | — | — |
| 回滚到此版本 | 历史行 / 当前运行 / 模块页 | 指针切换成功 | `message.error`，弹窗保留 | Modal.confirm（含影响面 + D-c 说明） | 刷新历史与部署状态 |
| 重试 | 失败行 / 当前运行 | 新实例入队 | `message.error` | — | 刷新列表 |
| 再次发布 | 当前运行 | 按快照重建实例 | `message.error` | — | 刷新列表 |
| 查看流水线 | 模块页提示条 | 跳流水线列表 | — | — | — |

---

## 9. 状态覆盖自查

- [x] 加载中：列表 / 当前运行 / 执行历史 / 节点命令 / 提交 / 版本预览 均有 loading；无假 loading
- [x] 空态：无流水线（"新建或复制默认线"）、无 script 节点（"至少保留 git 与写版本号"）、节点未配命令（`required-unset`：发布将失败 + 去配置）、无执行记录（"用『发起发布』发起首次"）、legacy 空（整卡不渲染）、模块某环境未发布（"未发布 · 去发布"）
- [x] 失败可重试：所有 `message.error` 场景保留输入 / 弹窗可再提交
- [x] 破坏性二次确认：删除节点、回滚（含模块页）、prod 提交 三处 `Modal.confirm` 且文案含后果
- [x] 禁用有 tooltip 原因：builtin 禁改名、platform 节点锁定、backend 灰度禁选
- [x] 保存中防重复：`saving` 锁（模板 / 节点命令 / 提交 各自独立）
- [x] 无弹窗套弹窗：节点增删与命令编辑行内完成

---

## 10. Token / 视觉（禁裸值）

| 用法 | Token |
|---|---|
| 页面卡片底 / 页面底 | `--ws-bg-subtle` / `--ws-bg-page`；容器 `--ws-bg-surface` |
| 文字主/次/三级 | `--ws-text-primary` / `--ws-text-secondary` / `--ws-text-tertiary` |
| 边框 / 细分隔 | `--ws-border` / `--ws-border-subtle` |
| hover / 按压 | `--ws-bg-hover` / `--ws-bg-active`（容器类统一） |
| 主色 / 链接 / tag primary | `--ws-brand-500`（DR-3 #F97316 派生） |
| success（完成节点 / 成功 tag） | `--ws-success-500` / `--ws-success-100` |
| warning（watchdog / legacy / 指针警示） | `--ws-warning-500` / `--ws-warning-100` |
| error（删除 / 失败节点 / 失败 tag） | `--ws-error-500` / `--ws-error-100` |
| info（提示条） | `--ws-info-500` / `--ws-info-100` |
| 代码 / 版本 / 路径 / key | `--ws-font-mono`（`.ws-mono`） |
| 数字列（时间/次数） | `tabular-nums` |
| 圆角 / 阴影 | `--ws-radius-md` / `--ws-shadow-card` |

- 命令编辑器与失败日志沿用深色终端（已登记例外），不新增裸值
- 枚举不配色（模块类型、环境名）；状态色只表达 success / warning / error
- 新增样式 light/dark 双主题过目，禁漏变量回退

---

## 11. 风险 / 待澄清（写码前定）

1. **legacy 目录不能被当命名空间清理**：切指针只需"目录名 = 版本值"，legacy 无需迁移；`cleanup` 必须按 `parseReleaseRef` 区分两种布局，实现需单测覆盖。
2. **「当前运行」只显示最新一次**（规格默认）：更早实例通过「执行历史 → 详情」下钻，避免同页两个实例视图。
3. **执行历史按模块筛选**（规格默认提供模块下拉，默认「全部」）。
4. **模块页回滚入口**（规格默认**保留**）：若改为"回滚统一去流水线"，则模块页操作列变为跳转。
5. **模块页版本值显示完整 `<key>/<commit>`**（与产物目录一致），不拆列、不解释归属。
6. **tab 顺序**：`当前运行 → 执行历史 → 编排与命令 → 发起发布`；如需"定义优先"，可调为 `编排与命令 → 当前运行 → 执行历史 → 发起发布`（仅改顺序，无结构影响）。
7. **迁移期 read-only 窗口**：迁移脚本执行 → 读路径切换之间需短暂停发布（不双读的必然代价），建议低峰执行。
8. **MCP 工具签名**：`publish_version` / `rollback` / `list_releases` 的候选按命名空间分组 → 是否加 `pipelineKey` 入参由后端规格定；本 UI 规格默认「候选已按命名空间过滤，前端传完整 `VersionRef`」。

---

## 12. 实现顺序（确认后执行）

1. **H 后端契约先行**：模板 `key` 列 + 校验 → `deploy_pipeline_step_commands` 表 + 五个接口 → `release-paths`/`artifact-store` 命名空间下沉 → `runStageCommand` 读路径切换 + 迁移脚本（生成专用线）→ 单测（v5 回归 + legacy 区分）
2. **G 前端契约**：`api/index.ts` 新增 `pipelineStepApi` + 模板 `key` 字段；`StageActionsEditor` props 改造
3. **A 流水线列表**（入口 + 现有提交表单移除）
4. **D 编辑页**（新路由 `PipelineEdit.vue`：基本信息 + 画布 + 节点命令 + 变量预览 + 未保存离开确认；详情页「编辑」改为跳转）
5. **B 当前运行**（只读流程图 + 成功/失败态操作）
6. **C 执行历史 + 回滚下沉 + legacy 表**
7. **E 发布抽屉**（身份预览）
8. **F 模块页瘦身**（删 tab、去归属列、加提示条）——最后做，避免删早了没地方配命令
9. 自检：`vue-tsc` + 手工冒烟（发布 → manifest → 回滚 → legacy 回滚 → 多流水线覆盖指针 → 列表/详情联动）+ 截图基线 `docs/ui/baselines/` + 回流 `geist-token-评审记录.md`
10. 发布 deploy-console 走传统发布：工作区 commit&push 后 `./scripts/publish-deploy-console.sh`（**勿走流水线**，会自杀式 restart）

---

*规格 v0.7（目标模块按入口联动版，2026-09-10）待用户批注。确认后按 §12 顺序实施；不做双读兼容（design.md §3.1 决策 D-b 硬切）。原型：`release-platform-v12-module-context.html`。*
