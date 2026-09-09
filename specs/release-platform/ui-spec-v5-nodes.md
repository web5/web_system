# 页面规格书 · 流水线 nodes 编排与实例渲染（v5）

- 页面类型：详情页 + 交互重构（PipelineDetail 编辑态 / 实例流程渲染 / 日志分段 / 历史记录，同屏联动）
- 参照页：`deploy-console/src/views/PipelineDetail.vue`（既有详情页，主参照）；Token canonical 参照 `ServiceManager.vue`
- 需求一句话：把「固定 9 阶段」开放为「git/写版本号两个 platform 节点 + 用户自定义 script 节点」的编排模型，编辑态可自由增删/排序/配脚本，实例渲染层按 nodes 快照展示（platform/script 视觉区分 + watchdog 角标）。
- 关联规格：`specs/release-platform/design.md` §14.4/14.5/14.8（执行语义/顺序约束/UI）；`tasks.md` S11 11.4+11.6
- 前置依赖：11.1-11.3/11.5 后端已就绪（nodes 列/校验/engine/转存，flag 门禁）；本文档为 11.4+11.6 写码前规格，**用户过目确认后实施**

---

## 0. 页面对象与改动边界

本次改动集中在一条数据链上，规格合并呈现、实现分步：

| 面 | 文件 | 改动 |
|---|---|---|
| A 编辑态 | `views/PipelineDetail.vue` | 编辑抽屉从「9 步勾选/拖拽 steps」升级为「nodes 画布：platform 锁定 + script 增删/排序/optional/watchdog」 |
| B 数据/类型 | `api/index.ts`、`components/pipeline/pipeline.stages.ts` | `PipelineTemplate`/`PipelineItem` 增 `nodes`；helper 三级回退 `nodes→steps→PIPELINE_STAGES` |
| C 渲染 | `components/pipeline/ProgressFlow.vue`、`StageCommandDrawer.vue` | 实例流程图/阶段详情按 nodes 快照渲染；platform=锁定态、script=普通、watchdog=角标 |
| D 兼容 | `PipelineCenter.vue` | 旧 9 阶段模板列表不破坏；**本次不改列结构**（另排） |

> 本次**不删** ModuleDetail「发布脚本」9 阶段视图（legacy 服务历史实例仍用它，见 design §14.6 N6）。

---

## 1. 交互骨架（编辑态 A，自上而下）

编辑流水线抽屉（沿用现 `a-drawer` width≈860）分三块，自上而下固定：

### 1.1 基本信息卡
- 字段：流水线名（builtin 禁改+提示"内置默认模板不可改名，可复制另建"）、启用 switch、说明 input、探活失败/审批/投递目标 radio-group（沿用现状）
- Token：标签 `--ws-text-secondary`；卡片底色 `--ws-bg-subtle`

### 1.2 流程编排卡（本次核心改）
- **画布**：横向 flex 链路（沿用现 `.f-node`/`.f-arrow` 样式族），节点 = `nodes[]` 顺序快照
- **连接线插孔**：每根连接线中点一个「+」插孔；点它 → 画布**直接插入新 script 节点**并自动选中，右侧面板立即进入编辑（label/key/optional/watchdog/脚本）——不经过表单
- **platform 节点**（git/写版本号=version+pointer）：置灰锁定 + 锁 icon；**不可拖、不可删、不可点开脚本**；悬停 tooltip「发布语义，平台托管」
- **script 节点**：可拖拽重排；节点卡片右上角 **×（hover 出现）直接删除**，不须先进面板
- **watchdog script 节点**：卡片角标 `⚠ 自动回滚`（warning 语义色）；选中后面板可去勾
- **+ 添加节点**（顶部快捷，插到 git 之后）：行为同插孔——直接落节点并选中编辑
- **选中节点面板（即改即生效）**：
  - label 输入 → 画布节点名实时同步；key 输入（改后模块脚本读写点同步，格式/保留字/重名校验）
  - checkbox：optional（未配脚本时跳过）｜ watchdog（失败自动回滚，全局仅可勾 1 个）
  - 脚本区 = StageActionsEditor（按「模块 × 节点 key」读写 actions）
