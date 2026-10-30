import { UserMemoryService } from './user-memory.service';
import { UserMemoryEntity } from './user-memory.entity';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';

/**
 * UserMemoryService.update 单测（#8229 跟进：C 端用户可自己改记忆）：
 * - 归属隔离：findOne 按 (id, userId) 查，他人条目查不到 → not_found
 * - 编辑成功：content 更新、contentHash 按归一化口径重算
 * - 撞内容（同 user+category 改成既有内容）→ conflict，不落库
 */
describe('UserMemoryService.update', () => {
  function hashOf(content: string): string {
    const normalized = content.trim().toLowerCase().replace(/\s+/g, ' ');
    return createHash('sha256').update(normalized).digest('hex').slice(0, 64);
  }

  function makeService(row: Partial<UserMemoryEntity> | null, clash: Partial<UserMemoryEntity> | null = null) {
    const repo = {
      findOne: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        // 第一次调用：按 (id, userId) 查本人条目；第二次：查同 (user, category, hash) 撞车
        if ('contentHash' in where && 'category' in where) return Promise.resolve(clash);
        return Promise.resolve(row);
      }),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
    } as unknown as Repository<UserMemoryEntity>;
    const service = new UserMemoryService(repo);
    return { service, repo };
  }

  const row = {
    id: 5,
    userId: 'u1',
    category: 'fact',
    content: '旧内容',
    contentHash: hashOf('旧内容'),
    confidence: 0.9,
    createdAt: new Date('2026-10-30T10:00:00Z'),
  };

  it('归属隔离：查询条件带 userId，他人/不存在 → not_found', async () => {
    const { service, repo } = makeService(null);
    const result = await service.update('u1', 5, '新内容');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(repo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5, userId: 'u1' } }));
  });

  it('编辑成功：content 更新、contentHash 按归一化口径重算（trim+小写+压缩空白）', async () => {
    const { service, repo } = makeService({ ...row });
    const result = await service.update('u1', 5, '  新内容  ');
    expect(result.ok).toBe(true);
    expect(result.row!.content).toBe('新内容');
    const saved = (repo.save as jest.Mock).mock.calls[0][0] as UserMemoryEntity;
    expect(saved.content).toBe('新内容');
    expect(saved.contentHash).toBe(hashOf('新内容'));
  });

  it('撞内容：同分类下已存在相同归一化内容（不同 id）→ conflict，不落库', async () => {
    const clash = { ...row, id: 9, content: '新内容', contentHash: hashOf('新内容') };
    const { service, repo } = makeService({ ...row }, clash);
    const result = await service.update('u1', 5, '新内容');
    expect(result).toEqual({ ok: false, reason: 'conflict' });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('内容未变（hash 相同）不触发撞车检查，直接保存', async () => {
    const clash = { ...row, id: 9 };
    const { service, repo } = makeService({ ...row }, clash);
    const result = await service.update('u1', 5, '旧内容');
    expect(result.ok).toBe(true);
    expect(repo.save).toHaveBeenCalled();
  });
});
