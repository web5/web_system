/**
 * 科豆 AI - 合同风险分析 API（业务层）
 *
 * 职责：提示词拼装 + 报告结构解析与归一化（合同专有）。
 * 通用 SSE 管线（请求 / 跨 chunk 解码 / 事件解析 / 会话接口）已抽到 `services/agent-stream.ts`，
 * 本模块以 agentId='contract-risk' 复用它 —— 翻译等其它能力同样用 `createAgentApi(agentId)`。
 *
 * 链路：小程序 → gateway(/api/ai-agent/agent/run) → ai-agent(/agent/run) → agent-core
 */
import {
  createAgentApi,
  type ConversationDetail as AgentConversationDetail,
  type ConversationSummary,
  type StoredChatMessage,
  type StreamEvent,
} from './agent-stream';

/** 保持原有导出面：调用方（pages/contract/*）无需改动 */
export type { StreamEvent, ConversationSummary, StoredChatMessage };

/** 合同风险 agent 标识（后端 admin 后台配置，改 prompt 不需发版） */
const CONTRACT_AGENT_ID = 'contract-risk';

/** 合同链路句柄：SSE 与会话接口都走通用管线 */
const api = createAgentApi(CONTRACT_AGENT_ID);

/** 风险信号（含可追问问题） */
export interface ContractSignal {
  id: string;
  name: string;
  level: 'danger' | 'warn' | 'ok';
  /** 风险标题，可带具体数字（真实年化、违约金比例等） */
  signalTitle: string;
  /** 一句话大白话 */
  plainText: string;
  legalBasis: { law: string; article: string; quote: string };
  actions: string[];
  termExplain?: string;
  /** 面向这个风险点，用户最可能追问的口语化问题 */
  askableQuestions?: string[];
}

/** 可主张权益（含可追问问题） */
export interface ContractRight {
  id: string;
  title: string;
  description: string;
  amount?: number;
  legalBasis: { law: string; article: string; quote: string };
  actions: string[];
  askableQuestions?: string[];
}

/** 贷款方案解读（loanPlan，贷款类必须，前端"月供构成卡"） */
export interface LoanPlan {
  repaymentType: string;
  termExplain: string;
  pros: string[];
  cons: string[];
  riskNote: string;
  totalInterest: number;
  effectiveApr: number;
  suggestions: string[];
}

/** 权益最大化建议（optimize 元素） */
export interface OptimizeItem {
  title: string;
  stage: '成交前' | '成交后' | '长期';
  plainText: string;
  actions: string[];
  askableQuestions?: string[];
}

/** 合同风险报告 */
export interface ContractReport {
  /** 合同类型（中文：消费贷款 / 购车融资 / 医疗保险 / 租房 等） */
  scene: string;
  /** 一句话结论：三段式，用 | 分隔（判断 / 最值钱一句话 / 立刻做的事） */
  conclusion: string;
  /** 风险信号 */
  signals: ContractSignal[];
  /** 我的权益 */
  rights: ContractRight[];
  /** 贷款方案解读（月供构成卡），贷款类必须 */
  loanPlan?: LoanPlan;
  /** 权益最大化建议（成交前/成交后/长期） */
  optimize?: OptimizeItem[];
  /** 关键数字摘要（合同中真实算出的数字，IRR/总利息/服务费等） */
  keyNumbers?: Array<{ label: string; value: string }>;
  disclaimer: string;
  /** 本次分析的会话 id，用于后续追问复用上下文 */
  conversationId?: string;
  createdAt: number;
}

/**
 * 分析合同，返回结构化风险报告（一次性 Promise 版本，用于不关心进度场景）。
 * @param text 合同文本（OCR/粘贴）
 * @param scene 可选场景
 */
export function analyzeContract(text: string, scene?: string): Promise<ContractReport> {
  return new Promise((resolve, reject) => {
    analyzeContractStream(
      text,
      scene,
      {
        onEvent: () => {},
        onDone: resolve,
        onError: reject,
      },
    );
  });
}

/** 流式分析事件处理器 */
export interface AnalyzeHandlers {
  /** 每个 SSE 事件（tool_call / tool_result / final 等） */
  onEvent(event: StreamEvent): void;
  /** LLM 逐字生成内容增量（content_delta 事件），供前端"AI 正在生成报告"实时渲染 */
  onDelta?(delta: string): void;
  /** 模型推理增量（reasoning_delta 事件），供前端"思考中"可视化 */
  onReasoning?(delta: string): void;
  /** 分析完成，返回结构化报告 */
  onDone(report: ContractReport): void;
  /** 分析失败 */
  onError(err: Error): void;
}

