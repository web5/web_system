import {
  Entity,
  PrimaryColumn,
  Column,
} from 'typeorm';

/**
 * 部署环境注册表 —— **归属模块（1:N）**。
 *
 * 关系：一个模块有多个环境，一个环境只属于一个模块（复合主键 `(module_key, id)`）。
 * dev / prod 是「每模块各一份」的内置环境（builtin，不可删、地址可改）。
 *
 * @deprecated `ports`：旧模型「环境 → 各模块服务地址」的 JSON 映射，已被 `address`
 * 取代。仅迁移回滚期保留（双读：address 优先，回退 ports[moduleKey]），P2 物理删列。
 *
 * 服务器连接信息在 deploy_servers（serverName 服务器组），环境只记组名。
 * 设计见 specs/module-env-ownership/design.md。
 */
@Entity('deploy_environments')
export class DeployEnvironmentEntity {
  /** 所属模块 key（1:N 的「1」侧） */
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '所属模块 key' })
  moduleKey: string;

  /** 环境 ID，模块内唯一（如 dev / prod / staging） */
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '环境 ID（模块内唯一）' })
  id: string;

  /** 环境展示名 */
  @Column({ type: 'varchar', length: 64, comment: '环境名称' })
  name: string;

  /** 公网访问地址 */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '公网访问地址' })
  publicUrl?: string;

  /** 本模块在本环境的服务地址（`host:port` 或域名）；前端类模块无地址，留空 */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '服务地址（host:port 或域名）' })
  address?: string;

  /** 服务器组（deploy_servers.serverName） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '服务器组' })
  serverName?: string;

  /** 可选：覆盖服务器组内的端口 */
  @Column({ type: 'int', nullable: true, comment: '覆盖端口' })
  port?: number;

  /**
   * @deprecated 旧模型「环境 → 各模块服务地址」的 JSON 映射，已被 `address` 取代。
   * 仅迁移回滚期保留，P2 物理删列（见 specs/module-env-ownership/design.md §4）。
   */
  @Column({ type: 'json', nullable: true, comment: '【废弃】后端模块服务地址映射（已由 address 取代）' })
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
