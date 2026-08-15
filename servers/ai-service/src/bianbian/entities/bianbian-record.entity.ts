import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';
import { UuidEntity } from '@web-system/shared';

/** 变身记录状态：pending 待处理 / processing 处理中 / success 成功 / failed 失败 */
export type TransformStatus = 'pending' | 'processing' | 'success' | 'failed';

/**
 * 变身记录表（日志类，uuid 主键）
 * 物理表名：bianbian_records
 */
@Entity('bianbian_records')
export class BianbianRecord extends UuidEntity {
  @PrimaryGeneratedColumn('uuid', { comment: '记录 ID' })
  id: string;

  /** 用户 ID，关联 users.id（物理列 BIGINT；mysql2 默认以字符串返回，故属性用 string） */
  @Index()
  @Column({ type: 'bigint', unsigned: true, comment: '用户 ID，关联 users.id' })
  userId: string;

  /** 原画（base64 data URL） */
  @Column({ type: 'text', comment: '原画（base64 data URL）' })
  originalImage: string;

  /** AI 生成结果图（本地路径 /api/uploads/bianbian/xxx.jpg，回退远程 CDN URL） */
  @Column({ type: 'text', nullable: true, comment: 'AI 生成结果图' })
  aiImage: string | null;

  /** 用户描述 */
  @Column({ type: 'varchar', length: 500, nullable: true, comment: '用户描述' })
  description: string | null;

  /** 风格 */
  @Column({ type: 'varchar', length: 50, default: 'pixar-3d', comment: '风格' })
  style: string;

  /** 输出尺寸，如 1024x1024 */
  @Column({ type: 'varchar', length: 20, default: '1024x1024', comment: '输出尺寸' })
  outputSize: string;

  /** 状态 */
  @Column({ type: 'varchar', length: 20, default: 'pending', comment: '状态 pending/processing/success/failed' })
  status: TransformStatus;

  /** 失败原因 */
  @Column({ type: 'varchar', length: 500, nullable: true, comment: '失败原因' })
  errorMsg: string | null;

  /** AI API 请求 ID（用于追踪） */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'AI API 请求 ID' })
  aiRequestId: string | null;

  /** 处理耗时（毫秒） */
  @Column({ type: 'int', nullable: true, comment: '处理耗时（毫秒）' })
  processingTimeMs: number | null;
}
