import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * 部署环境注册表（一等公民）。
 * - 固定环境 dev / prod 为 builtin，不可删除（端口可改）。
 * - 其他环境可任意增删（如 staging / 压测环境）。
 * - ports: 后端模块 key -> 端口 的映射，监控/部署统一读它，实现「不同环境指向不同端口」。
 */
@Entity('deploy_environments')
export class DeployEnvironmentEntity {
  /** 环境 ID，如 dev / prod / staging */
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '环境 ID' })
  id: string;

  /** 环境展示名 */
  @Column({ type: 'varchar', length: 64, comment: '环境名称' })
  name: string;

  /** SSH 主机（IP 或域名） */
  @Column({ type: 'varchar', length: 128, comment: 'SSH 主机' })
  @Index()
  host: string;

  /** SSH 用户名 */
  @Column({ type: 'varchar', length: 64, comment: 'SSH 用户名' })
  sshUser: string;

  /** SSH 私钥路径（留空则使用默认 ~/.ssh/id_ed25519_servers） */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'SSH 私钥路径' })
  sshKeyPath?: string;

  /** 远端项目根目录 */
  @Column({ type: 'varchar', length: 255, comment: '远端项目根目录' })
  remoteDir: string;

  /** 公网访问地址 */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '公网访问地址' })
  publicUrl?: string;

  /** 后端模块端口映射: { moduleKey: port }。前端模块无需端口。 */
  @Column({ type: 'json', nullable: true, comment: '后端模块端口映射' })
  ports?: Record<string, number>;

  /** 是否内置环境（dev/prod），内置环境禁止删除 */
  @Column({ type: 'boolean', default: false, comment: '是否内置环境' })
  builtin: boolean;

  @Column({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)', comment: '创建时间' })
  createdAt: Date;

  @Column({
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
    onUpdate: 'CURRENT_TIMESTAMP(3)',
    comment: '更新时间',
  })
  updatedAt: Date;
}
