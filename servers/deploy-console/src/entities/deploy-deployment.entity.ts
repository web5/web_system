import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * 环境-模块当前部署状态（「不同环境指定不同版本」的核心）。
 * 每个 (env_id, module_key) 一条记录，记录该环境该模块当前线上版本。
 * 部署成功时 upsert；回滚时改为指向历史版本。
 */
@Entity('deploy_deployments')
export class DeployDeploymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 环境 ID */
  @Column({ type: 'varchar', length: 32, comment: '环境 ID' })
  @Index()
  envId: string;

  /** 模块 key（与 modules.json 对齐） */
  @Column({ type: 'varchar', length: 64, comment: '模块 key' })
  @Index()
  moduleKey: string;

  /** 当前线上版本标签 */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '当前版本标签' })
  currentVersion?: string;

  /** 状态: deployed | unknown */
  @Column({ type: 'varchar', length: 16, default: 'deployed', comment: '状态' })
  status: string;

  /** 最近部署时间 */
  @Column({ type: 'datetime', precision: 3, nullable: true, comment: '最近部署时间' })
  deployedAt?: Date;

  /** 最近部署人 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最近部署人' })
  deployedBy?: string;

  /** 最近关联任务 ID */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最近任务 ID' })
  taskId?: string;

  @Column({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)', comment: '创建时间' })
  createdAt: Date;

  @Column({
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
    onUpdate: 'CURRENT_TIMESTAMP(3)',
    comment: '更新时间',
  })
  updatedAt: Date;
}
