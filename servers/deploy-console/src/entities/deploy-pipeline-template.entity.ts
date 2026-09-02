import { Entity, PrimaryColumn, Column, Index, Unique } from 'typeorm';

export type TemplateApproval = 'inherit' | 'always' | 'never';
export type TemplateTarget = 'auto' | 'local' | 'remote';

/**
 * 流水线模板（流程定义）：模块下可建多条"发布流程"。
 *
 * v1（S6-I）可配置面：
 * - skipVerify：跳过探活验证（快线/调试线）
 * - approval：审批策略（always/never 覆盖环境规则；inherit 沿用）
 * - defaultTarget：默认投递（提交未指定时使用）
 *
 * 每模块有一条 `builtin=true` 的「默认」模板（懒建、不可删除/改名），
 * 语义=现状（全流程 + 环境规则审批）；旧调用/MCP 不传模板即走它，保证兼容。
 *
 * S6-II 将扩展 steps 序列与工具绑定（见 design.md v2）。
 */
@Entity('deploy_pipeline_templates')
@Unique('uq_tpl_module_name', ['moduleKey', 'name'])
export class DeployPipelineTemplateEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '模板 ID（tpl-${ts}-${rand}）' })
  id: string;

  @Column({ type: 'varchar', length: 64, comment: '归属模块 key' })
  @Index()
  moduleKey: string;

  /** 模块内唯一（uq_tpl_module_name）；builtin 模板固定为「默认」 */
  @Column({ type: 'varchar', length: 64, comment: '模板名（模块内唯一）' })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '说明' })
  description?: string;

  @Column({ type: 'boolean', default: false, comment: '跳过探活验证（快线；由 steps 派生，兼容保留）' })
  skipVerify: boolean;

  /** 活动阶段子集：null=全部九阶段；仅可裁剪不可重排，必含 check/version/pointer */
  @Column({ type: 'json', nullable: true, comment: '活动阶段子集（null=全量，保序子序列）' })
  steps?: string[] | null;

  /** verify 失败自动回滚：previous=回滚上一版本（默认）；none=不回滚 */
  @Column({ type: 'varchar', length: 8, default: 'previous', comment: '失败自动回滚 previous/none' })
  rollbackOnFailure: 'previous' | 'none';

  @Column({ type: 'varchar', length: 8, default: 'inherit', comment: '审批策略 inherit/always/never' })
  approval: TemplateApproval;

  @Column({ type: 'varchar', length: 8, default: 'auto', comment: '默认投递 auto/local/remote' })
  defaultTarget: TemplateTarget;

  @Column({ type: 'boolean', default: true, comment: '启用；停用后不可被提交引用' })
  enabled: boolean;

  @Column({ type: 'boolean', default: false, comment: '内置默认模板（不可删除/改名）' })
  builtin: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '创建人' })
  createdBy?: string;

  @Column({ type: 'datetime', precision: 6, default: () => 'CURRENT_TIMESTAMP(6)', comment: '创建时间' })
  createdAt: Date;

  @Column({
    type: 'datetime',
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
    onUpdate: 'CURRENT_TIMESTAMP(6)',
    comment: '更新时间',
  })
  updatedAt: Date;
}
