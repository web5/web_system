import { Module } from '@nestjs/common'
import { AiController } from './ai/ai.controller'
import { LlmService } from './ai/llm.service'
import { HealthController } from './health/health.controller'
import { DocController } from './doc/doc.controller'

@Module({
  controllers: [AiController, HealthController, DocController],
  providers: [LlmService],
})
export class AppModule {}