- **顺序约束即时提示**（镜像后端 §14.5）：git 必须首位 / version 在 pointer 前 / key 重复 / 与 platform 保留字冲突 / 非法格式 → 就地红框 + 阻止保存，不弹错误风暴
- **删除 script 节点** → `Modal.confirm`，文案随节点语义变化：
  - 删 watchdog 节点 → "删除后将不再自动回滚（watchdog 失败不回滚），确认？"
  - 删其他 script → "该节点将从本流水线移除；模块已配的脚本保留（孤儿标注）"

### 1.3 节点脚本卡（A 联动）
- 顶部「作用模块」下拉（backend/frontend/micro-frontend 可发布模块，`deployApi.modules`），默认取当前查看实例的 moduleKey，缺失回落第一项
- 点选 script 节点 → 该卡展示 `StageActionsEditor`（复用共享组件）：
  - 读取/写入 `GET/PUT /modules/:key/stage-commands/:nodeKey`（含 actions）
  - platform 节点点选 → message.warning"version / pointer 是发布语义真相源，不可编辑"，不打开编辑器
- 保存后按模块刷新 scriptView 缓存；改的只是该模块脚本，不影响模板 nodes（nodes 在 1.2 保存）

### 1.4 保存动作
- 「保存流水线」= 一次性 PUT 模板（name/desc/enabled/策略 + **nodes**）；本地先跑 `checkSemanticOrder`（前端镜像）再提交，后端 400 时原样展示服务端消息
- 保存中 `editSaving` 锁防重复提交；成功后关抽屉并 `loadTpl + loadHistory + loadSelectedRun` 刷新
- **旧模板（nodes=null）进入编辑即触发前端转存预览**：编辑打开时若 tpl 无 nodes，用 `legacyStepsToNodes` 逻辑生成初始 nodes 草稿（git/version/pointer platform + 9 阶段 script），保存才落库——所见即"转存后效果"

---

## 2. 渲染面（C：实例流程图/详情/历史按 nodes）

| 元素 | 规则 |
|---|---|
| 流程图节点 | `ProgressFlow` 数据源 `p.nodes ?? p.steps ?? PIPELINE_STAGES`；platform 节点 tag「平台」+ 警示/中性色；script 普通；watchdog 节点加 ⚠ 角标；label 用 nodes.label（script）/固定名（platform） |
| 失败回滚 | 脚本节点失败按现状态矩阵标红；watchdog 自动回滚走既有日志/审计/通知文案（阶段名 = 节点 key + label） |
| 日志分段 | `StageCommandDrawer` 操作块前缀 `[${key}/opN]`（现状已支持任意 key，仅确认 label 映射兜底 `STEP_LABELS[key] || key || nodes.label`） |
| 历史记录 | 双 Tab「执行流程/历史」沿用；历史行模板名/实例快照 nodes 展示不新增列（node 细节在流程 Tab） |
| 空态 | 无实例 → 现"还没有执行记录 + 立即发起发布"（不改）；编辑态无 script 节点 → "至少保留 git 与写版本号（平台）" |

---

## 3. 类型/字段约定（B）

```ts
// api/index.ts
interface TemplateNode {
  kind: 'platform' | 'script'
  key: string                 // git|version|pointer 或自定义 script key
  label?: string              // script 必填
  optional?: boolean          // script：未配脚本时跳过
  watchdog?: boolean          // script：失败触发自动回滚（≤1）
  timeoutSec?: number
}
// PipelineTemplate.nodes?: TemplateNode[] | null   （新增，随模板 PUT/GET）
// PipelineItem.nodes?: TemplateNode[] | null        （新增，实例快照）
```

> key 规则、watchdog≤1、platform 保留字由后端 `normalizeNodes` 兜底；前端 `checkSemanticOrder`/`checkNodesOrder` 镜像同规则即时提示。

---

## 4. 交互清单（状态矩阵逐格）

