# 连线绘制公共 util（pipelineWires）设计

> 状态：**设计稿，待确认**。确认前不改动任何运行时代码。
> 关联：连线绘制规则（几何/着色/层序/绘制质量）的唯一判据源是
> [`specs/pipeline-flow-color/design.md` §2.5](../pipeline-flow-color/design.md)，本文只解决「**代码放哪、怎么复用**」。

## 0 背景与目标

`deploy-console` 里有两块同构画布：

- 编辑页：`apps/deploy-console/src/components/pipeline/OrchestrationEditor.vue`（编排，可增删改）
- 详情页：`apps/deploy-console/src/components/pipeline/ProgressFlow.vue`（只读，带运行状态）

两者**是同一套连线算法的复制粘贴**（`center / seg / chevron / drawWires` 四件套，几何逐行相同）：

| 区段 | 编辑页 | 详情页 | 性质 |
|---|---|---|---|
| `center` | 232-240 | 99-103 | 100% 重复 |
| `seg` | 241-249 | 104-111 | 重复（分歧：颜色来源） |
| `chevron` | 250-259 | 112-121 | 重复（分歧：颜色） |
| `drawWires` 骨架 | 260-309 | 128-178 | 重复 ~28 行 / 分歧 ~22 行 |
| `taskSeq` | 59-62 | 123-126 | 100% 重复 |
| 「＋」按钮 + 非 scoped CSS | 280-291、511-518 | — | 编辑页独有 |

（全仓扫描确认：`apps/` 下只有这两个文件有 SVG 测量式连线，无第三处。）

本次着色规则的收敛（成功覆盖、竖线按转折点分段、深色盖浅色、拐点补圆）只落在详情页一份实现里，
编辑页仍是旧几何（无取整、无圆帽、无分段）。**规则分散在两份代码里 = 下一轮还会不一致**。

目标：

1. 几何与绘制抽成单一实现，规则只改一处即两边同步；
2. 两处调用方的视觉行为**不变**（纯重构，不含新视觉）—— 唯一例外见 §6 待确认 1/2；
3. 不引入第三方画布库（理由见 §7）。

非目标：不做拖拽/自动布局/缩放；不改 DOM 结构与样式体系；原型稿不 import TS（见 §5.4）。

## 1 现状：两处的分歧点（抽取必须参数化）

| 维度 | 编辑页 | 详情页 |
|---|---|---|
| 列选择器 | `.step-col` | `.orch-col` |
| 任务卡选择器 | `.task-node`（嵌在 `.task > .tasks`） | `.orch-task`（列直接子元素） |
| 颜色来源 | `const COLOR = '#F97316'`，写 `stroke` **属性**（注释：presentation attribute 不吃 CSS 变量） | `p.style.stroke = 'var(--ws-success-500)' / 'var(--ws-border)'` |
| 着色判据 | 无（中性单色） | L1=目标列聚合色 / L2=按转折点分段、各段归分支 / L3·L4=目标任务自身色 |
| 层序、拐点圆、取整 | 无 | 有（本次新增） |
| 独有 | 列间「＋」添加步骤按钮（坐标 = 主线中点 `midX, f.cy`），非 scoped CSS | — |
| 重绘触发 | 8 处手动 `nextTick(drawWires)`；**无 resize 监听**（改窗口会错位） | `watch(instance)` + `mounted` + `resize` + `unmounted` 清理 |
| SVG 尺寸 | `ceil(scrollWidth)+40` / `ceil(scrollHeight)+20` | 同 |

## 2 接口设计（TS · 新建 `apps/deploy-console/src/utils/pipelineWires.ts`）

