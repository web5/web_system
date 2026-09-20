import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * 环境（微前端加载维度）—— 双域重构新增（**替代旧 `deploy_environments` + `deploy_env_slots`**）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.2
 * - `envId` 即产物目录名：`/static/modules/<appKey>/<envId>/`
 * - 内置保留字：`dev`（主开发，回退目标）/ `local` / `prod`
 * - 用户创建：**系统自增数字**（用户不填 ID）
 * - 约束：`isProd=true` 全局至多一条；`envId` 须匹配 `^[a-z0-9_-]+$`（作为 URL 段与目录名）
 * - 无 slot 概念（dev1/dev2 即多个并列环境）
 */
@Entity('deploy_envs')
export class DeployEnvEntity {
  /** 环境标识 = 产物目录名（内置保留字或自增数字） */
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '环境 ID（目录名）' })
  envId: string;

  /** 展示名（用户填写） */
  @Column({ type: 'varchar', length: 64, comment: '环境名称' })
  name: string;

  /** 归属站点（1 个 envId 属 1 个站点） */
  @Column({ type: 'varchar', length: 32, comment: '归属站点 key' })
  @Index()
  siteKey: string;

  /** 生产环境标记（全局至多一条） */
  @Column({ type: 'boolean', default: false, comment: '是否生产环境' })
  @Index()
  isProd: boolean;

  /** 内置环境（dev/local/prod）不可删 */
  @Column({ type: 'boolean', default: false, comment: '是否内置' })
  builtin: boolean;

  /** 切换挂件中的排序 */
  @Column({ type: 'int', default: 0, comment: '排序' })
  sort: number;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;
}
