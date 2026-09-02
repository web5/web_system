import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/**
 * 发布审批单（prod 门禁的留痕记录）。
 *
 * 与 deploy_pipelines 一对一关联：prod 提交被阻断时流水线进入
 * `pending-approval`，审批单独立记录提交人/审批人/意见/时间，满足
 * 「未审批的 prod 发布提交应被阻断并留记录」的验收。
 *
 * 时间戳用 bigint（毫秒），与 deploy_pipelines.startTime 对齐，便于排序。
 */
@Entity('deploy_approvals')
export class DeployApprovalEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '审批单 ID（${Date.now()}-${rand}）' })
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '关联流水线 ID' })
  @Index()
  pipelineId: string;

  @Column({ type: 'varchar', length: 16, comment: '环境' })
  @Index()
  env: string;

  @Column({ type: 'varchar', length: 64, comment: '模块 key' })
  @Index()
  moduleKey: string;

  @Column({ type: 'varchar', length: 16, default: 'direct', comment: '模式 direct/grayscale' })
  mode: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '来源 Git 分支' })
  gitBranch?: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '目标 commit（短哈希）' })
  commitId?: string;

  /** 提交人（发起发布请求的人） */
  @Column({ type: 'varchar', length: 64, comment: '提交人' })
  operator: string;

  @Column({ type: 'varchar', length: 16, default: 'pending', comment: '状态 pending/approved/rejected' })
  @Index()
  status: ApprovalStatus;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '审批人' })
  reviewer?: string;

  @Column({ type: 'text', nullable: true, comment: '审批意见' })
  comment?: string;

  @Column({ type: 'bigint', nullable: true, comment: '审批时间（毫秒）' })
  reviewedAt?: number;

  @Column({ type: 'bigint', comment: '提交时间（毫秒）' })
  createdAt: number;
}
