import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Agent 技能库（SKILL.md 行为守则）
 *
 * 一个 Skill = 一段约束 Agent 如何使用一组工具/能力的 Markdown 行为守则
 * （工作流、门禁、工具用法、错误处理、降级兜底）。
 * on-demand 挂载：运行时只注入 description 摘要，模型需要时通过内置
 * load_skill 工具拉取 content 全文。
 */
@Entity('agent_skills')
export class AgentSkillEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true, comment: 'ID' })
  id: number;

  /** 技能唯一标识，如 web-system-finnews（对应 SKILL.md frontmatter 的 name） */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, comment: '技能 code' })
  code: string;

  /** 技能名 */
  @Column({ type: 'varchar', length: 128, comment: '技能名' })
  name: string;

  /** on-demand 时注入 system 的摘要（50~100 字） */
  @Column({ type: 'varchar', length: 512, comment: '技能摘要（on-demand 注入 system）' })
  description: string;

  @Column({ type: 'varchar', length: 32, default: '1.0.0', comment: '版本' })
  version: string;

  /** SKILL.md 正文（Markdown 行为守则） */
  @Column({ type: 'mediumtext', comment: 'SKILL.md 正文' })
  content: string;

  /** 依赖工具：本地工具名 或 mcp:module/tool */
  @Column({ type: 'json', nullable: true, comment: '依赖工具名数组' })
  requiredTools: string[] | null;

  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true, comment: '创建人' })
  createdBy: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 6, comment: '更新时间' })
  updatedAt: Date;
}
