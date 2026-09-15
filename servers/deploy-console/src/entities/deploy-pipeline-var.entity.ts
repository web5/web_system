import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * 流水线变量（deploy_pipeline_vars）。
 *
 * 归属（用户 2026-09-14 定）：**变量跟着流水线走** ——
 * 挂在某一条流水线（流程定义）上，在「编辑流水线」页增删改查，详情页「变量」Tab 只读查看；
 * 不单独成页，也不复用 `config_items`（配置中心 = 服务/模块运行配置，与流水线无关）。
 *
 * 注入优先级（后者覆盖前者）：
 *   平台内置 → 配置中心（global→env→module）→ **流水线变量** → 节点内联
 */
@Entity('deploy_pipeline_vars')
@Index('uq_pipeline_var', ['pipelineId', 'key'], { unique: true })
export class DeployPipelineVarEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '变量 ID（pvar-${ts}-${rand}）' })
  id: string;

  /** 所属流水线（流程定义）ID */
  @Column({ type: 'varchar', length: 64, comment: '所属流水线 ID' })
  @Index()
  pipelineId: string;

  /** 变量名（脚本用 ${KEY} 引用） */
  @Column({ type: 'varchar', length: 64, comment: '变量键' })
  key: string;

  /** 变量值（密钥也存这里，列表侧掩码，不回显明文） */
  @Column({ type: 'text', comment: '变量值' })
  value: string;

  /** 是否密钥：写入后可更新，列表与详情一律掩码 */
  @Column({ type: 'boolean', default: false, comment: '是否密钥' })
  isSecret: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '说明' })
  description?: string;

  @Column({ type: 'boolean', default: true, comment: '是否启用（停用后不注入）' })
  enabled: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '更新人' })
  updatedBy?: string;

  @Column({ type: 'bigint', comment: '创建时间（毫秒）' })
  createdAt: number;

  @Column({ type: 'bigint', comment: '更新时间（毫秒）' })
  updatedAt: number;
}
