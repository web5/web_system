import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/** 内容管线配置——paper / ai-news 各一条，可扩展 */
@Entity('content_pipelines')
export class ContentPipelineEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 64, comment: '管线编码' })
  code: string;

  @Column({ type: 'varchar', length: 32, comment: '管线类型 paper | ai-news' })
  type: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '日报标题模板' })
  title_template: string | null;

  @Column({ type: 'varchar', length: 64, comment: 'cron 表达式' })
  cron: string;

  @Column({ type: 'text', nullable: true, comment: 'LLM prompt 模板' })
  llm_prompt: string | null;

  @Column({ type: 'json', nullable: true, comment: '发布目标列表' })
  publish_targets: string[] | null;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '腾讯文档目标目录' })
  tencent_folder: string | null;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deleted_at: Date | null;
}
