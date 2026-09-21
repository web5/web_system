import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 流水线任务 —— 「步骤 1 : N 任务」中的多方（specs/pipeline-step-task/design.md §4.2）。
 *
 * 任务是**执行单元**，两种 kind 混排于同一步骤内：
 * - script ：可选执行条件 + 任务级环境变量 + 1..N 动作（deploy_pipeline_actions）
 * - approval：人工审批门禁（approvers/timeout/onReject），不挂动作
 *
 * 环境差异（本机/远程）用**互斥条件**表达为同一步骤的多个任务；
 * 不提供默认兜底 —— 全不命中即该步骤失败（不静默猜）。
 */
@Entity('deploy_pipeline_tasks')
@Unique(['stepId', 'name'])
export class DeployPipelineTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 归属步骤（级联删除） */
  @Column({ name: 'step_id', type: 'varchar', length: 36, comment: '归属步骤 ID' })
  @Index()
  stepId: string;

  /** 任务类型：script / approval */
  @Column({ type: 'varchar', length: 16, comment: '类型：script | approval' })
  kind: 'script' | 'approval';

  /** 任务名（同步骤内唯一；画布任务卡展示，如 local / dev / 审批门禁） */
  @Column({ type: 'varchar', length: 64, comment: '任务名（同步骤内唯一）' })
  name: string;

  /**
   * 执行条件；空 = 恒执行。
   * 语法见 steps/condition.ts：`KEY == 值 [&& KEY != 值]`；
   * 求值不命中 → 跳过整个任务（含其全部动作）。
   */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '执行条件；空=恒执行' })
  condition?: string | null;

  /** 任务级环境变量（注入其所有动作进程；优先级最高） */
  @Column({ type: 'json', nullable: true, comment: '任务级环境变量 {KEY: value}' })
  env?: Record<string, string> | null;

  /**
   * 审核任务专属配置；script 任务恒 NULL。
   * `{approvers: string[], timeoutSec?: number, timeoutAction: 'skip'|'fail', onReject: 'fail'|'skip'}`
   */
  @Column({ type: 'json', nullable: true, comment: '审核任务配置（approvers/timeout/onReject）' })
  approval?: {
    approvers: string[];
    timeoutSec?: number;
    timeoutAction?: 'skip' | 'fail';
    onReject?: 'fail' | 'skip';
  } | null;

  /** 同步骤内顺序（升序） */
  @Column({ type: 'int', default: 0, comment: '同步骤内顺序（升序）' })
  sort: number;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最后编辑人' })
  updatedBy?: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;
}
