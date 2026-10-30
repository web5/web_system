import { UserMemorySummaryService } from './user-memory-summary.service';
import { UserMemorySummaryEntity } from './user-memory-summary.entity';
import { UserMemoryEntity } from './user-memory.entity';
import { AiAgentSummaryClient } from './ai-agent-summary.client';
import { Repository } from 'typeorm';

/**
 * UserMemorySummaryService 单测（#8229 批次1 卡1.2 + 架构修正：LLM 统一走 ai-agent）：
 * - get：返回该用户摘要行或 null
 * - rebuild：从明细全量重算摘要；ai-agent 生成成功用其文本
 * - 兜底：ai-agent 失败/超时/返回空 → 回落确定性模板（不抛、不阻断）
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

  function makeService(
    options?: {
      existing?: Partial<UserMemorySummaryEntity> | null;
      details?: Partial<UserMemoryEntity>[];
      llm?: { resolve?: string; reject?: Error };
    },
  ) {
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
    const aiAgent = {
      summarize: jest.fn().mockImplementation(() => {
        if (options?.llm?.reject) return Promise.reject(options.llm.reject);
        return Promise.resolve(options?.llm?.resolve ?? '');
      }),
    } as unknown as AiAgentSummaryClient;
    const service = new UserMemorySummaryService(repo, memoryRepo, aiAgent);
    return { service, repo, aiAgent };
  }

  it('get：该用户无摘要返回 null；有 userId 才查', async () => {
    const { service, repo } = makeService();
    await expect(service.get('u1')).resolves.toBeNull();
    expect(repo.findOne).toHaveBeenCalledWith({ where: { userId: 'u1', namespace: 'general' } });
    await expect(service.get('')).resolves.toBeNull();
  });

  it('rebuild：ai-agent 生成成功 → 用 LLM 文本落库（版本 1、item_count=明细数）', async () => {
    const details = [
      detail(1, 'fact', '用户叫橙子哥哥'),
      detail(2, 'preference', '偏好简洁的回答风格'),
    ];
    const { service, aiAgent } = makeService({ details, llm: { resolve: '# 用户画像\n- LLM 润色版' } });
    const result = await service.rebuild('u1');
    expect(result.changed).toBe(true);
    expect(result.row!.version).toBe(1);
    expect(result.row!.itemCount).toBe(2);
    expect(result.row!.summary).toContain('LLM 润色版');
    expect(aiAgent.summarize).toHaveBeenCalledWith(
      'u1',
      'general',
      [
        { category: 'fact', content: '用户叫橙子哥哥' },
        { category: 'preference', content: '偏好简洁的回答风格' },
      ],
      2,
    );
  });

  it('rebuild：ai-agent 失败/超时 → 回落模板聚合，不抛不阻断', async () => {
    const details = [
      detail(1, 'fact', '用户叫橙子哥哥，是深圳的独立开发者'),
      detail(2, 'habit', '习惯用中文交流'),
    ];
    const { service } = makeService({ details, llm: { reject: new Error('connect ECONNREFUSED') } });
    const result = await service.rebuild('u1');
    expect(result.changed).toBe(true);
    // #8273 格式契约：纯文本「· 分类：内容」，无 markdown（前端 {{ }} 转义，markdown 不会渲染、只会露出符号）
    expect(result.row!.summary).toContain('· 事实：');
    expect(result.row!.summary).toContain('· 习惯：');
    expect(result.row!.summary).not.toMatch(/(^#\s|^[-*]\s|\*\*)/m);
    expect(result.row!.summary).toContain('橙子哥哥');
    expect(result.row!.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rebuild：ai-agent 返回空字符串 → 回落模板聚合', async () => {
    const details = [detail(1, 'preference', '偏好简洁的回答风格')];
    const { service } = makeService({ details, llm: { resolve: '' } });
    const result = await service.rebuild('u1');
    expect(result.row!.summary).toContain('· 偏好：');
    expect(result.row!.summary).not.toMatch(/(^#\s|^[-*]\s|\*\*)/m);
    expect(result.row!.summary).toContain('偏好简洁的回答风格');
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
