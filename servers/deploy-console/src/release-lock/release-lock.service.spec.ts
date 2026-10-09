import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeployReleaseLockEntity } from '../entities/deploy-release-lock.entity';
import {
  ReleaseLockService,
  canAcquire,
  buildLockKey,
  DEFAULT_LOCK_TTL_MS,
} from './release-lock.service';

describe('canAcquire（发布锁判定，纯函数）', () => {
  const now = 1_000_000;

  it('无锁时可获取', () => {
    expect(canAcquire(null, 'p1', now)).toBe(true);
  });

  it('自己持有时可重入', () => {
    expect(canAcquire({ pipelineId: 'p1', expiresAt: now - 1 }, 'p1', now)).toBe(true);
  });

  it('他人持有且未过期时拒绝', () => {
    expect(canAcquire({ pipelineId: 'p2', expiresAt: now + 5000 }, 'p1', now)).toBe(false);
  });

  it('他人持有但已过期时可抢占（持有者多半已被强杀）', () => {
    expect(canAcquire({ pipelineId: 'p2', expiresAt: now - 1 }, 'p1', now)).toBe(true);
  });

  it('恰好在过期时刻可获取（边界）', () => {
    expect(canAcquire({ pipelineId: 'p2', expiresAt: now }, 'p1', now)).toBe(true);
  });
});

describe('buildLockKey', () => {
  it('格式为 moduleKey@env', () => {
    expect(buildLockKey('auth-service', 'dev')).toBe('auth-service@dev');
  });
});

