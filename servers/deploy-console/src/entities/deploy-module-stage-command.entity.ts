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
 * 各阶段「流程内置」逻辑的对外说明（仅可读视图，不返回实际代码）。
 *
 * 用于 PipelineDetail / ModuleDetail 的「发布脚本」面板：展示某个阶段
 * 由模块自定义（已配置 shell），还是由流水线内置逻辑兜底（无 shell、仅说明文字）。
 *
 * - `check` / `pull` / `restart` / `verify` / `cleanup` / `pointer` / `version`：
 *   都有合理内置逻辑，未配置时走该逻辑
 * - `build`：必填项，未配置即终止发布（fail-fast）
 * - version / pointer：发布语义真相源，不允许用户配置
 */
export const STAGE_BUILTIN_DESCRIPTIONS: Record<string, string> = {
  check:
    '安全基线：校验模块存在与类型（micro-frontend/frontend/backend）；prod 限定 master 分支；指定 commit 时按磁盘产物决定是否复用。',
  pull:
    '内置拉取：发布目录 git fetch → checkout 目标分支 → reset commit → clean；pnpm-lock.yaml 指纹变化才 install；并预构建共享 workspace 包（@web-system/shared / @web-system/types）。',
  build:
    '【必填·由模块提供】每模块独立的构建命令（DB 真相源），可任意 shell；未配置即发布终止。',
  upload:
    '内置投递：frontend 拷贝 dist/ 到发布目录 gateway public 静态资源目录；backend 跳过本阶段。',
  restart:
    '内置重启：仅后端服务，按模块 pm2 名称 `pm2 restart <name>` 重启进程。',
  version:
    '【发布语义真相源·固定由流水线执行】写 deploy_versions 表（库 web_system_deploy，含 git 信息）。',
  pointer:
    '【发布语义真相源·固定由流水线执行】upsert deploy_deployments.current_version；后端服务跳过本阶段。',
  verify:
    '内置探活：frontend 等待 gateway TTL 10s 后 curl __manifest__ 断言版本已切换；backend 通过 pm2.HTTP 探活确认在线。',
  cleanup:
    '内置清理：保留最近 5 个产物版本，清理更旧的（被灰度规则引用的版本跳过）。',
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
