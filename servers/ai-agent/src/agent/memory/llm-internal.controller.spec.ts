import { LlmInternalController } from './llm-internal.controller';
import { ClientRegistry } from '@kedouai/agent-core';
import { ConfigService } from '@nestjs/config';
import { MemorySummaryRequestDto } from './dto/memory-summary-request.dto';

/**
 * LlmInternalController 单测（#8229 架构修正：摘要 LLM 统一走 ai-agent）：
 * - 明细集 → 调 ClientRegistry 同提炼模型生成，返回 { summary, model, itemCount }
 * - items 为空 → 直接返回空 summary（不打 LLM）
 * - LLM 失败向上抛（由 user-service 回落模板，本端点不吞错）
 */
describe('LlmInternalController', () => {
  function makeController(options?: { chat?: string; chatError?: Error }) {
    const client = {
      modelId: 'deepseek-v4-flash',
      chat: jest.fn().mockImplementation(() => {
        if (options?.chatError) return Promise.reject(options.chatError);
        return Promise.resolve(options?.chat ?? '# 用户画像\n- **事实**：测试');
      }),
    };
    const registry = {
      getOrFallback: jest.fn().mockReturnValue(client),
    } as unknown as ClientRegistry;
    const configService = {
      get: jest.fn((key: string) => (key === 'MEMORY_EXTRACT_MODEL' ? process.env.MEMORY_EXTRACT_MODEL : undefined)),
    } as unknown as ConfigService;
    const controller = new LlmInternalController(registry, configService);
    return { controller, client, registry };
  }

  function dto(overrides?: Partial<MemorySummaryRequestDto>): MemorySummaryRequestDto {
    return {
      userId: 'u1',
      namespace: 'general',
      itemCount: 2,
      items: [
        { category: 'fact', content: '用户叫橙子哥哥' },
        { category: 'preference', content: '偏好简洁的回答风格' },
      ],
      ...overrides,
    } as MemorySummaryRequestDto;
  }

  it('明细集 → 生成摘要并返回 model/itemCount，用 MEMORY_EXTRACT_MODEL 同款 fallback', async () => {
    const { controller, client, registry } = makeController({ chat: '# 用户画像\n- LLM 生成' });
    const res = await controller.memorySummary(dto());
    expect(res.summary).toContain('LLM 生成');
    expect(res.model).toBe('deepseek-v4-flash');
    expect(res.itemCount).toBe(2);
    expect(registry.getOrFallback).toHaveBeenCalledWith(process.env.MEMORY_EXTRACT_MODEL);
    // system + user 两条消息
    expect((client.chat as jest.Mock).mock.calls[0][0]).toHaveLength(2);
  });

  it('items 为空 → 返回空 summary，不打 LLM', async () => {
    const { controller, client } = makeController();
    const res = await controller.memorySummary(dto({ items: [], itemCount: 0 }));
    expect(res.summary).toBe('');
    expect(res.model).toBeNull();
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('LLM 失败向上抛（user-service 侧兜底模板，本端点不吞错）', async () => {
    const { controller } = makeController({ chatError: new Error('TokenHub 超时') });
    await expect(controller.memorySummary(dto())).rejects.toThrow('TokenHub 超时');
  });
});
