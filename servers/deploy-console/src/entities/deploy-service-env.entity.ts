import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from 'typeorm';

/**
 * 服务 × 环境（= 该环境下该服务的"指向"）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.3
 * - **无 slotKey**（Q104）；**编辑入口在「环境详情 → 后端服务指向」**，服务详情只读
 * - gateway 按 `(envId, serviceKey)` 解析上游（R4：前后端环境联动）
 * - `hostName` 为空时部署必须 fail-fast（B4，不得回落 localhost）
 */
@Entity('deploy_service_envs')
@Unique(['serviceKey', 'envId'])
export class DeployServiceEnvEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '服务 key' })
  @Index()
  serviceKey: string;

  @Column({ type: 'varchar', length: 64, comment: '环境 envId' })
  @Index()
  envId: string;

  /** 目标主机组名（FK → deploy_hosts.name） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '目标主机组' })
  hostName?: string | null;

  @Column({ type: 'int', nullable: true, comment: '端口' })
  port?: number | null;

  @Column({ type: 'int', default: 1, comment: '副本数' })
  replicas: number;

  /** 运行时（NULL = 继承主机/环境） */
  @Column({ type: 'varchar', length: 16, nullable: true, comment: '运行时 pm2/docker' })
  runtime?: 'pm2' | 'docker' | null;

  /** 显式上游地址（填了则直接用，不再拼 host:port） */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '上游地址' })
  upstreamUrl?: string | null;

  /** 探活路径覆盖 */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '探活路径覆盖' })
  healthPath?: string | null;

  /** pm2 进程名覆盖 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'pm2 进程名覆盖' })
  pm2Name?: string | null;

  /** 环境级配置（环境变量 / 资源限制等） */
  @Column({ type: 'json', nullable: true, comment: '环境级配置' })
  config?: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 16, default: 'active', comment: '状态 active/disabled' })
  status: 'active' | 'disabled';

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
