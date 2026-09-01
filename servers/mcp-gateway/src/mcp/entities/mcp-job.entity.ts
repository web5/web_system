import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 任务索引表（jobId → 模块的路由映射）。
 *
 * 只做路由，不存任务状态 —— 真实状态归各后端（deploy_pipelines / agent_run 等），
 * 避免两套状态机同步问题。保留该表是为了可迁移与可维护：
 * 能独立追踪任务归属、按时间清理、排查"jobId 查不到"类问题。
 */
@Entity('mcp_jobs')
export class McpJobEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '自增 ID' })
  id: number;

  @Column({ type: 'varchar', length: 64, unique: true, comment: '任务 ID（后端生成）' })
  @Index()
  job_id: string;

  @Column({ type: 'varchar', length: 64, comment: '模块标识（如 deploy）' })
  code_key: string;

  @Column({ type: 'varchar', length: 64, comment: '任务工具名（如 publish_pipeline）' })
  tool_name: string;

  /** 提交者（API Key 的 ownerId），便于按人排查任务 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '提交者 ownerId' })
  operator: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;
}
