/**
 * D1 · thinking 统一策略（三处收口的单一事实源）。
 *
 * 背景：hy3 / hy4-preview / deepseek 系均为思考型模型，`reasoning_content` 与 `content`
 * 共用 max_tokens —— 小输出预算下思考吃满预算 → finish_reason=length + 空正文
 *（think-probe*.mjs 实测 3/3 复现）。原先 tokenhub / hy3 / content-hub 三份心智各写一套，
 * 且 tokenhub 含 `modelId.includes('deepseek')` 硬编码与 budget:1024 硬编码，互相漂移。
 *
 * 本模块是**唯一**判定链（D1 §4.2，P1 最高）：
 *   P1  带工具强制 enabled   ← hasTools=true：无论 agent 配置 / override 写 disabled，一律纠正为 enabled
 *   P2  options.thinking 显式 ← 仅非工具场景；有值直接用
 *   P3  agent 配置            ← C7 thinking 列：disabled→disabled；enabled→enabled+budget
 *   P4  env TOKENHUB_THINKING ← 次优先运维档；仅作用于 P1–P3 未决的调用
 *   P5  形态默认              ← 非工具无任何配置 → disabled
 *
 * budget 规则：最终 type='enabled' 时携带
 *   budget_tokens = max(1, floor(min(模型 max_tokens 上限, 有效 maxTokens / 2)))
 * 其中「有效 maxTokens」已含 §4.3 默认解析（带工具未配 = 模型上限）。
 * P1 强制场景恒用公式值（显式 budget 不放行，拍板口径）；P2 override 自带 budget_tokens 用显式值。
 *
 * 优先级实现口径（D1 §4.2 / contracts.md C7-c）：
 *   带工具强制 enabled（最高）> options.thinking 显式 > agent 配置 > env > 形态默认；
 *   env 不压制工具强制（W3）；agent 配置压过 env（W2）。
 */
import { type ThinkingOption } from './base-ai.client';
import { Logger } from '../lib/logger';

/**
 * 模型 max output tokens 常量表（budget 公式与「带工具 maxTokens 默认」的共同输入）。
 *
 * ⚠️ W5 未核定：以下为**公开档位占位值**，真值需运维按 TokenHub 控制台核定；
 * 运维修正不发版走 env `MODEL_MAX_OUTPUT_TOKENS_JSON`（JSON 对象，key=模型 id）。
 * 未知模型回落 DEFAULT_MODEL_MAX_OUTPUT 并 WARN。
 */
export const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  hy3: 8192,
  'hy4-preview': 8192,
  'deepseek-v4-flash': 8192,
  'deepseek/deepseek-v4-flash': 8192,
  'deepseek-v4-pro-0813': 8192,
  'glm-5.3': 8192,
  'kimi-k3': 8192,
  'qwen3.5-plus': 8192,
  'minimax-m3': 8192,
};

/** 未知模型 max output 回落值（W5 建议 8192） */
export const DEFAULT_MODEL_MAX_OUTPUT = 8192;

/** env 覆盖解析失败只告警一次（避免每请求刷屏） */
let envOverrideWarned = false;
/** 未命中常量表只告警一次/模型（避免每请求刷屏） */
const unknownModelWarned = new Set<string>();

function warn(msg: string): void {
  new Logger('thinking-policy').warn(msg);
}

/**
 * 查模型 max output tokens：env `MODEL_MAX_OUTPUT_TOKENS_JSON` 覆盖 > 常量表 > DEFAULT。
 * 支持 `deepseek/deepseek-v4-flash` 形态命中裸名 `deepseek-v4-flash`（大小写不敏感）。
 */
export function lookupModelMaxTokens(modelId?: string): number {
  const raw = (process.env.MODEL_MAX_OUTPUT_TOKENS_JSON ?? '').trim();
  if (raw && modelId) {
    try {
      const map = JSON.parse(raw) as Record<string, unknown>;
      const hit = map[modelId] ?? map[modelId.toLowerCase()];
      if (typeof hit === 'number' && Number.isFinite(hit) && hit > 0) return Math.floor(hit);
    } catch {
      if (!envOverrideWarned) {
        envOverrideWarned = true;
        warn(`MODEL_MAX_OUTPUT_TOKENS_JSON 解析失败，忽略 env 覆盖：${raw.slice(0, 120)}`);
      }
    }
  }
  if (modelId) {
    const key = modelId.toLowerCase();
    const bare = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key;
    for (const [k, v] of Object.entries(MODEL_MAX_OUTPUT_TOKENS)) {
      const lk = k.toLowerCase();
      if (lk === key || lk === bare) return v;
    }
    if (!unknownModelWarned.has(key)) {
      unknownModelWarned.add(key);
      warn(
        `模型 ${modelId} 不在 MODEL_MAX_OUTPUT_TOKENS 常量表（W5 真值未核定），` +
          `回落 DEFAULT_MODEL_MAX_OUTPUT=${DEFAULT_MODEL_MAX_OUTPUT}；可用 MODEL_MAX_OUTPUT_TOKENS_JSON 运维修正`,
      );
    }
  }
  return DEFAULT_MODEL_MAX_OUTPUT;
}

