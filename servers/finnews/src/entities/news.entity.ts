import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** 原始资讯表——每条采集到的新闻 */
@Entity('finnews_news')
@Index(['source_name', 'publish_date'])
export class NewsEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  topic_id: string | null;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  @Index()
  source_name: string | null;

  @Column({ type: 'text', nullable: true })
  source_url: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  source_type: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  @Index()
  simhash: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  category: string | null;

  @Column({ type: 'datetime', nullable: true })
  @Index()
  publish_date: Date | null;

  @Column({ default: false })
  is_processed: boolean;

  @Column({ default: false })
  is_aggregated: boolean;

  @CreateDateColumn()
  crawled_at: Date;
}
