import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { loadLlmEnv } from './config/llm-loader'
import { startCollabServer } from './collab/collab.gateway'

async function bootstrap() {
  loadLlmEnv()
  const app = await NestFactory.create(AppModule, {
    // 前端 :5173 跨域调用 :7100 的 SSE，需要放开 CORS（含 OPTIONS 预检）
    cors: {
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    },
  })
  await app.listen(7100, '0.0.0.0')
  startCollabServer(7101)
  new Logger('Bootstrap').log('HTTP :7100  WS :7101 (room = ws path)')
}
bootstrap().catch((e) => { console.error('[bootstrap] FAILED', e); process.exit(1) })
