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

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    pending: 'blue',
    'pending-approval': 'orange',
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
    running: '运行中',
    succeeded: '成功',
    failed: '失败',
    cancelled: '已取消',
  }
  return map[status] || status
}

export function formatTime(ts?: number): string {
  return ts ? dayjs(ts).format('YYYY-MM-DD HH:mm:ss') : '—'
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

/** v5 平台保留字（script key 不可占用；与后端 template-node PLATFORM_RESERVED 保持一致） */
export const NODE_PLATFORM_KEYS = ['git', 'version', 'pointer'] as const

/** platform 节点固定 label（platform 节点由平台命名，script 用自身 label） */
export const NODE_PLATFORM_LABELS: Record<string, string> = {
  git: 'git · 拉取代码',
  version: '写版本号',
  pointer: '切指针',
}

const NODE_KEY_RE = /^[A-Za-z0-9_-]{1,32}$/

/** v5 nodes 校验（与后端 normalizeNodes 同规则）：返回违规列表，空 = 合法 */
export function checkNodes(nodes: TemplateNode[]): string[] {
  const errs: string[] = []
  const keys = nodes.map((n) => n.key)
  if (!nodes.length) return errs
  for (const p of NODE_PLATFORM_KEYS) {
    if (!keys.includes(p)) errs.push(`节点必须保留平台步骤「${p}」（发布语义基线）`)
  }
  const iGit = keys.indexOf('git')
  if (iGit !== 0) errs.push('「git」必须排在第一位（先拉码后构建）')
  const iVer = keys.indexOf('version')
  const iPtr = keys.indexOf('pointer')
  if (iVer >= 0 && iPtr >= 0 && iVer > iPtr) errs.push('「version」必须排在「pointer」之前')
  const seen = new Set<string>()
  let watchCount = 0
  for (const n of nodes) {
    if (seen.has(n.key)) errs.push(`节点 key 重复: ${n.key}`)
    seen.add(n.key)
    if (n.kind === 'platform') continue
    if ((NODE_PLATFORM_KEYS as readonly string[]).includes(n.key)) errs.push(`script key 不能占用平台保留字: ${n.key}`)
    if (!NODE_KEY_RE.test(n.key)) errs.push(`script key 非法: ${n.key}`)
    if (!n.label?.trim()) errs.push(`script 节点「${n.key}」缺少 label`)
    if (n.watchdog) watchCount++
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

export function formatTimeShort(ts?: number): string {
  return ts ? dayjs(ts).format('MM-DD HH:mm:ss') : '—'
}

export function durationMs(p: PipelineItem): number {
  if (!p.endTime) return Date.now() - p.startTime
  return p.endTime - p.startTime
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
  if (p.status === 'pending-approval' || cur < 0 || i < 0) return 'pending'
  return i < cur ? 'done' : i === cur ? 'running' : 'pending'
}

/** 实例是否仍在运行/等待（需要轮询） */
export function isLive(p?: PipelineItem | null): boolean {
  return !!p && ['running', 'pending', 'pending-approval'].includes(p.status)
}
