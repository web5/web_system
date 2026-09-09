/**
 * 引擎遥测出口（Phase2.1）。
 *
 * 宿主（ai-agent / ai-service）可选注入做结构化观测与成本统计。
 * 引擎仅在关键生命周期发出事件；端口方法全部可选、异常被引擎吞掉，
 * 保证遥测故障不影响 run 主链路。字段口径对齐 OTel GenAI SemConv 的
 * agent/llm/tool span 语义（仅对齐 schema，不引 otel SDK）。
 */

export interface TelemetryRunBase {
  runId: string;
  ts: number;
}

/** run 开始（agent span 语义） */
export interface TelemetryRunStart extends TelemetryRunBase {
  agentId: string;
  /** 定义版本快照（AgentDefinition.version，DB 下发填充；未知为空） */
  agentVersion?: string;
  userId: string;
  model: string;
}

/** 一次模型调用（llm span 语义；对齐 gen_ai.operation.name / gen_ai.usage.*） */
export interface TelemetryLlmSpan extends TelemetryRunBase {
  operation: 'chat_with_tools';
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  step: number;
}

/** 一次工具执行（tool span 语义；对齐 gen_ai.tool.name） */
export interface TelemetryToolSpan extends TelemetryRunBase {
  tool: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
  step: number;
}

/** on-demand 技能加载 */
export interface TelemetrySkillLoad extends TelemetryRunBase {
  skill: string;
  step: number;
}

/** run 结束（成败 / 耗时 / token 汇总） */
export interface TelemetryRunEnd extends TelemetryRunBase {
  status: 'ok' | 'error';
  error?: string;
  durationMs: number;
  totalTokens: number;
}

/** 可注入的可选遥测端口（方法全可选；宿主只实现关心的即可） */
export interface TelemetryPort {
  onRunStart?(e: TelemetryRunStart): void | Promise<void>;
  onLlmSpan?(e: TelemetryLlmSpan): void | Promise<void>;
  onToolSpan?(e: TelemetryToolSpan): void | Promise<void>;
  onSkillLoad?(e: TelemetrySkillLoad): void | Promise<void>;
  onRunEnd?(e: TelemetryRunEnd): void | Promise<void>;
}
