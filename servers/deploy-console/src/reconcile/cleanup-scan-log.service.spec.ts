import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeployCleanupScanEntity } from '../entities/deploy-cleanup-scan.entity';
import { CleanupScanLogService, MAX_ITEMS, newScanId } from './cleanup-scan-log.service';
import { RetentionReport } from './retention.service';

function report(patch: Partial<RetentionReport> = {}): RetentionReport {
  return {
    ranAt: 1_700_000_000_000,
    enabled: false,
    keepDays: 90,
    status: 'dry-run',
    reason: '只观测',
    tables: [
      { table: 'deploy_tasks', candidates: 12, deleted: 0, protectedRows: 3, cutoff: '2026-07-01T00:00:00.000Z' },
      { table: 'audit_logs', candidates: 5, deleted: 0, protectedRows: 0, cutoff: '2026-07-01T00:00:00.000Z' },
    ],
    ...patch,
  };
}

describe('CleanupScanLogService', () => {
  let svc: CleanupScanLogService;
  let saved: DeployCleanupScanEntity | undefined;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
  };

  beforeEach(async () => {
    saved = undefined;
    repo = {
      create: jest.fn((e: Partial<DeployCleanupScanEntity>) => e as DeployCleanupScanEntity),
      save: jest.fn(async (e: DeployCleanupScanEntity) => {
        saved = e;
        return e;
      }),
      createQueryBuilder: jest.fn(() => {
        const qb: Record<string, jest.Mock> = {
          orderBy: jest.fn(() => qb),
          limit: jest.fn(() => qb),
          andWhere: jest.fn(() => qb),
          getMany: jest.fn(async () => [] as DeployCleanupScanEntity[]),
        };
        return qb;
      }),
      findOne: jest.fn(async () => null),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CleanupScanLogService,
        { provide: getRepositoryToken(DeployCleanupScanEntity), useValue: repo },
      ],
    }).compile();
    svc = mod.get(CleanupScanLogService);
  });

  it('record：汇总出候选数/删除数，并生成 scan- 前缀 ID', async () => {
    await svc.record({
      kind: 'retention',
      status: 'dry-run',
      dryRun: true,
      summary: [
        { key: 'deploy_tasks', candidates: 12, deleted: 0 },
        { key: 'audit_logs', candidates: 5, deleted: 2 },
      ],
      operator: 'alice',
    });
    expect(saved!.id.startsWith('scan-')).toBe(true);
    expect(saved!.candidateCount).toBe(17);
    expect(saved!.deletedCount).toBe(2);
    expect(saved!.operator).toBe('alice');
    expect(newScanId(123)).toMatch(/^scan-123-/);
  });

  it('record：候选清单超上限要截断并留标记（不许假装完整）', async () => {
    const items = Array.from({ length: MAX_ITEMS + 50 }, (_, i) => `portal:v${i}`);
    await svc.record({ kind: 'remote', status: 'dry-run', dryRun: true, items, env: 'prod' });
    expect(saved!.items!.length).toBe(MAX_ITEMS + 1);
    expect(saved!.items!.at(-1)).toContain('未列出');
  });

  it('record：写库失败只告警不抛（留痕不能拖死巡检）', async () => {
    repo.save.mockRejectedValueOnce(new Error('表不存在'));
    const out = await svc.record({ kind: 'remote', status: 'dry-run', dryRun: true });
    expect(out).toBeTruthy();
    expect(out.kind).toBe('remote');
  });

  it('recordRetention：按表展开汇总，dry-run 语义正确', async () => {
    await svc.recordRetention(report(), 'bob');
    expect(saved!.kind).toBe('retention');
    expect(saved!.status).toBe('dry-run');
    expect(saved!.dryRun).toBe(true);
    expect(saved!.summary!.map((s) => s.key)).toEqual(['deploy_tasks', 'audit_logs']);
    expect(saved!.scanTime).toBe(1_700_000_000_000);
    expect(saved!.summary![0].protectedRows).toBe(3);
  });

  it('recordRetention：真删过就不是 dry-run', async () => {
    await svc.recordRetention(report({ status: 'deleted', tables: [
      { table: 'deploy_tasks', candidates: 12, deleted: 12, protectedRows: 0, cutoff: 'c' },
    ] }));
    expect(saved!.dryRun).toBe(false);
    expect(saved!.deletedCount).toBe(12);
  });

  it('recordRemote：候选带模块前缀，且未扫描到条目时记 skipped', async () => {
    await svc.recordRemote('prod', [
      { moduleKey: 'portal', scanned: 8, keep: ['a', 'b'], remove: ['c', 'd'] },
      { moduleKey: 'admin', scanned: 0, keep: [], remove: [], reason: '远端目录不存在' },
    ]);
    expect(saved!.kind).toBe('remote');
    expect(saved!.env).toBe('prod');
    expect(saved!.items).toEqual(['portal:c', 'portal:d']);
    expect(saved!.candidateCount).toBe(2);
    expect(saved!.status).toBe('skipped');
    expect(saved!.reason).toContain('远端目录不存在');
  });

  it('list：限制上限 500，且按 kind/env 过滤', async () => {
    await svc.list({ kind: 'remote', env: 'prod', limit: 9999 });
    const qb = repo.createQueryBuilder.mock.results[0].value;
    expect(qb.limit).toHaveBeenCalledWith(500);
    expect(qb.andWhere).toHaveBeenCalledWith('s.kind = :kind', { kind: 'remote' });
    expect(qb.andWhere).toHaveBeenCalledWith('s.env = :env', { env: 'prod' });
  });

  it('list：读失败返回空数组而不是 500', async () => {
    repo.createQueryBuilder.mockImplementationOnce(() => {
      const qb: Record<string, jest.Mock> = {
        orderBy: jest.fn(() => qb),
        limit: jest.fn(() => qb),
        andWhere: jest.fn(() => qb),
        getMany: jest.fn(async () => {
          throw new Error('no such table');
        }),
      };
      return qb;
    });
    await expect(svc.list({})).resolves.toEqual([]);
  });
});
