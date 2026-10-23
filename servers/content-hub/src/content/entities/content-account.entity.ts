import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * 自媒体三方平台账号登记表（2026-10-23）
 *
 * 只登记**账号本身**（平台 + 编码 + 显示名 + 凭据），不承载"哪个管线用哪个账号"
 * 的绑定关系——绑定在 content_pipelines 侧，本表保持单一职责。
 *
 * 凭据安全（A3 决议）：AppSecret 等以 AES-256-GCM 加密入库（`credentials_enc`），
 * 列表与对外接口只回 `credentials_mask`；解密钥由 ACCOUNT_CRED_KEY_FILE 指向的
 * 0600 文件提供，**不进进程环境变量**（避免 pm2 env 之类命令直接打出明文）。
 */
@Entity('content_accounts')
export class ContentAccountEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 32, comment: '平台标识 wechat_mp' })
  platform: string;

  @Column({ type: 'varchar', length: 64, comment: '账号编码（同平台内唯一）' })
  code: string;

  @Column({ type: 'varchar', length: 128, comment: '显示名' })
  name: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '平台侧主体标识（公众号主体名，连通性检测后回填）',
  })
  identity: string | null;

  @Column({
    type: 'text',
    nullable: true,
    comment: '凭据密文 AES-256-GCM（base64：iv + tag + ciphertext）',
  })
  credentials_enc: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '凭据掩码（列表展示）' })
  credentials_mask: string | null;

  @Column({ type: 'json', nullable: true, comment: '账号能力清单（检测后回填）' })
  capabilities: string[] | null;

  @Column({ type: 'datetime', precision: 6, nullable: true, comment: '最近一次连通性检测时间' })
  last_checked_at: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true, comment: '检测结果 ok | warn | err' })
  last_check_status: string | null;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deleted_at: Date | null;
}
