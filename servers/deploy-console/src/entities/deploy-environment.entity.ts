import {
  Entity,
  PrimaryColumn,
  Column,
} from 'typeorm';

/**
 * 部署环境注册表（一等公民）。
 * - 固定环境 dev / prod 为 builtin，不可删除。
 * - 其他环境可任意增删（如 staging / 压测环境）。
 * - ports: 后端模块 key -> 服务地址（`host:port` 或域名），监控/部署统一读它。
 *   列名保留 `ports`（兼容旧数据），但 value 类型从 `number`（端口）改为 `string`（完整地址）。
 *   例：`{ gateway: '127.0.0.1:6000', 'auth-service': 'dev.kedouai.com:6101' }`。
 *   留空表示该服务不在本环境部署。
 * - 服务器连接信息已下沉到 deploy_servers（serverName 服务器组），环境不再直接持有单台 host。
 */
@Entity('deploy_environments')
export class DeployEnvironmentEntity {
  /** 环境 ID，如 dev / prod / staging */
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '环境 ID' })
  id: string;

  /** 环境展示名 */
  @Column({ type: 'varchar', length: 64, comment: '环境名称' })
  name: string;

  /** 公网访问地址 */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '公网访问地址' })
  publicUrl?: string;

  /** 后端模块服务地址映射: { moduleKey: 'host:port' 或域名 }。前端模块无需地址。 */
  @Column({ type: 'json', nullable: true, comment: '后端模块服务地址映射（host:port 或域名）' })
  ports?: Record<string, string>;

  /** 是否内置环境（dev/prod），内置环境禁止删除 */
  @Column({ type: 'boolean', default: false, comment: '是否内置环境' })
  builtin: boolean;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)', comment: '创建时间' })
  createdAt: Date;

  @Column({
    type: 'datetime',
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
    onUpdate: 'CURRENT_TIMESTAMP(6)',
    comment: '更新时间',
  })
  updatedAt: Date;
}
