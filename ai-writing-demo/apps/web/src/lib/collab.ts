import { ref } from 'vue'

export interface EditRecord {
  actor: 'human' | 'ai-agent'
  before: string
  after: string
  ts: number
  seq: number
}

// 人机回合协议基础：记 Human Edit + 读「上次 agent 以来的修改」+ 冲突检测 + 审计
//
// 注意：主干文档现在是 Tiptap 的 Y.XmlFragment（由编辑器托管），不再是一个 Y.Text，
// 所以这里不 observe ytext，改为由编辑器的 human-update 事件外部驱动 recordHumanEdit()。
export function useEditLog() {
  const log = ref<EditRecord[]>([])
  let seq = 0
  let lastAiSeq = -1

  // 由编辑器（本地/远端）人类修改事件驱动
  const recordHumanEdit = (after: string) => {
    log.value.push({ actor: 'human', before: '', after, ts: Date.now(), seq: seq++ })
  }

  // 每轮 AI 开始前打点：此后发生的人改才算「AI 产出之后」的改动
  const markAiPoint = () => {
    lastAiSeq = seq
  }

  const humanEditsSince = (sinceSeq: number) =>
    log.value.filter((r) => r.actor === 'human' && r.seq > sinceSeq).map((r) => r.after)

  return {
    log,
    recordHumanEdit,
    markAiPoint,
    humanEditsSince,
    getLastAiSeq: () => lastAiSeq,
  }
}

// 冲突检测：AI 产出之后是否有人又改过 → 是则走「建议模式」，不自动覆盖
export function useConflict(
  getLastAiSeq: () => number,
  humanEditsSince: (n: number) => string[],
) {
  const detect = (): boolean => humanEditsSince(getLastAiSeq()).length > 0
  return { detect }
}

export interface AuditEvent {
  actor: 'human' | 'ai-agent'
  action: string
  [key: string]: unknown
}

// 审计流水：AI 落地 / 人工改动 / 撤销都登记，供对话气泡与后续回放使用
export function useAuditLog() {
  const events = ref<AuditEvent[]>([])
  const record = (e: AuditEvent) => {
    events.value.push({ ...e, ts: Date.now() })
  }
  return { events, record }
}
