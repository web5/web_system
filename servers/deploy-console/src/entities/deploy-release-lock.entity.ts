import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * 发布锁（以「模块 × 环境」为键）。
 *
 * 解决的问题：同一模块同一环境并发发布时，两个流水线会互相覆盖版本指针，
 * 导致"发布 A 成功、实际跑的是 B 的产物"这类静默错误。
 *
 * 为什么用表而不是内存锁：deploy-console 可能多实例，且进程重启后内存锁丢失；
 * 表锁对单实例同样适用，并带 `expiresAt` 防止发布进程被强杀后留下死锁。
 */
@Entity('deploy_release_locks')
export class DeployReleaseLockEntity {
  /** 锁键：`moduleKey@env` */
  @PrimaryColumn({ type: 'varchar', length: 160, comment: '锁键 moduleKey@env' })
  lockKey: string;

  @Column({ type: 'varchar', length: 64, comment: '持有锁的流水线 ID' })
  pipelineId: string;

  @Column({ type: 'bigint', comment: '获取时间（毫秒时间戳）' })
  acquiredAt: number;

  /** 过期时间：持有者被强杀时，超时后允许他人抢占，避免死锁 */
  @Column({ type: 'bigint', comment: '过期时间（毫秒时间戳）' })
  expiresAt: number;
}
