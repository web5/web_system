import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

/**
 * 流水线**配置**版本快照（2026-09-29）。
 *
 * 与 `config_snapshots` 同源思路，但对象是**流水线定义本身**：
 *   每次在控制台保存步骤 / 任务 / 动作（含动作脚本正文），都生成一个 revision。
 *
 * 解决的问题：动作脚本此前以字符串躺在 `deploy_pipeline_actions.script`，
 * 改坏了无从追溯、也无从恢复（2026-09-29 实测：13 条流水线的 prod write-version
 * 脚本被一次坏写入损坏，只能人工重写）。有了 revision，任何一次保存都可回看、可恢复。
 *
 * 设计约束：
 *   - **只增不改不删**：恢复历史版本 = 从旧快照生成一个**新 revision**，
 *     历史记录永远保留（审计与追溯不因回滚而断裂）。
 *   - `snapshot` 存完整编排树（steps → tasks → actions，含脚本正文）+
 *     流水线自身元数据副本（用于展示差异，恢复时只回放编排树）。
 *   - 敏感值不在此表新增：脚本里的口令走 `deploy_pipeline_vars`（isSecret），
 *     快照原样保留脚本正文（与库中同等级，不额外扩散）。
 */
/** 快照中的动作（含脚本正文） */
export interface PipelineActionSnapshot {
  id: string;
  name: string;
  script: string;
  managed?: boolean;
  sort?: number;
  enabled?: boolean;
}

/** 快照中的审批配置（与编排入参 TaskInput.approval 同构） */
export interface PipelineApprovalSnapshot {
  approvers: string[];
  timeoutSec?: number;
  timeoutAction?: 'skip' | 'fail';
  onReject?: 'fail' | 'skip';
}

/** 快照中的任务（含动作） */
export interface PipelineTaskSnapshot {
  id: string;
  kind: 'script' | 'approval';
  name: string;
  condition?: string | null;
  env?: Record<string, string> | null;
  approval?: PipelineApprovalSnapshot | null;
  sort?: number;
  enabled?: boolean;
  actions: PipelineActionSnapshot[];
}

/** 快照中的步骤（含任务） */
export interface PipelineStepSnapshot {
  id: string;
  name: string;
  description?: string | null;
  sort?: number;
  enabled?: boolean;
  tasks: PipelineTaskSnapshot[];
}

/**
 * 快照里的流水线元数据副本（用于展示「这次改动时流水线长什么样」）。
 *
 * 注：`nodes` 以 **JSON 文本**落快照 —— 它是不定结构（平台节点/自定义脚本节点），
 * 既避免快照 schema 与节点 schema 强耦合，也让 TypeORM 的 json 深写入类型可判定。
 * 恢复时只回放 `steps`，nodes 不参与。
 */
export interface PipelineMetaSnapshot {
  id: string;
  key: string;
  name: string;
  moduleKey: string;
  env: string | null;
  description: string | null;
  approval: string;
  approvers: string[] | null;
  defaultTarget: string;
  enabled: boolean;
  builtin: boolean;
  skipVerify: boolean;
  rollbackOnFailure: string;
  nodes: string | null;
}

/** 快照正文：流水线元数据副本 + 完整编排树 */
export interface PipelineSnapshot {
  pipeline?: PipelineMetaSnapshot;
  steps: PipelineStepSnapshot[];
}

@Entity('deploy_pipeline_revisions')
@Index(['pipelineId', 'rev'], { unique: true })
export class DeployPipelineRevisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 所属流水线（deploy_pipelines.id） */
  @Column({ name: 'pipeline_id', type: 'varchar', length: 64, comment: '所属流水线 ID' })
  @Index()
  pipelineId: string;

  /** 版本号（该流水线内单调递增，从 1 开始） */
  @Column({ type: 'int', comment: '配置版本号（流水线内单调递增）' })
  rev: number;

  /**
   * 产生来源：
   *   save-steps  步骤保存
   *   save-tasks  任务/动作保存（含脚本变更）
   *   delete-step 删除步骤（级联）
   *   restore     从历史版本恢复
   *   seed        初始化基线（首次导入/修补）
   */
  @Column({ type: 'varchar', length: 16, comment: '产生来源' })
  source: string;

  /** 变更摘要（人读，如「保存任务 3 个（含动作，全量替换）」） */
  @Column({ type: 'varchar', length: 255, nullable: true, comment: '变更摘要' })
  summary?: string | null;

  /**
   * 完整快照：
   *   { pipeline: {...元数据}, steps: [ { id,name,description,sort,enabled,
   *       tasks: [ { id,kind,name,condition,env,approval,sort,enabled,
   *                  actions: [ { id,name,script,managed,sort,enabled } ] } ] } ] }
   */
  @Column({ type: 'json', comment: '完整编排树快照（含动作脚本正文）' })
  snapshot: PipelineSnapshot;

  /** 恢复来源版本号（source='restore' 时记录从哪个版本恢复） */
  @Column({
    name: 'restored_from_rev',
    type: 'int',
    nullable: true,
    comment: '恢复来源版本号（restore 时）',
  })
  restoredFromRev?: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '操作人' })
  createdBy?: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;
}
