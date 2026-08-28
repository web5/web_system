/**
 * 合同翻译官 - AI 分析 API
 * 调用 ai-agent 服务的 agent 编排接口（SSE 流式），聚合最终风险报告。
 *
 * 链路：小程序 → gateway(/api/ai-agent/agent/run) → ai-agent(/agent/run) → agent-core
 */
import { getToken } from '../utils/request';

const AGENT_RUN_URL = '/api/ai-agent/agent/run';
const AGENT_ID = 'contract-risk';

/** SSE 事件类型（与 agent-core StreamEvent 对齐） */
export interface StreamEvent {
  type: 'start' | 'content_delta' | 'tool_call' | 'tool_result' | 'final' | 'error';
  content?: string;
  name?: string;
  conversationId?: string;
}

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
  const app = getApp<IAppOption>();
  const baseUrl = app.globalData.apiBase;
  const token = getToken();

  const userInput = scene
    ? `【合同场景】${scene}\n【合同内容】\n${text}\n\n请识别这份合同的风险，输出结构化风险报告。`
    : `【合同内容】\n${text}\n\n请判断合同类型并识别风险，输出结构化风险报告。`;

  const task = wx.request({
    url: `${baseUrl}${AGENT_RUN_URL}`,
    method: 'POST',
    data: { agentId: AGENT_ID, userInput },
    enableChunked: true,
    header: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: 300000, // agent 编排 + IRR + LLM 多步，超时调到 5 分钟
    success: () => {
      // 流式结果通过 onChunkReceived 处理
    },
    fail: (err) => {
      handlers.onError(new Error(err.errMsg || '网络请求失败'));
    },
  });

  // 每个请求独立的 SSE 缓冲区
  let buffer = '';
  let done = false;

  // 接收流式 chunk，解析 SSE 事件
  // 微信小程序的 onChunkReceived 的 res.data 是 ArrayBuffer，需要用 TextDecoder 转为 UTF-8 字符串
  (task as any).onChunkReceived((res: any) => {
    if (done) return;
    try {
      const chunk = res.data;
      const chunkText = decodeChunk(chunk);
      if (chunkText == null) return; // 解码失败跳过
      buffer = parseSseEventsStream(buffer, chunkText, handlers, () => { done = true; });
    } catch (e) {
      done = true;
      handlers.onError(e as Error);
    }
  });
}

/** 解析 SSE 事件流（流式版，逐个事件回调）；返回剩余未完成缓冲区 */
function parseSseEventsStream(
  buffer: string,
  chunk: string,
  handlers: AnalyzeHandlers,
  markDone: () => void,
): string {
  buffer += chunk;
  // 按 data: 行切分
  const lines = buffer.split('\n');
  buffer = lines.pop() || ''; // 保留最后一个不完整行

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.substring(5).trim();
    if (!payload) continue;

    try {
      const event = JSON.parse(payload) as StreamEvent;
      handlers.onEvent(event);
      // 逐字增量：透传给前端"正在生成报告"实时渲染（若注册了 onDelta）
      if (event.type === 'content_delta' && handlers.onDelta && event.content) {
        handlers.onDelta(event.content);
      }
      if (event.type === 'error') {
        markDone();
        handlers.onError(new Error(event.content || '分析失败'));
        return buffer;
      } else if (event.type === 'final') {
        markDone();
        const report = parseReport(event.content || '');
        handlers.onDone(report);
        return buffer;
      }
    } catch {
      // 忽略非 JSON 行
    }
  }
  return buffer;
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

/** 追问流式事件处理器 */
export interface FollowUpHandlers {
  onReply(reply: string): void;
  onError(err: Error): void;
}

/**
 * 追问（流式版本）：收到 final 事件即返回完整文本回复。
 * 复用与初次分析相同的 agent run 通道，通过 conversationId 保持上下文。
 */
