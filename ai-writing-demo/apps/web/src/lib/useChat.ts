import { ref } from 'vue'
import { streamAi } from '../api/aiClient'
import { planAiApply } from './useAiDocument'

export interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
  streaming: boolean
  applied?: {
    changeId: string
    changedCount: number
    overlapped: boolean
    undone: boolean
  }
}

let uidSeq = 0
const uid = () => `m${++uidSeq}`

// 对话驱动文档：发指令 → 流式回全文 → 段落级合并落地 → 可撤销
export function useChat(opts: {
  getDocText: () => string
  setDocText: (t: string) => void
  beforeSend?: () => void
  afterApply?: (overlapped: boolean) => void
}) {
  const messages = ref<ChatMessage[]>([])
  const busy = ref(false)
  const changes = new Map<string, { before: string; after: string }>()
  let changeSeq = 0

  const send = async (instruction: string) => {
    const text = (instruction || '').trim()
    if (!text || busy.value) return

    opts.beforeSend?.()
    messages.value.push({ id: uid(), role: 'user', text, streaming: false })
    messages.value.push({ id: uid(), role: 'ai', text: '', streaming: true })
    const idx = messages.value.length - 1
    busy.value = true

    // 快照：发起请求那一刻的文档（后面用它算 AI 改动区间和人工改动区间）
    const requestDoc = opts.getDocText()
    let acc = ''
    try {
      for await (const token of streamAi({ doc: requestDoc, instruction: text })) {
        acc += token
        messages.value[idx].text = acc
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      messages.value[idx].text = acc + `\n[流式失败] ${msg}`
      messages.value[idx].streaming = false
      busy.value = false
      return
    }
    messages.value[idx].streaming = false

    // 落地：以【当前文档】为底，检测与人工修改的交叉
    const currentDoc = opts.getDocText()
    const plan = planAiApply(requestDoc, acc, currentDoc)
    const changeId = `c${++changeSeq}`
    changes.set(changeId, { before: currentDoc, after: plan.text })
    opts.setDocText(plan.text)

    messages.value[idx].applied = {
      changeId,
      changedCount: plan.changedCount,
      overlapped: plan.overlapped,
      undone: false,
    }
    busy.value = false
    opts.afterApply?.(plan.overlapped)
  }

  // 撤销本次 AI 改动：回滚到该次改动前的快照
  const undoChange = (changeId: string) => {
    const c = changes.get(changeId)
    if (!c) return
    const cur = opts.getDocText()
    if (cur !== c.after) {
      const ok = confirm(
        '文档在本次 AI 改动之后又发生了修改。撤销会回滚到本次 AI 改动前的版本，之后的改动也会被覆盖。是否继续？',
      )
      if (!ok) return
    }
    opts.setDocText(c.before)
    const m = messages.value.find((x) => x.applied?.changeId === changeId)
    if (m?.applied) m.applied.undone = true
  }

  return { messages, busy, send, undoChange }
}
