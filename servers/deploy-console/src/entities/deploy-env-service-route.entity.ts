import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
} from 'typeorm';

/**
 * 环境服务路由表。
 * 每个前端环境独立定义「服务名(serviceName) → serverName（服务器组）」的映射，
 * 实现多环境指向：不同环境把同一服务指向不同服务器组。
 * 每环境每服务一条路由（UNIQUE(env_id, service_name)）。
 */
@Entity('deploy_env_service_routes')
@Unique(['envId', 'serviceName'])
export class DeployEnvServiceRouteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 前端环境 ID（dev/prod/staging） */
  @Column({ type: 'varchar', length: 32, comment: '环境 ID' })
  @Index()
  envId: string;

  /** 服务名 = deploy_modules.key（gateway / auth-service / ...） */
  @Column({ type: 'varchar', length: 64, comment: '服务名' })
  @Index()
  serviceName: string;

  /** 指向哪个服务器组（serverName） */
  @Column({ type: 'varchar', length: 64, comment: '目标服务器组' })
  serverName: string;

  /** 可选：该服务在目标组的端口（覆盖环境默认） */
  @Column({ type: 'int', nullable: true, comment: '服务端口' })
  port?: number;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)', comment: '创建时间' })
  createdAt: Date;
}
