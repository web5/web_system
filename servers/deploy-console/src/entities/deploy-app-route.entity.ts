import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from 'typeorm';

/**
 * shell 挂载路由（微前端域）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.2
 * 约束：UNIQUE(appKey, mountPath) —— 冲突检测（FR-2.2）由数据层兜底。
 * 保存此表**只改配置、不触发发布**（FR-2.3）。
 */
@Entity('deploy_app_routes')
@Unique(['appKey', 'mountPath'])
export class DeployAppRouteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '应用 key' })
  @Index()
  appKey: string;

  /** 挂载路径（如 /admin） */
  @Column({ type: 'varchar', length: 128, comment: '挂载路径' })
  mountPath: string;

  /** 激活规则（默认同挂载路径） */
  @Column({ type: 'varchar', length: 128, comment: '激活规则' })
  activeRule: string;

  @Column({ type: 'boolean', default: true, comment: '是否需要鉴权' })
  requireAuth: boolean;

  @Column({ type: 'int', default: 0, comment: '排序' })
  sort: number;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;
}