function sendFollowUpStream(
  question: string,
  conversationId: string,
  handlers: FollowUpHandlers,
): void {
  const app = getApp<IAppOption>();
  const baseUrl = app.globalData.apiBase;
  const token = getToken();

  const task = wx.request({
    url: `${baseUrl}${AGENT_RUN_URL}`,
    method: 'POST',
    data: { agentId: AGENT_ID, userInput: question, conversationId },
    enableChunked: true,
    header: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    timeout: 300000,
    success: () => {
      // 流式结果通过 onChunkReceived 处理
    },
    fail: (err) => {
      handlers.onError(new Error(err.errMsg || '网络请求失败'));
    },
  });

  let buffer = '';
  let done = false;

  (task as any).onChunkReceived((res: any) => {
    if (done) return;
    try {
      const chunkText = decodeChunk(res.data);
      if (chunkText == null) return;
      buffer += chunkText;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.substring(5).trim();
        if (!payload) continue;
        try {
          const event = JSON.parse(payload) as StreamEvent;
          if (event.type === 'final') {
            done = true;
            handlers.onReply(event.content || '');
            return;
          }
          if (event.type === 'error') {
            done = true;
            handlers.onError(new Error(event.content || '回复失败'));
            return;
          }
        } catch {
          // 忽略非 JSON 行
        }
      }
    } catch (e) {
      done = true;
      handlers.onError(e as Error);
    }
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
  // 3) 扫描配对括号，定位最右的完整顶层 JSON（不强制含特定字段）
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') starts.push(i);
  }
  // 从右往左找（优先最大/最完整的对象）
  for (let k = starts.length - 1; k >= 0; k--) {
    const i = starts[k];
    const end = findMatchingBrace(text, i);
    if (end === -1) continue;
    const candidate = text.slice(i, end + 1);
    const parsed = tryParseObject(candidate);
    if (parsed) return parsed;
  }
  // 4) 截断容错：LLM 输出被截断（未闭合），用最后出现的 `}` 截断后尝试
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace > 0) {
    // 取最后一个 `{` 到最后一个 `}` 之间的片段
    for (let k = starts.length - 1; k >= 0; k--) {
      const i = starts[k];
      if (i >= lastBrace) continue;
      const candidate = text.slice(i, lastBrace + 1);
      const parsed = tryParseObject(candidate);
      if (parsed) return parsed;
    }
  }
  return null;
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

/** 场景归一：英文/拼音 scene 转中文标签 */
const SCENE_LABEL_CN: Record<string, string> = {
  'consumer-loan': '消费贷款',
  'car-loan': '购车贷款',
  'car-finance': '购车融资租赁',
  'car-finance-lease': '购车融资租赁',
  'medical-insurance': '医疗保险',
  'car-insurance': '车险',
  rental: '租房',
  other: '其他',
};
function normalizeScene(raw: unknown): string {
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

/**
 * 将 onChunkReceived 的 res.data 解码为 UTF-8 字符串。
 * 微信小程序基础库的 onChunkReceived 回调中，res.data 是 ArrayBuffer（或 Uint8Array）。
 * 旧代码用 String(chunk) 会得到 "[object ArrayBuffer]"，无法按 "\n" 解析 SSE，导致事件全部丢失。
 */
function decodeChunk(chunk: unknown): string | null {
  try {
    if (typeof chunk === 'string') return chunk;
    if (chunk instanceof ArrayBuffer) {
      // 微信小程序支持 TextDecoder
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Decoder: any = (globalThis as any).TextDecoder || (wx as any)?.TextDecoder;
      if (Decoder) {
        return new Decoder('utf-8').decode(new Uint8Array(chunk));
      }
      // 退化：手动按字节转 UTF-8（微信小程序低版本可能没有 TextDecoder）
      const view = new Uint8Array(chunk);
      let result = '';
      for (let i = 0; i < view.length; i++) result += String.fromCharCode(view[i]);
      return result;
    }
    if (typeof Uint8Array !== 'undefined' && chunk instanceof Uint8Array) {
      const Decoder: any = (globalThis as any).TextDecoder;
      if (Decoder) return new Decoder('utf-8').decode(chunk);
      let result = '';
      for (let i = 0; i < chunk.length; i++) result += String.fromCharCode(chunk[i]);
      return result;
    }
    return null;
  } catch {
    return null;
  }
}
