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
 * 步骤任务（分支）—— 「步骤（节点）1 : N 任务」关系中的多方。
 *
 * 语义：一个步骤在不同条件下用不同脚本完成同一件事（如发布=本机 cp / 远程 scp）。
 * 任务是**独立实体**（不是塞在脚本里的 case），因此可单独增删改、可审计：
 * 「这次发布跑了哪个任务」是结构化事实，不靠读日志 + 反解脚本。
 *
 * `condition` 为空 = **默认任务**（兜底）；运行时全不匹配且有默认任务 → 用它。
 *
 * 设计与执行语义：`specs/pipeline-step-branch/design.md` §3.1 / §4
 */
@Entity('deploy_pipeline_step_branches')
@Unique(['templateId', 'nodeKey', 'name'])
export class DeployPipelineStepBranchEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 归属流水线 ID（物理列名沿用历史的 `template_id`，见 deploy-pipeline-step-command 同款说明）。
   */
  @Column({ name: 'template_id', type: 'varchar', length: 64, comment: '流水线 ID' })
  @Index()
  templateId: string;

  /** 所属步骤 key（= TemplateNode.key） */
  @Column({ name: 'node_key', type: 'varchar', length: 32, comment: '步骤 key' })
  nodeKey: string;

  /** 任务名（同一节点内唯一；通常与环境同名，如 local / dev） */
  @Column({ type: 'varchar', length: 64, comment: '任务名（同步骤内唯一）' })
  name: string;

  /** 展示名（如「本机投递」），可空 */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '展示名' })
  label?: string | null;

  /**
   * 匹配条件；NULL / 空串 = 默认任务（兜底）。
   * 语法见 steps/condition.ts：`KEY == VALUE [&& KEY == VALUE]`
   */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '匹配条件；空=默认任务' })
  condition?: string | null;

  /** 任务脚本（自包含：自带 set -euo pipefail 与所需变量计算） */
  @Column({ type: 'text', comment: '任务脚本（自包含）' })
  script: string;

  /** 匹配顺序（升序，先命中者胜） */
  @Column({ type: 'int', default: 0, comment: '匹配顺序（升序）' })
  sort: number;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最后编辑人' })
  updatedBy?: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;
}
