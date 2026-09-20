import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from 'typeorm';

/**
 * 网关转发规则（API 网关域，前缀级）—— 替代 `gateway_routes`（旧表未被运行时消费）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.3
 * - `envId` 为 NULL 表示"全环境默认"；有值表示该环境的覆盖
 * - 优先级数值小者优先匹配（FR-7.2）
 * - 与 `deploy_endpoints` 分层：本表管「转发」，接口表管「治理」
 */
@Entity('deploy_service_routes')
@Unique(['serviceKey', 'envId', 'pathPrefix'])
export class DeployServiceRouteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '服务 key' })
  @Index()
  serviceKey: string;

  /** NULL = 全环境默认；有值 = 该环境覆盖 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '环境 envId（NULL=全环境）' })
  @Index()
  envId?: string | null;

  /** 匹配路径前缀（如 /api/auth） */
  @Column({ type: 'varchar', length: 128, comment: '路径前缀' })
  pathPrefix: string;

  /** 转发时剥离的前缀正则（如 ^/api） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '剥离前缀' })
  stripPrefix?: string | null;

  /** 剥离后重写到的目标前缀（如 /api） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '重写目标前缀' })
  rewriteTo?: string | null;

  /** 显式上游覆盖（填了则不用服务环境解析值） */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '上游覆盖' })
  upstreamOverride?: string | null;

  @Column({ type: 'int', default: 30000, comment: '代理超时（毫秒）' })
  timeoutMs: number;

  @Column({
    type: 'varchar',
    length: 16,
    default: 'passthrough',
    comment: '鉴权模式 passthrough/service_key/jwt',
  })
  authMode: 'passthrough' | 'service_key' | 'jwt';

  /** 匹配优先级（数值小者优先） */
  @Column({ type: 'int', default: 0, comment: '优先级' })
  priority: number;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;
}
