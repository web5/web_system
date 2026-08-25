import { InMemoryConversationMemory } from './in-memory-conversation-memory';
import { Compaction } from './compaction';
import { AgentMemoryConfig } from '../interfaces/agent.interface';
import { ChatMessage } from '../../common/http/base-ai.client';

const config: AgentMemoryConfig = { compactionThreshold: 4, keepRecent: 2, enabled: true };

function msg(role: ChatMessage['role'], content: string): ChatMessage {
  return { role, content };
}

describe('InMemoryConversationMemory', () => {
  it('新建会话 persist 后 load 能还原近期消息', async () => {
    const mem = new InMemoryConversationMemory();
    const id = await mem.persist('u1', undefined, [msg('user', 'hi'), msg('assistant', 'hello')], config);
    expect(id).toBeTruthy();

    const loaded = await mem.load('u1', id);
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[0].content).toBe('hi');
  });

  it('传入 conversationId 可续聊（不新建）', async () => {
    const mem = new InMemoryConversationMemory();
    const id = await mem.persist('u1', 'c1', [msg('user', 'a')], config);
    expect(id).toBe('c1');
    const id2 = await mem.persist('u1', 'c1', [msg('user', 'b')], config);
    expect(id2).toBe('c1');
  });

  it('超过阈值时触发压缩，保留 keepRecent 条近期消息', async () => {
    const compact = {
      extractPersistable: (m: ChatMessage[]) => m.filter((x) => x.role !== 'system'),
      shouldCompact: () => true,
      compact: jest.fn().mockResolvedValue('这是摘要'),
    } as unknown as Compaction;

    const mem = new InMemoryConversationMemory(compact);
    const full: ChatMessage[] = [
      msg('user', '1'),
      msg('assistant', 'a'),
      msg('user', '2'),
      msg('assistant', 'b'),
      msg('user', '3'),
      msg('assistant', 'c'),
    ];
    await mem.persist('u1', 'c1', full, config);

    // 6 条，阈值 4，keepRecent 2 -> 压缩后保留最近 2 条
    const loaded = await mem.load('u1', 'c1');
    expect(loaded.summary).toBe('这是摘要');
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[loaded.messages.length - 1].content).toBe('c');
  });
});
