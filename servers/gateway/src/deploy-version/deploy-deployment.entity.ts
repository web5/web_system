import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * 只读镜像 deploy-console 的 deploy_deployments 表。
 * gateway 仅查询「某环境某模块当前线上版本」，不写入、不同步建表。
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
  @Column({ type: 'datetime', precision: 6, nullable: true, comment: '最近部署时间' })
  deployedAt?: Date;
}
