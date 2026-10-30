/**
 * 通用 LLM 对话客户端——财经 / 论文 / AI 资讯三领域共用。
 *
 * REQ-2 (#271)：删自建 fetch，改走 agent-core 统一客户端（TokenHubClient）。
 * 只引 `@kedouai/agent-core/clients` 轻量子路径，不拖 AgentEngine/registry。
 *
 * 环境变量口径与 agent-core 统一：
 *   TOKENHUB_API_KEY / HY3_API_KEY（回落）、TOKENHUB_BASE_URL、TOKENHUB_MODEL
 * 旧的 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL 作为兼容别名继续识别。
 * 显式传 key 给客户端构造，避免客户端内部漏读某级 env 回调（P0 回归根因）。
 */
import { Logger } from '@nestjs/common';
// 引主入口获取 TokenHubClient（子路径 @kedouai/agent-core/clients 已出，
// 供支持 exports 的打包器用；ts-jest/CJS 下主入口等价可行）
import {
  TokenHubClient,
  resolveThinking,
  lookupModelMaxTokens,
} from '@kedouai/agent-core';
import type {
  ChatMessage as CoreChatMessage,
  ChatOptions as CoreChatOptions,
  ThinkingOption,
} from '@kedouai/agent-core';

const logger = new Logger('ContentHubLLM');

/** 对外接口：保持与旧版完全兼容，调用方无需改 import */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  /**
   * 是否允许模型「先思考再回答」，默认 `disabled`（D1 P5 形态默认）。
   *
   * 🔴 必须默认关掉，原因实测（2026-10-26，TokenHub / hy3）：
   *   `hy3` 是 reasoning 模型，`reasoning_content` 与 `content` **共用 max_tokens**。
   *   只吐 60 token 的 JSON，思考能烧 900~1500 token → finish_reason=length + content=""。
   *
   * 映射（D1 §改造点 3）：'disabled'→显式关；'auto'→显式开（budget 走公式）；缺省→形态默认 disabled。
   * 换到不认 `thinking` 字段的服务商时，置 env `LLM_THINKING=auto` 整体不下发该字段（wire-format 逃生）。
   */
  thinking?: 'disabled' | 'auto';
}

/**
 * 解析 API key：优先 TOKENHUB_API_KEY，回落 HY3_API_KEY，兼容旧 LLM_API_KEY。
 */
function resolveApiKey(): string {
  return (
    process.env.TOKENHUB_API_KEY?.trim() ||
    process.env.HY3_API_KEY?.trim() ||
    process.env.LLM_API_KEY?.trim() ||
    ''
  );
}

/**
 * 解析模型名：优先 TOKENHUB_MODEL，兼容旧 LLM_MODEL。
 */
function resolveModel(): string {
  return process.env.TOKENHUB_MODEL?.trim() || process.env.LLM_MODEL?.trim() || 'hy3';
}

/**
 * content-hub 自己的 thinking 取值 → 共享策略 P2 override（D1 §改造点 3）。
 * - 'disabled' → {type:'disabled'}（显式关）
 * - 'auto'     → {type:'enabled'}（显式开，budget 走公式）
 * - 缺省       → undefined（落 P5 形态默认 = disabled，翻译类零漂移）
 */
function mapThinking(t?: 'disabled' | 'auto'): ThinkingOption | undefined {
  if (t === 'disabled') return { type: 'disabled' };
  if (t === 'auto') return { type: 'enabled' };
  return undefined;
}

/**
 * 统一 chat 入口——内部走 agent-core TokenHubClient。
 *
 * 保留旧版的三个健壮性行为：
 *   1. 密钥缺失显式抛错
 *   2. thinking 默认 disabled（零漂移）
 *   3. 空 content + finish_reason=length 显式抛错（不返回空串让上层误判）
 */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error(
      'LLM API key 未配置：请设置 TOKENHUB_API_KEY 或 HY3_API_KEY 环境变量',
    );
  }

  /**
   * thinking 控制（D1 三处收口）：策略统一走 agent-core `resolveThinking`。
   * `LLM_THINKING=auto` 是 wire-format 逃生口——整体不下发 thinking 字段
   *（换不认该字段的服务商），不参与策略链。
   */
  const wireOff = (process.env.LLM_THINKING ?? '').toLowerCase() === 'auto';

  // TokenHubClient 构造时传 modelId + 显式 key（优先于 env），
  // 确保 resolveApiKey() 的兜底链结果被实际使用（P0 回归根因）
  const client = new TokenHubClient(resolveModel(), undefined, apiKey);

  const coreOpts: CoreChatOptions = {
    temperature: opts.temperature ?? 0.3,
    maxTokens: opts.maxTokens ?? 500,
  };
  if (wireOff) {
    coreOpts.omitThinking = true;
  } else {
    const resolved = resolveThinking({
      hasTools: false,
      maxTokens: opts.maxTokens ?? 500,
      override: mapThinking(opts.thinking),
      modelMaxTokens: lookupModelMaxTokens(resolveModel()),
      clientDefaultMaxTokens: 500,
    });
    if (resolved) coreOpts.thinking = resolved.thinking;
  }

  // agent-core ChatMessage 需要 ts 字段
  const coreMessages: CoreChatMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
    ts: Date.now(),
  }));

  const result = await client.chatWithTools(coreMessages, [], coreOpts);
  const content = result.content ?? '';

  /**
   * 空 content + 被预算截断 = 思考把额度烧光了。
   * 必须显式抛错而不是返回空串——返回空串时上层只看到「JSON 解析失败」，
   * 会误判成 prompt 写错（历史 bug 的根因）。
   */
  if (!content.trim() && result.finishReason === 'length') {
    throw new Error(
      `LLM 返回空白且被 max_tokens 截断` +
        `（finish_reason=length）：疑似模型思考占满预算，请关闭 thinking 或提高 maxTokens`,
    );
  }

  return content;
}

/** 供需要日志的领域模块复用，避免各自 new Logger */
export { logger };
