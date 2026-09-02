import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 可由模块自定义命令的流水线阶段（真相源在 DB，不在代码）。
 *
 * - `version` / `pointer` 两个阶段**固定由流水线执行**：版本与指针是发布语义真相源，
 *   交给 shell 会重现「传 versionTag 打出当前 HEAD 代码」的历史高危问题，故不在本列。
 * - 其余阶段均可由模块配置 shell 命令；**未配置即 fail-fast**，不回退任何内置硬编码。
 */
export const CONFIGURABLE_STAGES = [
  'check',
  'pull',
  'build',
  'upload',
  'restart',
  'verify',
  'cleanup',
] as const;

export type ConfigurableStage = (typeof CONFIGURABLE_STAGES)[number];

/**
 * 各模块类型的默认构建命令（数据化模板，design.md 决策 4）。
 *
 * 默认值落在 DB 而非 TS 分支：运维可在页面把构建改成任意方式，
 * 无需改代码、无需重建控制台——这正是原先 `stageBuild` 硬编码
 * `nest build`/`vite build` 造成的痛点。
 */
export const DEFAULT_BUILD_TEMPLATE: Record<string, string> = {
  backend: 'npx tsc -p tsconfig.json',
  frontend: 'npx vite build',
  'micro-frontend': 'npx vite build --mode mf',
  'mini-app': 'npx vite build',
};

/**
 * 模块阶段命令（发布流水线唯一执行真相源）。
 *
 * 本表合并了历史上两套互斥机制，终结文档与代码互相矛盾的局面：
 * - `deploy_modules.buildCmd`（旧版自定义构建命令，仅覆盖 build）
 * - `deploy_module_hooks`（每阶段 shell 脚本，但 build 阶段从未接入）
 *
 * 统一后：每模块每阶段一条命令，DB 为真相源，流水线零技术栈知识。
 */
@Entity('deploy_module_stage_commands')
@Unique(['moduleKey', 'stage'])
export class DeployModuleStageCommandEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '模块 key（关联 deploy_modules.key）' })
  @Index()
  moduleKey: string;

  /** 阶段：CONFIGURABLE_STAGES 之一 */
  @Column({ type: 'varchar', length: 32, comment: '流水线阶段' })
  stage: string;

  /** shell 命令（bash -c 执行） */
  @Column({ type: 'text', comment: 'shell 命令' })
  command: string;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  /** 阶段超时（秒）；为空则用流水线全局默认 */
  @Column({ type: 'int', nullable: true, comment: '超时秒数（为空用全局默认）' })
  timeoutSec?: number;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最后编辑人' })
  updatedBy?: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;

  /** 与可配置阶段保持一致 */
  static STAGES = CONFIGURABLE_STAGES;
}
