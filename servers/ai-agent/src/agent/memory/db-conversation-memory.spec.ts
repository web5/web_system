import { DbConversationMemory } from './db-conversation-memory';
import { AgentConversation } from './agent-conversation.entity';
import { Compaction, ChatMessage, AgentMemoryConfig } from '@kedouai/agent-core';
import { Repository } from 'typeorm';
import { MusicService } from '../../music/music.service';
import { UserMemorySummaryClient } from './user-memory-summary.client';

/**
 * DbConversationMemory 持久化行为单测：
 * - 新建会话写默认 title（首条 user 前 20 字）
 * - 既有会话 title 保留（不被整行覆盖写 null）
 * - 摘要压缩分支同样保留 title，且 messages 缩为 keepRecent
 * - save 对象不携带 report/meta（避免把业务快照列覆盖为空）
 * - loadProfile 双源合并（#8229）：摘要 + 口味并存、单源降级、失败不崩
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
      msgs.push({ role: 'user', content: `消息 ${i}`, ts: Date.now() });
      msgs.push({ role: 'assistant', content: `回复 ${i}`, ts: Date.now() });
    }
    return msgs;
  }

  function setup(existing: Partial<AgentConversation> | null, options?: { taste?: unknown; summary?: unknown }) {
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
    const music = {
      getTaste: jest.fn().mockResolvedValue(
        options?.taste ?? {
          likes: { genres: [], artists: [], moods: [] },
          dislikes: { genres: [], artists: [] },
        },
      ),
    } as unknown as MusicService;
    const summaryClient = {
      getSummary: jest.fn().mockResolvedValue(options?.summary ?? null),
    } as unknown as UserMemorySummaryClient;
    const mem = new DbConversationMemory(repo, compaction, music as never, summaryClient as never);
    return { repo, compaction, mem, music, summaryClient };
  }

  it('新建会话：title 取首条 user 内容前 20 字（去空白）', async () => {
    const { repo, mem } = setup(null);
    await mem.persist(
      'u1',
      undefined,
      [
        { role: 'system', content: 'system prompt', ts: Date.now() },
        { role: 'user', content: '【合同场景】消费贷款\n【合同内容】甲方借乙方十万元……', ts: Date.now() },
      ],
      config,
    );
    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.title).toBe('【合同场景】消费贷款 【合同内容】甲方借');
  });

  it('新建会话：save 对象不携带 report/meta（避免插入空快照干扰后续更新）', async () => {
    const { repo, mem } = setup(null);
    await mem.persist('u1', undefined, [{ role: 'user', content: '你好', ts: Date.now() }], config);
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
      [{ role: 'user', content: '新的一轮追问', ts: Date.now() }],
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

  // ── loadProfile 双源合并（#8229 批次1 卡1.6）─────────────────────────

  it('loadProfile：读到摘要并注入（原 BUG：此前从不查用户记忆）', async () => {
    const { mem } = setup(null, {
      summary: { namespace: 'general', summary: '# 用户画像\n- **事实**：用户叫橙子哥哥', version: 2, itemCount: 3 },
    });
    const text = await mem.loadProfile('u1');
    expect(text).toContain('# 用户画像');
    expect(text).toContain('橙子哥哥');
  });

  it('loadProfile：摘要与口味并存时两者都注入', async () => {
    const { mem } = setup(null, {
      taste: {
        likes: { genres: ['民谣'], artists: ['周杰伦'], moods: [] },
        dislikes: { genres: [], artists: [] },
      },
      summary: { namespace: 'general', summary: '- **偏好**：偏好简洁的回答风格', version: 1, itemCount: 1 },
    });
    const text = await mem.loadProfile('u1');
    expect(text).toContain('用户口味档案');
    expect(text).toContain('民谣');
    expect(text).toContain('用户记忆摘要');
    expect(text).toContain('偏好简洁的回答风格');
  });

  it('loadProfile：user-service 不可达（读摘要抛错）不崩、不注入摘要，口味仍注入', async () => {
    const { mem, summaryClient } = setup(null, {
      taste: {
        likes: { genres: ['摇滚'], artists: [], moods: [] },
        dislikes: { genres: [], artists: [] },
      },
    });
    (summaryClient.getSummary as jest.Mock).mockRejectedValue(new Error('connect ECONNREFUSED'));
    const text = await mem.loadProfile('u1');
    expect(text).toContain('用户口味档案');
    expect(text).not.toContain('用户记忆摘要');
  });

  it('loadProfile：双源都失败时返回 null（不抛异常，对话主链路不受影响）', async () => {
    const { mem, music, summaryClient } = setup(null);
    (music.getTaste as jest.Mock).mockRejectedValue(new Error('connect ECONNREFUSED'));
    (summaryClient.getSummary as jest.Mock).mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(mem.loadProfile('u1')).resolves.toBeNull();
  });

  it('loadProfile：无摘要、无口味时返回 null（不注入空档案）', async () => {
    const { mem } = setup(null);
    await expect(mem.loadProfile('u1')).resolves.toBeNull();
  });
});
