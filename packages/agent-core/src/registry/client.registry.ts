/**
 * 模型客户端注册中心（按 modelId 获取可用 BaseAiClient）。
 */
import { BaseAiClient } from '../clients/base-ai.client';
import { Logger } from '../lib/logger';

export class ClientRegistry {
  private readonly logger = new Logger(ClientRegistry.name);
  private readonly clients = new Map<string, BaseAiClient>();

  register(client: BaseAiClient): void {
    this.clients.set(client.modelId, client);
  }

  get(modelId: string): BaseAiClient {
    const client = this.clients.get(modelId);
    if (!client) throw new Error(`模型 ${modelId} 未注册`);
    return client;
  }

  getOrFallback(modelId?: string): BaseAiClient {
    if (modelId && this.clients.has(modelId)) return this.clients.get(modelId)!;
    if (modelId) {
      this.logger.warn(`模型 ${modelId} 未注册，回退到默认模型（hy3）`);
    }
    if (this.clients.has('hy3')) return this.clients.get('hy3')!;
    const first = this.clients.values().next().value;
    if (!first) throw new Error('无任何已注册模型客户端');
    return first;
  }

  listModels(): Array<{ id: string; displayName: string; available: boolean }> {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.modelId,
      displayName: c.displayName,
      available: c.isAvailable(),
    }));
  }
}
