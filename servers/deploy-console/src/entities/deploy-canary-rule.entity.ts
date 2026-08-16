import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * 灰度规则表。
 * matchRule 支持 three types:
 *  - { type: 'user-list', userIds: ['u1','u2'] }   用户名单精确匹配
 *  - { type: 'percent', value: 10 }                 10% 用户走灰度（userId+ruleId FNV-1a hash % 100 < value）
 *  - { type: 'header', key: 'x-canary', values: ['on'] }  请求头匹配（调试用）
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
