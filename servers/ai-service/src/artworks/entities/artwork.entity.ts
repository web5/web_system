import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';
import { BigIntEntity } from '@web-system/shared';

/** 作品来源类型：bianbian 变身 / draw-ai 画图 / design 设计 / ai-art AI 艺术 */
export type ArtworkSourceType = 'bianbian' | 'draw-ai' | 'design' | 'ai-art';

/**
 * 用户作品（相册）表——保存变身、画板等 AI 生成结果到用户个人账户。
 * 核心业务表，BIGINT 自增主键。
 * 物理表名：artworks
 */
@Entity('artworks')
export class Artwork extends BigIntEntity {
  @PrimaryGeneratedColumn('uuid', { comment: '作品 ID' })
  id: string;

  /** 用户 ID，关联 users.id */
  @Index()
  @Column({ type: 'bigint', unsigned: true, comment: '用户 ID，关联 users.id' })
  userId: number;

  /** 作品标题/描述 */
  @Column({ type: 'varchar', length: 500, comment: '作品标题/描述' })
  title: string;

  /** 生成的图片地址 */
  @Column({ type: 'text', nullable: true, comment: '生成图片地址' })
  imageUrl: string | null;

  /** 原始图片地址（如变变的原画） */
  @Column({ type: 'text', nullable: true, comment: '原始图片地址' })
  originalImageUrl: string | null;

  /** 来源类型 */
  @Column({ type: 'varchar', length: 50, comment: '来源类型 bianbian/draw-ai/design/ai-art' })
  sourceType: ArtworkSourceType;

  /** 生成提示词 */
  @Column({ type: 'text', nullable: true, comment: '生成提示词' })
  prompt: string | null;

  /** 额外元数据 */
  @Column({ type: 'json', nullable: true, comment: '额外元数据' })
  metadata: Record<string, unknown> | null;
}
