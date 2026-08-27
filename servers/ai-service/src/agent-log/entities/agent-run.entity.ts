import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AbstractEntity } from '@web-system/shared';

/**
 * Agent 运行记录（统一存放在 ai-service 库，方便 admin 统一 debug）
 *
 * 设计目的：开发/运营查看每个 agent 每次 run 的完整原始数据（prompt、消息、工具调用、最终回答），
 * 用来调优 system prompt、tool 设计、对话记忆策略。
 *
 * 写入点：
 *  - ai-service 的 AgentController 在 SSE 流结束后写入（本地 agents：study-assistant、bianbian）
 *  - ai-agent（port 6010 的 contract-risk）完成后通过 internal HTTP 接口推送到 ai-service 落库
 *
 * 一次 run 一行。raw 字段都尽量保留原始字节（用 JSON 列），不做归一化处理。
 */
@Entity('agent_runs')
@Index('idx_agent_runs_agent', ['agentId'])
@Index('idx_agent_runs_user', ['userId'])
@Index('idx_agent_runs_conversation', ['conversationId'])
@Index('idx_agent_runs_created', ['createdAt'])
export class AgentRun extends AbstractEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 哪个 agent（与 agent-core 的 AgentDefinition.id 对齐，如 contract-risk / study-assistant） */
  @Column({ type: 'varchar', length: 64, comment: 'Agent id' })
  agentId: string;

  /** Agent 名称（快照，方便列表展示） */
  @Column({ type: 'varchar', length: 128, nullable: true, comment: 'Agent 名称' })
  agentName: string | null;

  /** 调用方用户 id（JWT sub） */
  @Column({ type: 'varchar', length: 64, comment: '调用方用户 id' })
  userId: string;

  /** 会话 id（与 conversationId 一致，可空——ai-agent 落库后才有） */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '会话 id' })
  conversationId: string | null;

  /** 用户原始输入（userInput） */
  @Column({ type: 'mediumtext', comment: '用户输入原文' })
  userInput: string;

  /** agent 的 systemPrompt 原文快照（不读注册表，确保即使 agent 定义变了也保留历史） */
  @Column({ type: 'mediumtext', comment: 'systemPrompt 原文快照' })
  systemPrompt: string;

  /** Agent 声明的工具列表（便于排查 tool 调用是否超出声明） */
  @Column({ type: 'json', nullable: true, comment: 'Agent 工具声明' })
  tools: string[] | null;

  /** Agent 模型 id */
  @Column({ type: 'varchar', length: 64, nullable: true, comment: '模型 id' })
  model: string | null;

  /**
   * 完整 run 步骤流水，按发生顺序存储：
   * [{ type, name?, content?, step?, ts }]（start/tool_call/tool_result/final/error 等）
   * 用 JSON 保留原始事件，方便回放调试
   */
  @Column({ type: 'json', comment: '完整步骤流水' })
  steps: Array<{
    type: string;
    name?: string;
    content?: string;
    args?: unknown;
    step?: number;
    ts: number;
  }>;

  /** 最终输出（final 事件 content，AI 整理后的回答） */
  @Column({ type: 'mediumtext', nullable: true, comment: 'AI 最终输出' })
  finalAnswer: string | null;

  /** 错误信息（error 事件 content） */
  @Column({ type: 'text', nullable: true, comment: '错误信息' })
  error: string | null;

  /** run 状态：ok / error */
  @Column({ type: 'varchar', length: 16, default: 'ok', comment: '运行状态' })
  status: 'ok' | 'error';

  /** 总耗时（ms） */
  @Column({ type: 'int', nullable: true, comment: '总耗时 ms' })
  durationMs: number | null;

  /** run 所在服务（ai-service / ai-agent），方便区分来源 */
  @Column({ type: 'varchar', length: 32, default: 'ai-service', comment: '来源服务' })
  source: string;
}
