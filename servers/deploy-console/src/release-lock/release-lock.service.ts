import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployReleaseLockEntity } from '../entities/deploy-release-lock.entity';

export interface LockState {
  pipelineId: string;
  expiresAt: number;
}

/**
 * 获取锁的结果。**`newly` 是能不能释放的依据**（诊断 #6 引入）。
 *
 * 锁下沉到「指针写入」层后，流水线自己已经持锁、写入层会**重入**同一个 owner。
 * 若释放时不区分，写入层写完就把整条流水线还在用的锁删了 —— 后面「改 dist / 探活 /
 * 验证」全裸奔。所以：只有本次新拿到的锁才负责释放。
 */
export interface AcquireResult {
  /** 是否持有锁 */
  ok: boolean;
  /** 本次是否新拿到（false = 重入已有锁，调用方**不要**释放） */
  newly: boolean;
  /** 未抢到时的当前持有者 */
  holder?: string;
  expiresAt?: number;
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
   *
   * 需要区分「重入 vs 新拿」时用 `acquireEx`（诊断 #6）。
   */
  async acquire(
    moduleKey: string,
    env: string,
    pipelineId: string,
    ttlMs: number = DEFAULT_LOCK_TTL_MS,
  ): Promise<boolean> {
    return (await this.acquireEx(moduleKey, env, pipelineId, ttlMs)).ok;
  }

  /**
   * `acquire` 的详细版：额外回报**本次是否新拿到锁**。
   *
   * 语义：
   * - 原本无锁 → `newly=true`
   * - 他人持有但已过期（被自己抢占）→ `newly=true`
   * - 自己已持有（重入）→ `newly=false`（锁属于外层调用方，内层**不得**释放）
   */
  async acquireEx(
    moduleKey: string,
    env: string,
    pipelineId: string,
    ttlMs: number = DEFAULT_LOCK_TTL_MS,
  ): Promise<AcquireResult> {
    const lockKey = buildLockKey(moduleKey, env);
    const now = Date.now();

    // 预检（非互斥）：他人持有且未过期时直接拒绝，避免无谓的 CAS 写
    let newly = true;
    try {
      const current = await this.repo.findOne({ where: { lockKey } });
      if (current && !canAcquire(current, pipelineId, now)) {
        this.logger.warn(
          `发布被拒绝：${lockKey} 已被流水线 ${current.pipelineId} 持有（至 ${new Date(
            current.expiresAt,
          ).toISOString()}）`,
        );
        return { ok: false, newly: false, holder: current.pipelineId, expiresAt: current.expiresAt };
      }
      // 无锁 → 新拿；自己持有 → 重入；他人锁已过期 → 抢占（算新拿）
      newly = !current || current.pipelineId !== pipelineId;
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
      return { ok: false, newly: false };
    }

    // 校验最终持有者是否是自己：并发下后到者的 ON DUPLICATE 不满足 IF 条件，锁仍归先到者
    try {
      const row = await this.repo.findOne({ where: { lockKey } });
      const ok = row?.pipelineId === pipelineId;
      return {
        ok,
        newly: ok ? newly : false,
        holder: row?.pipelineId,
        expiresAt: row?.expiresAt,
      };
    } catch (e) {
      this.logger.warn(`确认发布锁持有者失败，视为未抢到: ${(e as Error).message}`);
      return { ok: false, newly: false };
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

  /**
   * **强制解锁**（人工应急，诊断 #12）：无条件删除该「模块 × 环境」的锁。
   *
   * 只在确认发布进程确实没了时使用（典型：发布途中 console 被重启，
   * 锁要等 TTL 30 分钟自然过期，该模块这段时间谁也发不了）。
   */
  async forceRelease(moduleKey: string, env: string): Promise<boolean> {
    const lockKey = buildLockKey(moduleKey, env);
    try {
      const r = await this.repo.delete({ lockKey });
      const n = r.affected ?? 0;
      if (n > 0) this.logger.warn(`强制解锁：${lockKey}（人工操作）`);
      return n > 0;
    } catch (e) {
      this.logger.warn(`强制解锁失败: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * 清理已过期的锁（启动对账用，诊断 #12）。
   *
   * 不清理的话，TTL 期间重启 console 后这些僵尸锁仍会挡住发布——
   * 虽然 `acquire` 允许抢占过期锁，但列表页会一直显示「有人在发布」，误导运维。
   */
  async releaseExpired(now: number = Date.now()): Promise<number> {
    try {
      const rows = await this.repo.find();
      const stale = rows.filter((r) => Number(r.expiresAt) <= now);
      if (!stale.length) return 0;
      await this.repo.delete(stale.map((r) => r.lockKey));
      this.logger.log(`启动对账：清理过期发布锁 ${stale.length} 条`);
      return stale.length;
    } catch (e) {
      this.logger.warn(`清理过期发布锁失败: ${(e as Error).message}`);
      return 0;
    }
  }

  /** 列出当前所有锁（运维视角：谁在发什么；含是否已过期） */
  async listAll(now: number = Date.now()): Promise<(LockState & { lockKey: string; expired: boolean })[]> {
    try {
      const rows = await this.repo.find();
      return rows.map((r) => ({
        lockKey: r.lockKey,
        pipelineId: r.pipelineId,
        expiresAt: Number(r.expiresAt),
        expired: Number(r.expiresAt) <= now,
      }));
    } catch {
      return [];
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