```ts
/** 线段类型（与规则文档 §2.5 的 L1~L4 + 拐点圆一一对应） */
export type WireKind = 'main' | 'fork' | 'branch' | 'chevron' | 'dot'

export interface WireJob {
  kind: WireKind
  x1: number; y1: number          // dot / chevron 只用 x1,y1
  x2?: number; y2?: number
  color: string                   // 调用方给的颜色 token（如 'var(--ws-ok)'）
}

export interface WireColorCtx<T = unknown> {
  kind: WireKind
  fromCol: number                 // 进入侧列索引
  toCol: number                   // 目标列索引
  taskIndex: number               // 目标任务索引（-1 = 不指向具体任务，如主线）
  task?: T                        // 目标任务数据（调用方注入）
  tasks?: T[]                     // 目标列全部任务（用于聚合判定）
}

export interface WireStyle {
  lineWidth: number               // 2.5
  chevronDx: number               // 9
  chevronDy: number               // 8
  chevronWidth: number            // 3
  dotRadius: number               // 1.5（= lineWidth/2 + 0.25，覆盖 butt 缺口）
  sameLineTolerance: number       // 1（px）
  roundCoords: boolean            // true —— 坐标取整，消半像素发虚
  grayFirst: boolean              // true —— 灰（neutralColor）先画、彩色后画
  neutralColor: string            // 'var(--ws-border)'
  extraW: number                  // 40（SVG 宽度余量）
  extraH: number                  // 20
  linecap: 'round' | 'butt'       // 'round'
}

export interface DrawWiresOptions<T = unknown> {
  wrap: HTMLElement               // 坐标基准（.canvas-body）
  svg: SVGSVGElement
  colSelector: string             // '.step-col' | '.orch-col'
  taskSelector: string            // '.task-node' | '.orch-task'
  /** 颜色由调用方决定 —— util 不认识业务状态 */
  colorOf: (ctx: WireColorCtx<T>) => string
  /** 目标列的任务数据（顺序须与 DOM 任务卡一致） */
  tasksOf?: (toCol: number) => T[]
  /** 主线中点回调（编辑页用它放「＋」按钮），返回 false 可跳过 */
  onMidpoint?: (midX: number, cy: number, fromCol: number) => void
  style?: Partial<WireStyle>
}

export function buildWireJobs<T>(o: DrawWiresOptions<T>): WireJob[]
export function paintWires(svg: SVGSVGElement, jobs: WireJob[], style?: Partial<WireStyle>): void
export function drawWires<T>(o: DrawWiresOptions<T>): void      // build + paint
export function redrawOnResize(handler: () => void): () => void // 返回清理函数（编辑页补监听用）
```

设计要点：

- **util 不认识业务状态**：颜色一律由 `colorOf(ctx)` 返回，编辑页恒返回中性橙、详情页按规则返回状态色。
- **几何规则单点**：sameLine、转折点分段、拐点圆、取整、层序都在 util 内，两处共享。
- **统一写 `style.stroke`**：编辑页原来用 attribute（因为不吃 CSS 变量），统一改 `style.stroke` 后颜色可传 CSS 变量（编辑页橙改用 `var(--primary)`，需确认视觉一致，见 §6）。
- **`onMidpoint` 承载「＋」**：编辑页按钮的定位逻辑依赖 `midX/f.cy`，由回调给出坐标，util 不管 DOM 按钮。

## 3 几何与绘制算法（复用规则文档，不重新定义）

- L1 主线横线：`(f.right, f.cy) → (mx, f.cy)`，`mx = (f.right + t0.left)/2`
- sameLine（目标列单任务且 `|t0.cy - f.cy| < 1`）：L1 直接接到卡 + 箭头
- 否则：竖线按**转折点分段**（第 k 段 = 上一转折点 → 第 k 个任务行中线），各段颜色由 `colorOf({kind:'fork', taskIndex:k})` 决定；
  每个转折点补 `dot`（r=1.5，色 = 该分支色）；每条分支自己横出 L3 + L4 chevron
- 兜底：进入侧行低于目标首行 → 顶部补段归第 1 个任务；高于末行 → 末段归最后一个
- 落笔：坐标取整 → 灰（neutralColor）先画、彩色后画
- 完整判据与场景矩阵见 `specs/pipeline-flow-color/design.md` §2.5 / §3

## 4 调用方接入形态

### 4.1 详情页 `ProgressFlow.vue`

```ts
drawWires({
  wrap: canvasBody.value!, svg: wires.value!,
  colSelector: '.orch-col', taskSelector: '.orch-task',
  tasksOf: (toCol) => orch.value?.[toCol]?.tasks ?? [],
  colorOf: ({ kind, toCol, taskIndex, tasks }) => {
    if (kind === 'main') return wireColor(runAgg(steps[toCol]))            // 聚合（成功覆盖）
    const t = (tasks ?? [])[taskIndex]
    return wireColor(t ? taskStateOf(steps[toCol], t) : '')                // fork 段 / branch / chevron / dot
  },
})
```
（不含本次新增规则的"旧判据"全部删除：`ok`、DOM class `st-skipped` 判断等。）

