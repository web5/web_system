import * as Y from 'yjs'
import { ref } from 'vue'
import { streamAi } from '../api/aiClient'
import type { useAgentState } from './agentState'
import type { useAuditLog } from './collab'

type AgentStateApi = ReturnType<typeof useAgentState>
type AuditApi = ReturnType<typeof useAuditLog>

// AI 受控 peer + 流式 ghost 建议（对应调研 §4.2 / §4.3）
// applyToDoc：把建议文本并入主干（由编辑器实现，写进 Y.XmlFragment，而不是孤立的 Y.Text）
export function useAiWriter(
  ydoc: Y.Doc,
  ySuggestion: Y.Text,
  applyToDoc: (text: string) => void,
  agentState: AgentStateApi,
  audit: AuditApi,
) {
  const status = ref<'idle' | 'streaming' | 'pending' | 'accepted' | 'rejected'>('idle')
  let buffer = ''
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (!buffer) return
    const chunk = buffer
    buffer = ''
    ydoc.transact(() => {
      ySuggestion.insert(ySuggestion.length, chunk, { origin: 'ai-agent' })
    }, 'ai-agent')
  }

  const start = async (instruction: string, currentDoc: string, recentHumanEdits: string[]) => {
    status.value = 'streaming'
    agentState.dispatch({ type: 'AI_SUBMIT' })
    audit.record({ actor: 'ai-agent', action: 'submit', instruction })
    ydoc.transact(() => {
      if (ySuggestion.length > 0) ySuggestion.delete(0, ySuggestion.length)
    }, 'ai-agent')

    try {
      for await (const token of streamAi({ doc: currentDoc, instruction, recentHumanEdits })) {
        buffer += token
        if (timer) clearTimeout(timer)
        timer = setTimeout(flush, 100) // 每 ~100ms 批量 flush，避免逐 token 抖动
      }
      flush()
      status.value = 'pending'
    } catch (e) {
      status.value = 'rejected'
      console.error('[aiWriter] stream failed', e)
    }
  }

  const accept = () => {
    const text = ySuggestion.toString()
    if (text) applyToDoc(text) // 并入主干（编辑器 → XmlFragment）
    ydoc.transact(() => {
      if (ySuggestion.length > 0) ySuggestion.delete(0, ySuggestion.length)
    })
    status.value = 'accepted'
    agentState.dispatch({ type: 'ACCEPT' })
    audit.record({ actor: 'human', action: 'accept-ai' })
  }

  const reject = () => {
    ydoc.transact(() => {
      if (ySuggestion.length > 0) ySuggestion.delete(0, ySuggestion.length)
    })
    status.value = 'rejected'
    agentState.dispatch({ type: 'REJECT' })
    audit.record({ actor: 'human', action: 'reject-ai' })
  }

  return { status, start, accept, reject }
}
