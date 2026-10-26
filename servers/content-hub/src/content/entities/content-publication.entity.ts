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

  /**
   * 发布所用账号与其主体类型的**快照**（2026-10-23）
   *
   * 不显示时现查账号表：类型若日后调整，历史成文的状态语义不应该跟着漂移——
   * 一条昨天以个人号发的草稿，不能因为今天升级成企业号就变成「待发布」。
   * 空值表示当时还没登记账号（本功能上线前的记录），前端按「未登记」处理。
   */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '发布所用账号编码' })
  account_code: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    nullable: true,
    comment: '发布时账号主体类型快照 personal | enterprise',
  })
  account_type: string | null;

  /**
   * 发布所用封面（`content_media.id`，2026-10-26）。
   *
   * 和 account_code 同理是**快照**：素材改名/换图之后，
   * 这条历史记录仍要能说明「当时用的是哪张」。空值 = 走正文首图或默认兜底封面。
   */
  @Column({ type: 'bigint', nullable: true, comment: '发布所用封面素材 ID' })
  cover_media_id: number | null;

  @Column({ type: 'json', nullable: true, comment: '错误信息/回调结果' })
  detail: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;
}
