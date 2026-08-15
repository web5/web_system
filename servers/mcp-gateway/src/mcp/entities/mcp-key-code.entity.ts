import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/** 申请验证码（邮箱验证码，带过期与尝试次数限制） */
@Entity('mcp_key_codes')
export class McpKeyCodeEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  email: string;

  /** SHA-256(code) */
  @Column({ name: 'code_hash', type: 'varchar', length: 64 })
  codeHash: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'last_sent_at', type: 'timestamp', nullable: true })
  lastSentAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