/**
 * 分析合同（流式版本）：通过 handlers 暴露每个 SSE 事件，前端可按 tool_call 动态更新文案。
 * @param text 合同文本
 * @param scene 可选场景
 * @param handlers 事件处理器
 */
export function analyzeContractStream(
  text: string,
  scene: string | undefined,
  handlers: AnalyzeHandlers,
): void {
  const userInput = scene
    ? `【合同场景】${scene}\n【合同内容】\n${text}\n\n请识别这份合同的风险，输出结构化风险报告。`
    : `【合同内容】\n${text}\n\n请判断合同类型并识别风险，输出结构化风险报告。`;

  // source='tool'：合同评估产生的会话不进「对话记录」列表（有独立的合同历史入口）
  api.stream(userInput, { source: 'tool' }, {
    onEvent: (event) => handlers.onEvent(event),
    onDelta: (delta) => handlers.onDelta?.(delta),
    onReasoning: (delta) => handlers.onReasoning?.(delta),
    // final 的完整文本 → 合同专有的结构化报告解析
    onReply: (content) => handlers.onDone(parseReport(content)),
    onError: (err) => handlers.onError(err),
  });
}

/**
 * 合同对话追问：基于已生成的 conversationId 继续同一段对话，返回文本回复。
 * 用户在结果页对报告结论追问时调用，AI 会结合已分析的合同上下文继续回答。
 * @param question 用户追问内容
 * @param conversationId 初次分析 final 事件返回的会话 id
 */
export function sendContractFollowUp(question: string, conversationId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sendFollowUpStream(question, conversationId, {
      onReply: resolve,
      onError: reject,
    });
  });
}

/**
 * 追问（流式版本，UI 真正实时渲染）：
 *  - onEvent  任意 SSE 事件（tool_call / tool_result / start ...）
 *  - onDelta  content_delta 增量（LLM 逐字吐字）
 *  - onReply  final 一次性完整回复
 *  - onError  失败
 */
export function sendContractFollowUpStream(
  question: string,
  conversationId: string,
  handlers: FollowUpStreamHandlers,
): void {
  sendFollowUpStream(question, conversationId, handlers);
}

/** 追问流式事件处理器 */
export interface FollowUpHandlers {
  onReply(reply: string): void;
  onError(err: Error): void;
}

/** 追问流式事件处理器（带 onDelta 增量渲染，供 UI 真正流式显示） */
export interface FollowUpStreamHandlers {
  /** 任意 SSE 事件透传（tool_call / tool_result / final 等），供 UI 给出过程化提示 */
  onEvent?(event: StreamEvent): void;
  /** LLM 逐字增量（SSE content_delta 事件） */
  onDelta?(delta: string): void;
  /** 追问最终回复文本（final 事件） */
  onReply(reply: string): void;
  /** 失败 */
  onError(err: Error): void;
}

/**
 * 追问（流式版本）：收到 final 事件即返回完整文本回复。
 * 复用与初次分析相同的 agent run 通道，通过 conversationId 保持上下文。
 */
function sendFollowUpStream(
  question: string,
  conversationId: string,
  handlers: FollowUpStreamHandlers,
): void {
  api.stream(question, { conversationId, source: 'tool' }, {
    onEvent: (event) => handlers.onEvent?.(event),
    onDelta: (delta) => handlers.onDelta?.(delta),
    onReply: (content) => handlers.onReply(content),
    onError: (err) => handlers.onError(err),
  });
}

/** 从 agent final 内容解析结构化报告（LLM 输出 JSON 文本，提取/兜底）
 *
 * LLM 有时会在 JSON 前后混用思考文本、markdown 标题、代码块。本函数鲁棒提取：
 * 1. 整体就是 JSON → 直接 parse
 * 2. 含 ```json ... ``` 代码块 → 提取代码块
 * 3. 否则从左到右扫描配对括号，定位**最后一个**完整顶层 JSON
 * 4. 仍然失败 → 兜底返回"解析失败"占位（不把 LLM 原始英文丢给用户）
 */
