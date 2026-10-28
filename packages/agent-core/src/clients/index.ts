/**
 * 轻量客户端入口（REQ-2 / #271）。
 *
 * 只导出 chat 能力（Hy3Client / TokenHubClient / BaseAiClient / 类型），
 * 不拖入 AgentEngine / registry / memory 等重模块。
 * content-hub 等只需 LLM 调用的消费方引 `@kedouai/agent-core/clients` 即可。
 */
export { BaseAiClient, parseJsonToolCall } from './base-ai.client';
export type {
  ChatMessage,
  ChatOptions,
  ChatWithToolsResult,
  StreamChunk,
  StreamToolEvent,
  ThinkingOption,
  ToolCall,
  ToolCallSchema,
  TokenUsage,
  ModelInfo,
} from './base-ai.client';
export { Hy3Client } from './hy3.client';
export { TokenHubClient } from './tokenhub.client';
// D1 think 统一策略（三处收口的单一事实源）
export {
  resolveThinking,
  resolveMaxTokens,
  lookupModelMaxTokens,
  MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT,
} from './thinking-policy';
export type { ResolveThinkingInput, ResolveMaxTokensInput } from './thinking-policy';
