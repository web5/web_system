import type { PipelineItem } from '@/api'
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

export function formatTimeShort(ts?: number): string {
  return ts ? dayjs(ts).format('MM-DD HH:mm:ss') : '—'
}

export function durationMs(p: PipelineItem): number {
  if (!p.endTime) return Date.now() - p.startTime
  return p.endTime - p.startTime
}

/** 实例实际活动阶段列表（无快照 = 全量九阶段） */
export function stepList(p: PipelineItem): string[] {
  return (p.steps && p.steps.length
    ? p.steps
    : [...PIPELINE_STAGES]) as string[]
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
