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

  /**
   * 尝试获取锁（**原子互斥**）；被他人持有且未过期时返回 false。
   *
   * 历史缺陷：旧的「findOne → 判断 → upsert」三步在并发下有竞态——
   * 两条发布同时读到"无锁"，都 upsert 成功（ON DUPLICATE 后写覆盖），双双返回 true，
   * 同一「模块 × 环境」会并行发布、互相覆盖版本指针。
   *
   * 修复：改单条 `INSERT ... ON DUPLICATE KEY UPDATE`（带 IF 条件）做原子抢占，
   * 后到者若「不是自己持有且锁未过期」则不覆盖行；随后读回校验最终持有者是否是自己。
   * 单条语句决定了 winner，无需 find+insert 间隙，跨实例同样互斥。
   */
  async acquire(
    moduleKey: string,
    env: string,
    pipelineId: string,
    ttlMs: number = DEFAULT_LOCK_TTL_MS,
  ): Promise<boolean> {
    const lockKey = buildLockKey(moduleKey, env);
    const now = Date.now();

    // 预检（非互斥）：他人持有且未过期时直接拒绝，避免无谓的 CAS 写
    try {
      const current = await this.repo.findOne({ where: { lockKey } });
      if (!canAcquire(current, pipelineId, now)) {
        this.logger.warn(
          `发布被拒绝：${lockKey} 已被流水线 ${current?.pipelineId} 持有（至 ${new Date(
            current?.expiresAt ?? now,
          ).toISOString()}）`,
        );
        return false;
      }
    } catch (e) {
      // 查锁失败不阻断发布：继续尝试原子抢占（CAS 成功与否才是最终结论）
      this.logger.warn(`查询发布锁失败，尝试原子抢占: ${(e as Error).message}`);
    }

    try {
      await this.repo.query(
        `INSERT INTO deploy_release_locks (lock_key, pipeline_id, acquired_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           pipeline_id = IF(pipeline_id = VALUES(pipeline_id) OR expires_at <= VALUES(acquired_at), VALUES(pipeline_id), pipeline_id),
           expires_at  = IF(pipeline_id = VALUES(pipeline_id) OR expires_at <= VALUES(acquired_at), VALUES(expires_at), expires_at),
           acquired_at = IF(pipeline_id = VALUES(pipeline_id) OR expires_at <= VALUES(acquired_at), VALUES(acquired_at), acquired_at)`,
        [lockKey, pipelineId, now, now + ttlMs],
      );
    } catch (e) {
      this.logger.warn(`获取发布锁失败（可能并发抢占）: ${(e as Error).message}`);
      return false;
    }

    // 校验最终持有者是否是自己：并发下后到者的 ON DUPLICATE 不满足 IF 条件，锁仍归先到者
    try {
      const row = await this.repo.findOne({ where: { lockKey } });
      return row?.pipelineId === pipelineId;
    } catch (e) {
      this.logger.warn(`确认发布锁持有者失败，视为未抢到: ${(e as Error).message}`);
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
