import { Controller, Post, Body, Res } from '@nestjs/common'
import type { Response } from 'express'
import { LlmService, StreamBody } from './llm.service'

@Controller('ai')
export class AiController {
  constructor(private readonly llm: LlmService) {}

  // 手写 SSE：X-Accel-Buffering:no 防 nginx 缓冲；半包处理在复用的 fetch 流解析里
  @Post('stream')
  async stream(@Body() body: StreamBody, @Res() res: Response) {
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    try {
      for await (const token of this.llm.streamTokens(body)) {
        res.write(`data: ${JSON.stringify({ token })}\n\n`)
      }
      res.write('data: [DONE]\n\n')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`)
    } finally {
      res.end()
    }
  }
}
