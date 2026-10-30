import { UserMemorySummaryService } from './user-memory-summary.service';
import { UserMemorySummaryEntity } from './user-memory-summary.entity';
import { UserMemoryEntity } from './user-memory.entity';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

/**
 * UserMemorySummaryService 单测（#8229 批次1 卡1.2）：
 * - get：返回该用户摘要行或 null
 * - rebuild：从明细全量重算摘要（无 TokenHub 配置时回落确定性模板）
 * - 幂等：同一 source_hash 重复 rebuild 不产生新版本（version 不变）
 * - 变更明细集后 rebuild：version 递增、item_count 与明细数一致
 * - 摘要长度上限 500 字（超出截断）
 * - 明细为空且从无摘要：不产生空行
 */
describe('UserMemorySummaryService', () => {
  const now = new Date('2026-10-30T10:00:00Z');

  function detail(id: number, category: string, content: string): Partial<UserMemoryEntity> {
    return { id, category, content, contentHash: `hash-${id}`, createdAt: now, updatedAt: now };
  }

  function makeService(options?: { existing?: Partial<UserMemorySummaryEntity> | null; details?: Partial<UserMemoryEntity>[] }) {
    const existing = options?.existing === undefined ? null : options.existing;
    const details = options?.details ?? [];
    const repo = {
      findOne: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
      create: jest.fn((e) => e),
    } as unknown as Repository<UserMemorySummaryEntity>;
    const memoryRepo = {
      find: jest.fn().mockResolvedValue(details),
    } as unknown as Repository<UserMemoryEntity>;
    const configService = {
      get: jest.fn().mockReturnValue(undefined), // 无 TOKENHUB 配置 → 模板兜底路径
    } as unknown as ConfigService;
    const service = new UserMemorySummaryService(repo, memoryRepo, configService);
    return { service, repo, memoryRepo };
  }

  it('get：该用户无摘要返回 null；有 userId 才查', async () => {
    const { service, repo } = makeService();
    await expect(service.get('u1')).resolves.toBeNull();
    expect(repo.findOne).toHaveBeenCalledWith({ where: { userId: 'u1', namespace: 'general' } });
    await expect(service.get('')).resolves.toBeNull();
  });

  it('rebuild：从明细全量重算，首写 version=1，item_count=明细数，摘要非空', async () => {
    const details = [
      detail(1, 'fact', '用户叫橙子哥哥，是深圳的独立开发者'),
      detail(2, 'preference', '偏好简洁的回答风格'),
      detail(3, 'habit', '习惯用中文交流'),
    ];
    const { service, repo } = makeService({ details });
    const result = await service.rebuild('u1');
    expect(result.changed).toBe(true);
    expect(result.row).not.toBeNull();
    expect(result.row!.version).toBe(1);
    expect(result.row!.itemCount).toBe(3);
    expect(result.row!.summary).toContain('# 用户画像');
    expect(result.row!.summary).toContain('橙子哥哥');
    expect(result.row!.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.create).toHaveBeenCalled();
  });

  it('rebuild：同一 source_hash 重复 rebuild 不产生新版本（version 不递增）', async () => {
    const details = [detail(1, 'fact', '用户叫橙子哥哥')];
    // 第一次 rebuild 拿到该明细集的指纹
    const first = await makeService({ details }).service.rebuild('u1');
    const hash = first.row!.sourceHash;
    // 以「已保存该指纹的行」重放 rebuild → 必须走幂等分支
    const second = await makeService({
      details,
      existing: { userId: 'u1', namespace: 'general', summary: '# 用户画像', version: 3, itemCount: 1, sourceHash: hash } as Partial<UserMemorySummaryEntity>,
    }).service.rebuild('u1');
    expect(second.changed).toBe(false);
    expect(second.skipped).toBe(true);
    expect(second.row!.version).toBe(3);
  });

  it('rebuild：明细集变化后 version 递增', async () => {
    const details = [detail(1, 'fact', '用户叫橙子哥哥')];
    const first = await makeService({ details }).service.rebuild('u1');
    const hash1 = first.row!.sourceHash;
    // 新增一条明细 → 指纹变化
    const details2 = [...details, detail(2, 'habit', '习惯用中文交流')];
    const second = await makeService({
      details: details2,
      existing: { userId: 'u1', namespace: 'general', summary: '# 用户画像', version: 1, itemCount: 1, sourceHash: hash1 } as Partial<UserMemorySummaryEntity>,
    }).service.rebuild('u1');
    expect(second.changed).toBe(true);
    expect(second.row!.version).toBe(2);
    expect(second.row!.itemCount).toBe(2);
  });

  it('rebuild：无明细且从无摘要行时不产生空行', async () => {
    const { service } = makeService({ details: [], existing: null });
    const result = await service.rebuild('u1');
    expect(result.changed).toBe(false);
    expect(result.row).toBeNull();
  });

  it('upsert：摘要超 500 字被截断并保留「…」（验收判据 6）', async () => {
    const longSummary = '长'.repeat(600);
    const { service } = makeService();
    const { row } = await service.upsert({
      userId: 'u1',
      summary: longSummary,
      itemCount: 1,
      sourceHash: 'h',
      lastItemAt: null,
    });
    expect([...row.summary].length).toBe(500);
    expect(row.summary.endsWith('…')).toBe(true);
  });
});
