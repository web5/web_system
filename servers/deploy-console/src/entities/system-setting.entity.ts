import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * 系统设置（通用键值）。
 *
 * 当前用途：通知渠道配置（`NOTIFY_WEBHOOK_URL` / `NOTIFY_WECOM_URL`）。
 * 设计成通用键值表：后续审批开关、度量保留期等系统级配置都往这里收，
 * 而不是继续散落在各处环境变量里。
 *
 * 用 `setting_key` 做主键：保存即 upsert，无需额外的"存在性判断"。
 */
@Entity('system_settings')
export class SystemSettingEntity {
  @PrimaryColumn({ type: 'varchar', length: 128, comment: '设置键' })
  settingKey: string;

  /** 空串视为"未配置"（读取时与 null 同等对待） */
  @Column({ type: 'text', nullable: true, comment: '设置值（空串=未配置）' })
  settingValue?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '说明' })
  description?: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最后更新人' })
  updatedBy?: string;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;
}
