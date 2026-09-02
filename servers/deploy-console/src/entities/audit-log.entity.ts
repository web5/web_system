import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
} from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/** 审计变更条目：字段级 before/after（前后值 diff） */
export interface AuditChangeItem {
  field: string;
  before?: unknown;
  after?: unknown;
}

/**
 * 审计日志持久化实体（对应 AuditLogEntry）。
 * 落库支持结构化查询；id 由审计服务写入 uuid（见 audit.service）。
 */
@Entity('audit_logs')
export class AuditLogEntity extends AbstractEntity {
  @PrimaryColumn({ type: 'varchar', length: 36, comment: '审计日志 ID（uuid）' })
  id: string;

  /** 事件时间（业务时间，区别于本行 created_at） */
  @Column({ type: 'datetime', precision: 6, comment: '事件时间' })
  @Index()
  timestamp: Date;

  @Column({ type: 'varchar', length: 64, comment: '操作人' })
  user: string;

  @Column({ type: 'varchar', length: 64, comment: '动作，如 login/deploy/rollback/config_change' })
  @Index()
  action: string;

  @Column({ type: 'varchar', length: 16, nullable: true, comment: '环境 dev/prod/gateway' })
  @Index()
  env?: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '组件名' })
  component?: string;

  @Column({ type: 'varchar', length: 32, comment: '状态 success/failed/unknown' })
  status: string;

  @Column({ type: 'text', comment: '详情（JSON 字符串或文本）' })
  detail: string;

  /** 字段级变更 diff（[{field,before,after}]）：配置类写操作记录前/后值，支撑审计页 diff 视图 */
  @Column({ type: 'json', nullable: true, comment: '字段级变更（before/after）' })
  changes?: AuditChangeItem[] | null;
}
