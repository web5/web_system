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

describe('ReleaseLockService', () => {
  let service: ReleaseLockService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
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

  it('无锁时获取成功并写入', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.acquire('auth-service', 'dev', 'p1')).resolves.toBe(true);
    expect(repo.upsert).toHaveBeenCalledTimes(1);

    const [entity] = repo.upsert.mock.calls[0];
    expect(entity.lockKey).toBe('auth-service@dev');
    expect(entity.pipelineId).toBe('p1');
    expect(entity.expiresAt - entity.acquiredAt).toBe(DEFAULT_LOCK_TTL_MS);
  });

  it('他人持有未过期时获取失败，且不写库', async () => {
    repo.findOne.mockResolvedValue({
      lockKey: 'auth-service@dev',
      pipelineId: 'p2',
      acquiredAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    await expect(service.acquire('auth-service', 'dev', 'p1')).resolves.toBe(false);
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('锁已过期时可抢占', async () => {
    repo.findOne.mockResolvedValue({
      lockKey: 'auth-service@dev',
      pipelineId: 'p2',
      acquiredAt: 0,
      expiresAt: Date.now() - 1,
    });
    await expect(service.acquire('auth-service', 'dev', 'p1')).resolves.toBe(true);
  });

  it('查锁异常时按无锁处理（不阻断发布）', async () => {
    repo.findOne.mockRejectedValue(new Error('db down'));
    await expect(service.acquire('auth-service', 'dev', 'p1')).resolves.toBe(true);
  });

  it('写入撞唯一键时视为未抢到', async () => {
    repo.findOne.mockResolvedValue(null);
    repo.upsert.mockRejectedValue(new Error('Duplicate entry'));
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
});
