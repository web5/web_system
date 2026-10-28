/**
 * Agent 定义表单载入/默认值映射（详情页用，纯函数可单测）。
 *
 * 真源：docs/ui/page-specs/agent-def-detail-v2.md（详情页表单）+ contracts.md §7
 * （C7-c null 语义 / C7-e 不把 null 写成 0.7 / C7-h 传了才覆盖）。
 * 分层：零 UI 依赖；AgentDefDetail.vue 只做接线。
 */
import type { AgentDef, SaveAgentDefPayload, ThinkingOption, CapabilityRef } from '@/api/agent-defs';
import {
  defaultThinkingForm,
  hasToolsOf,
  thinkingToForm,
  type ThinkingFormValue,
} from './tuning-params';

/** 新建默认值：调参字段一律「未配置」（null），禁止 ?? 0.7 预填（C7-e / D10 修正） */
export function defaultAgentForm(): SaveAgentDefPayload {
  return {
    id: '',
    name: '',
    systemPrompt: '',
    model: 'hy3',
    tools: [],
    capabilities: [],
    maxSteps: 10,
    temperature: null,
    maxTokens: null,
    topP: null,
    thinking: null,
    memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
    streaming: true,
    description: '',
    keywords: [],
  };
}

/**
 * 联动①（W1 配置默认侧）：带工具 + 未配置 → 默认 enabled；
 * 显式值一律尊重（disabled 走误配红字警示，不在此纠正）。
 */
export function deriveThinkingForm(
  hasTools: boolean,
  thinking: ThinkingOption | null | undefined,
): ThinkingFormValue {
  const tf = thinkingToForm(thinking);
  return tf === 'null' ? defaultThinkingForm(hasTools) : tf;
}

export interface DefFormState {
  form: SaveAgentDefPayload;
  /** thinking 表单三态（与 API 形状的映射在保存/载入时转换） */
  thinking: ThinkingFormValue;
  /** 「路由关键词」tags 选择器中间态 */
  keywordsInput: string[];
}

/** 详情页载入：AgentDef → 表单态（副本，不共享引用） */
export function defToForm(def: AgentDef): DefFormState {
  // capabilities 为空时从 tools 派生（老数据兼容）
  const caps: CapabilityRef[] = def.capabilities?.length
    ? def.capabilities.map((c) => ({ ...c }))
    : (def.tools || []).map((t) => ({ type: 'tool', ref: t, enabled: true }));

  const form: SaveAgentDefPayload = {
    id: def.id,
    name: def.name,
    systemPrompt: def.systemPrompt,
    model: def.model,
    tools: [...(def.tools || [])],
    capabilities: caps,
    maxSteps: def.maxSteps,
    // D10 修正：空值保持 null（「未配置」），不 ?? 0.7 预填
    temperature: def.temperature ?? null,
    maxTokens: def.maxTokens ?? null,
    topP: def.topP ?? null,
    thinking: def.thinking ?? null,
    memory: { ...def.memory },
    streaming: def.streaming !== false,
    description: def.description ?? '',
    keywords: def.keywords ?? [],
  };

  return {
    form,
    thinking: deriveThinkingForm(hasToolsOf(form.tools, caps), def.thinking),
    keywordsInput: [...(def.keywords || [])],
  };
}
