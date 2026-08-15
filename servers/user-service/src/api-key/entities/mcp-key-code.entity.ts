import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/** 申请验证码（邮箱验证码，带过期与尝试次数限制） */
@Entity('mcp_key_codes')
export class McpKeyCodeEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: 'ID' })
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 255, comment: '邮箱' })
  email: string;

  /** SHA-256(code) */
  @Column({ type: 'varchar', length: 64, comment: 'SHA-256(code)' })
  codeHash: string;

  @Column({ type: 'timestamp', comment: '过期时间' })
  expiresAt: Date;

  @Column({ type: 'int', default: 0, comment: '尝试次数' })
  attempts: number;

  @Column({ type: 'timestamp', nullable: true, comment: '最近发送时间' })
  lastSentAt: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deletedAt: Date | null;
}
