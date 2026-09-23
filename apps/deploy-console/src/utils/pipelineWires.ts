/**
 * pipelineWires —— 流水线画布连线绘制（编辑页 / 详情页共用）
 *
 * 设计：specs/pipeline-wires-util/design.md
 * 规则：specs/pipeline-flow-color/design.md §2.5（几何 / 归属 / 着色 / 层序 / 绘制质量）
 *
 * 职责边界：
 * - **只管几何与落笔**，不认识业务状态 —— 颜色一律由调用方 `colorOf(ctx)` 注入
 *   （详情页按任务/步骤聚合状态给状态色，编辑页恒给中性色）。
 * - 「＋」之类挂在连线上的交互元素由 `onMidpoint` 回调交回调用方摆放（util 不碰业务 DOM）。
 */
const SVG_NS = 'http://www.w3.org/2000/svg'

/** 线段类型：与规则文档 §2.5 的 L1 主线 / L2 竖线 / L3 支线 / L4 箭头 / 拐点圆一一对应 */
export type WireKind = 'main' | 'fork' | 'branch' | 'chevron' | 'dot'

export interface WireJob {
  kind: WireKind
  x1: number
  y1: number
  /** dot / chevron 只用 x1,y1 */
  x2?: number
  y2?: number
  color: string
}

export interface WireColorCtx<T = unknown> {
  kind: WireKind
  /** 进入侧（源）列索引 */
  fromCol: number
  /** 目标列索引 */
  toCol: number
  /** 目标任务索引（-1 = 不指向具体任务，如主线横线） */
  taskIndex: number
  /** 目标列全部任务（顺序与 DOM 任务卡一致） */
  tasks?: T[]
  /** 目标任务（taskIndex >= 0 时） */
  task?: T
}

export interface WireStyle {
  /** 主线/支线线宽 */
  lineWidth: number
  /** 箭头 chevron 的 x 缩进 */
  chevronDx: number
  /** 箭头 chevron 的 y 半高 */
  chevronDy: number
  /** 箭头线宽 */
  chevronWidth: number
  /** 拐点补圆半径（覆盖 butt 线帽在直角处留下的缺口） */
  dotRadius: number
  /** sameLine 判定阈值（px） */
  sameLineTolerance: number
  /** 坐标取整（消半像素发虚） */
  roundCoords: boolean
  /** 层序：中性色（灰）先画、彩色后画 → 交叉处深色盖浅色 */
  grayFirst: boolean
  /** 中性色（跳过 / 未执行 / 未进入） */
  neutralColor: string
  /** SVG 画布尺寸余量 */
  extraW: number
  extraH: number
  /** 线帽（round 消除段末缺口） */
  linecap: 'round' | 'butt'
  /** 是否绘制拐点圆 */
  dot: boolean
}

export const DEFAULT_WIRE_STYLE: WireStyle = {
  lineWidth: 2.5,
  chevronDx: 9,
  chevronDy: 8,
  chevronWidth: 3,
  dotRadius: 1.5,
  sameLineTolerance: 1,
  roundCoords: true,
  grayFirst: true,
  neutralColor: 'var(--ws-border)',
  extraW: 40,
  extraH: 20,
  linecap: 'round',
  dot: true,
}

export interface DrawWiresOptions<T = unknown> {
  /** 坐标基准容器（.canvas-body，SVG 是它的 absolute 子元素） */
  wrap: HTMLElement
  svg: SVGSVGElement
  /** 列（步骤）选择器 */
  colSelector: string
  /** 任务卡选择器 */
  taskSelector: string
  /** 颜色由调用方决定 */
  colorOf: (ctx: WireColorCtx<T>) => string
  /** 目标列任务数据（顺序须与 DOM 任务卡一致） */
  tasksOf?: (toCol: number) => T[]
  /** 主线中点回调（编辑页用它放「＋」插入步骤按钮） */
  onMidpoint?: (midX: number, cy: number, fromCol: number) => void
  style?: Partial<WireStyle>
}