describe('ReleaseLockService.acquire（原子互斥 CAS）', () => {
  let service: ReleaseLockService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      query: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ReleaseLockService,
        { provide: getRepositoryToken(DeployReleaseLockEntity), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(ReleaseLockService);
  });

  const holder = (pipelineId: string, expiresAt: number) => ({
    lockKey: 'auth-service@dev',
    pipelineId,
    acquiredAt: 0,
    expiresAt,
  });

  it('无锁：执行原子抢占并确认自己是持有者', async () => {
    repo.findOne
      .mockResolvedValueOnce(null) // 预检：无锁
      .mockResolvedValueOnce(holder('p1', Date.now() + DEFAULT_LOCK_TTL_MS)); // 确认：自己
    await expect(service.acquire('auth-service', 'dev', 'p1')).resolves.toBe(true);

    // CAS 语句必须走 ON DUPLICATE + IF 条件（不带条件会覆盖他人锁 → 非互斥）
    expect(repo.query).toHaveBeenCalledTimes(1);
    const [sql, params] = repo.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO deploy_release_locks');
    expect(sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(sql).toContain('IF(');
    expect(params).toContain('auth-service@dev');
    expect(params).toContain('p1');
  });

  it('他人持有未过期：直接拒绝，不执行 CAS', async () => {
    repo.findOne.mockResolvedValueOnce(holder('p2', Date.now() + 60_000));
    await expect(service.acquire('auth-service', 'dev', 'p1')).resolves.toBe(false);
    expect(repo.query).not.toHaveBeenCalled();
  });

  it('锁已过期：可抢占并成为持有者', async () => {
    repo.findOne
      .mockResolvedValueOnce(holder('p2', Date.now() - 1)) // 预检：过期可抢
      .mockResolvedValueOnce(holder('p1', Date.now() + DEFAULT_LOCK_TTL_MS)); // 确认：自己
    await expect(service.acquire('auth-service', 'dev', 'p1')).resolves.toBe(true);
  });

  it('并发竞争落败（他人持锁，后到者 CAS 未生效）：确认后仍返回 false', async () => {
    repo.findOne
      .mockResolvedValueOnce(null) // 预检：无锁（竞态窗口）
      .mockResolvedValueOnce(holder('p2', Date.now() + 60_000)); // 确认：CAS 后锁被先到者持有
    await expect(service.acquire('auth-service', 'dev', 'p1')).resolves.toBe(false);
    // CAS 已尽力执行（无抛错），但最终持有者是别人 → false
    expect(repo.query).toHaveBeenCalledTimes(1);
  });

  it('预检查询异常：仍尝试 CAS；确认异常则安全失败', async () => {
    repo.findOne
      .mockRejectedValueOnce(new Error('db down')) // 预检异常
      .mockRejectedValueOnce(new Error('db down')); // 确认异常
    await expect(service.acquire('auth-service', 'dev', 'p1')).resolves.toBe(false);
    expect(repo.query).toHaveBeenCalledTimes(1);
  });

  it('CAS 写失败：返回 false（不误判抢到锁）', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    repo.query.mockRejectedValue(new Error('Duplicate entry'));
    await expect(service.acquire('auth-service', 'dev', 'p1')).resolves.toBe(false);
  });

  it('释放只删自己持有的锁', async () => {
    await service.release('auth-service', 'dev', 'p1');
    expect(repo.delete).toHaveBeenCalledWith({ lockKey: 'auth-service@dev', pipelineId: 'p1' });
  });

  it('释放异常不抛出（依赖 TTL 兜底）', async () => {
    repo.delete.mockRejectedValue(new Error('db down'));
    await expect(service.release('auth-service', 'dev', 'p1')).resolves.toBeUndefined();
  });

  // ── 诊断 #6/#12：newly 语义、强制解锁、过期清理 ──

  it('#6：首次获取 → newly=true（调用方需负责释放）', async () => {
    repo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(holder('p1', Date.now() + 60_000));
    const r = await service.acquireEx('auth-service', 'dev', 'p1');
    expect(r).toMatchObject({ ok: true, newly: true });
  });

  it('#6：自己已持有（重入）→ newly=false（禁止内层把外层的锁释放掉）', async () => {
    repo.findOne
      .mockResolvedValueOnce(holder('p1', Date.now() + 60_000))
      .mockResolvedValueOnce(holder('p1', Date.now() + 60_000));
    const r = await service.acquireEx('auth-service', 'dev', 'p1');
    expect(r).toMatchObject({ ok: true, newly: false });
  });

  it('#6：抢占他人过期锁 → newly=true', async () => {
    repo.findOne
      .mockResolvedValueOnce(holder('p2', Date.now() - 1))
      .mockResolvedValueOnce(holder('p1', Date.now() + 60_000));
    const r = await service.acquireEx('auth-service', 'dev', 'p1');
    expect(r).toMatchObject({ ok: true, newly: true });
  });

  it('#6：被他人持有 → ok=false 且带回持有者（供报错文案）', async () => {
    const at = Date.now() + 60_000;
    repo.findOne.mockResolvedValueOnce(holder('p2', at));
    const r = await service.acquireEx('auth-service', 'dev', 'p1');
    expect(r).toMatchObject({ ok: false, newly: false, holder: 'p2', expiresAt: at });
  });

  it('#6 回归：bigint 列被读成字符串时，expiresAt 要转成数字', async () => {
    repo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(holder('p1', '1791522115000' as never));
    const r = await service.acquireEx('auth-service', 'dev', 'p1');
    expect(typeof r.expiresAt).toBe('number');
    expect(r.expiresAt).toBe(1_791_522_115_000);
  });

  it('#12：forceRelease 无条件删除（人工应急）', async () => {
    repo.delete.mockResolvedValue({ affected: 1 });
    await expect(service.forceRelease('auth-service', 'dev')).resolves.toBe(true);
    expect(repo.delete).toHaveBeenCalledWith({ lockKey: 'auth-service@dev' });
  });

  it('#12：forceRelease 无锁可解 → false', async () => {
    repo.delete.mockResolvedValue({ affected: 0 });
    await expect(service.forceRelease('auth-service', 'dev')).resolves.toBe(false);
  });

  it('#12：releaseExpired 只清理到期锁，未过期的保留', async () => {
    const now = Date.now();
    repo.find.mockResolvedValue([
      holder('p-old', now - 1_000), // 过期
      holder('p-live', now + 60_000), // 仍在跑：绝不能清
    ]);
    const n = await service.releaseExpired(now);
    expect(n).toBe(1);
    expect(repo.delete).toHaveBeenCalledWith(['auth-service@dev']);
  });

  it('#12：listAll 返回持有者与是否过期', async () => {
    const now = Date.now();
    repo.find.mockResolvedValue([holder('p1', now - 1)]);
    const rows = await service.listAll(now);
    expect(rows[0]).toMatchObject({ lockKey: 'auth-service@dev', pipelineId: 'p1', expired: true });
  });
});
