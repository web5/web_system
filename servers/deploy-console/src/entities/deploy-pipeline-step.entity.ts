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
 * 流水线步骤 —— 「流水线 1 : N 步骤」中的多方（specs/pipeline-step-task/design.md §4.1）。
 *
 * 步骤是**纯分组容器**：名称 + 人话介绍，不挂脚本、不挂条件、不参与执行判断；
 * 执行体全部在任务（deploy_pipeline_tasks）与其动作（deploy_pipeline_actions）上。
 *
 * 物理列 `pipeline_id` 沿用历史语义（= deploy_pipelines.id，历史列名 template_id 的同义）。
 */
@Entity('deploy_pipeline_steps')
@Unique(['pipelineId', 'name'])
export class DeployPipelineStepEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 归属流水线 ID */
  @Column({ name: 'pipeline_id', type: 'varchar', length: 64, comment: '流水线 ID' })
  @Index()
  pipelineId: string;

  /** 步骤名（同流水线内唯一；画布上行标题） */
  @Column({ type: 'varchar', length: 64, comment: '步骤名（同流水线内唯一）' })
  name: string;

  /** 介绍（纯展示，给非配置人读懂这步在干什么） */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '介绍（纯展示）' })
  description?: string | null;

  /** 顺序（升序执行） */
  @Column({ type: 'int', default: 0, comment: '顺序（升序）' })
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
