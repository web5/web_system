import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PIPELINE_STAGES } from './deploy-pipeline.entity';

/**
 * 发布脚本 Hook（每模块每阶段一个可编辑的 shell 脚本）。
 *
 * - 数据库是**真相源**；流水线执行时从 DB 读脚本，落盘到发布目录
 *   `hooks/<moduleKey>/<stage>.sh` 作为执行载体（缓存）。
 * - 修改脚本后，下一次执行自动用新脚本（每次执行都从 DB 覆盖落盘文件）。
 * - 未配置的模块/阶段用流水线内置逻辑。
 */
@Entity('deploy_module_hooks')
@Unique(['moduleKey', 'stage'])
export class DeployModuleHookEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '模块 key（关联 deploy_modules.key）' })
  @Index()
  moduleKey: string;

  /** 阶段：PIPELINE_STAGES 之一 */
  @Column({ type: 'varchar', length: 32, comment: '流水线阶段' })
  stage: string;

  /** shell 脚本内容 */
  @Column({ type: 'text', comment: 'shell 脚本内容' })
  script: string;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最后编辑人' })
  updatedBy?: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;

  /** 与流水线阶段保持一致 */
  static STAGES = PIPELINE_STAGES;
}
