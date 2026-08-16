import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';

/**
 * 只读镜像 deploy-console 的 deploy_modules 表（模块注册表）。
 * gateway 仅读取模块类型/入口等信息，供 __version__ 端点与微前端基座使用。
 */
@Entity('deploy_modules')
export class DeployModuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  /** backend | frontend | micro-frontend | mini-app */
  @Column({ type: 'varchar', length: 32 })
  type: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  publicPath?: string;

  /** 微前端远程入口，如 remoteEntry.js */
  @Column({ type: 'varchar', length: 128, nullable: true })
  entry?: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;
}
