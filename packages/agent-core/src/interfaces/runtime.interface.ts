/**
 * Agent 运行时接口（RunInput / StreamEvent）。
 */
import type { ThinkingOption } from '../clients/base-ai.client';

export type StreamEventType =
  | 'content_delta'
  | 'reasoning_delta'
  | 'tool_call'
  | 'tool_result'
  | 'skill_load'
  | 'summary'
  | 'final'
  | 'error'
  | 'permission_request'
  /** 意图路由决策结果：必须是本轮第一个事件（早于任何 token 增量） */
  | 'intent'
  /** 结构化卡片：由工具结果转换后补发（kind 区分卡片类型，一期 'music'） */
  | 'card';

export interface StreamEvent {
  type: StreamEventType;
  /**
   * intent 事件专用：路由决策结果。
   * 客户端据此渲染 agent 徽标 / 排查误判；服务端须在第一个 token 之前推送。
   */
  intent?: {
    agentId: string;
    agentName?: string;
    /** 0~1 */
    confidence: number;
    via: 'explicit' | 'locked' | 'rule' | 'llm' | 'fallback';
    switched?: boolean;
    previousAgentId?: string;
  };
  content?: string;
  name?: string;
  args?: unknown;
  step?: number;
  conversationId?: string;
  /**
   * permission_request 专用：确认请求 id。
   * 客户端据此调用确认接口（approve/reject），服务端挂起工具执行直到确认。
   */
  requestId?: string;
  /**
   * card 事件专用载荷：结构化卡片。
   * kind 区分卡片类型（一期 'music'），其余字段随 kind 扩展。
   * 契约：卡片类型与新增 kind 须在 `docs/api/contracts.md` C2 登记；
   *       已知值给 IDE 提示，`(string & {})` 保留扩展位（新 kind 不破坏消费方编译）。
   */
  card?: {
    kind: 'music' | (string & {});
    [key: string]: unknown;
  };
  /** 本轮对话累计的 token 消耗（final/error 事件携带，来自大模型返回的 usage） */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /**
   * 本轮 run 的唯一 id（N5，2026-10-26）。
   * intent / final / error 事件携带；与 `agent_runs.id` 同值，
   * 前端日志据此直接反查 agent_runs 那一行（C2 契约，可选字段，旧消费方忽略即可）。
   */
  runId?: string;
}

export interface RunInput {
  agentId: string;
  userInput: string;
  conversationId?: string;
  /**
   * 临时覆盖 Agent 定义中的模型（调试/对比用）。
   * 不传则用 Agent 定义里的 model；传入时仅本次运行生效，不修改 Agent 定义。
   */
  model?: string;
  /**
   * 运行场景（N3 装配侧过滤，2026-10-26）：
   * - 'admin'：调试台，有 HITL 确认 UI，装配全部工具；
   * - 'c-end'：小程序等无 HITL 场景，**不装配** `requiresConfirm` 工具
   *   （宁可不给模型看，也不要「调了才发现要确认、挂 60s 被拒」）。
   * 缺省不过滤（向后兼容）。
   */
  scene?: 'admin' | 'c-end';
  /**
   * P2 单次覆盖思考开关（D1 分层输入，仅非工具场景优先；
   * 带工具场景会被共享策略强制纠正为 enabled）。
   * 与 Agent 定义层 `thinking`（P3）**分层不预合并**，由 `resolveThinking` 闭环判定。
   */
  thinking?: ThinkingOption | null;
}
