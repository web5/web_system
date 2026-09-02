import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployReleaseLockEntity } from '../entities/deploy-release-lock.entity';

export interface LockState {
  pipelineId: string;
  expiresAt: number;
}

/** 默认锁 TTL：30 分钟（足够跑完一次发布，又不至于死锁太久） */
export const DEFAULT_LOCK_TTL_MS = 30 * 60 * 1000;

/**
 * 判断锁能否被 `pipelineId` 获取（纯函数，便于单测）。
 *
 * - 无锁 → 可获取
 * - 自己持有 → 可重入（重跑同一条流水线时不应把自己锁死）
 * - 他人持有且**未过期** → 不可获取（拒绝并发发布）
 * - 他人持有但**已过期** → 可抢占（持有者多半已被强杀）
 */
export function canAcquire(
  current: LockState | null | undefined,
  pipelineId: string,
  now: number,
): boolean {
  if (!current) return true;
  if (current.pipelineId === pipelineId) return true;
  return current.expiresAt <= now;
}

export function buildLockKey(moduleKey: string, env: string): string {
  return `${moduleKey}@${env}`;
}

/**
 * 发布锁服务：以「模块 × 环境」串行化发布，避免并发覆盖版本指针。
 */
@Injectable()
export class ReleaseLockService {
  private readonly logger = new Logger(ReleaseLockService.name);

  constructor(
    @InjectRepository(DeployReleaseLockEntity)
    private readonly repo: Repository<DeployReleaseLockEntity>,
  ) {}

  /** 尝试获取锁；被他人持有且未过期时返回 false */
  async acquire(
    moduleKey: string,
    env: string,
    pipelineId: string,
    ttlMs: number = DEFAULT_LOCK_TTL_MS,
  ): Promise<boolean> {
    const lockKey = buildLockKey(moduleKey, env);
    const now = Date.now();

    let current: LockState | null = null;
    try {
      current = await this.repo.findOne({ where: { lockKey } });
    } catch (e) {
      // 查锁失败不阻断发布：拿不到锁最多是并发保护失效，不该让发布起不来
      this.logger.warn(`查询发布锁失败，按无锁处理: ${(e as Error).message}`);
    }

    if (!canAcquire(current, pipelineId, now)) {
      this.logger.warn(
        `发布被拒绝：${lockKey} 已被流水线 ${current?.pipelineId} 持有（至 ${new Date(
          current?.expiresAt ?? now,
        ).toISOString()}）`,
      );
      return false;
    }

    try {
      await this.repo.upsert(
        { lockKey, pipelineId, acquiredAt: now, expiresAt: now + ttlMs },
        { conflictPaths: ['lockKey'] },
      );
      return true;
    } catch (e) {
      // 并发插入撞唯一键 → 视为未抢到
      this.logger.warn(`获取发布锁失败（可能并发抢占）: ${(e as Error).message}`);
      return false;
    }
  }

  /** 释放锁；只释放自己持有的，避免误删他人（抢占后）的锁 */
  async release(moduleKey: string, env: string, pipelineId: string): Promise<void> {
    try {
      await this.repo.delete({ lockKey: buildLockKey(moduleKey, env), pipelineId });
    } catch (e) {
      this.logger.warn(`释放发布锁失败（将依赖 TTL 过期）: ${(e as Error).message}`);
    }
  }

  /** 查看当前锁持有者（供前端提示"谁在发布"） */
  async holder(moduleKey: string, env: string): Promise<LockState | null> {
    try {
      const row = await this.repo.findOne({ where: { lockKey: buildLockKey(moduleKey, env) } });
      if (!row) return null;
      return { pipelineId: row.pipelineId, expiresAt: row.expiresAt };
    } catch {
      return null;
    }
  }
}
