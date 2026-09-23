import { AgentConversationQueryService } from './agent-conversation-query.service';
import { AgentConversation } from './memory/agent-conversation.entity';
import { Repository } from 'typeorm';

describe('AgentConversationQueryService', () => {
  function setup() {
    const repo = {
      findAndCount: jest.fn().mockResolvedValue([[{ id: 'c1' }], 1]),
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as Repository<AgentConversation>;
    const svc = new AgentConversationQueryService(repo);
    return { repo, svc };
  }

  it('list：固定 userId + source=chat 过滤 + updatedAt 倒序 + 轻量列 select + 分页', async () => {
    const { repo, svc } = setup();
    await svc.listConversations('u1', 2, 10);
    expect(repo.findAndCount).toHaveBeenCalledWith({
      // source='chat'：只返回主对话，工具页（翻译/合同）会话不进主列表（30d9b1f 起的行为）
      where: { userId: 'u1', source: 'chat' },
      order: { updatedAt: 'DESC' },
      select: ['id', 'title', 'meta', 'createdAt', 'updatedAt'],
      skip: 10,
      take: 10,
    });
  });

  it('list：source=tool → 只返回工具页会话（2026-09-23）', async () => {
    const { repo, svc } = setup();
    await svc.listConversations('u1', 1, 20, 'tool');
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', source: 'tool' } }),
    );
  });

  it('list：source=tool + agentId → 按能力过滤（翻译 / 合翻各取各的）', async () => {
    const { repo, svc } = setup();
    await svc.listConversations('u1', 1, 20, 'tool', 'contract-risk');
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', source: 'tool', agentId: 'contract-risk' } }),
    );
  });

  it('list：agentId 为空串 → 不拼该条件（等价于只按 source 过滤）', async () => {
    const { repo, svc } = setup();
    await svc.listConversations('u1', 1, 20, 'tool', '   ');
    expect(repo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', source: 'tool' } }),
    );
  });

  it('list：返回 {list, total}', async () => {
    const { svc } = setup();
    const result = await svc.listConversations('u1', 1, 20);
    expect(result).toEqual({ list: [{ id: 'c1' }], total: 1 });
  });

  it('markSource：source=tool 时一并把显式 agentId 落库（工具记录按能力过滤靠它）', async () => {
    const repo = { update: jest.fn() } as unknown as Repository<AgentConversation>;
    const svc = new AgentConversationQueryService(repo);
    await svc.markSource('u1', 'conv-1', 'tool', 'translate');
    expect(repo.update).toHaveBeenCalledWith({ id: 'conv-1', userId: 'u1' }, {
      source: 'tool',
      agentId: 'translate',
    });
  });

  it('markSource：agentId 为空 → 只改 source（不写空值）', async () => {
    const repo = { update: jest.fn() } as unknown as Repository<AgentConversation>;
    const svc = new AgentConversationQueryService(repo);
    await svc.markSource('u1', 'conv-1', 'tool', '  ');
    expect(repo.update).toHaveBeenCalledWith({ id: 'conv-1', userId: 'u1' }, { source: 'tool' });
  });

  it('detail：按 {id,userId} 查询（防止越权读他人会话）', async () => {
    const { repo, svc } = setup();
    await svc.getConversation('u1', 'conv-1');
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'conv-1', userId: 'u1' } });
  });

  it('detail：他人/不存在 → null（controller 转 404，不泄露存在性）', async () => {
    const repo = { findOne: jest.fn().mockResolvedValue(null) } as unknown as Repository<AgentConversation>;
    const svc = new AgentConversationQueryService(repo);
    await expect(svc.getConversation('u2', 'conv-u1')).resolves.toBeNull();
  });
});
