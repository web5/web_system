import { Module, Provider } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  ClientRegistry,
  DeepseekClient,
  Hy3Client,
} from '@kedou-ai/agent-core';
import { OcrService } from './ocr.service';
import { OcrController } from './ocr.controller';

/**
 * 独立提供 ClientRegistry（DeepSeek + Hy3），供 OcrService 的 LLM 清洗调用。
 * AgentModule 也提供了一份相同实例，互不影响（DeepseekClient 是无状态配置类）。
 */
const clientRegistryProvider: Provider = {
  provide: ClientRegistry,
  useFactory: (): ClientRegistry => {
    const registry = new ClientRegistry();
    registry.register(new Hy3Client());
    registry.register(new DeepseekClient());
    return registry;
  },
};

@Module({
  imports: [ConfigModule],
  providers: [clientRegistryProvider, OcrService],
  controllers: [OcrController],
  exports: [OcrService, ClientRegistry],
})
export class OcrModule {}