import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/** 内容管道采集条目——带状态机与去重指纹 */
@Entity('content_items')
@Index('idx_items_pipeline_status', ['pipeline_id', 'status'])
@Index('idx_items_simhash', ['simhash'])
@Index('idx_items_publish_date', ['publish_date'])
@Index('uk_items_pipeline_external', ['pipeline_id', 'external_id'], { unique: true })
export class ContentItemEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', nullable: true, comment: '所属管线 ID' })
  pipeline_id: number | null;

  @Column({ type: 'bigint', nullable: true, comment: '来源 ID' })
  source_id: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '源内唯一 id' })
  external_id: string | null;

  @Column({ type: 'varchar', length: 500, comment: '标题' })
  title: string;

  @Column({ type: 'varchar', length: 1024, nullable: true, comment: '原文链接' })
  url: string | null;

  @Column({ type: 'mediumtext', nullable: true, comment: '原始正文' })
  content: string | null;

  @Column({ type: 'text', nullable: true, comment: 'LLM 摘要' })
  summary: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '分类' })
  category: string | null;

  @Column({ type: 'json', nullable: true, comment: '标签' })
  tags: string[] | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'SimHash 指纹' })
  simhash: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '来源名称' })
  source_name: string | null;

  @Column({ type: 'datetime', nullable: true, comment: '原始发布时间' })
  publish_date: Date | null;

  @Column({ type: 'varchar', length: 24, default: 'pending', comment: '状态机' })
  status: string;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '最近错误信息' })
  error: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deleted_at: Date | null;
}
