import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * 只读镜像 deploy-console 的 deploy_canary_rules 表。
 * gateway 仅查询灰度规则并做命中判断，不写入、不同步建表。
 */
@Entity('deploy_canary_rules')
export class DeployCanaryRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, comment: '环境 ID' })
  @Index()
  envId: string;

  @Column({ type: 'varchar', length: 64, comment: '模块 key' })
  @Index()
  moduleKey: string;

  @Column({ type: 'varchar', length: 64, comment: '灰度版本号' })
  canaryVersion: string;

  @Column({ type: 'json', comment: '灰度规则 JSON' })
  matchRule: any;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)', comment: '创建时间' })
  createdAt: Date;
}
