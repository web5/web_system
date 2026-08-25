import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BaseAiClient } from './http/base-ai.client';
import { Hy3Client } from './http/hy3.client';
import { DeepseekClient } from './http/deepseek.client';

/**
 * 模型客户端注册中心（全局单例）。
 * Agent harness 与主 AiService 共用，按 modelId 获取可用的 BaseAiClient。
 * 新增模型客户端只需在此注册，避免各模块自行维护 Map（横切关注点收口）。
 */
@Injectable()
export class ClientRegistry implements OnModuleInit {
  private readonly logger = new Logger(ClientRegistry.name);
  private readonly clients = new Map<string, BaseAiClient>();

  constructor(
    private readonly hy3Client: Hy3Client,
    private readonly deepseekClient: DeepseekClient,
  ) {}

  onModuleInit(): void {
    this.register(this.hy3Client);
    this.register(this.deepseekClient);
    this.logger.log(`模型客户端注册完成: ${Array.from(this.clients.keys()).join(', ')}`);

    const available = Array.from(this.clients.values())
      .filter((c) => c.isAvailable())
      .map((c) => c.modelId);
    if (available.length === 0) {
      this.logger.warn('警告：当前无可用模型客户端（请检查 HY3_API_KEY / DEPSEEK_API_KEY 配置）');
    } else {
      this.logger.log(`可用模型: ${available.join(', ')}`);
    }
  }

  register(client: BaseAiClient): void {
    this.clients.set(client.modelId, client);
  }

  get(modelId: string): BaseAiClient {
    const client = this.clients.get(modelId);
    if (!client) throw new Error(`模型 ${modelId} 未注册`);
    return client;
  }

  /** 获取可用 client，找不到则返回默认 hy3（即使未配置，由 client 在调用时报错） */
  getOrFallback(modelId?: string): BaseAiClient {
    if (modelId && this.clients.has(modelId)) return this.clients.get(modelId)!;
    if (this.clients.has('hy3')) return this.clients.get('hy3')!;
    const first = this.clients.values().next().value;
    if (!first) throw new Error('无任何已注册模型客户端');
    return first;
  }

  /** 列出所有已注册模型及其可用状态（供 CLI 展示配置情况） */
  listModels(): Array<{ id: string; displayName: string; available: boolean }> {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.modelId,
      displayName: c.displayName,
      available: c.isAvailable(),
    }));
  }
}
