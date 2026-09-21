import type { PipelineItem, TemplateNode } from '@/api'
import dayjs from 'dayjs'

/** 九阶段发布流程（固定顺序） */
export const PIPELINE_STAGES = [
  'check',
  'pull',
  'build',
  'upload',
  'restart',
  'version',
  'pointer',
  'verify',
  'cleanup',
] as const

export type PipelineStageKey = (typeof PIPELINE_STAGES)[number]

/** 阶段中文名 */
export const STEP_LABELS: Record<string, string> = {
  check: '校验',
  pull: '拉取代码',
  build: '构建',
  upload: '投递',
  restart: '重启',
  version: '写版本',
  pointer: '切指针',
  verify: '探活',
  cleanup: '清理',
}

/** 步骤状态 → antdv color */
export const STEP_COLORS: Record<string, string> = {
  done: 'success',
  running: 'processing',
  error: 'error',
  pending: 'default',
}

/**
 * 等待人工审批的状态。
 *
 * 两种语义（design D8：审批从「发布前置门禁」升级为**节点**）：
 *  - `pending-approval`：流水线级门禁 —— 提交即阻断，**尚未执行任何阶段**；
 *  - `awaiting-approval`：节点级挂起 —— 已跑到某个 approval 节点并停在那儿，
 *    批准后**从该节点之后继续**（已执行的节点不重跑）。
 * 页面动作（审批按钮、撤回文案、能否删除）都要同时覆盖两者，故收口成一处。
 */
export const APPROVAL_STATUSES = ['pending-approval', 'awaiting-approval'] as const;

export function isApprovalPending(status?: string | null): boolean {
  return !!status && (APPROVAL_STATUSES as readonly string[]).includes(status);
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    pending: 'blue',
    'pending-approval': 'orange',
    'awaiting-approval': 'orange',
    running: 'processing',
    succeeded: 'success',
    failed: 'error',
    cancelled: 'default',
  }
  return map[status] || 'default'
}

export function statusText(status: string): string {
  const map: Record<string, string> = {
    pending: '等待中',
    'pending-approval': '待审批',
    'awaiting-approval': '节点待审批',
    running: '运行中',
    succeeded: '成功',
    failed: '失败',
    cancelled: '已取消',
  }
  return map[status] || status
}

/**
 * bigint 毫秒时间戳经 TypeORM/JSON 到前端是**字符串**（如 `"1789987757654"`），
 * 直接交给 dayjs 会被当作 `YYYYMMDDHHmmss` 误解析（实测 → `1797-04-20 10:05:04`）。
 * 故格式化/比较前一律 Number 归一（规格 specs/deploy-console-domain-split/page-spec.md §10.1）。
 */
