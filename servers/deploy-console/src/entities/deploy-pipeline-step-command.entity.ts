import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 操作执行类型：shell=自写脚本 / service=引用工具目录里的内置工具（沿用 v4 StageAction） */
export type StepActionType = 'shell' | 'service';

/**
 * 流水线节点内的一个执行动作（沿用 v4 StageAction 结构）。
 *
 * 与「节点」的职责边界：节点是流程语义单元（编排/失败策略），操作只是执行动作。
 */
export interface StepAction {
  id: string;
  type: StepActionType;
  name: string;
  /** type=shell 时的脚本正文（bash -c 执行） */
  code?: string;
  /** type=service 时引用的工具 code（deploy_tool_catalog.code） */
  tool?: string;
  /** 操作级超时（秒）；为空用节点级 timeoutSec */
  timeoutSec?: number;
  /** continueOnError：该操作失败不中断节点（护栏类操作用） */
  cont?: boolean;
  enabled?: boolean;
  /** 平台内置操作（如 git 的拉取），不可删除 */
  builtin?: boolean;
}

/**
 * 流水线节点命令（R6 新真相源：流水线 × 节点 key）。
 *
 * 取代 `deploy_module_stage_commands`（模块 × 阶段 key）——命令从模块搬进流水线，
 * 模块退化为纯目标与上下文（{MODULE_*} 变量注入）。
 *
 * 每条记录 = 一个流水线的一个 script 节点的完整操作序列。
 * platform 节点（git/version/pointer）不可写（发布语义真相源，由流水线引擎固定执行）。
 */
@Entity('deploy_pipeline_step_commands')
@Unique(['pipelineId', 'nodeKey'])
export class DeployPipelineStepCommandEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 归属流水线 ID（关联 deploy_pipelines.id）。
   * 物理列名仍是历史的 `template_id`：改名只动语义层，避免数据迁移（见 specs/deploy-console/pipeline-naming.md）。
   */
  @Column({ name: 'template_id', type: 'varchar', length: 64, comment: '流水线 ID' })
  @Index()
  pipelineId: string;

  /** 节点 key（= TemplateNode.key；platform 保留字不可写） */
  @Column({ type: 'varchar', length: 32, comment: '节点 key' })
  nodeKey: string;

  /** shell 命令（bash -c 执行）—— 单操作形态，多操作为空时回退到它 */
  @Column({ type: 'text', comment: 'shell 命令（单操作形态兜底）' })
  command: string;

  /**
   * 多操作：一个节点内 1..N 个执行动作，顺序执行。
   * 兼容：`actions` 为空时回退执行 `command`（等价单操作）。
   */
  @Column({ type: 'json', nullable: true, comment: '节点内多操作（v4），为空回退 command' })
  actions?: StepAction[] | null;

  /**
   * 环境分支配置：`{ [envId]: 该环境的脚本 }`（specs/pipeline-env-branch/design.md §3.1）。
   *
   * 非空 = 该节点启用环境分支：保存时由它**拼装**出单一执行体，同时写入
   * `command` 与 `actions[shell].code`（执行体真相源在后者，见 pickStepActions）。
   * 因此页面手改脚本会在下次保存时被覆盖 —— 编辑入口只有「环境分支」。
   *
   * 未配置脚本的环境 → 拼装结果里落 fail-fast 分支（不做静默回落）。
   *
   * @deprecated 已由「步骤任务」实体取代（specs/pipeline-step-branch/design.md）：
   * 分支改为独立表 `deploy_pipeline_step_branches`，本列保留仅为兼容存量数据，
   * 迁移 p15 会把它落成任务行并置空。新代码不要再读它。
   */
  @Column({
    name: 'env_branches',
    type: 'json',
    nullable: true,
    comment: '（已废弃，迁移 p15 后为空）环境分支配置',
  })
  envBranches?: Record<string, string> | null;

  /**
   * 步骤执行条件（gate）。
   *
   * 语法见 `steps/condition.ts`：`KEY == VALUE [&& KEY == VALUE]`，与步骤任务的匹配条件同一引擎。
   * 空 = 恒执行；求值为 false → **跳过整个步骤**（日志记「执行条件不满足，已跳过」），流程继续；
   * 表达式非法 → 该步骤失败。
   */
  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '步骤执行条件；不满足则跳过整个步骤',
  })
  condition?: string | null;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  /**
   * 平台托管（`locked=true`）：接口拒写、页面只读，写入只经代码内置脚本同步。
   *
   * 语义是"进 DB 真相源、但不允许页面改坏" —— git 拉取属发布语义基线，运维可在库里
   * 审计/临时调整，但不能从控制台随意编辑（改坏即所有模板的拉码行为一起错）。
   */
  @Column({ type: 'boolean', default: false, comment: '平台托管：接口拒写、页面只读' })
  locked: boolean;

  /** 节点级超时（秒）；为空则用流水线全局默认 */
  @Column({ type: 'int', nullable: true, comment: '超时秒数（为空用全局默认）' })
  timeoutSec?: number;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '最后编辑人' })
  updatedBy?: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;
}
