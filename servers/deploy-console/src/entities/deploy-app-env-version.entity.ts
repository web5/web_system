import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from 'typeorm';

/**
 * 应用 × 环境的版本指针（微前端域）—— 替代旧 `deploy_deployments` 的 env 维度
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.2（Q103：**无 slotKey**）
 * - `currentVersion` 指向产物目录 `<appKey>/<envId>/<version>/`
 * - 切换版本 / 回滚 = 只改写 `envId/index.js` 入口指针 + 本表指针（不重新构建）
 * - gateway `__manifest__` 的 `byEnv[envId]` 由此表解析
 */
@Entity('deploy_app_env_versions')
@Unique(['appKey', 'envId'])
export class DeployAppEnvVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '应用 key' })
  @Index()
  appKey: string;

  @Column({ type: 'varchar', length: 64, comment: '环境 envId' })
  @Index()
  envId: string;

  /** 当前版本（git short sha，指向 `<envId>/<version>/`） */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '当前版本' })
  currentVersion?: string | null;

  /** 上一版本（回滚默认目标） */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '上一版本' })
  previousVersion?: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: 'unknown',
    comment: '状态 deployed/unknown/failed',
  })
  status: 'deployed' | 'unknown' | 'failed';

  @Column({ type: 'datetime', precision: 6, nullable: true, comment: '发布时间' })
  deployedAt?: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '发布人' })
  deployedBy?: string | null;

  /** 关联的流水线运行 ID */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '流水线运行 ID' })
  taskId?: string | null;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;
}
