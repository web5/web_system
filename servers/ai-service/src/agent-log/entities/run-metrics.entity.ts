import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/**
 * Agent run 每日指标（Phase2.4）：按 agentId+model+source+date 增量聚合。
 * 在 recordRun 落库后同步 upsert 当日行，提供观测台成功率/成本/延迟趋势，
 * 避免每次查询全表扫描 agent_runs。
 */
@Entity('run_metrics')
@Index('idx_run_metrics_agent_date', ['agentId', 'date'])
@Index('idx_run_metrics_date', ['date'])
export class RunMetrics extends AbstractEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: 'Agent id' })
  agentId: string;

  @Column({ type: 'varchar', length: 128, comment: '模型 id' })
  model: string;

  @Column({ type: 'varchar', length: 32, comment: '来源服务（ai-agent / ai-service）' })
  source: string;

  /** 业务日（本地 YYYY-MM-DD） */
  @Column({ type: 'date', comment: '业务日（本地）' })
  date: string;

  @Column({ type: 'int', default: 0, comment: 'run 总数' })
  runCount: number;

  @Column({ type: 'int', default: 0, comment: '成功数' })
  okCount: number;

  @Column({ type: 'int', default: 0, comment: '失败数' })
  errorCount: number;

  @Column({ type: 'bigint', default: 0, comment: 'token 总量' })
  totalTokens: string;

  @Column({ type: 'decimal', precision: 14, scale: 6, default: 0, comment: '成本合计 CNY' })
  totalCost: string;

  @Column({ type: 'int', default: 0, comment: '累计耗时 ms（平均耗时 = totalDurationMs / runCount）' })
  totalDurationMs: number;
}
