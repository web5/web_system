import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 内容管道发布记录——每次发布动作一条，支持失败重发 */
@Entity('content_publications')
@Index('idx_pub_item', ['item_id'])
@Index('idx_pub_pipeline_target', ['pipeline_id', 'target'])
export class ContentPublicationEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', comment: '条目 ID' })
  item_id: number;

  @Column({ type: 'bigint', nullable: true, comment: '管线 ID' })
  pipeline_id: number | null;

  @Column({ type: 'varchar', length: 32, comment: '发布目标 tencent_docs | wechat_mp' })
  target: string;

  @Column({ type: 'varchar', length: 24, comment: 'submitted/success/failed' })
  status: string;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '外部 ID' })
  external_id: string | null;

  @Column({ type: 'json', nullable: true, comment: '错误信息/回调结果' })
  detail: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;
}
