import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * 站点（入口域名）—— 双域重构新增
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.2
 * 作用：gateway 按请求 Host 匹配站点，进而决定该域名下可切换哪些环境（`switchable` + `defaultEnvId`）。
 */
@Entity('deploy_sites')
export class DeploySiteEntity {
  /** 站点 key：local / dev / prod */
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '站点 key' })
  key: string;

  /** 入口域名（唯一；列级 unique 已隐含索引，勿再叠加 @Index 否则索引名冲突） */
  @Column({ type: 'varchar', length: 128, unique: true, comment: '入口域名' })
  host: string;

  @Column({ type: 'varchar', length: 64, comment: '展示名' })
  name: string;

  /** 该站点默认加载的环境（缺省 dev） */
  @Column({ type: 'varchar', length: 64, default: 'dev', comment: '默认环境 envId' })
  defaultEnvId: string;

  /** 是否在产品页渲染环境切换挂件（prod 站点为 false） */
  @Column({ type: 'boolean', default: false, comment: '是否可切换环境' })
  switchable: boolean;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)' })
  createdAt: Date;
}
