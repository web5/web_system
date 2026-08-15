import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/** 原始资讯表——每条采集到的新闻 */
@Entity('finnews_news')
@Index(['source_name', 'publish_date'])
export class NewsEntity {
  @PrimaryGeneratedColumn('uuid', { comment: '新闻 ID' })
  id: string;

  @Column({ type: 'uuid', nullable: true, comment: '所属话题 ID' })
  @Index()
  topic_id: string | null;

  @Column({ type: 'varchar', length: 500, comment: '标题' })
  title: string;

  @Column({ type: 'text', nullable: true, comment: '正文' })
  content: string | null;

  @Column({ type: 'text', nullable: true, comment: '摘要' })
  summary: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  @Index()
  source_name: string | null;

  @Column({ type: 'text', nullable: true, comment: '来源 URL' })
  source_url: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true, comment: '来源类型' })
  source_type: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '去重 simhash' })
  @Index()
  simhash: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, comment: '分类' })
  category: string | null;

  @Column({ type: 'datetime', nullable: true })
  @Index()
  publish_date: Date | null;

  @Column({ type: 'boolean', default: false, comment: '是否已处理' })
  is_processed: boolean;

  @Column({ type: 'boolean', default: false, comment: '是否已聚合到话题' })
  is_aggregated: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '采集时间' })
  crawled_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deleted_at: Date | null;
}
