import { ConfigService } from '@nestjs/config';
import { AgentRegistry, ClientRegistry, Hy3Client, TokenHubClient } from '@kedouai/agent-core';
import { Repository } from 'typeorm';
import { IntentService } from './intent/intent.service';
import { AgentConversation } from './memory/agent-conversation.entity';
import { BUILTIN_TOKENHUB_MODELS, ModelCatalogService } from './model-catalog.service';

describe('ModelCatalogService 与意图分类默认模型', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    { source: 'db', models: 'deepseek/deepseek-flash', dictAvailable: true },
    { source: 'env', models: 'deepseek-v4-flash,hy4-preview', dictAvailable: false },
    { source: 'builtin', models: undefined, dictAvailable: false },
    { source: 'db', models: undefined, dictAvailable: false },
  ])('$source / dictAvailable=$dictAvailable 时分类不回退 hy3', async (scenario) => {
    const values: Record<string, string | undefined> = {
      MODEL_SOURCE: scenario.source,
      TOKENHUB_MODELS: scenario.models,
      INTENT_ROUTING_ENABLED: 'true',
    };
    const config = {
      get: (key: string, fallback?: string) => values[key] ?? fallback,
    } as ConfigService;
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      if (!scenario.dictAvailable) throw new Error('dictionary unavailable');
      return new Response(
        JSON.stringify({
          data: ['deepseek-v4-flash', 'deepseek-v4-pro', 'hy4-preview'].map((value) => ({ value })),
        }),
        { status: 200 },
      );
    });
    const flashChat = jest
      .spyOn(TokenHubClient.prototype, 'chat')
      .mockResolvedValue(JSON.stringify({ agentId: 'specialist', confidence: 0.95 }));
    const fallbackChat = jest.spyOn(Hy3Client.prototype, 'chat').mockResolvedValue('');
    const clients = new ClientRegistry();
    const selectClient = jest.spyOn(clients, 'getOrFallback');
    clients.register(new Hy3Client());
    for (const modelId of BUILTIN_TOKENHUB_MODELS.split(',')) {
      clients.register(new TokenHubClient(modelId));
    }
    const agents = new AgentRegistry();
    for (const agentId of ['general', 'specialist']) {
      agents.register({
        id: agentId,
        name: agentId,
        systemPrompt: agentId,
        model: 'deepseek-v4-flash',
        tools: [],
        maxSteps: 1,
        memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
      });
    }
    const intent = new IntentService({} as Repository<AgentConversation>, agents, clients, config);
    const catalog = new ModelCatalogService(config, clients);

    await catalog.sync();
    const result = await intent.resolve({ userInput: '处理一下这个请求', userId: 'test-user' });

    expect(result).toMatchObject({ agentId: 'specialist', via: 'llm' });
    expect(flashChat).toHaveBeenCalledTimes(1);
    expect(selectClient).toHaveBeenCalledWith('deepseek-v4-flash');
    expect(fallbackChat).not.toHaveBeenCalled();
    if (scenario.dictAvailable) {
      expect(catalog.getState()).toMatchObject({
        source: 'db',
        models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'hy4-preview'],
      });
      expect(() => clients.get('deepseek/deepseek-flash')).toThrow('未注册');
    }
  });
});
