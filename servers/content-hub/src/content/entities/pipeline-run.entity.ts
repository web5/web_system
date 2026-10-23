import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 管线运行批次（2026-10-23）
 *
 * 为什么需要这张表：手动运行一条管线要跑完「采集 → LLM 摘要 → 渲染 → 发布」，
 * 实测 30 秒起步（采集多个源 + 逐个条目调 LLM）。同步接口会被链路上的三道超时
 * 依次掐断（前端 10s → 网关 content-admin 通道 30s → nginx 60s），
 * 前端只看到「网络错误」，而后端其实一直在跑、内容也真的投出去了。
 *
 * 所以手动运行改为**异步**：POST 立即建一条 running 记录并返回 job_id，
 * 后台跑完后回写状态与四数结果，前端轮询 job 拿结果。
 * 本表就是这个 job 的载体 —— 落在库里而不是进程内存，是为了：
 *   · 服务重启不丢在途任务（启动时把遗留 running 标记为 failed，见 PipelineRunService）
 *   · 同一条管线的重复点击可以判定「已有在跑」，直接复用而不并发
 *   · 留下耗时的历史，后面能回答「这条管线最近是不是变慢了」
 */
@Entity('content_pipeline_runs')
@Index('idx_pr_code_status', ['pipeline_code', 'status'])
export class PipelineRunEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 64, comment: '管线 code' })
  pipeline_code: string;

  @Column({ type: 'varchar', length: 16, default: 'manual', comment: '触发方式 manual | schedule' })
  trigger_type: string;

  @Column({ type: 'varchar', length: 16, default: 'running', comment: 'running | ok | failed' })
  status: string;

  @Column({ type: 'datetime', precision: 6, nullable: true, comment: '开始时间' })
  started_at: Date | null;

  @Column({ type: 'datetime', precision: 6, nullable: true, comment: '结束时间' })
  finished_at: Date | null;

  @Column({ type: 'int', nullable: true, comment: '耗时（毫秒）' })
  duration_ms: number | null;

  @Column({ type: 'int', default: 0, comment: '采集条数' })
  collected: number;

  @Column({ type: 'int', default: 0, comment: '新入库条数' })
  new_items: number;

  @Column({ type: 'int', default: 0, comment: '成功发布数' })
  published: number;

  @Column({ type: 'int', default: 0, comment: '失败数' })
  errors: number;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '失败原因' })
  error_msg: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;
}
