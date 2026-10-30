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
        return Promise.resolve(options?.chat ?? '· 事实：测试');
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
    const { controller, client, registry } = makeController({ chat: '· 事实：LLM 生成' });
    const res = await controller.memorySummary(dto());
    expect(res.summary).toContain('LLM 生成');
    expect(res.model).toBe('deepseek-v4-flash');
    expect(res.itemCount).toBe(2);
    expect(registry.getOrFallback).toHaveBeenCalledWith(process.env.MEMORY_EXTRACT_MODEL);
    // system + user 两条消息
    expect((client.chat as jest.Mock).mock.calls[0][0]).toHaveLength(2);
  });

  /**
   * #8273 回归：摘要正文在 admin 记忆卡与 portal 画像卡都是 `{{ }}` 插值转义渲染（禁 v-html），
   * markdown 不会被渲染、只会露出 `#`/`-`/`**`。所以 prompt 必须强制纯文本。
   * 本用例钉住三条：①明令禁 markdown ②不再要求「首行 # 用户画像」③不再要求正文写统计行。
   */
  it('system prompt 强制纯文本，不再要求 markdown 标题与统计行（#8273）', async () => {
    const { controller, client } = makeController();
    await controller.memorySummary(dto());
    const messages = (client.chat as jest.Mock).mock.calls[0][0] as { role: string; content: string }[];
    const system = messages[0].content;
    expect(system).toContain('禁止任何 markdown 语法');
    expect(system).toContain('不要 # 标题');
    expect(system).toContain('「· 」开头');
    // 旧口径（会让卡片露出井号 / 重复条数）必须不再出现
    expect(system).not.toContain('首行必须是');
    expect(system).not.toContain('共 N 条记忆');
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
