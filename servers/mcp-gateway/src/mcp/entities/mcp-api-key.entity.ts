import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

/** 每用户 MCP API Key（明文仅返回一次，存储 SHA-256） */
@Entity('mcp_api_keys')
export class McpApiKeyEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name: string | null;

  /** SHA-256(plaintext)，永不存储明文 */
  @Index()
  @Column({ name: 'key_hash', type: 'varchar', length: 64 })
  keyHash: string;

  /** 明文前 12 位，用于列表展示脱敏 */
  @Column({ name: 'key_prefix', type: 'varchar', length: 16 })
  keyPrefix: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: 'active' | 'revoked';

  /** 过期时间，null 表示永久有效 */
  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  /** apply=公开申请签发；admin=运营后台直接创建 */
  @Column({ name: 'owner_type', type: 'varchar', length: 16, default: 'apply' })
  ownerType: 'apply' | 'admin';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt: Date | null;
}