export function toMs(ts?: number | string | null): number {
  const n = Number(ts)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function formatTime(ts?: number | string): string {
  const n = toMs(ts)
  return n ? dayjs(n).format('YYYY-MM-DD HH:mm:ss') : '—'
}

/**
 * 步骤语义硬约束（与 servers/deploy-console/src/pipeline-template/pipeline-template.service.ts
 * STEP_SEMANTIC_ORDER 保持一致；前端用于拖拽排序即时校验，后端保存时二次拦截）。
 */
export const STEP_SEMANTIC_ORDER: ReadonlyArray<readonly [string, string]> = [
  ['check', 'pull'],
  ['check', 'build'],
  ['check', 'upload'],
  ['check', 'restart'],
  ['check', 'version'],
  ['check', 'pointer'],
  ['check', 'verify'],
  ['check', 'cleanup'],
  ['pull', 'build'],
  ['pull', 'upload'],
  ['pull', 'restart'],
  ['pull', 'version'],
  ['pull', 'pointer'],
  ['pull', 'verify'],
  ['pull', 'cleanup'],
  ['build', 'upload'],
  ['build', 'restart'],
  ['build', 'version'],
  ['build', 'pointer'],
  ['build', 'verify'],
  ['upload', 'version'],
  ['restart', 'version'],
  ['version', 'pointer'],
  ['pointer', 'verify'],
]

/** 校验步骤顺序是否满足语义硬约束；返回违规描述列表（空 = 合法） */
export function checkSemanticOrder(steps: string[]): string[] {
  const idx = new Map(steps.map((s, i) => [s, i]))
  const errs: string[] = []
  for (const [before, after] of STEP_SEMANTIC_ORDER) {
    const bi = idx.get(before)
    const ai = idx.get(after)
    if (bi !== undefined && ai !== undefined && bi >= ai) {
      errs.push(`「${before}」必须排在「${after}」之前（发布语义基线，不可颠倒）`)
    }
  }
  return errs
}

/**
 * 保留字节点名（与后端 template-node `PLATFORM_RESERVED` 保持一致）。
 *
 * 终态（design §3）：`git` 已放开 —— 拉码就是普通 shell 节点；
 * `version` / `pointer` 保留为黑名单，因为它们的能力已变成 `service` action，
 * 再出现同名节点会造成"以为它在写版本/切指针"的语义误读。
 */
export const NODE_PLATFORM_KEYS = ['version', 'pointer'] as const

/** 旧 platform 节点的固定 label（仅历史数据展示用） */
export const NODE_PLATFORM_LABELS: Record<string, string> = {
  git: 'git · 拉取代码',
  version: '写版本号',
  pointer: '切指针',
}

/**
 * service action 可选工具（与后端 `steps/service-tools.ts` 的 tool 名一致）。
 * 终态：平台能力 = 节点里的一个 service action，不再是节点类型。
 */
export const SERVICE_TOOL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'write-version', label: '写版本记录' },
  { value: 'switch-pointer', label: '切换版本指针' },
  { value: 'restart', label: '重启服务' },
  { value: 'verify', label: '部署验证' },
  { value: 'upload', label: '投递产物' },
  { value: 'pull', label: '拉取代码' },
  { value: 'cleanup', label: '清理旧版本' },
  { value: 'check', label: '安全基线校验' },
]

/** 节点是否可承载命令 / 可拖拽编辑（shell 或旧名 script；platform 仅读取兼容） */
export function isShellNode(n: TemplateNode): boolean {
  return n.kind === 'shell' || n.kind === 'script'
}

const NODE_KEY_RE = /^[A-Za-z0-9_-]{1,32}$/

/**
 * v5 nodes 校验（与后端 normalizeNodes 同规则）：返回违规列表，空 = 合法。
 *
 * 终态不再强制 git/version/pointer，也不再约束相对序 —— 顺序由画布拖拽决定。
 */
export function checkNodes(nodes: TemplateNode[]): string[] {
  const errs: string[] = []
  if (!nodes.length) return errs
  const seen = new Set<string>()
  let watchCount = 0
  for (const n of nodes) {
    if (seen.has(n.key)) errs.push(`节点 key 重复: ${n.key}`)
    seen.add(n.key)
    if (n.kind === 'platform') continue // 旧节点：仅读取兼容，不校验
    if ((NODE_PLATFORM_KEYS as readonly string[]).includes(n.key)) {
      errs.push(`节点 key 不能占用保留字: ${n.key}（其能力已是 service action，不应用作节点名）`)
    }
    if (!NODE_KEY_RE.test(n.key)) errs.push(`节点 key 非法: ${n.key}（须匹配 ^[A-Za-z0-9_-]{1,32}$）`)
    if (!n.label?.trim()) errs.push(`节点「${n.key}」缺少 label`)
    if (isShellNode(n) && (n as { watchdog?: boolean }).watchdog) watchCount++
  }
  if (watchCount > 1) errs.push('watchdog 节点最多 1 个')
  return errs
}

/** 节点展示名：script 用自身 label；platform 用固定名映射 */
export function nodeDisplayName(n: TemplateNode): string {
  if (n.kind === 'platform') return NODE_PLATFORM_LABELS[n.key] || n.key
  return n.label || n.key
}

/** 某实例某个 stage key 的展示名：v5 按实例 nodes label（含 platform 固定名），legacy 回退九阶段中文名 */
export function stepLabelOf(p: Pick<PipelineItem, 'nodes' | 'steps'> | null, stage: string): string {
  const n = p?.nodes?.find((x) => x.key === stage)
  if (n) return nodeDisplayName(n)
  return STEP_LABELS[stage] || stage
}

