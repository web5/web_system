/**
 * 合翻报告解析（文本 → 结构化报告）
 *
 * 后端 `POST /api/ai-agent/agent/run` 返回的是**纯文本流**（模型输出 JSON，前后可能混
 * 思考文本 / markdown / 代码块）。本模块与小程序 `services/contract-api.ts` 同策略：
 * 整体 JSON → ```json 围栏 → 括号配对扫描（取最长可解析顶层对象）→ 截断容错 → 兜底空报告。
 *
 * 兜底原则：**绝不把模型原始文本丢给用户**（见 parseContractReport 的 fallback）。
 */
import type {
  ContractReport,
  ContractRight,
  ContractSignal,
  KeyNumber,
  LegalBasis,
  OptimizeItem,
} from '@/types/contract';

/** 场景归一：英文 scene key 转中文标签（与小程序 SCENE_LABEL_CN 同源） */
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

const DEFAULT_DISCLAIMER = '仅用于理解合同，不构成法律/理财/投资建议。';

/** 解析 agent final 文本为结构化报告；解析不出返回空报告（signals/rights 为空 → 页面走空态） */
export function parseContractReport(content: string): ContractReport {
  const parsed = extractJsonObject((content || '').trim());
  if (!parsed) return emptyReport();

  const rawSignals: unknown[] = Array.isArray(parsed.signals) ? parsed.signals : [];
  const rawRights: unknown[] = Array.isArray(parsed.rights) ? parsed.rights : [];
  const rawOptimize: unknown[] = Array.isArray(parsed.optimize) ? parsed.optimize : [];

  const signals: ContractSignal[] = rawSignals
    .map(normalizeSignal)
    .filter((s) => s.signalTitle || s.plainText);
  const rights: ContractRight[] = rawRights.map(normalizeRight).filter((r) => r.title);
  const optimize: OptimizeItem[] = rawOptimize
    .map(normalizeOptimize)
    .filter((o): o is OptimizeItem => !!o);

  if (!signals.length && !rights.length) return emptyReport();

  return {
    scene: normalizeScene(parsed.scene),
    conclusion: String(parsed.conclusion || '').trim() || defaultConclusion(signals, rights),
    signals,
    rights,
    optimize,
    keyNumbers: normalizeKeyNumbers(parsed.keyNumbers),
    disclaimer: String(parsed.disclaimer || '').trim() || DEFAULT_DISCLAIMER,
    createdAt: Date.now(),
  };
}

/** 空报告：页面据此渲染「暂无报告数据」空态，不渲染半张报告 */
function emptyReport(): ContractReport {
  return {
    scene: '未知',
    conclusion: '',
    signals: [],
    rights: [],
    optimize: [],
    keyNumbers: [],
    disclaimer: DEFAULT_DISCLAIMER,
    createdAt: Date.now(),
  };
}

function defaultConclusion(signals: ContractSignal[], rights: ContractRight[]): string {
  const danger = signals.filter((s) => s.level === 'danger').length;
  const warn = signals.filter((s) => s.level === 'warn').length;
  const parts = [`发现 ${danger} 项高风险、${warn} 项中风险`];
  if (rights.length) parts.push(`${rights.length} 条可主张权益`);
  parts.push('建议就下方标注的条款重新协商后再签署。');
  return parts.join('，');
}

/* ==================== 归一化 ==================== */

function normalizeScene(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '未知';
  // 已是中文且不含英文字母 → 直接用
  if (/[\u4e00-\u9fa5]/.test(s) && !/[A-Za-z]/.test(s)) return s;
  return SCENE_LABEL_CN[s.toLowerCase()] || s;
}

function normalizeSignal(s: any): ContractSignal {
  return {
    id: String(s?.id ?? s?.name ?? `sig-${Math.random().toString(36).slice(2, 8)}`),
    name: String(s?.name ?? ''),
    level: s?.level === 'danger' || s?.level === 'warn' || s?.level === 'ok' ? s.level : 'warn',
    signalTitle: String(s?.signalTitle ?? s?.name ?? '风险条款'),
    plainText: String(s?.plainText ?? ''),
    legalBasis: normalizeLegalBasis(s?.legalBasis),
    actions: Array.isArray(s?.actions) ? s.actions.map(String).filter(Boolean) : [],
    termExplain: s?.termExplain ? String(s.termExplain) : undefined,
    askableQuestions: normalizeQuestions(s?.askableQuestions),
  };
}

