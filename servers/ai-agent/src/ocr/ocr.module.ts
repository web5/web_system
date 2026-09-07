import { Module, Provider } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  ClientRegistry,
  TokenHubClient,
  Hy3Client,
} from '@kedouai/agent-core';
import { OcrService } from './ocr.service';
import { OcrController } from './ocr.controller';

/**
 * 独立提供 ClientRegistry（TokenHub deepseek-v4-flash + Hy3），供 OcrService 的 LLM 清洗调用。
 * AgentModule 也提供了一份相同实例，互不影响（客户端是无状态配置类）。
 * 说明：官方直连 DeepseekClient(deepseek-chat) 已下线，DeepSeek 系统一走 TokenHub 托管。
 */
const clientRegistryProvider: Provider = {
  provide: ClientRegistry,
  useFactory: (): ClientRegistry => {
    const registry = new ClientRegistry();
    registry.register(new Hy3Client());
    registry.register(new TokenHubClient('deepseek-v4-flash'));
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