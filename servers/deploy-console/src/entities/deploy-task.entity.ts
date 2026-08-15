import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
} from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/**
 * 部署/构建/回滚任务持久化实体。
 * 替换原内存 Map，重启不丢；运行中的实时日志仍由内存对象推 SSE。
 * id 为业务自然键（${Date.now()}-${rand}），非自增主键 —— 属任务类例外。
 */
@Entity('deploy_tasks')
export class DeployTaskEntity extends AbstractEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '任务 ID（${Date.now()}-${rand}）' })
  id: string;

  /** 任务类型: build | deploy | rollback */
  @Column({ type: 'varchar', length: 16, comment: '类型 build/deploy/rollback' })
  @Index()
  type: string;

  /** 环境: dev | prod | gateway */
  @Column({ type: 'varchar', length: 16, nullable: true, comment: '环境 dev/prod/gateway' })
  @Index()
  env?: string;

  /** 组件名 */
  @Column({ type: 'varchar', length: 64, comment: '组件名' })
  component: string;

  /** 回滚标签（rollback 时使用） */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '回滚标签' })
  tag?: string;

  /** 状态: pending | running | success | failed | cancelled */
  @Column({ type: 'varchar', length: 16, comment: '状态 pending/running/success/failed/cancelled' })
  @Index()
  status: string;

  /** 实时日志（JSON 数组） */
  @Column({ type: 'json', nullable: true, comment: '实时日志（JSON 数组）' })
  logs?: string[];

  /** 错误信息 */
  @Column({ type: 'text', nullable: true, comment: '错误信息' })
  error?: string;

  /** 操作人 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '操作人' })
  operator?: string;

  /** 开始时间（毫秒时间戳，业务时间） */
  @Column({ type: 'bigint', comment: '开始时间（毫秒时间戳）' })
  @Index()
  startTime: number;

  /** 结束时间（毫秒时间戳，业务时间） */
  @Column({ type: 'bigint', nullable: true, comment: '结束时间（毫秒时间戳）' })
  endTime?: number;
}