interface Pt {
  right: number
  left: number
  cy: number
}

/**
 * 计算全部线段（几何 + 颜色），不落笔。
 * 几何规则见 specs/pipeline-flow-color/design.md §2.5：
 *  L1 主线横线 → 分叉 X；L2 竖线**按转折点分段**；L3 支线横线；L4 箭头；拐点补圆。
 */
export function buildWireJobs<T>(o: DrawWiresOptions<T>): WireJob[] {
  const st: WireStyle = { ...DEFAULT_WIRE_STYLE, ...(o.style || {}) }
  const cols = [...o.wrap.querySelectorAll(o.colSelector)] as HTMLElement[]
  const jobs: WireJob[] = []
  if (cols.length < 2) return jobs

  const R = (v: number) => (st.roundCoords ? Math.round(v) : v)
  const wr = o.wrap.getBoundingClientRect()
  const center = (el: Element, wrapRect: DOMRect = wr): Pt => {
    const r = el.getBoundingClientRect()
    return {
      right: r.right - wrapRect.left,
      left: r.left - wrapRect.left,
      cy: r.top - wrapRect.top + r.height / 2,
    }
  }
  const colorOf = (kind: WireKind, fromCol: number, toCol: number, taskIndex: number, tasks?: T[]) =>
    o.colorOf({
      kind,
      fromCol,
      toCol,
      taskIndex,
      tasks,
      task: taskIndex >= 0 ? tasks?.[taskIndex] : undefined,
    })

  for (let i = 0; i < cols.length - 1; i++) {
    const fromTasks = [...cols[i].querySelectorAll(o.taskSelector)] as HTMLElement[]
    const toTasks = [...cols[i + 1].querySelectorAll(o.taskSelector)] as HTMLElement[]
    if (!fromTasks.length || !toTasks.length) continue

    const f = center(fromTasks[0])
    const t0 = center(toTasks[0])
    const mx = (f.right + t0.left) / 2
    const toCol = i + 1
    const tasks = o.tasksOf?.(toCol)

    /* L1 主线横线：目标列聚合色（有成功分支时成功覆盖） */
    jobs.push({
      kind: 'main',
      x1: R(f.right),
      y1: R(f.cy),
      x2: R(mx),
      y2: R(f.cy),
      color: colorOf('main', i, toCol, -1, tasks),
    })
    o.onMidpoint?.(mx, f.cy, i)

    const sameLine = toTasks.length === 1 && Math.abs(t0.cy - f.cy) < st.sameLineTolerance
    if (sameLine) {
      /* 单任务同高：无竖线，主线直接接到卡 + 箭头 */
      const c = colorOf('branch', i, toCol, 0, tasks)
      jobs.push({ kind: 'branch', x1: R(mx), y1: R(f.cy), x2: R(t0.left), y2: R(f.cy), color: c })
      jobs.push({ kind: 'chevron', x1: R(t0.left), y1: R(f.cy), color: c })
      continue
    }

    /* L2 竖线：按转折点分段 —— 每个任务行中线是一个转折点，
       第 k 段（上一转折点 → 第 k 任务行中线）归第 k 条分支 */
    const ys = toTasks.map((t) => center(t).cy)
    let prev = Math.min(f.cy, ys[0])
    toTasks.forEach((_t, ti) => {
      const cy = ys[ti]
      const c = colorOf('fork', i, toCol, ti, tasks)
      if (cy > prev + 0.5) {
        jobs.push({ kind: 'fork', x1: R(mx), y1: R(prev), x2: R(mx), y2: R(cy), color: c })
      }
      if (st.dot) jobs.push({ kind: 'dot', x1: R(mx), y1: R(cy), color: c })
      prev = Math.max(prev, cy)
    })
    /* 兜底：进入侧任务行低于全部目标行 → 末段补画并归最后一个分支 */
    if (f.cy > prev + 0.5) {
      const c = colorOf('fork', i, toCol, toTasks.length - 1, tasks)
      jobs.push({ kind: 'fork', x1: R(mx), y1: R(prev), x2: R(mx), y2: R(f.cy), color: c })
      if (st.dot) jobs.push({ kind: 'dot', x1: R(mx), y1: R(f.cy), color: c })
    }

    /* L3 支线横线 + L4 箭头：各分支 = 各自目标任务状态色 */
    toTasks.forEach((t, ti) => {
      const c2 = center(t)
      const c = colorOf('branch', i, toCol, ti, tasks)
      jobs.push({ kind: 'branch', x1: R(mx), y1: R(c2.cy), x2: R(c2.left), y2: R(c2.cy), color: c })
      jobs.push({ kind: 'chevron', x1: R(c2.left), y1: R(c2.cy), color: c })
    })
  }
  return jobs
}

