import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

/**
 * 通知记录（站内历史）。
 *
 * 与审计（audit_logs）的分工：
 * - 审计：记录**所有**操作（谁/何时/做了什么），是追溯真相源；
 * - 通知：对**关键事件**做主动推送（Webhook / 企业微信），并留一份送达历史。
 *
 * `delivery` 记录各通道送达结果（如 `{ webhook: 'ok', wecom: 'failed' }`），
 * 让运维能发现"通道没配/推不出去"，而不是以为已经通知到了。
 */
@Entity('notification_logs')
export class NotificationLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 事件类型：pipeline.succeeded / pipeline.failed / pipeline.auto-rollback ... */
  @Column({ type: 'varchar', length: 64, comment: '事件类型' })
  @Index()
  event: string;

  @Column({ type: 'varchar', length: 16, comment: '环境' })
  @Index()
  env: string;

  @Column({ type: 'varchar', length: 64, comment: '模块 key' })
  @Index()
  moduleKey: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '版本标签' })
  versionTag?: string;

  /** success | failed | warn */
  @Column({ type: 'varchar', length: 16, comment: 'success/failed/warn' })
  status: string;

  @Column({ type: 'text', comment: '内容摘要' })
  detail: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '操作人' })
  operator?: string;

  /** 各通道送达结果，如 { webhook: 'ok', wecom: 'failed' } */
  @Column({ type: 'json', nullable: true, comment: '各通道送达结果' })
  delivery?: Record<string, string>;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;
}
