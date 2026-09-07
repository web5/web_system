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

  it('list：固定 userId 过滤 + updatedAt 倒序 + 轻量列 select + 分页', async () => {
    const { repo, svc } = setup();
    await svc.listConversations('u1', 2, 10);
    expect(repo.findAndCount).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      order: { updatedAt: 'DESC' },
      select: ['id', 'title', 'meta', 'createdAt', 'updatedAt'],
      skip: 10,
      take: 10,
    });
  });

  it('list：返回 {list, total}', async () => {
    const { svc } = setup();
    const result = await svc.listConversations('u1', 1, 20);
    expect(result).toEqual({ list: [{ id: 'c1' }], total: 1 });
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
