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
  @PrimaryGeneratedColumn('uuid', { comment: '话题 ID' })
  id: string;

  @Column({ type: 'varchar', length: 500, comment: '标题' })
  @Index()
  title: string;

  @Column({ type: 'text', nullable: true, comment: '摘要' })
  summary: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, comment: '分类' })
  @Index()
  category: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true, comment: '情感倾向' })
  sentiment: string | null;

  @Column({ type: 'float', nullable: true, comment: '情感得分' })
  sentiment_score: number | null;

  @Column({ type: 'int', default: 1, comment: '关联新闻数' })
  news_count: number;

  @Column({ type: 'json', nullable: true, comment: '来源名称列表' })
  source_names: string[] | null;

  @Column({ type: 'json', nullable: true, comment: '来源链接列表' })
  source_urls: Array<{ name: string; url: string }> | null;

  @Column({ type: 'json', nullable: true, comment: '实体列表' })
  entities: Array<{ type: string; name: string; stock_code?: string; sector?: string }> | null;

  @Column({ type: 'json', nullable: true, comment: '关联话题 ID 列表' })
  related_topic_ids: string[] | null;

  @Column({ type: 'uuid', nullable: true, comment: '父话题 ID' })
  parent_topic_id: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: '向量 ID' })
  embedding_id: string | null;

  @Column({ type: 'datetime', nullable: true })
  @Index()
  publish_date: Date | null;

  @Column({ type: 'boolean', default: false, comment: '是否热门' })
  is_hot: boolean;

  /** 软删除标记（历史约定，保留以兼容现有查询；后续可统一为 deleted_at 时间戳 */
  @Column({ type: 'boolean', default: false, comment: '是否删除' })
  is_deleted: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '首次出现时间' })
  first_seen: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '最近更新时间' })
  last_updated: Date;
}
