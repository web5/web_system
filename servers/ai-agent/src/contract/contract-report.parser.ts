/**
 * 合同风险报告解析器（纯函数）。
 *
 * 契约：LLM 在 agent final 阶段输出的 content 可能是结构化 JSON 报告，也可能是普通追问回答。
 * - 报告 → 解析并返回快照对象（供 agent_conversations.report 列存储、result 页回放渲染）；
 * - 非报告（追问文本 / 解析失败）→ 返回 null，调用方据此"不覆盖"既有快照。
 *
 * 鲁棒性：LLM 可能在 JSON 前后混用思考文本、markdown 代码块、标题，甚至输出被截断。
 * 解析策略与 mini-contract 侧保持一致：整体 parse → ```json 代码块 → 顶层配对括号扫描 → 截断容错。
 */
export interface ContractReportSnapshot {
  scene: string;
  conclusion?: string;
  signals?: Array<Record<string, unknown>>;
  rights?: Array<Record<string, unknown>>;
  loanPlan?: Record<string, unknown>;
  optimize?: Array<Record<string, unknown>>;
  keyNumbers?: Array<Record<string, unknown>>;
  disclaimer?: string;
}

/** 判定是否为"合同风险报告"（有 scene 或 signals 结构）；是则返回快照，否则 null */
export function parseContractReport(content: string): ContractReportSnapshot | null {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed) return null;

  const obj = extractJsonObject(trimmed);
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  const hasSignals = Array.isArray(rec.signals);
  const scene = typeof rec.scene === 'string' ? rec.scene.trim() : '';
  if (!hasSignals && !scene) return null; // 普通追问文本等 → 非报告

  // 白名单重建（避免整体断言）；report 快照仅需前端渲染用到的字段
  const snapshot: ContractReportSnapshot = { scene };
  if (typeof rec.conclusion === 'string') snapshot.conclusion = rec.conclusion;
  if (hasSignals) snapshot.signals = rec.signals as Array<Record<string, unknown>>;
  if (Array.isArray(rec.rights)) snapshot.rights = rec.rights as Array<Record<string, unknown>>;
  if (rec.loanPlan && typeof rec.loanPlan === 'object') {
    snapshot.loanPlan = rec.loanPlan as Record<string, unknown>;
  }
  if (Array.isArray(rec.optimize)) {
    snapshot.optimize = rec.optimize as Array<Record<string, unknown>>;
  }
  if (Array.isArray(rec.keyNumbers)) {
    snapshot.keyNumbers = rec.keyNumbers as Array<Record<string, unknown>>;
  }
  if (typeof rec.disclaimer === 'string') snapshot.disclaimer = rec.disclaimer;
  return snapshot;
}

/**
 * 从字符串中提取顶层 JSON 对象（成功返回对象，否则 null）：
 * 1. 整体 parse；2. ```json 代码块；3. 左起取首个"完整闭合"的对象（最外层优先，
 *    避免拿到嵌套子对象）；4. 括号未闭合（截断）时以整体最后一个 `}` 截断容错。
 */
function extractJsonObject(text: string): unknown {
  // 1) 整体就是 JSON
  if (text.trim().startsWith('{')) {
    const obj = tryParse(text.trim());
    if (obj) return obj;
  }
  // 2) markdown ```json ... ``` 代码块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const parsed = tryParse(fence[1].trim());
    if (parsed) return parsed;
  }
  // 3) 左起扫描：首个括号完整闭合的对象通常即最外层目标
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    const end = findMatchingBrace(text, i);
    if (end !== -1) {
      const parsed = tryParse(text.slice(i, end + 1));
      if (parsed) return parsed;
      i = end; // 该块整体不可解析，跳过内部再继续找
      continue;
    }
    // 4) 截断容错：起点未闭合（LLM 输出截断），以整体最后一个 `}` 截断尝试
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace > i) {
      const parsed = tryParse(text.slice(i, lastBrace + 1));
      if (parsed) return parsed;
    }
  }
  return null;
}

/** 尝试 parse 一段文本为对象 */
function tryParse(candidate: string): unknown {
  try {
    const obj = JSON.parse(candidate.trim());
    if (obj && typeof obj === 'object') return obj;
  } catch {
    // 忽略非法 JSON
  }
  return null;
}

/** 从 start（指向 `{`）向右找匹配的 `}`（跳过字符串内括号） */
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