/** 实例实际活动阶段/节点 keys（v5 nodes 优先，回退 steps 子集/全九阶段） */
export function stageKeys(p: Pick<PipelineItem, 'nodes' | 'steps'>): string[] {
  if (p.nodes && p.nodes.length) return p.nodes.map((n) => n.key)
  if (p.steps && p.steps.length) return p.steps
  return [...PIPELINE_STAGES] as string[]
}

/** legacy 9 阶段转 nodes 的中文名（前端镜像） */
const LEGACY_SCRIPT_LABELS: Record<string, string> = {
  check: '校验',
  build: '构建',
  upload: '投递',
  restart: '重启',
  verify: '探活',
  cleanup: '清理',
}

/**
 * legacy（steps 子集 / skipVerify / 九阶段）→ v5 nodes 前端镜像。
 * 规则与后端 template-node legacyStepsToNodes 保持一致（git 首位 / build 必配 / verify 看 rollback 标 watchdog）。
 */
export function legacyToNodes(opts: {
  steps?: string[] | null
  skipVerify?: boolean
  rollbackOnFailure?: 'previous' | 'none'
}): TemplateNode[] {
  const base = opts.steps && opts.steps.length ? [...opts.steps] : [...PIPELINE_STAGES]
  const withVerify = !opts.skipVerify && base.includes('verify')
  const verifyWatchdog = withVerify && opts.rollbackOnFailure !== 'none'
  const nodes: TemplateNode[] = []
  nodes.push({ kind: 'platform', key: 'git' })
  for (const s of base) {
    if (s === 'pull' || s === 'git') continue
    if (s === 'version') {
      nodes.push({ kind: 'platform', key: 'version' })
      continue
    }
    if (s === 'pointer') {
      nodes.push({ kind: 'platform', key: 'pointer' })
      continue
    }
    if (s === 'verify' && !withVerify) continue
    if (!LEGACY_SCRIPT_LABELS[s]) continue
    nodes.push({
      kind: 'script',
      key: s,
      label: LEGACY_SCRIPT_LABELS[s],
      optional: s === 'build' ? false : true,
      watchdog: s === 'verify' && verifyWatchdog ? true : undefined,
    })
  }
  const iv = nodes.findIndex((n) => n.key === 'version')
  const ip = nodes.findIndex((n) => n.key === 'pointer')
  if (iv >= 0 && ip >= 0 && iv > ip) {
    const [v] = nodes.splice(iv, 1)
    nodes.splice(ip, 0, v)
  }
  return nodes
}

export function formatTimeShort(ts?: number | string): string {
  const n = toMs(ts)
  return n ? dayjs(n).format('MM-DD HH:mm:ss') : '—'
}

export function durationMs(p: PipelineItem): number {
  const start = toMs(p.startTime)
  const end = toMs(p.endTime)
  return end ? end - start : Date.now() - start
}

/** 实例实际活动阶段列表（v5 nodes → steps 子集 → 全量九阶段） */
export function stepList(p: PipelineItem): string[] {
  return stageKeys(p)
}

export type StepState = 'done' | 'running' | 'error' | 'pending'

/** 由实例状态 + 当前阶段推算某步骤的进展态 */
export function stepState(p: PipelineItem, s: string): StepState {
  if (p.status === 'succeeded') return 'done'
  const list = stepList(p)
  const cur = list.indexOf(p.stage ?? '')
  const i = list.indexOf(s)
  if (p.status === 'failed' || p.status === 'cancelled') {
    if (i < 0) return 'pending'
    return i < cur ? 'done' : i === cur ? 'error' : 'pending'
  }
  // 门禁级：一个阶段都还没跑，全部算未开始
  if (p.status === 'pending-approval' || cur < 0 || i < 0) return 'pending'
  // 节点级挂起：已执行的节点要显示为已完成，停在待审批的那个节点上
  return i < cur ? 'done' : i === cur ? 'running' : 'pending'
}

/** 实例是否仍在运行/等待（需要轮询） */
export function isLive(p?: PipelineItem | null): boolean {
  if (!p) return false
  // 挂起等审批同样需要轮询：审批可能在别处（API / 他人）发生，页面要能自己刷新过来
  return ['running', 'pending', ...APPROVAL_STATUSES].includes(p.status)
}
