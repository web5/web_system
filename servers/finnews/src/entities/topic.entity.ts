import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 话题表——聚合后的新闻话题 */
@Entity('finnews_topics')
@Index(['category', 'publish_date'])
@Index(['is_hot', 'publish_date'])
export class TopicEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 500 })
  @Index()
  title: string;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  @Index()
  category: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  sentiment: string | null;

  @Column({ type: 'float', nullable: true })
  sentiment_score: number | null;

  @Column({ default: 1 })
  news_count: number;

  @Column({ type: 'json', nullable: true })
  source_names: string[] | null;

  @Column({ type: 'json', nullable: true })
  source_urls: Array<{ name: string; url: string }> | null;

  @Column({ type: 'json', nullable: true })
  entities: Array<{ type: string; name: string; stock_code?: string; sector?: string }> | null;

  @Column({ type: 'json', nullable: true })
  related_topic_ids: string[] | null;

  @Column({ type: 'uuid', nullable: true })
  parent_topic_id: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  embedding_id: string | null;

  @Column({ type: 'datetime', nullable: true })
  @Index()
  publish_date: Date | null;

  @Column({ default: false })
  is_hot: boolean;

  @Column({ default: false })
  is_deleted: boolean;

  @CreateDateColumn()
  first_seen: Date;

  @UpdateDateColumn()
  last_updated: Date;
}
