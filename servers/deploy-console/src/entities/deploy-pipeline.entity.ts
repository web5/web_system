import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
} from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/** 流水线阶段（顺序即执行顺序） */
export const PIPELINE_STAGES = [
  'check',
  'pull',      // 发布目录 git 拉取（fetch + checkout 分支 + reset commit）
  'build',     // 前端 vite build / 后端 nest build
  'upload',    // 前端产物投递
  'restart',   // 后端 pm2 重启
  'version',   // 写版本表
  'pointer',   // 前端切指针 / 灰度规则
  'verify',    // 前端 manifest / 后端 health check
  'cleanup',   // 清理旧版本
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** 发布模式：direct=直接全量；grayscale=灰度（写灰度规则，不切 stable 指针） */
export type PipelineMode = 'direct' | 'grayscale';

/**
 * 发布流水线任务。
 *
 * 把历史上人肉执行的「构建 → 拷贝产物 → 写版本表 → 切指针 → 等 TTL 验证 → 清理旧版本」
 * 固化为一条可追踪、可重试、可取消的流水线。
 *
 * 与 deploy_tasks 的区别：deploy_tasks 是脚本级任务（build/deploy/rollback），
 * deploy_pipelines 是发布流程级任务，带阶段进度与灰度语义。
 */
@Entity('deploy_pipelines')
export class DeployPipelineEntity extends AbstractEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '流水线 ID（${Date.now()}-${rand}）' })
  id: string;

  @Column({ type: 'varchar', length: 16, comment: '环境 dev/prod' })
  @Index()
  env: string;

  @Column({ type: 'varchar', length: 64, comment: '模块 key' })
  @Index()
  moduleKey: string;

  /** 实际发布的版本标签（git commit 短哈希），提交时为空，check 阶段后确定 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '发布版本标签' })
  versionTag?: string;

  @Column({ type: 'varchar', length: 16, default: 'direct', comment: '模式 direct/grayscale' })
  mode: string;

  /** 状态: pending | running | succeeded | failed | cancelled */
  @Column({ type: 'varchar', length: 16, default: 'pending', comment: '状态 pending/running/succeeded/failed/cancelled' })
  @Index()
  status: string;

  /** 当前阶段（PIPELINE_STAGES 之一），终态后保留最后阶段 */
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '当前阶段' })
  stage?: string;

  @Column({ type: 'json', nullable: true, comment: '进度 {current,total,message}' })
  progress?: { current: number; total: number; message: string };

  @Column({ type: 'json', nullable: true, comment: '阶段日志（JSON 数组）' })
  logs?: string[];

  @Column({ type: 'text', nullable: true, comment: '错误信息' })
  error?: string;

  /** 操作人：MCP 调用时为 API Key 的 ownerId，控制台调用时为登录用户名 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '操作人' })
  operator?: string;

  /** 模块类型快照（check 阶段确定）：micro-frontend / frontend / backend */
  @Column({ type: 'varchar', length: 32, nullable: true, comment: '模块类型快照' })
  moduleType?: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '来源 Git 分支' })
  gitBranch?: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '来源 Git commit' })
  gitCommit?: string;

  /** 灰度参数：{ type: 'percent'|'user-list'|'header', ... }，仅 mode=grayscale 时有值 */
  @Column({ type: 'json', nullable: true, comment: '灰度规则参数' })
  grayscaleRule?: Record<string, unknown>;

  /** 灰度模式创建的规则 ID，promote/回滚时用 */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '关联的灰度规则 ID' })
  canaryRuleId?: string;

  /**
   * 是否复用磁盘上已有产物（跳过 build / upload 两阶段）。
   *
   * 指定 versionTag 发布历史版本时为 true：产物已存在就不重新构建 ——
   * 否则会拿当前工作区代码打出历史版本号，造成「版本与代码不一致」。
   */
  @Column({ type: 'boolean', default: false, comment: '是否复用已有产物（跳过构建与投递）' })
  reuseArtifact?: boolean;

  @Column({ type: 'json', nullable: true, comment: '发布结果快照（产物路径/验证结果等）' })
  result?: Record<string, unknown>;

  /** 实例所用流水线模板（提交时快照，模板后续变更不影响历史实例） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '流水线模板 ID（快照）' })
  templateId?: string;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '流水线模板名（快照）' })
  templateName?: string;

  /** 跳过 verify（快线）——模板快照固化到实例 */
  @Column({ type: 'boolean', default: false, comment: '跳过探活验证（模板快照）' })
  skipVerify?: boolean;

  /** 活动阶段快照：null=全部九阶段（模板 steps 子集，提交时固化） */
  @Column({ type: 'json', nullable: true, comment: '活动阶段快照（null=全量）' })
  steps?: string[] | null;

  /** 失败自动回滚开关快照（previous/none） */
  @Column({ type: 'varchar', length: 8, default: 'previous', comment: '失败自动回滚快照' })
  rollbackOnFailure?: string;

  /** 投递目标快照（提交时模板 defaultTarget/入参确定；auto 提交时解析默认） */
  @Column({ type: 'varchar', length: 8, nullable: true, comment: '投递目标快照 auto/local/remote' })
  runTarget?: string;

  @Column({ type: 'bigint', comment: '开始时间（毫秒时间戳）' })
  @Index()
  startTime: number;

  @Column({ type: 'bigint', nullable: true, comment: '结束时间（毫秒时间戳）' })
  endTime?: number;
}
