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
 * 流水线动作 —— 「任务 1 : N 动作」中的多方（specs/pipeline-step-task/design.md §4.3）。
 *
 * 动作一律是 **shell 脚本**：调用平台能力（写版本记录等）= 脚本内 curl 平台接口，
 * 不存在"内置工具"执行实体（工具目录只是可复用脚本的模板库）。
 *
 * 任务内动作严格按 sort **串行**执行，任一失败即断（后续动作不再执行）；
 * 任务被条件跳过时，其全部动作随之跳过。
 */
@Entity('deploy_pipeline_actions')
@Unique(['taskId', 'name'])
export class DeployPipelineActionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 归属任务（级联删除） */
  @Column({ name: 'task_id', type: 'varchar', length: 36, comment: '归属任务 ID' })
  @Index()
  taskId: string;

  /** 动作名（任务内唯一；画布动作卡展示，如「write-version · 写版本记录」） */
  @Column({ type: 'varchar', length: 64, comment: '动作名（任务内唯一）' })
  name: string;

  /** 脚本正文（自包含；平台向动作进程注入 CONSOLE_API/CONSOLE_TOKEN 等凭据变量） */
  @Column({ type: 'text', comment: '脚本正文（自包含）' })
  script: string;

  /**
   * 平台托管标记：git/build 等平台动作。
   * 页面只读 —— **不可删除、不可改名**（脚本内容允许随平台升级更新）。
   */
  @Column({ type: 'boolean', default: false, comment: '平台托管动作（不可删/不可改名）' })
  managed: boolean;

  /** 任务内顺序（升序，严格串行） */
  @Column({ type: 'int', default: 0, comment: '任务内顺序（升序，串行）' })
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
