import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ArtworkSourceType = 'bianbian' | 'draw-ai' | 'design' | 'ai-art';

/**
 * 用户作品（相册）实体
 * 保存变变、画板等 AI 生成结果到用户个人账户
 */
@Entity('artworks')
export class Artwork {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 用户 ID */
  @Column({ type: 'int', comment: '用户ID' })
  userId: number;

  /** 作品标题/描述 */
  @Column({ type: 'varchar', length: 500, comment: '作品标题/描述' })
  title: string;

  /** 生成的图片地址 */
  @Column({ type: 'text', comment: '生成图片地址', nullable: true })
  imageUrl: string;

  /** 原始图片地址（如变变的原画） */
  @Column({ type: 'text', comment: '原始图片地址', nullable: true })
  originalImageUrl?: string;

  /** 来源类型：bianbian / draw-ai */
  @Column({ type: 'varchar', length: 50, comment: '来源类型' })
  sourceType: ArtworkSourceType;

  /** 生成提示词 */
  @Column({ type: 'text', comment: '生成提示词', nullable: true })
  prompt?: string;

  /** 额外元数据 */
  @Column({ type: 'json', comment: '额外元数据', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
