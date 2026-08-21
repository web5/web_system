import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 公众号永久素材缓存——封面图等，避免重复上传 */
@Entity('content_media')
@Index('idx_media_type', ['media_type'])
export class ContentMediaEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 16, comment: 'image/thumb' })
  media_type: string;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '源文件 URL' })
  file_url: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, comment: '微信 media_id' })
  media_id: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '微信 CDN url' })
  url: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;
}
