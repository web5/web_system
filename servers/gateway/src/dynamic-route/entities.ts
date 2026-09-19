import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * 双域重构（P2）网关侧只读实体镜像。
 *
 * 这些表属于部署库 `web_system_deploy`（与 deploy-console 同库），
 * 通过 gateway 已有的 **`deploy` 命名连接**读取（synchronize: false，gateway 只读消费者）。
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.3 / §4.4
 * 仅映射运行时需要的列，避免与 deploy-console 侧实体全量字段耦合。
 */

/** 转发规则（前缀级） */
@Entity('deploy_service_routes')
export class DeployServiceRouteEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  serviceKey: string;

  /** NULL = 全环境默认；有值 = 该环境覆盖 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  envId: string | null;

  @Column({ type: 'varchar', length: 128 })
  pathPrefix: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  stripPrefix: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  rewriteTo: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  upstreamOverride: string | null;

  @Column({ type: 'int', default: 30000 })
  timeoutMs: number;

  @Column({ type: 'varchar', length: 16, default: 'passthrough' })
  authMode: string;

  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;
}

/** 服务 × 环境的「指向」 */
@Entity('deploy_service_envs')
export class DeployServiceEnvEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  serviceKey: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  envId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  hostName: string | null;

  @Column({ type: 'int', nullable: true })
  port: number | null;

  @Column({ type: 'int', default: 1 })
  replicas: number;

  @Column({ type: 'varchar', length: 16, nullable: true })
  runtime: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  upstreamUrl: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;
}

/** 服务（网关背后的后端） */
@Entity('deploy_services')
export class DeployServiceEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 16, default: 'nest' })
  kind: string;

  @Column({ type: 'varchar', length: 128 })
  repoDir: string;

  @Column({ type: 'int', nullable: true })
  defaultPort: number | null;

  @Column({ type: 'varchar', length: 128, default: '/health' })
  healthPath: string;

  /** 未登记接口策略：allow 放行 / deny 拒绝 */
  @Column({ type: 'varchar', length: 16, default: 'allow' })
  unknownPolicy: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  deletedAt: Date | null;
}

/** 接口清单（方法 + 路径级，用于 unknownPolicy 判定） */
@Entity('deploy_endpoints')
export class DeployEndpointEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  serviceKey: string;

  @Column({ type: 'varchar', length: 8 })
  method: string;

  @Column({ type: 'varchar', length: 255 })
  pathPattern: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'boolean', default: false })
  deprecated: boolean;
}

/** 环境（envId 即微前端加载目录，也是后端指向的维度） */
@Entity('deploy_envs')
export class DeployEnvEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  envId: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  siteKey: string;

  @Column({ type: 'boolean', default: false })
  isProd: boolean;

  /** 切换挂件中的排序（manifest 按它输出 envs 顺序） */
  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;
}

/** 站点（Host → 默认环境 / 是否可切换） */
@Entity('deploy_sites')
export class DeploySiteEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  key: string;

  @Column({ type: 'varchar', length: 128 })
  host: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 64, default: 'dev' })
  defaultEnvId: string;

  @Column({ type: 'boolean', default: false })
  switchable: boolean;
}

/** 应用（微前端）：manifest 的 byEnv 需要 key / deployMode / 软删标记 */
@Entity('deploy_apps')
export class DeployAppEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 24, default: 'micro-frontend' })
  kind: string;

  /** env-dir = 按环境目录（可切换）；site-version = 基座（不纳入切换，Q107） */
  @Column({ type: 'varchar', length: 16, default: 'env-dir' })
  deployMode: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  deletedAt: Date | null;
}

/** 应用 × 环境的版本指针（manifest 的 byEnv 由它解析"哪个环境加载哪个版本目录"） */
@Entity('deploy_app_env_versions')
export class DeployAppEnvVersionEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  appKey: string;

  @Column({ type: 'varchar', length: 64 })
  @Index()
  envId: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  currentVersion: string | null;
}
