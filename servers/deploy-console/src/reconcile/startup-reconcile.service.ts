import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployTaskEntity } from '../entities/deploy-task.entity';
import { ReleaseLockService } from '../release-lock/release-lock.service';

export interface ReconcileReport {
  ranAt: number;
  /** 被回收的僵尸任务数（重启时仍在 running 且已超期） */
  staleTasks: number;
  /** 被清理的过期发布锁数 */
  staleLocks: number;
  /** 回收的任务 ID（供 UI/日志核对） */
  taskIds: string[];
}

/**
 * 判定「僵尸任务」的默认阈值。
 *
 * 一次发布（构建 + 投递 + 探活）正常在 10 分钟内结束；跑过 1 小时还在 running，
 * 宿主进程几乎可以肯定已经没了（console 重启 / pm2 被强杀 / 容器漂移）。
 * 可配 `DEPLOY_TASK_STALE_MS`。
 */
export const DEFAULT_STALE_TASK_MS = 60 * 60 * 1000;

/**
 * 启动对账（诊断 #12）。
 *
 * 背景：`status='running'` 只在流水线启动那一刻写入，**没有任何回收路径**；
 * `ReleaseLockService` 的锁只能等 TTL 30 分钟自然过期；`DeployService.tasks` 更是
 * 纯进程内存。于是「发布途中 console 重启」会留下两个后遗症：
 * 1. 那条任务在 UI 上**永久转圈**（谁也不知道它其实已经死了）
 * 2. 该「模块 × 环境」**30 分钟谁也发不了**（锁还在，且没人敢手工清）
 *
 * 本服务在 `onApplicationBootstrap` 时把这两类残留清掉：
 * - 超期 running 任务 → `failed`（附可解释的原因，不静默删）
 * - 已过期的锁 → 删除（未过期的**不动**：那可能是一次**真的在跑**的发布）
 *
 * 幂等：重复启动只是重复执行同样的判定，第二次自然查不到残留。
 */
@Injectable()
export class StartupReconcileService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupReconcileService.name);

  constructor(
    @InjectRepository(DeployTaskEntity)
    private readonly taskRepo: Repository<DeployTaskEntity>,
    private readonly locks: ReleaseLockService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const r = await this.reconcile();
      if (r.staleTasks || r.staleLocks) {
        this.logger.warn(
          `启动对账：回收僵尸任务 ${r.staleTasks} 条、清理过期锁 ${r.staleLocks} 条` +
            (r.taskIds.length ? `（任务 ${r.taskIds.join(', ')}）` : ''),
        );
      } else {
        this.logger.log('启动对账：无残留');
      }
    } catch (e) {
      // 对账失败绝不能拖垮启动
      this.logger.error(`启动对账失败（不影响启动）：${(e as Error).message}`);
    }
  }

  /**
   * 执行一次对账（可手动触发）。
   * @param staleMs 超过该时长仍在 running 即判定为僵尸
   */
  async reconcile(staleMs: number = DEFAULT_STALE_TASK_MS): Promise<ReconcileReport> {
    const now = Date.now();
    const cutoff = now - staleMs;
    const reason =
      `启动对账：console 重启时发现该任务仍为 running 且已超 ${Math.round(staleMs / 60000)} 分钟，` +
      `判定宿主进程已中断（如需确认请查该模块当前线上版本）`;

    // startTime 是 bigint，用 QueryBuilder 直接下推比较，避免 JS 侧 bigint→string 的坑
    const stale = await this.taskRepo
      .createQueryBuilder('t')
      .select(['t.id', 't.component', 't.env', 't.startTime'])
      .where('t.status = :status', { status: 'running' })
      .andWhere('t.startTime < :cutoff', { cutoff })
      .getMany();

    for (const t of stale) {
      await this.taskRepo.update(
        { id: t.id },
        { status: 'failed', endTime: now, error: reason },
      );
      this.logger.warn(
        `回收僵尸任务 ${t.id}（${t.env ?? '-'}/${t.component}，始于 ${new Date(
          Number(t.startTime),
        ).toISOString()}）`,
      );
    }

    const staleLocks = await this.locks.releaseExpired(now);

    return {
      ranAt: now,
      staleTasks: stale.length,
      staleLocks,
      taskIds: stale.map((t) => t.id),
    };
  }
}
