import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DeployCleanupScanEntity } from '../entities/deploy-cleanup-scan.entity';
import { RemoteArtifactCleanupService } from '../remote/remote-artifact-cleanup.service';
import { RetentionService } from './retention.service';
import { CleanupScanLogService } from './cleanup-scan-log.service';
import { CleanupScanService } from './cleanup-scan.service';

/** 8 个版本目录，全部远老于 24h（保证不受 minAge 保护） */
function entries(names: string[]) {
  const now = Date.now();
  return names.map((name, i) => ({ name, mtime: now - (30 - i) * 24 * 3600 * 1000 }));
}

describe('CleanupScanService', () => {
  let svc: CleanupScanService;
  let remote: { scan: jest.Mock; cleanup: jest.Mock };
  let scanLog: { recordRetention: jest.Mock; recordRemote: jest.Mock; list: jest.Mock; one: jest.Mock };
  let repo: { create: jest.Mock; save: jest.Mock };
  let local: { query: jest.Mock };

  beforeEach(async () => {
    remote = { scan: jest.fn(), cleanup: jest.fn() };
    scanLog = {
      recordRetention: jest.fn(async (_r: unknown, op?: string) => ({ id: 'scan-1', operator: op })),
      recordRemote: jest.fn(async (_env: string, _o: unknown, op?: string) => ({ id: 'scan-2', operator: op })),
      list: jest.fn(async () => []),
      one: jest.fn(async () => null),
    };
    repo = {
      create: jest.fn((e: Partial<DeployCleanupScanEntity>) => e),
      save: jest.fn(async (e: DeployCleanupScanEntity) => e),
    };
    local = { query: jest.fn(async () => [{ app_key: 'portal' }, { app_key: 'admin' }]) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CleanupScanService,
        {
          provide: RetentionService,
          useValue: {
            run: jest.fn(async () => ({ ranAt: 1, status: 'dry-run', tables: [] })),
            protectedVersionKeys: jest.fn(async () => [
              { env: 'prod', component: 'portal', version: 'aaaaaaa' },
              { env: 'prod', component: 'portal', version: 'bbbbbbb' },
            ]),
          },
        },
        { provide: RemoteArtifactCleanupService, useValue: remote },
        { provide: CleanupScanLogService, useValue: scanLog },
        { provide: DataSource, useValue: local },
        { provide: getRepositoryToken(DeployCleanupScanEntity), useValue: repo },
      ],
    }).compile();
    svc = mod.get(CleanupScanService);
  });

  it('runRetention：跑一次并把结论落库（操作人透传）', async () => {
    await svc.runRetention('alice');
    expect(scanLog.recordRetention).toHaveBeenCalled();
    expect(scanLog.recordRetention.mock.calls[0][1]).toBe('alice');
  });

  it('runRemote：受保护版本绝不进候选清单（指针版本被删 = 白屏）', async () => {
    remote.scan.mockResolvedValueOnce(entries(['v1', 'v2', 'v3', 'v4', 'v5', 'aaaaaaa', 'v7', 'v8']));
    const r = await svc.runRemote('prod', 'portal');
    const remove = r.outcomes[0].remove;
    expect(remove).not.toContain('aaaaaaa');
    expect(remove.length).toBeGreaterThan(0);
    expect(remote.cleanup).not.toHaveBeenCalled(); // 硬约束：观测入口绝不删
  });

  it('runRemote：未扫描到条目要显式 skipped（不许假装 0 候选一切正常）', async () => {
    remote.scan.mockResolvedValueOnce([]);
    const r = await svc.runRemote('prod', 'portal');
    expect(r.outcomes[0].reason).toContain('未扫描到条目');
    expect(r.outcomes[0].scanned).toBe(0);
  });

  it('runRemote：不指定模块时从指针表发现模块', async () => {
    remote.scan.mockResolvedValue(entries(['v1', 'v2']));
    const r = await svc.runRemote('prod', undefined);
    expect(local.query).toHaveBeenCalled();
    expect(r.outcomes.map((o) => o.moduleKey)).toEqual(['portal', 'admin']);
  });

  it('runRemote：候选带模块前缀，且落库时传入 outcomes', async () => {
    remote.scan.mockResolvedValueOnce(entries(['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8']));
    await svc.runRemote('prod', 'portal', 'bob');
    const [, outcomes, operator] = scanLog.recordRemote.mock.calls[0];
    expect(outcomes[0].remove.length).toBe(3); // 保留 5 个 → 删 3 个
    expect(operator).toBe('bob');
  });

  it('list/one 委托给留痕服务', async () => {
    await svc.list({ kind: 'remote' });
    await svc.one('scan-1');
    expect(scanLog.list).toHaveBeenCalledWith({ kind: 'remote' });
    expect(scanLog.one).toHaveBeenCalledWith('scan-1');
  });
});
