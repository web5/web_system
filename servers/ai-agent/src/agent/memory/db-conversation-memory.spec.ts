import { DbConversationMemory } from './db-conversation-memory';
import { AgentConversation } from './agent-conversation.entity';
import { Compaction, ChatMessage, AgentMemoryConfig } from '@kedouai/agent-core';
import { Repository } from 'typeorm';

/**
 * DbConversationMemory 持久化行为单测：
 * - 新建会话写默认 title（首条 user 前 20 字）
 * - 既有会话 title 保留（不被整行覆盖写 null）
 * - 摘要压缩分支同样保留 title，且 messages 缩为 keepRecent
 * - save 对象不携带 report/meta（避免把业务快照列覆盖为空）
 */
describe('DbConversationMemory', () => {
  const config: AgentMemoryConfig = {
    compactionThreshold: 20,
    keepRecent: 6,
    enabled: true,
  };

  function makeMessages(count: number): ChatMessage[] {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < count; i++) {
      msgs.push({ role: 'user', content: `消息 ${i}` });
      msgs.push({ role: 'assistant', content: `回复 ${i}` });
    }
    return msgs;
  }

  function setup(existing: Partial<AgentConversation> | null) {
    const repo = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
      create: jest.fn((e) => e),
    } as unknown as Repository<AgentConversation>;
    const compaction = {
      shouldCompact: jest.fn().mockReturnValue(false),
      compact: jest.fn(),
      extractPersistable: jest.fn((msgs: ChatMessage[]) =>
        msgs.filter((m) => m.role !== 'system'),
      ),
    } as unknown as Compaction;
    const mem = new DbConversationMemory(repo, compaction);
    return { repo, compaction, mem };
  }

  it('新建会话：title 取首条 user 内容前 20 字（去空白）', async () => {
    const { repo, mem } = setup(null);
    await mem.persist(
      'u1',
      undefined,
      [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '【合同场景】消费贷款\n【合同内容】甲方借乙方十万元……' },
      ],
      config,
    );
    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.title).toBe('【合同场景】消费贷款 【合同内容】甲方借');
  });

  it('新建会话：save 对象不携带 report/meta（避免插入空快照干扰后续更新）', async () => {
    const { repo, mem } = setup(null);
    await mem.persist('u1', undefined, [{ role: 'user', content: '你好' }], config);
    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved).not.toHaveProperty('report');
    expect(saved).not.toHaveProperty('meta');
    expect(saved.title).toBe('你好');
  });

  it('更新会话：title 保留既有值，不被整行覆盖写 null', async () => {
    const { repo, mem } = setup({
      id: 'conv-1',
      userId: 'u1',
      title: '合同体检 · 消费贷款',
      summary: 'old',
      summarizedCount: 2,
      messages: [],
    } as unknown as Partial<AgentConversation>);
    await mem.persist(
      'u1',
      'conv-1',
      [{ role: 'user', content: '新的一轮追问' }],
      config,
    );
    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.id).toBe('conv-1');
    expect(saved.title).toBe('合同体检 · 消费贷款');
  });

  it('触发摘要压缩：title 保留、summary 更新、messages 缩为 keepRecent', async () => {
    const { repo, compaction, mem } = setup({
      id: 'conv-2',
      userId: 'u1',
      title: '既有标题',
      summary: null,
      summarizedCount: 0,
      messages: [],
    } as unknown as Partial<AgentConversation>);
    (compaction.shouldCompact as jest.Mock).mockReturnValue(true);
    (compaction.compact as jest.Mock).mockResolvedValue('合并后的新摘要');
    await mem.persist('u1', 'conv-2', makeMessages(6), config);
    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.title).toBe('既有标题');
    expect(saved.summary).toBe('合并后的新摘要');
    expect(saved.summarizedCount).toBe(6);
    expect(Array.isArray(saved.messages)).toBe(true);
    expect((saved.messages as unknown[]).length).toBe(6);
  });
});
