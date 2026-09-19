import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * 应用（微前端域）—— 替代旧 `deploy_modules`（前端部分）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.2
 * - `key` 创建后不可改（gateway manifest 依赖）
 * - `kind=shell` 的基座走 `deployMode=site-version`（不纳入 envId 目录，Q107）
 * - 子模块与顶层应用**同构**，仅用 `parentKey` 表达归属（不引入强制层级）
 */
@Entity('deploy_apps')
export class DeployAppEntity {
  /** 应用 key（创建后不可改） */
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '应用 key' })
  key: string;

  @Column({ type: 'varchar', length: 128, comment: '名称' })
  name: string;

  /** 应用类型 */
  @Column({
    type: 'varchar',
    length: 24,
    default: 'micro-frontend',
    comment: '类型 shell/micro-frontend/spa/mini-app',
  })
  @Index()
  kind: 'shell' | 'micro-frontend' | 'spa' | 'mini-app';

  /** 父应用 key（子模块归属；仅展示/分组用） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '父应用 key' })
  parentKey?: string | null;

  /** 仓库目录（apps/<dir>） */
  @Column({ type: 'varchar', length: 128, comment: '仓库目录' })
  repoDir: string;

  /** 构建入口文件名 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '入口文件' })
  entry?: string | null;

  /** 产物公共路径 */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: 'publicPath' })
  publicPath?: string | null;

  /** 共享依赖清单 */
  @Column({ type: 'json', nullable: true, comment: 'externals' })
  externals?: string[] | null;

  /**
   * 部署模式：
   * - `env-dir`（默认）：产物写 `<appKey>/<envId>/<version>/`，按环境切换
   * - `site-version`：基座 shell 专用，按站点 + 版本目录（不纳入 env 切换，Q107）
   */
  @Column({
    type: 'varchar',
    length: 16,
    default: 'env-dir',
    comment: '部署模式 env-dir/site-version',
  })
  deployMode: 'env-dir' | 'site-version';

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
