import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 变变记录状态 */
export type TransformStatus = 'pending' | 'processing' | 'success' | 'failed';

@Entity('bianbian_records')
export class BianbianRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 用户 ID */
  @Column({ type: 'varchar', length: 255 })
  @Index()
  userId: string;

  /** 原画（base64 data URL） */
  @Column({ type: 'text' })
  originalImage: string;

  /** AI 生成的结果图（base64 data URL 或 CDN URL） */
  @Column({ type: 'text', nullable: true })
  aiImage: string | null;

  /** 用户描述 */
  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string;

  /** 风格 */
  @Column({ type: 'varchar', length: 50, default: 'pixar-3d' })
  style: string;

  /** 输出尺寸，如 1024x1024 */
  @Column({ type: 'varchar', length: 20, default: '1024x1024' })
  outputSize: string;

  /** 状态 */
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: TransformStatus;

  /** 失败原因 */
  @Column({ type: 'varchar', length: 500, nullable: true })
  errorMsg: string | null;

  /** AI API 的请求 ID（用于追踪） */
  @Column({ type: 'varchar', length: 255, nullable: true })
  aiRequestId: string | null;

  /** 处理耗时（毫秒） */
  @Column({ type: 'int', nullable: true })
  processingTimeMs: number | null;

  @CreateDateColumn()
  @Index()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
