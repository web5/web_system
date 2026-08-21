import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/** 内容管道采集源配置——每类来源一条（arxiv / rss / hackernews / wechat_mp / douyin / xiaohongshu） */
@Entity('content_sources')
export class ContentSourceEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 64, comment: '源编码' })
  code: string;

  @Column({ type: 'varchar', length: 128, comment: '显示名' })
  name: string;

  @Column({ type: 'varchar', length: 32, comment: '采集器类型' })
  type: string;

  @Column({ type: 'json', nullable: true, comment: '各源私有配置' })
  config: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '内容领域' })
  category: string | null;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deleted_at: Date | null;
}