function parseReport(content: string): ContractReport {
  const trimmed = content.trim();
  const parsed = extractJsonObject(trimmed);
  if (parsed) {
    return {
      scene: normalizeScene(parsed.scene),
      conclusion: parsed.conclusion || '分析完成，请查看下方风险与权益明细。',
      signals: Array.isArray(parsed.signals) ? parsed.signals.map(normalizeSignal) : [],
      rights: Array.isArray(parsed.rights) ? parsed.rights.map(normalizeRight) : [],
      loanPlan: normalizeLoanPlan(parsed.loanPlan),
      optimize: Array.isArray(parsed.optimize) ? parsed.optimize.map(normalizeOptimize) : [],
      keyNumbers: Array.isArray(parsed.keyNumbers) ? parsed.keyNumbers : [],
      disclaimer: parsed.disclaimer || '仅用于理解合同，不构成法律/理财/投资建议。',
      createdAt: Date.now(),
    };
  }

  // 兜底：绝不把 LLM 的英文思考丢给用户，给出明确占位
  return {
    scene: '未知',
    conclusion:
      '本次报告解析异常，建议点击下方对话区追问 AI 重新生成结论。常见原因：合同文本过短或格式异常。',
    signals: [],
    rights: [],
    loanPlan: undefined,
    optimize: [],
    keyNumbers: [],
    disclaimer: '仅用于理解合同，不构成法律/理财/投资建议。',
    createdAt: Date.now(),
  };
}

/** 从字符串中提取一个顶层 JSON 对象（返回成功解析的对象或 null）
 *
 * 鲁棒策略（应对 LLM 输出不可控）：
 * 1. 整体就是 JSON → 直接 parse
 * 2. ```json ... ``` 代码块 → 提取代码块
 * 3. 扫描配对括号，定位最右的完整顶层 JSON（不强制含特定字段）
 * 4. 截断容错：JSON 不完整（LLM 输出被截断）时，尝试用最后出现的 `}` 截断后解析
 */
function extractJsonObject(text: string): any | null {
  if (!text) return null;
  // 1) 整体就是 JSON
  if (text.trim().startsWith('{')) {
    try {
      const obj = JSON.parse(text.trim());
      if (obj && typeof obj === 'object') return obj;
    } catch {
      // 继续尝试
    }
  }
  // 2) markdown ```json ... ``` 代码块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const parsed = tryParseObject(fence[1].trim());
    if (parsed) return parsed;
  }
  // 3) 扫描配对括号：模型输出可能在 JSON 前有中文思考、JSON 后有遗漏文字，
  //    也可能包含嵌套对象（signals.legalBasis 等）。从右往左找所有能匹配的 {}
  //    配对，挑**最长**且 parse 成功的候选（最外层 JSON），避免把内层子对象误当顶层报告。
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') starts.push(i);
  }
  let best: any = null;
  let bestLen = 0;
  for (let k = starts.length - 1; k >= 0; k--) {
    const i = starts[k];
    const end = findMatchingBrace(text, i);
    if (end === -1) continue;
    const candidate = text.slice(i, end + 1);
    const parsed = tryParseObject(candidate);
    if (parsed && candidate.length > bestLen) {
      best = parsed;
      bestLen = candidate.length;
    }
  }
  if (best) return best;
  // 4) 截断容错：LLM 输出被截断（未闭合），用最后出现的 `}` 截断后从右往左找最长合法片段
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace > 0) {
    for (let k = starts.length - 1; k >= 0; k--) {
      const i = starts[k];
      if (i >= lastBrace) continue;
      const candidate = text.slice(i, lastBrace + 1);
      const parsed = tryParseObject(candidate);
      if (parsed && candidate.length > bestLen) {
        best = parsed;
        bestLen = candidate.length;
      }
    }
  }
  return best;
}

/** 尝试解析一段文本为对象，解析成功且是对象则返回，否则返回 null */
function tryParseObject(candidate: string): any | null {
  try {
    const obj = JSON.parse(candidate.trim());
    if (obj && typeof obj === 'object') return obj;
  } catch {
    // 忽略
  }
  return null;
}

