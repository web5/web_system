import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** 用户订阅表 */
@Entity('finnews_subscriptions')
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  @Index()
  user_id: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  sub_type: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  sub_value: string | null;

  @Column({ default: true })
  push_enabled: boolean;

  @Column({ type: 'json', nullable: true })
  push_channels: string[] | null;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;
}
