import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from 'typeorm';

/**
 * 应用 × 环境的版本指针（**前端 env-dir 应用**域）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.2（Q103：**无 slotKey**）
 * - `currentVersion` 指向产物目录 `<appKey>/<envId>/<version>/`
 * - 切换版本 / 回滚 = 只改写 `envId/index.js` 入口指针 + 本表指针（不重新构建）
 * - gateway `__manifest__` 的 `byEnv[envId]` 由此表解析
 *
 * ⚠️ 2026-09-28 更正早期表述「替代旧 `deploy_deployments` 的 env 维度」：
 *   本表**只覆盖前端 env-dir 应用**（deploy_apps.deploy_mode='env-dir'，当前 admin / portal）。
 *   后端服务的版本指针仍在 `deploy_deployments`（新模型无对应载体），
 *   发布时由 `ReleaseRegistryService.setPointer` 双写：前端写两处，后端只写旧表。
 *   ⇒ 迁移期两轨必须同步，否则旧 shell（只认 legacy `modules[]`）会拿到陈旧产物
 *     （2026-09-28 dev 页面 404 事故即由此而来）。
 */
@Entity('deploy_app_env_versions')
@Unique(['appKey', 'envId'])
export class DeployAppEnvVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '应用 key' })
  @Index()
  appKey: string;

  @Column({ type: 'varchar', length: 64, comment: '环境 envId' })
  @Index()
  envId: string;

  /** 当前版本（git short sha，指向 `<envId>/<version>/`） */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '当前版本' })
  currentVersion?: string | null;

  /** 上一版本（回滚默认目标） */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: '上一版本' })
  previousVersion?: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: 'unknown',
    comment: '状态 deployed/unknown/failed',
  })
  status: 'deployed' | 'unknown' | 'failed';

  @Column({ type: 'datetime', precision: 6, nullable: true, comment: '发布时间' })
  deployedAt?: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '发布人' })
  deployedBy?: string | null;

  /** 关联的流水线运行 ID */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '流水线运行 ID' })
  taskId?: string | null;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;
}
