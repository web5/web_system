import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 配置作用域（优先级由低到高，后者覆盖前者） */
export const CONFIG_SCOPES = ['global', 'env', 'module'] as const;
export type ConfigScope = (typeof CONFIG_SCOPES)[number];

/**
 * 配置项。
 *
 * 三级作用域：
 * - `global`：全局默认（`envId=''`、`moduleKey=''`）
 * - `env`   ：环境级（`envId` 有值、`moduleKey=''`）
 * - `module`：模块级（`envId` 与 `moduleKey` 均有值）
 *
 * **为什么用空串而不是 NULL 表示"不适用"**：MySQL 唯一索引中 NULL 互不相等，
 * 用 NULL 会让同一条全局配置被重复插入多次，唯一约束形同虚设。
 *
 * 密钥（`isSecret`）的 value 存密文，格式 `iv:authTag:ciphertext`（均 base64），
 * 明文永不落库、永不回显。
 */
@Entity('config_items')
@Unique(['scope', 'envId', 'moduleKey', 'key'])
export class ConfigItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16, comment: '作用域 global/env/module' })
  scope: string;

  @Column({ type: 'varchar', length: 64, default: '', comment: "环境 ID（global 时为 ''）" })
  @Index()
  envId: string;

  @Column({ type: 'varchar', length: 64, default: '', comment: "模块 key（非 module 时为 ''）" })
  @Index()
  moduleKey: string;

  @Column({ type: 'varchar', length: 128, comment: '配置键' })
  key: string;

  /** 明文值；isSecret 时为 `iv:authTag:ciphertext` 密文 */
  @Column({ type: 'text', comment: '配置值（密钥为密文）' })
  value: string;

  @Column({ type: 'boolean', default: false, comment: '是否密钥（加密存储、页面掩码）' })
  isSecret: boolean;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '说明' })
  description?: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最后编辑人' })
  updatedBy?: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;
}
