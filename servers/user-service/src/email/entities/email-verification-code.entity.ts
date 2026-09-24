import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 邮箱验证码（绑定邮箱用）
 * 表：email_verification_codes（migrations/0014_mp_account_phone_email.sql）
 *
 * 与 mcp_key_codes 分开：用途不同（账号绑定 vs API Key 申请）、限频策略不同，
 * 且本表带 user_id 便于审计。
 */
@Entity('email_verification_codes')
export class EmailVerificationCodeEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: 'ID' })
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 100, comment: '邮箱' })
  email: string;

  @Index()
  @Column({ type: 'bigint', unsigned: true, nullable: true, comment: '申请人；未登录为 NULL' })
  userId: number | null;

  /** SHA-256(code)：不存明文 */
  @Column({ type: 'char', length: 64, comment: '验证码 SHA-256' })
  codeHash: string;

  @Column({ type: 'varchar', length: 20, default: 'bind', comment: 'bind / change' })
  purpose: string;

  @Column({ type: 'datetime', comment: '过期时间' })
  expiresAt: Date;

  @Column({ type: 'tinyint', unsigned: true, default: 0, comment: '已校验次数' })
  attempts: number;

  @Column({ type: 'datetime', nullable: true, comment: '核销时间' })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'datetime', comment: '创建时间' })
  createdAt: Date;
}
