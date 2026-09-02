import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * 工具注册表（S6-II）。
 *
 * 平台"能力单元"统一目录，供模板步骤编排与阶段命令编辑器参考：
 * - kind=service：平台内置执行器（探活/写版本/切指针/回滚/重启/投递/清理…），由 executeStage 分派
 * - kind=shell：外部 CLI（git/pnpm/scp/pm2/curl…），可参数化为 shell 命令
 *
 * 每个 service 工具即 design.md v2 中"步骤执行器"的对外元数据；code 与内置步骤一一对应。
 */
@Entity('deploy_tool_catalog')
export class DeployToolEntity {
  @PrimaryColumn({ type: 'varchar', length: 64, comment: '工具 code（shell 工具用命令名；service 工具与内置步骤对应）' })
  code: string;

  @Column({ type: 'varchar', length: 64, comment: '工具名' })
  name: string;

  /** service=平台内置执行器；shell=外部 CLI */
  @Column({ type: 'varchar', length: 16, comment: 'kind service/shell' })
  kind: 'service' | 'shell';

  /** 分类：code(代码) / build(构建) / deploy(投递部署) / probe(探活) / semantic(发布语义) / cleanup(清理) / generic */
  @Column({ type: 'varchar', length: 32, comment: '分类' })
  category: string;

  @Column({ type: 'text', nullable: true, comment: '说明' })
  description?: string;

  @Column({ type: 'text', nullable: true, comment: '示例（shell 命令片段或 service 工具说明）' })
  example?: string;

  @Column({ type: 'boolean', default: true, comment: '是否可用（停用后模板编辑器不推荐/不可选）' })
  available: boolean;

  @Column({ type: 'boolean', default: false, comment: '种子内置工具（service 内置不可删除；shell 种子可停用不可删）' })
  builtin: boolean;

  @Column({
    type: 'datetime',
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
    onUpdate: 'CURRENT_TIMESTAMP(6)',
    comment: '更新时间',
  })
  updatedAt: Date;
}
