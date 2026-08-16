import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
} from 'typeorm';

/**
 * 服务器表（后端部署节点）。
 * - serverName 是「服务器组」名：多台服务器共享同名，实现多副本/负载均衡。
 * - 同组同主机唯一（UNIQUE(server_name, host)）。
 */
@Entity('deploy_servers')
@Unique(['serverName', 'host'])
export class DeployServerEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 服务器组名（serverName），多台服务器共享同名 */
  @Column({ type: 'varchar', length: 64, comment: '服务器组名' })
  @Index()
  serverName: string;

  /** SSH 主机（IP 或域名） */
  @Column({ type: 'varchar', length: 128, comment: 'SSH 主机' })
  host: string;

  /** SSH 用户名 */
  @Column({ type: 'varchar', length: 64, comment: 'SSH 用户名' })
  sshUser: string;

  /** SSH 私钥路径（留空则使用默认 ~/.ssh/id_ed25519_servers） */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'SSH 私钥路径' })
  sshKeyPath?: string;

  /** 该服务器部署根目录 */
  @Column({ type: 'varchar', length: 255, comment: '部署根目录' })
  remoteDir: string;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)', comment: '创建时间' })
  createdAt: Date;
}