/** 从 start（指向 `{`）开始，向右找匹配的 `}` 位置（处理字符串内的括号） */
function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 场景归一：英文/拼音 scene 转中文标签（列表卡片展示复用） */
export const SCENE_LABEL_CN: Record<string, string> = {
  'consumer-loan': '消费贷款',
  'car-loan': '购车贷款',
  'car-finance': '购车融资租赁',
  'car-finance-lease': '购车融资租赁',
  'medical-insurance': '医疗保险',
  'car-insurance': '车险',
  rental: '租房',
  other: '其他',
};
export function normalizeScene(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '未知';
  // 已经是中文且不含明显英文字母 → 直接返回
  if (/[\u4e00-\u9fa5]/.test(s) && !/[A-Za-z]/.test(s)) return s;
  const mapped = SCENE_LABEL_CN[s.toLowerCase()];
  if (mapped) return mapped;
  // 兜底：原样展示（中文里夹英文也行）
  return s;
}

function normalizeSignal(s: any) {
  return {
    id: String(s?.id ?? s?.name ?? 'unknown'),
    name: String(s?.name ?? ''),
    level: (s?.level === 'danger' || s?.level === 'warn' || s?.level === 'ok') ? s.level : 'warn',
    signalTitle: String(s?.signalTitle ?? s?.name ?? ''),
    plainText: String(s?.plainText ?? ''),
    legalBasis: s?.legalBasis ?? { law: '', article: '', quote: '' },
    actions: Array.isArray(s?.actions) ? s.actions.map(String) : [],
    termExplain: s?.termExplain ? String(s.termExplain) : undefined,
    askableQuestions: normalizeQuestions(s?.askableQuestions),
  };
}

function normalizeRight(r: any) {
  const amountRaw = r?.amount;
  const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw) || undefined;
  return {
    id: String(r?.id ?? r?.title ?? 'unknown'),
    title: String(r?.title ?? '可主张权益'),
    description: String(r?.description ?? ''),
    ...(amount && amount > 0 ? { amount } : {}),
    legalBasis: r?.legalBasis ?? { law: '', article: '', quote: '' },
    actions: Array.isArray(r?.actions) ? r.actions.map(String) : [],
    askableQuestions: normalizeQuestions(r?.askableQuestions),
  };
}

/** 归一化 loanPlan（贷款方案解读），非法/缺失返回 undefined */
function normalizeLoanPlan(lp: any): LoanPlan | undefined {
  if (!lp || typeof lp !== 'object') return undefined;
  const repaymentType = String(lp.repaymentType ?? '未知');
  if (!lp.termExplain && !lp.riskNote && !Array.isArray(lp.pros) && !Array.isArray(lp.cons)) {
    return undefined; // 空壳，忽略
  }
  return {
    repaymentType,
    termExplain: String(lp.termExplain ?? ''),
    pros: Array.isArray(lp.pros) ? lp.pros.map(String) : [],
    cons: Array.isArray(lp.cons) ? lp.cons.map(String) : [],
    riskNote: String(lp.riskNote ?? ''),
    totalInterest: Number(lp.totalInterest) || 0,
    effectiveApr: Number(lp.effectiveApr) || 0,
    suggestions: Array.isArray(lp.suggestions) ? lp.suggestions.map(String) : [],
  };
}

/** 归一化 optimize（权益最大化建议） */
function normalizeOptimize(o: any) {
  if (!o || typeof o !== 'object') return undefined;
  const stage = o.stage === '成交后' || o.stage === '长期' ? o.stage : '成交前';
  return {
    title: String(o.title ?? '权益最大化建议'),
    stage,
    plainText: String(o.plainText ?? ''),
    actions: Array.isArray(o.actions) ? o.actions.map(String) : [],
    askableQuestions: normalizeQuestions(o?.askableQuestions),
  };
}

/** 归一化 askableQuestions（去空、去重复） */
function normalizeQuestions(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const q of raw) {
    const s = String(q ?? '').trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      result.push(s);
    }
  }
  return result;
}

/* ==================== 对话历史（列表 / 详情） ==================== */

// 类型与接口复用通用层（agent-stream）：ConversationSummary / StoredChatMessage 直接 re-export，
// 仅 ConversationDetail 的 report 快照需要绑定合同专有类型。

/** 对话详情：`report` 快照为合同风险报告 */
export type ConversationDetail = AgentConversationDetail<ContractReport>;

/** 我的合同分析对话列表（分页） */
export function listContractConversations(page = 1, pageSize = 20): Promise<{ list: ConversationSummary[]; total: number }> {
  return api.listConversations(page, pageSize);
}

/** 单个对话详情（报告快照 + 消息序列，历史回放用） */
export function getContractConversation(conversationId: string): Promise<ConversationDetail> {
  return api.getConversation<ContractReport>(conversationId);
}
