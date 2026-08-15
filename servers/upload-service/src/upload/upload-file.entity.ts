import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { BigIntEntity } from '@web-system/shared';

/**
 * 上传文件记录：每次成功上传落一条，用于审计、孤儿文件清理与回收引用。
 * 文件本体仍存本地磁盘（uploads/<category>/），本表只存元数据。
 */
@Entity('upload_files')
export class UploadFileEntity extends BigIntEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: '文件记录 ID' })
  id: number;

  /** 上传者，关联 users.id；匿名上传为 NULL */
  @Index()
  @Column({ type: 'bigint', unsigned: true, nullable: true, comment: '上传用户 ID，关联 users.id' })
  userId: string | null;

  @Column({ type: 'varchar', length: 32, comment: '上传分类 avatar/drawing/bianbian/general' })
  category: string;

  @Column({ type: 'varchar', length: 255, comment: '原始文件名' })
  originalName: string;

  @Column({ type: 'varchar', length: 255, comment: '存储文件名，如 avatar-<ts>-<rand>.png' })
  storageName: string;

  @Column({ type: 'varchar', length: 512, comment: '磁盘相对路径，如 uploads/avatar/<storageName>' })
  storagePath: string;

  @Column({ type: 'varchar', length: 512, comment: '访问 URL，如 /api/uploads/avatar/<storageName>' })
  url: string;

  @Column({ type: 'varchar', length: 128, comment: 'MIME 类型' })
  mimeType: string;

  @Column({ type: 'int', unsigned: true, comment: '文件大小（字节）' })
  sizeBytes: number;

  @Column({ type: 'varchar', length: 16, nullable: true, comment: '扩展名（含点），如 .png' })
  extension: string | null;

  /** 文件 MD5，用于去重与完整性校验；未计算时为 NULL */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '文件 MD5 校验值' })
  checksum: string | null;

  /** uploaded 已上传 / deleted 已删除（逻辑删除） */
  @Column({ type: 'varchar', length: 16, default: 'uploaded', comment: '状态 uploaded/deleted' })
  status: 'uploaded' | 'deleted';
}
