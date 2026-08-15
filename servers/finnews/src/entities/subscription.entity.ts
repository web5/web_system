import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/** 用户订阅表 */
@Entity('finnews_subscriptions')
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid', { comment: '订阅 ID' })
  id: string;

  /** 用户 ID，关联 users.id（物理列 BIGINT；mysql2 默认以字符串返回，故属性用 string） */
  @Column({ type: 'bigint', unsigned: true, comment: '用户 ID，关联 users.id' })
  @Index()
  user_id: string;

  @Column({ type: 'varchar', length: 50, nullable: true, comment: '订阅类型' })
  sub_type: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true, comment: '订阅值' })
  sub_value: string | null;

  @Column({ type: 'boolean', default: true, comment: '是否推送' })
  push_enabled: boolean;

  @Column({ type: 'json', nullable: true, comment: '推送渠道列表' })
  push_channels: string[] | null;

  @Column({ type: 'boolean', default: true, comment: '是否生效' })
  is_active: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deleted_at: Date | null;
}
