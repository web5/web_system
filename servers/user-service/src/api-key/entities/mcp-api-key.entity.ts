import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * 每用户 MCP API Key（明文仅返回一次，存储 SHA-256）
 * 归属 user-service：Key 是用户资产，与账户绑定（owner_id 可选，兼容邮箱自助）
 */
@Entity('mcp_api_keys')
export class McpApiKeyEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: 'ID' })
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 255, comment: '邮箱' })
  email: string;

  @Column({ type: 'varchar', length: 120, nullable: true, comment: '名称' })
  name: string | null;

  /** 绑定用户 ID，null 表示邮箱自助（未登录）申请 */
  @Index()
  @Column({ type: 'bigint', unsigned: true, nullable: true, comment: '绑定用户ID，null=邮箱自助' })
  ownerId: number | null;

  /** SHA-256(plaintext)，永不存储明文 */
  @Index()
  @Column({ type: 'varchar', length: 64, comment: 'SHA-256(plaintext)' })
  keyHash: string;

  /** 明文前 12 位，用于列表展示脱敏 */
  @Column({ type: 'varchar', length: 16, comment: '明文前 12 位脱敏' })
  keyPrefix: string;

  @Column({ type: 'varchar', length: 16, default: 'active', comment: '状态 active/revoked' })
  status: 'active' | 'revoked';

  /** 过期时间，null 表示永久有效 */
  @Column({ type: 'timestamp', nullable: true, comment: '过期时间，null=永久有效' })
  expiresAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, comment: '最近使用时间' })
  lastUsedAt: Date | null;

  /** apply=公开申请签发；admin=运营后台直接创建 */
  @Column({ type: 'varchar', length: 16, default: 'apply', comment: '来源 apply/admin' })
  ownerType: 'apply' | 'admin';

  @CreateDateColumn({ type: 'datetime', precision: 3, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 3, comment: '更新时间' })
  updatedAt: Date;

  /** 吊销时间，null 表示未吊销 */
  @Column({ type: 'timestamp', nullable: true, comment: '吊销时间' })
  revokedAt: Date | null;

  @DeleteDateColumn({ type: 'datetime', precision: 3, nullable: true, comment: '软删除时间' })
  deletedAt: Date | null;
}