function normalizeRight(r: any): ContractRight {
  const amountRaw = r?.amount;
  const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw) || undefined;
  return {
    id: String(r?.id ?? r?.title ?? `right-${Math.random().toString(36).slice(2, 8)}`),
    title: String(r?.title ?? '可主张权益'),
    description: String(r?.description ?? ''),
    ...(amount && amount > 0 ? { amount } : {}),
    legalBasis: normalizeLegalBasis(r?.legalBasis),
    actions: Array.isArray(r?.actions) ? r.actions.map(String).filter(Boolean) : [],
    askableQuestions: normalizeQuestions(r?.askableQuestions),
  };
}

function normalizeOptimize(o: any): OptimizeItem | undefined {
  if (!o || typeof o !== 'object') return undefined;
  return {
    title: String(o.title ?? '权益最大化建议'),
    stage: o.stage === '成交后' || o.stage === '长期' ? o.stage : '成交前',
    plainText: String(o.plainText ?? ''),
    actions: Array.isArray(o.actions) ? o.actions.map(String).filter(Boolean) : [],
  };
}

function normalizeLegalBasis(lb: any): LegalBasis {
  if (!lb || typeof lb !== 'object') return { law: '', article: '', quote: '' };
  return {
    law: String(lb.law ?? ''),
    article: String(lb.article ?? ''),
    quote: String(lb.quote ?? ''),
  };
}

function normalizeKeyNumbers(raw: any): KeyNumber[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((k) => ({ label: String(k?.label ?? '').trim(), value: String(k?.value ?? '').trim() }))
    .filter((k) => k.label && k.value);
}

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

/* ==================== JSON 鲁棒提取 ==================== */

/**
 * 从模型输出中提取顶层 JSON 对象：
 * 1) 整体就是 JSON；2) ```json 围栏；3) 括号配对扫描取最长可解析片段；4) 截断容错。
 */
function extractJsonObject(text: string): any | null {
  if (!text) return null;

  if (text.startsWith('{')) {
    const parsed = tryParseObject(text);
    if (parsed) return parsed;
  }

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const parsed = tryParseObject(fence[1].trim());
    if (parsed) return parsed;
  }

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

  // 截断容错：用最后一个 } 截断后再找最长合法片段
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace > 0) {
    for (let k = starts.length - 1; k >= 0; k--) {
      const i = starts[k];
      if (i >= lastBrace) continue;
      const parsed = tryParseObject(text.slice(i, lastBrace + 1));
      if (parsed && text.slice(i, lastBrace + 1).length > bestLen) {
        best = parsed;
        bestLen = text.slice(i, lastBrace + 1).length;
      }
    }
  }
  return best;
}

function tryParseObject(candidate: string): any | null {
  try {
    const obj = JSON.parse(candidate.trim());
    if (obj && typeof obj === 'object') return obj;
  } catch {
    /* 忽略 */
  }
  return null;
}

/** 从 start（指向 `{`）向右找配对 `}`（跳过字符串内的括号） */
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
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* ==================== 派生展示值 ==================== */

/**
 * 健康指数：由风险等级派生（与原型口径一致：2 高 2 中 → 62）。
 * 下限 20 —— 再差也留一点刻度，避免 0 分造成的"无可救药"误读。
 */
export function healthScore(signals: ContractSignal[]): number {
  const danger = signals.filter((s) => s.level === 'danger').length;
  const warn = signals.filter((s) => s.level === 'warn').length;
  return Math.max(20, 100 - danger * 13 - warn * 6);
}

export function riskLevelLabel(score: number): string {
  if (score >= 80) return '低风险';
  if (score >= 60) return '中等风险';
  return '高风险';
}

/**
 * 报告 ↔ 原文联动的关键词回查（Q1 兜底，后端补定位字段 B3 后可替换）。
 * 策略：标题按标点切段 → 长段优先命中原文；切不到再退化为滑窗子串。
 * 命中不到返回空串 —— **不伪造定位**。
 */
export function pickKeyword(title: string, text: string): string {
  const t = (title || '').trim();
  const body = text || '';
  if (!t || !body) return '';

  const segments = t
    .split(/[，。、：:；;（(）)“”"'\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3)
    .sort((a, b) => b.length - a.length);
  for (const seg of segments) {
    if (body.includes(seg)) return seg;
  }

  for (let len = Math.min(6, t.length); len >= 3; len--) {
    for (let i = 0; i + len <= t.length; i++) {
      const win = t.slice(i, i + len);
      if (body.includes(win)) return win;
    }
  }
  return '';
}
