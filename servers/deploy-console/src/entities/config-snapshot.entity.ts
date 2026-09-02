import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

/**
 * 配置快照。
 *
 * 每次保存配置时生成，并与发布版本关联：**回滚版本时配置同步回退**，
 * 避免出现"代码回到旧版本、配置却还是新的"这种不一致。
 *
 * `payload` 存该版本生效的合并结果（密钥仍以密文形式保存，不落明文）。
 */
@Entity('config_snapshots')
@Index(['envId', 'moduleKey', 'versionTag'])
export class ConfigSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '环境 ID' })
  @Index()
  envId: string;

  @Column({ type: 'varchar', length: 64, comment: '模块 key' })
  @Index()
  moduleKey: string;

  @Column({ type: 'varchar', length: 64, comment: '关联的版本标签' })
  versionTag: string;

  /** 合并后的生效配置：{ key: { value, isSecret, source } } */
  @Column({ type: 'json', comment: '合并后的生效配置（密钥仍为密文）' })
  payload: Record<string, { value: string; isSecret: boolean; source: string }>;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '操作人' })
  createdBy?: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;
}
