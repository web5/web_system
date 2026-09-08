import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * 发布触发事件（CI/CD 触发端点的幂等表）。
 *
 * 背景：GitHub Actions 等外部系统在 push 时投递「发布意图」。
 * 网络重试 / workflow 重跑 / Actions 自身重试都会造成**同一 delivery 重复投递**，
 * 若不幂等会产生两条流水线：并发抢锁、互相覆盖产物与版本指针。
 * 以 GitHub 的 `X-GitHub-Delivery`（每次投递唯一）作主键收敛，
 * 重复投递直接返回首次结果，不产生第二条流水线。
 */
@Entity('deploy_release_events')
export class DeployReleaseEventEntity {
  /** 投递 ID（幂等键，来自 X-GitHub-Delivery 或调用方生成的唯一 ID） */
  @PrimaryColumn({ type: 'varchar', length: 128, comment: '投递 ID（幂等键）' })
  deliveryId: string;

  /** 事件类型（push / workflow_dispatch / 自定义） */
  @Column({ type: 'varchar', length: 64, comment: '事件类型' })
  event: string;

  /** 来源标识（如 release.yml），用于审计 operator 前缀 ci:<source> */
  @Column({ type: 'varchar', length: 128, comment: '来源（workflow 名等）' })
  source: string;

  @Column({ type: 'varchar', length: 64, comment: '环境' })
  env: string;

  @Column({ type: 'varchar', length: 64, comment: '模块 key' })
  moduleKey: string;

  /** 产生的流水线 ID（幂等命中时直接复用） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '流水线 ID' })
  pipelineId?: string;

  /** accepted=已受理 / duplicate=幂等命中 / rejected=被拒绝 */
  @Column({ type: 'varchar', length: 32, comment: '处理状态 accepted/duplicate/rejected' })
  status: string;

  @Column({ type: 'text', nullable: true, comment: '拒绝原因' })
  reason?: string;

  @Column({ type: 'json', nullable: true, comment: '原始 payload（审计用，不含密钥）' })
  payload?: Record<string, unknown>;

  @CreateDateColumn({ comment: '首次接收时间' })
  createdAt: Date;
}
