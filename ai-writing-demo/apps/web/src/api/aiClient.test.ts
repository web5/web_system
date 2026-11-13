// aiClient SSE 契约测试（D2 先红后绿用例）
// 契约：后端通过 `data: {"error": "..."}` 帧报告错误时，
// streamAi 必须抛出该错误，让调用方能感知失败；
// 绝不允许静默吞掉后把已累积的半截文本当成完整结果落地。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { streamAi } from './aiClient'

function sseResponse(frames: string[]): Response {
  const payload = frames.map((f) => `data: ${f}\n\n`).join('')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

async function drain(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = []
  for await (const t of gen) out.push(t)
  return out
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('streamAi SSE 契约', () => {
  it('正常 token 帧按序产出', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(['{"token":"你"}', '{"token":"好"}', '[DONE]'])),
    )
    expect(await drain(streamAi({ doc: '', instruction: '' }))).toEqual(['你', '好'])
  })

  it('非 JSON 心跳帧被跳过，不中断流', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse([': ping', '{"token":"A"}', '[DONE]'])),
    )
    expect(await drain(streamAi({ doc: '', instruction: '' }))).toEqual(['A'])
  })

  it('错误帧必须抛错，不许静默吞掉（先红后绿锚点）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(['{"token":"半"}', '{"error":"upstream 500"}', '[DONE]']),
      ),
    )
    await expect(drain(streamAi({ doc: '', instruction: '' }))).rejects.toThrow(
      'upstream 500',
    )
  })

  it('[DONE] 帧终止流', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(['{"token":"X"}', '[DONE]', '{"token":"Y"}'])),
    )
    expect(await drain(streamAi({ doc: '', instruction: '' }))).toEqual(['X'])
  })
})