| 操作 | 触发 | 成功 | 失败 | 破坏性确认 | 完成后 |
|---|---|---|---|---|---|
| 编辑流水线 | 页头按钮 | 开抽屉回填 | — | — | — |
| 保存流水线 | 底部 primary | `message.success` | `message.error`(400 原样) | — | 关抽屉+三刷新 |
| 添加 script 节点 | "+ 添加节点" | 插入画布 git 后 | 校验错就地标红 | — | 保持编辑 |
| 删除 script/watchdog 节点 | 节点×/删除 | 移除+toast | — | Modal.confirm(后果文案 §1.2) | 保持编辑 |
| 拖动重排节点 | 拖到目标左/右半区 | 序号重算 | 违反 §14.5 就地红框+阻止 | — | 保持编辑 |
| 编辑节点脚本 | 点 script 节点 | 编辑器回填该模块该 key | API 错 message.error | — | — |
| 点 platform 节点 | 点击 | — | — | — | warning 不可编辑 |
| 勾 optional/watchdog | 节点选中面板 | 同步草稿 | — | watchdog 去勾无确认 | — |
| 切换作用模块 | 下拉 | 拉 scriptView 重载 | 空 → 空态文案 | — | — |
| 转存旧模板 | 打开编辑(无 nodes) | 草稿预转存 | — | — | 保存才落库 |

---

## 5. 状态覆盖自查

- [x] 加载中：drawer 打开/保存按钮 loading；模块/模板接口 loading
- [x] 空态：无 script 节点 / 无作用模块 / 无实例 三处有原因+出路
- [x] 失败可重试：接口失败 message.error + 可再次点保存
- [x] 破坏性二次确认：删除 script/watchdog 节点 Modal.confirm 含后果
- [x] 禁用有 tooltip：platform 节点锁定 + builtin 改名禁 + 添加框约束
- [x] 保存中防重复：editSaving 锁
- [x] 无弹窗套弹窗：添加节点用行内展开非 modal

---

## 6. Token / 视觉（禁裸值）

| 用法 | Token |
|---|---|
| 页面卡片底 | `--ws-bg-subtle` / 容器 `--ws-bg-surface` |
| 文字主/次/三级 | `--ws-text-primary/secondary/tertiary` |
| 边框/分隔 | `--ws-border` / `--ws-border-subtle` |
| platform 锁定节点 | 中性边框 + lock icon（不套 status 色）；hover `--ws-bg-hover` |
| watchdog 角标/警示 | `--ws-warning-500`（⚠） |
| script 节点默认 | 常规卡片；hover `--ws-bg-hover` / 按压 `--ws-bg-active` |
| 编辑器代码块 | 沿用现 StageActionsEditor 深色终端（已登记例外，不新增裸值） |
| 圆形序号/箭头 | 沿用现 `.f-*` 样式族（改造时并入 token 变量） |

> 现状 PipelineDetail 存在少量历史裸值（#666/#1677ff 等），**本次不改存量行**、仅新增节点相关样式并统一走 token；遗留裸值单列整改（另开任务，避免扩散面）。

---

## 7. 风险 / 待澄清（写码前必须定）

1. **platform「写版本号」视觉**：version 与 pointer 是否合并成一个节点卡片（内部两个动作）还是仍为两个独立节点？——设计定的是两个 platform 节点，但用户口述"写版本号两个节点"易歧义。**规格默认：git 一个 + 版本号区含 version/pointer 两节点卡片（独立可跳转、不可删）**。
2. **watchdog 默认勾选**：旧模板转存时 verify→watchdog=true（11.5 已定）；新加 script 节点 watchdog 默认不勾。
3. **孤儿脚本标注**（§14.7）：被删 script key 若模块仍配了脚本 → UI 在哪提示？（11.2 已保留数据，标注点建议：编辑态节点面板下方"以下模块仍配置了已移除节点的脚本：xxx" 弱提示，非阻塞）。
4. **key 自动 slug 冲突**：label「通知」→ notify；与已有 key 撞名 → 追加 `-2`，规格默认如此。
5. **作用模块为空**（模板从未被任何模块发布且无可发布模块）→ 脚本卡空态文案，发布模块列表为空时不阻断模板保存。
6. **多选删除/批量**：本次单节点删除，不做批量。

---

*规格 v0.1 待用户批注。确认后按 A→B→C→D 顺序实现：A（PipelineDetail 编辑态 nodes 画布）→ B（类型/helper 回退）→ C（渲染层）→ 各自 vue-tsc + 手工冒烟；完成后自检回流 `geist-token-评审记录.md`。*
