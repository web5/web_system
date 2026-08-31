import { Column, Entity, PrimaryColumn, Index } from 'typeorm';
import { AbstractEntity } from '@web-system/shared';
import { CapabilityRef, SkillRef } from '@kedouai/agent-core';

/**
 * Agent 定义主表（数据库配置化）
 *
 * 每行一个 agent 的"当前发布版本"快照，主键 = agentId（agent-core 的 AgentDefinition.id）。
 * 各服务（ai-agent / ai-service）启动 + 定时轮询从 ai-service 拉取本表 published 且 enabled
 * 的定义，覆盖本地 AgentRegistry，实现"改 prompt 运行时生效"。
 *
 * 兼容约定：AgentDefinition 的可配置字段都在这里；tools 仍存名字数组，工具实现留代码（二期 MCP 化）。
 * 来源优先级：DB（本表）> 代码内置定义（*.agent.ts，一期迁移完删除）。
 */
@Entity('agent_definitions')
export class AgentDefinitionEntity extends AbstractEntity {
  /** agent id（与 AgentDefinition.id 对齐），作为主键 */
  @PrimaryColumn({ type: 'varchar', length: 64, comment: 'agent id' })
  id: string;

  /** 展示名 */
  @Column({ type: 'varchar', length: 128, comment: 'Agent 名称' })
  name: string;

  /** systemPrompt 原文（可含换行，用 text） */
  @Column({ type: 'mediumtext', comment: 'systemPrompt' })
  systemPrompt: string;

  /** 模型 id（clientRegistry 中注册的 id，如 hy3 / deepseek） */
  @Column({ type: 'varchar', length: 64, comment: '模型 id' })
  model: string;

  /** 工具名数组（AgentDefinition.tools，兼容旧数据；新配置统一走 capabilities） */
  @Column({ type: 'json', comment: '工具名数组' })
  tools: string[];

  /** 能力数组：本地工具 / MCP 远程工具 / Skill 三类统一引用 */
  @Column({ type: 'json', nullable: true, comment: '能力数组（tool/mcp/skill）' })
  capabilities: CapabilityRef[] | null;

  /** 可挂载技能摘要目录（发布时从 capabilities 中 skill 类型 + 技能表解析） */
  @Column({ type: 'json', nullable: true, comment: '可挂载技能摘要目录' })
  skills: SkillRef[] | null;

  /** 最大步数 */
  @Column({ type: 'int', default: 10, comment: '最大步数' })
  maxSteps: number;

  /** 采样温度 */
  @Column({ type: 'float', nullable: true, comment: '采样温度' })
  temperature: number | null;

  /** 记忆配置（AgentMemoryConfig） */
  @Column({ type: 'json', comment: '记忆配置' })
  memory: {
    compactionThreshold: number;
    keepRecent: number;
    enabled: boolean;
  };

  /** 是否流式输出（默认 true；false=最终回答一次性输出） */
  @Column({ type: 'boolean', default: true, comment: '是否流式输出' })
  streaming: boolean;

  /** 当前版本号（每次 publish +1） */
  @Column({ type: 'int', default: 1, comment: '当前版本号' })
  version: number;

  /** 状态：published=已发布（服务端加载）；draft=草稿（未发布，不生效） */
  @Column({ type: 'varchar', length: 16, default: 'draft', comment: '状态：published/draft' })
  status: 'published' | 'draft';

  /** 是否启用（disabled 则不参与加载，等价下线该 agent） */
  @Column({ type: 'boolean', default: true, comment: '是否启用' })
  enabled: boolean;

  /** 最近一次发布时间 */
  @Column({ type: 'datetime', nullable: true, precision: 6, comment: '最近发布时间' })
  publishedAt: Date | null;

  /** 最近更新人（admin 用户名） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '更新人' })
  updatedBy: string | null;
}
