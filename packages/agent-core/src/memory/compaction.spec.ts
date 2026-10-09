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