### 4.2 编辑页 `OrchestrationEditor.vue`

```ts
drawWires({
  wrap: canvasBody.value!, svg: wires.value!,
  colSelector: '.step-col', taskSelector: '.task-node',
  colorOf: () => 'var(--primary)',                       // 中性单色（原 #F97316）
  onMidpoint: (mx, cy, i) => placePlusButton(mx, cy, i),  // 「＋」按钮照旧，非 scoped CSS 保持不变
})
// 挂载时：redrawOnResize(draw) 返回的清理函数在 onUnmounted 调用（补当前缺失的 resize）
```

## 5 迁移计划（每步独立可回退）

| 步骤 | 内容 | 验证 | 回退 |
|---|---|---|---|
| 1 | 新增 `utils/pipelineWires.ts`（无调用方） | `vue-tsc --noEmit` 通过 | 删文件 |
| 2 | 详情页接入（含本次着色算法） | 原型八场景矩阵逐场景比对 SVG 段色（S0/S2/S5/S3/S4/S1/S6/S7） | 改回旧 `drawWires` |
| 3 | 编辑页接入（中性色 + 「＋」回调 + resize） | 编辑页截图前后对比：线位置/「＋」位置不变；改窗口大小后连线跟随 | 改回旧 `drawWires` |
| 4 | 删除两处旧实现；补编辑页 resize 清理 | 两页全量回归 + `scan-rules.sh diff` | revert commit |

### 5.4 原型侧

原型是单文件零依赖 HTML（双击可开），**不 import 运行时代码**。两份原型
（`pipeline-env-branch-canvas.html`、`deploy-console-domain-split.html`）保持自包含，
只在注释里标注「几何与着色规则与 `utils/pipelineWires.ts` 同步，改动需两边一致」。

## 6 待确认项

1. **编辑页是否一并应用新几何质量**（取整 / 圆帽 / 拐点圆）？会让编辑页连线略平滑，与详情页一致；
   若要求编辑页视觉 100% 不变，则 util 需给 `roundCoords/linecap/dot` 开关由调用方关闭（建议：开启，保持两页一致）。
2. **编辑页是否补 resize 监听**（当前缺失，改窗口尺寸连线错位）？建议补（顺手修 bug）。
3. **编辑页颜色**由硬编码 `#F97316` 改为 `var(--primary)` 是否可接受（两者同为主橙，视觉应一致）？
4. **util 落点**：先放 `apps/deploy-console/src/utils/`（只有 console 用）；
   将来若 admin/portal 也要画流程画布，再上提到 `packages/`（现在不做）。
5. 是否把「竖线分段 / 层序 / 拐点圆」也应用到**编辑页**的连线（编辑页无状态，整条同色，
   分段无意义；但拐点圆可消锯齿）—— 归入待确认 1。

## 7 为什么不引第三方库

- 节点是业务 DOM 卡片（HTML+CSS 渲染），不是库管的节点模型；坐标来自 DOM 实测。
- 差异化在「一条边按任务行拆段、每段不同业务状态色 + 层序 + 拐点」，通用库（Vue Flow / X6 /
  React Flow）的基本模型是「一条 edge 一个 style」，仍需自定义 edge 自己画，收益有限而迁移成本高。
- 若将来编排页要升级为**可拖拽画布 + 自动布局**，再评估 Vue Flow（Vue3 原生）或 AntV X6；
  届时自定义 edge 里仍可复用本 util 的分段着色逻辑。

## 8 验收判据

- 详情页：八场景（成功覆盖 / 跳过 / 失败 / 执行中 / 未进入 / 三分支 ×2）段色与原型一致；
- 编辑页：连线与「＋」位置、hover 行为与重构前一致（截图并置比对）；改窗口大小后连线跟随；
- 两处旧 `seg/chevron/center/drawWires` 实现删除，无重复；
- `vue-tsc --noEmit` 与 `scripts/redline/scan-rules.sh diff` 通过。
