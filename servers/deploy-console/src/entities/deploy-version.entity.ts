import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';
import { UuidEntity } from '@web-system/shared';

/**
 * 发布版本记录。
 * 每次部署（deploy）任务成功完成时写入一条，供回滚选择。
 * tag 同时对应远程 releases/<tag>/ 快照目录。
 */
@Entity('deploy_versions')
export class DeployVersionEntity extends UuidEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 环境: dev | prod */
  @Column({ type: 'varchar', length: 16, comment: '环境 dev/prod' })
  @Index()
  env: string;

  /** 组件名 */
  @Column({ type: 'varchar', length: 64, comment: '组件名' })
  @Index()
  component: string;

  /** 版本标签，如 20260815-a1b2c3d，对应远程 releases/<tag>/ */
  @Column({ type: 'varchar', length: 128, comment: '版本标签' })
  @Index()
  versionTag: string;

  /** Git 提交短哈希（若有） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'Git 提交短哈希' })
  gitCommit?: string;

  /** Git 分支（若有） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'Git 分支' })
  gitBranch?: string;

  /** 发布人 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '发布人' })
  releasedBy?: string;

  /** 发布时间 */
  @Column({ type: 'datetime', precision: 6, comment: '发布时间' })
  @Index()
  releasedAt: Date;

  /** 关联任务 ID */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '关联任务 ID' })
  taskId?: string;

  /** active | rolled_back */
  @Column({ type: 'varchar', length: 16, default: 'active', comment: '状态 active/rolled_back' })
  @Index()
  status: string;

  /** 备注 */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '备注' })
  note?: string;
}
