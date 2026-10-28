import { Compaction } from './compaction';
import { ClientRegistry } from '../registry/client.registry';
import type { ChatMessage } from '../clients/base-ai.client';

/**
 * 2026-10-09 事故回归：tool 消息曾随对话落库，但 StoredMessage 不携带
 * assistant.toolCalls → 落库的 tool 消息必然是「孤儿」。下一轮回放时
 * 「assistant(无 tool_calls) → role=tool」违反 OpenAI 兼容协议，
 * 被 TokenHub 400 打回（[MODEL_ERROR] HTTP 400），会话从此每轮必炸。
 */
describe('Compaction.extractPersistable', () => {
  const c = new Compaction({} as ClientRegistry);

  it('去掉 system 与 tool 消息，只留 user / assistant', () => {
    const run: ChatMessage[] = [
      { role: 'system', content: '你是通用助手', ts: 1 },
      { role: 'user', content: '帮我搜今天的AI资讯', ts: 2 },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'web_search', arguments: '{"query":"AI 资讯"}' }],
        ts: 3,
      },
      { role: 'tool', content: '搜索结果（约 10KB）...', toolCallId: 'call_1', ts: 4 },
      { role: 'assistant', content: '整理好的资讯汇总', ts: 5 },
    ];
    const out = c.extractPersistable(run);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(out.some((m) => m.toolCallId)).toBe(false);
  });

  it('空入参返回空数组', () => {
    expect(c.extractPersistable([])).toEqual([]);
  });
});

/**
 * D1 R2 直调点护栏：摘要压缩显式 override enabled（防 P5=disabled 反转误伤质量）。
 */
describe('Compaction.compact · thinking 显式开启（D1 R2）', () => {
  it('调用 chat 时带 thinking:{type:enabled}（不落 P5 disabled）', async () => {
    const chat = jest.fn().mockResolvedValue('摘要内容');
    const registry = { getOrFallback: jest.fn().mockReturnValue({ chat }) } as unknown as ClientRegistry;
    const c = new Compaction(registry);

    await c.compact(null, [{ role: 'user', content: 'hi', ts: 1 }], 'hy3');

    expect(chat).toHaveBeenCalledTimes(1);
    const options = chat.mock.calls[0][1];
    expect(options.thinking).toEqual({ type: 'enabled' });
    expect(options.maxTokens).toBe(800);
  });
});
