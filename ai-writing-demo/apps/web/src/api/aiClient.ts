import { COLLAB_HTTP } from '../config'

export interface StreamReq {
  doc: string
  instruction: string
  recentHumanEdits?: string[]
  provider?: string
}

// SSE 流式读取：fetch + ReadableStream + 半包缓冲（对应调研 §1/§13）
export async function* streamAi(body: StreamReq): AsyncGenerator<string> {
  const res = await fetch(`${COLLAB_HTTP}/ai/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (data === '[DONE]') return
      let json: { error?: string; token?: string }
      try {
        json = JSON.parse(data)
      } catch {
        continue // 跳过非 JSON / 心跳
      }
      // 错误帧必须抛给调用方：放在 try 外，避免被上面的 catch 静默吞掉
      // （吞掉会让调用方把已累积的半截文本当成完整结果落地）
      if (json.error) throw new Error(json.error)
      if (json.token) yield json.token
    }
  }
}
