import { Injectable } from '@nestjs/common'
import { mockStream } from './mock-generator'

const PROVIDERS: Record<string, { key: string; base: string; model: string }> = {
  deepseek: { key: 'DEEPSEEK_API_KEY', base: 'DEEPSEEK_BASE_URL', model: 'DEEPSEEK_MODEL' },
  hunyuan: { key: 'HUNYUAN_API_KEY', base: 'HUNYUAN_BASE_URL', model: 'HUNYUAN_MODEL' },
}

export interface StreamBody {
  doc: string
  instruction: string
  recentHumanEdits?: string[]
  provider?: string
}

@Injectable()
export class LlmService {
  // 返回 token 流；无 key / FORCE_MOCK / 出错 时自动降级 mock
  async *streamTokens(body: StreamBody): AsyncGenerator<string> {
    const useMock =
      process.env.FORCE_MOCK === '1' ||
      (!process.env.DEEPSEEK_API_KEY && !process.env.HUNYUAN_API_KEY)
    if (useMock) {
      yield* mockStream(body.instruction, body.doc || '')
      return
    }

    const provider = body.provider || process.env.AI_PROVIDER || 'deepseek'
    const cfg = PROVIDERS[provider] || PROVIDERS.deepseek
    const apiKey = process.env[cfg.key]
    const baseUrl = process.env[cfg.base]
    const model = process.env[cfg.model]
    if (!apiKey || !baseUrl) {
      yield* mockStream(body.instruction, body.doc || '')
      return
    }

    const prompt = this.buildPrompt(body)
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [
            {
              role: 'system',
              content:
                '你是文档写作助手。基于用户提供的「当前文档全文」和指令，输出【修改后的完整文档全文】。' +
                '硬性要求：1) 只输出文档正文，纯文本，不要任何解释、前言、后记、markdown 代码块；' +
                '2) 段落之间用单个换行分隔；' +
                '3) 除指令要求修改的部分外，其余内容必须原样保留，不得自行增删改写；' +
                '4) 如果当前文档为空，按指令生成一篇完整文档。',
            },
            { role: 'user', content: prompt },
          ],
        }),
      })
      if (!resp.ok || !resp.body) {
        yield* mockStream(body.instruction, body.doc || '')
        return
      }
      const reader = resp.body.getReader()
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
          try {
            const json = JSON.parse(data)
            const token: string | undefined = json.choices?.[0]?.delta?.content
            if (token) yield token
          } catch {
            /* 跳过心跳/非 JSON 行 */
          }
        }
      }
    } catch (e) {
      console.error('[llm] 真实 LLM 调用失败，降级 mock：', e)
      yield* mockStream(body.instruction, body.doc || '')
    }
  }

  private buildPrompt(body: StreamBody): string {
    const doc = (body.doc || '').trim()
    const edits =
      body.recentHumanEdits && body.recentHumanEdits.length
        ? `\n最近用户手动修改过的文档快照（用于增量意图推断，不要照抄）：\n${body.recentHumanEdits.join('\n')}`
        : ''
    const head = doc
      ? `当前文档全文：\n"""\n${doc}\n"""`
      : '当前文档为空，请根据指令【生成】一篇完整文档。'
    return (
      `${head}\n` +
      `用户指令：${body.instruction}${edits}\n` +
      `请直接返回修改后的【完整文档全文】。`
    )
  }
}
