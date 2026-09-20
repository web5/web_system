import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from 'typeorm';

/**
 * 主机（部署节点 / 主机组）—— 替代旧 `deploy_servers`
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.1
 * - `name` 是「主机组」名：多台机器共享同名，实现多副本
 * - 同组同主机唯一（UNIQUE(name, host)）
 * - `runtime` 为本次双域重构新增（pm2 / docker），供服务环境解析运行时
 */
@Entity('deploy_hosts')
@Unique(['name', 'host'])
export class DeployHostEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 主机组名（多台服务器共享同名） */
  @Column({ type: 'varchar', length: 64, comment: '主机组名' })
  @Index()
  name: string;

  /** SSH 主机（IP 或域名） */
  @Column({ type: 'varchar', length: 128, comment: 'SSH 主机' })
  host: string;

  /** SSH 用户名 */
  @Column({ type: 'varchar', length: 64, comment: 'SSH 用户名' })
  sshUser: string;

  /** SSH 私钥路径（留空用默认部署密钥） */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'SSH 私钥路径' })
  sshKeyPath?: string | null;

  /** 该主机的部署根目录 */
  @Column({ type: 'varchar', length: 255, comment: '部署根目录' })
  remoteDir: string;

  /** 运行时类型（本期只实现 pm2） */
  @Column({
    type: 'varchar',
    length: 16,
    default: 'pm2',
    comment: '运行时平台 pm2/docker',
  })
  runtime: 'pm2' | 'docker';

  /** 标签（如 {"zone":"cn-gz"}） */
  @Column({ type: 'json', nullable: true, comment: '标签' })
  labels?: Record<string, string> | null;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;

  @Column({
    type: 'datetime',
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
    onUpdate: 'CURRENT_TIMESTAMP(6)',
  })
  updatedAt: Date;
}