export interface ResolveMaxTokensInput {
  /** 是否带工具（含 capabilities 解析出的 tool/mcp/skill 派生工具） */
  hasTools: boolean;
  /** agent/调用配置的 maxTokens（可空） */
  maxTokens?: number | null;
  /** 模型 max_tokens 上限（缺省按 DEFAULT） */
  modelMaxTokens?: number;
  /** 客户端现状默认（非工具未配时透传不变，C7-e 回归口径：8000/2000~4000/500） */
  clientDefault?: number;
}

/**
 * 有效 max_tokens 下发值（D1 §4.3）：
 * - 配了 maxTokens → 配置值
 * - 带工具未配 → 模型上限（工具编排需要满额输出预算，不人为压小）
 * - 非工具未配 → 调用方现状默认透传不变
 */
export function resolveMaxTokens(input: ResolveMaxTokensInput): number {
  const modelMax = input.modelMaxTokens ?? DEFAULT_MODEL_MAX_OUTPUT;
  if (input.maxTokens != null && Number.isFinite(input.maxTokens) && input.maxTokens > 0) {
    return Math.floor(input.maxTokens);
  }
  if (input.hasTools) return modelMax;
  return input.clientDefault ?? modelMax;
}

export interface ResolveThinkingInput {
  /** P1：是否带工具（含 capabilities 派生工具；命中即强制 enabled） */
  hasTools: boolean;
  /** 原始 maxTokens 配置（可空；budget 公式内部按有效值折算） */
  maxTokens?: number | null;
  /** P3：agent 定义层 thinking（C7 thinking 列）；null/undefined = 未配置 */
  agentThinking?: ThinkingOption | null;
  /** P2：调用层显式覆盖（仅非工具场景优先） */
  override?: ThinkingOption | null;
  /** 模型 max_tokens 上限（缺省 DEFAULT；显式传入便于单测固定基数） */
  modelMaxTokens?: number;
  /** 客户端现状默认 maxTokens（非工具未配时 budget 折算基数） */
  clientDefaultMaxTokens?: number;
}

/**
 * 唯一 thinking 判定链，返回可直接展开进请求 payload 的片段：
 *   `...resolveThinking(...)` → `{ thinking: { type: 'enabled', budget_tokens: N } }`
 * 或 `{ thinking: { type: 'disabled' } }`。
 *
 * 当前链路 P1–P5 必然落定（P5 兜底 disabled），返回 undefined 仅保留给
 * 未来「整体不下发」语义；wire-format 逃生口见 ChatOptions.omitThinking（客户端处理）。
 */
export function resolveThinking(input: ResolveThinkingInput): { thinking: ThinkingOption } | undefined {
  const modelMax = input.modelMaxTokens ?? DEFAULT_MODEL_MAX_OUTPUT;
  const effectiveMaxTokens = resolveMaxTokens({
    hasTools: input.hasTools,
    maxTokens: input.maxTokens,
    modelMaxTokens: modelMax,
    clientDefault: input.clientDefaultMaxTokens,
  });
  /** budget 公式：min(模型上限, 有效 maxTokens/2)，floor + max(1,·) 防 0 */
  const formulaBudget = (): number =>
    Math.max(1, Math.floor(Math.min(modelMax, effectiveMaxTokens / 2)));
  const enabledWith = (explicitBudget?: number): { thinking: ThinkingOption } => ({
    thinking: { type: 'enabled', budget_tokens: explicitBudget ?? formulaBudget() },
  });

  // P1 带工具强制 enabled：纠正一切 disabled；显式 budget 不放行（一律公式值）
  if (input.hasTools) return enabledWith();

  // P2 调用层显式 override（仅非工具）：override 自带 budget_tokens 用显式值
  if (input.override) {
    if (input.override.type === 'disabled') return { thinking: { type: 'disabled' } };
    return enabledWith(input.override.budget_tokens);
  }

  // P3 agent 配置（C7 thinking 列；存量值带 budget_tokens 运行时读作显式 budget，向后兼容）
  if (input.agentThinking) {
    if (input.agentThinking.type === 'disabled') return { thinking: { type: 'disabled' } };
    return enabledWith(input.agentThinking.budget_tokens);
  }

  // P4 env TOKENHUB_THINKING：运维档（语义不变；仅作用于 P1–P3 未决；不压制工具强制）
  const env = (process.env.TOKENHUB_THINKING ?? '').trim().toLowerCase();
  if (env === 'none' || env === 'disabled') return { thinking: { type: 'disabled' } };
  const m = env.match(/^budget:(\d+)$/);
  if (m) return enabledWith(Number(m[1]));

  // P5 形态默认：非工具无任何配置 → disabled（安全默认，根治空正文；带工具已被 P1 兜住）
  return { thinking: { type: 'disabled' } };
}
