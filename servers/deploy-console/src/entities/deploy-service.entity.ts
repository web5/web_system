import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * 服务（API 网关域）—— 替代旧 `deploy_modules`（backend 部分）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.3
 * - `key` 沿用旧 module key（**不重命名**），保证流水线历史 `moduleKey` 零改造
 * - `deployChannel=legacy` 供 `deploy-console` 自身使用（传统发布，不能自杀式重启）
 */
@Entity('deploy_services')
export class DeployServiceEntity {
  /** 服务 key（创建后不可改；沿用旧 module key） */
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '服务 key' })
  key: string;

  @Column({ type: 'varchar', length: 128, comment: '名称' })
  name: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: 'nest',
    comment: '类型 nest/express/mcp/static',
  })
  @Index()
  kind: 'nest' | 'express' | 'mcp' | 'static';

  /** 仓库目录（servers/<dir>） */
  @Column({ type: 'varchar', length: 128, comment: '仓库目录' })
  repoDir: string;

  /** pm2 进程名（runtime=pm2 时使用） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: 'pm2 进程名' })
  pm2Name?: string | null;

  @Column({ type: 'int', nullable: true, comment: '默认端口' })
  defaultPort?: number | null;

  @Column({ type: 'varchar', length: 128, default: '/health', comment: '探活路径' })
  healthPath: string;

  /** 未登记接口策略（默认放行，迁移期） */
  @Column({
    type: 'varchar',
    length: 16,
    default: 'allow',
    comment: '未登记接口策略 allow/deny',
  })
  unknownPolicy: 'allow' | 'deny';

  /**
   * 发布通道：
   * - `managed`（默认）：走流水线（构建 → 上传 → 重启 → 探活）
   * - `legacy`：走传统发布脚本（`deploy-console` 自身专用）
   */
  @Column({
    type: 'varchar',
    length: 16,
    default: 'managed',
    comment: '发布通道 managed/legacy',
  })
  deployChannel: 'managed' | 'legacy';

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '描述' })
  description?: string | null;

  @Column({ type: 'boolean', default: false, comment: '是否内置' })
  builtin: boolean;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'datetime', precision: 6, nullable: true, comment: '软删除时间' })
  deletedAt?: Date | null;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;
}