/** 落笔：坐标已取整；线帽 round；中性色（灰）先画、彩色后画 */
export function paintWires(svg: SVGSVGElement, jobs: WireJob[], style?: Partial<WireStyle>): void {
  const st: WireStyle = { ...DEFAULT_WIRE_STYLE, ...(style || {}) }
  svg.innerHTML = ''

  const paint = (j: WireJob) => {
    if (j.kind === 'dot') {
      const c = document.createElementNS(SVG_NS, 'circle')
      c.setAttribute('cx', String(j.x1))
      c.setAttribute('cy', String(j.y1))
      c.setAttribute('r', String(st.dotRadius))
      c.setAttribute('fill', j.color)
      c.setAttribute('stroke', 'none')
      svg.appendChild(c)
      return
    }
    const p = document.createElementNS(SVG_NS, 'path')
    p.setAttribute(
      'd',
      j.kind === 'chevron'
        ? `M${j.x1 - st.chevronDx} ${j.y1 - st.chevronDy} L${j.x1} ${j.y1} L${j.x1 - st.chevronDx} ${j.y1 + st.chevronDy}`
        : `M${j.x1} ${j.y1} L${j.x2} ${j.y2}`,
    )
    p.setAttribute('stroke-width', String(j.kind === 'chevron' ? st.chevronWidth : st.lineWidth))
    p.setAttribute('fill', 'none')
    p.setAttribute('stroke-linecap', st.linecap)
    if (j.kind === 'chevron') p.setAttribute('stroke-linejoin', 'round')
    // 用 style 而非 attribute：presentation attribute 不吃 CSS 变量
    p.style.stroke = j.color
    svg.appendChild(p)
  }

  if (st.grayFirst) {
    jobs.filter((j) => j.color === st.neutralColor).forEach(paint)
    jobs.filter((j) => j.color !== st.neutralColor).forEach(paint)
  } else {
    jobs.forEach(paint)
  }
}

/** 一站式：设置画布尺寸 → 计算 → 落笔 */
export function drawWires<T>(o: DrawWiresOptions<T>): void {
  const st: WireStyle = { ...DEFAULT_WIRE_STYLE, ...(o.style || {}) }
  o.svg.setAttribute('width', String(Math.ceil(o.wrap.scrollWidth) + st.extraW))
  o.svg.setAttribute('height', String(Math.ceil(o.wrap.scrollHeight) + st.extraH))
  paintWires(o.svg, buildWireJobs(o), st)
}

/** 任务序号（编辑页 / 详情页同款算法）：单任务步骤 = 步骤号；多任务 = 步骤号-任务号 */
export function taskSeqNo(stepIdx: number, taskIdx: number, total: number): string {
  return total > 1 ? `${stepIdx + 1}-${taskIdx + 1}` : String(stepIdx + 1)
}

/** 窗口尺寸变化时重绘（编辑页此前漏了监听 → 改窗口连线错位）；返回清理函数 */
export function redrawOnResize(handler: () => void): () => void {
  window.addEventListener('resize', handler)
  return () => window.removeEventListener('resize', handler)
}
