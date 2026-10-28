/**
 * B3 调参表单纯逻辑（五控件 + 三条联动 + 策略预览 + 审计 diff）。
 *
 * 真源：
 * - B3-原型说明.md §2 五控件规格 / §3 三条联动（Proto: 653631a0，Design: pass）
 * - D1-think统一-技术方案修订.md §6.3（表单联动规则）、§4.2（budget 公式）、§4.3（maxTokens 默认解析）
 * - docs/api/contracts.md C7-b（temperature/topP 互斥）、C7-e（null 不预填 0.7）
 *
 * 分层：本文件零 UI 依赖，可被 jest 直接单测；组件层只做展示与 v-model 接线。
 */

// ===== 常量 =====

/** 模型 max_tokens 上限。占位真值 8192（W5 待运维核定后替换，见 D3） */
export const MODEL_MAX_TOKENS = 8192;

/** 非工具场景客户端现状默认（hy3 口径示意，C7-e 回归口径）。W5 核定时随模型上限一并复核 */
export const CLIENT_DEFAULT_MAX_TOKENS = 2000;

/** 运行时回落温度（空 = 不覆盖，运行时回落此值；禁止 ?? 0.7 预填进表单） */
export const RUNTIME_FALLBACK_TEMPERATURE = 0.7;

// ===== 类型 =====

/** 表单侧 thinking 三态（D1：并列 segmented） */
export type ThinkingFormValue = 'null' | 'enabled' | 'disabled';

/** API/存储侧 thinking 形状：{"type":"enabled"} | {"type":"disabled"} | null。
 *  budget_tokens 不作为 agent 级配置（D1 §4.3），映射时一律丢弃。 */
export interface ThinkingOption {
  type: 'enabled' | 'disabled';
  /** 仅运行时调用级使用；agent 配置不写入 */
  budget_tokens?: number;
}

/** 五控件调参字段（进 agent 定义保存 payload） */
export interface TuningFields {
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  thinking: ThinkingFormValue;
  maxSteps: number;
}

// ===== thinking 三态映射 =====

/** API 值 → 表单三态。非法形状回落 NULL（防联调期旧形状污染，对齐 parseThinking 收紧口径） */
export function thinkingToForm(v: ThinkingOption | null | undefined): ThinkingFormValue {
  if (!v || typeof v !== 'object') return 'null';
  if (v.type === 'enabled') return 'enabled';
  if (v.type === 'disabled') return 'disabled';
  return 'null';
}

/** 表单三态 → API 值。enabled 时**不**带 budget_tokens（不进 agent 配置） */
export function thinkingToApi(v: ThinkingFormValue): ThinkingOption | null {
  if (v === 'enabled') return { type: 'enabled' };
  if (v === 'disabled') return { type: 'disabled' };
  return null;
}

// ===== 挂工具判定（联动①②公共输入） =====

export interface CapabilityLike {
  type?: string;
  ref?: string;
  enabled?: boolean;
}

/** 挂工具 = tools 非空，或 capabilities 中存在启用项（D1 §6.3 联动1 判据） */
export function hasToolsOf(
  tools?: string[] | null,
  capabilities?: CapabilityLike[] | null,
): boolean {
  if (Array.isArray(tools) && tools.length > 0) return true;
  if (Array.isArray(capabilities)) {
    return capabilities.some((c) => c && c.enabled !== false);
  }
  return false;
}

// ===== 联动①：挂工具默认 enabled + 误配 disabled =====

/** 带工具默认 enabled（W1 配置默认侧）；非工具默认未配置 */
export function defaultThinkingForm(hasTools: boolean): ThinkingFormValue {
  return hasTools ? 'enabled' : 'null';
}

/**
 * 误配判定（D2 可点+红字警示，不锁死控件）：
 * 带工具 + 显式 disabled → 运行时会被强制纠正为 enabled，此处选 disabled 不会生效。
 */
export function isThinkingMisconfig(hasTools: boolean, thinking: ThinkingFormValue): boolean {
  return hasTools && thinking === 'disabled';
}

// ===== 联动②：maxTokens 空值占位与有效值 =====

/** 占位文案随工具联动（D1 §6.3 联动2） */
export function maxTokensPlaceholder(hasTools: boolean): string {
  return hasTools
    ? `空 = 模型上限（${MODEL_MAX_TOKENS}）`
    : '空 = 系统默认（非工具）';
}

/** 有效 maxTokens（D1 §4.3 默认解析）：配了用配置值；空 + 带工具 = 模型上限；空 + 非工具 = 客户端现状默认 */
export function effectiveMaxTokens(
  maxTokens: number | null | undefined,
  hasTools: boolean,
): number {
  if (maxTokens !== null && maxTokens !== undefined && Number.isFinite(maxTokens)) {
    return maxTokens;
  }
  return hasTools ? MODEL_MAX_TOKENS : CLIENT_DEFAULT_MAX_TOKENS;
}

// ===== 联动③：budget 公式（D1 拍板） =====

/**
 * budget_tokens = min(模型上限, maxTokens/2)（maxTokens 取有效值；
 * 结果 max(1, floor(...)) 防 0）。仅 thinking 最终 enabled 时下发，此处只算数值。
 * 走查用例：maxTokens 2000 → 1000；空 + 带工具 → 4096。
 */
export function resolveBudgetTokens(
  maxTokens: number | null | undefined,
  hasTools: boolean,
): number {
  const eff = effectiveMaxTokens(maxTokens, hasTools);
  return Math.max(1, Math.min(MODEL_MAX_TOKENS, Math.floor(eff / 2)));
}

// ===== 校验（C7-b 互斥 + 值域预防） =====

export type TuningFieldKey = 'temperature' | 'maxTokens' | 'topP' | 'maxSteps';

export interface TuningValidation {
  ok: boolean;
  errors: Partial<Record<TuningFieldKey, string>>;
}

/**
 * 保存前预防性校验（真相源仍在后端 assertTuningParams，这里只提前拦）：
 * - C7-b：temperature 与 topP 同填 → 两字段同时红字、保存被拒、**不清已填值**
 * - 值域：temperature 0–2 / topP 0–1 / maxTokens ≥1 / maxSteps 1–50
 */
export function validateTuning(p: {
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  maxSteps: number;
}): TuningValidation {
  const errors: Partial<Record<TuningFieldKey, string>> = {};

  const tempSet = p.temperature !== null && p.temperature !== undefined;
  const topPSet = p.topP !== null && p.topP !== undefined;

  if (tempSet && topPSet) {
    errors.temperature = 'temperature 与 topP 只能填一个（互斥校验）';
    errors.topP = 'temperature 与 topP 只能填一个（互斥校验）';
  }
  if (tempSet && (p.temperature! < 0 || p.temperature! > 2)) {
    errors.temperature = 'temperature 取值范围 0–2';
  }
  if (topPSet && (p.topP! < 0 || p.topP! > 1)) {
    errors.topP = 'topP 取值范围 0–1';
  }
  if (p.maxTokens !== null && p.maxTokens !== undefined && p.maxTokens < 1) {
    errors.maxTokens = 'maxTokens 需 ≥ 1';
  }
  if (!(p.maxSteps >= 1 && p.maxSteps <= 50)) {
    errors.maxSteps = 'max_steps 取值范围 1–50';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

// ===== 角色门禁（S5 仅超管） =====

/** 调参入口/区块仅超级管理员可见（原型 data-need-role="superadmin" 口径） */
export function canAccessTuning(roles: string[] | undefined | null): boolean {
  return Array.isArray(roles) && roles.includes('super_admin');
}

// ===== 生效策略预览（轻量版 P1–P5） =====

export interface StrategyChainItem {
  no: number;
  label: string;
  hit: boolean;
  detail: string;
}

export interface StrategyPreview {
  chain: StrategyChainItem[];
  /** 最终 thinking 文本（含「强制」「（P5）」标注） */
  thinkingText: string;
  /** budget_tokens；null = 不下发 */
  budgetTokens: number | null;
  /** 公式说明；null = 不下发 */
  budgetFormula: string | null;
  /** 生效 max_tokens 数值 */
  maxTokens: number;
  /** max_tokens 来源说明（模型上限 / 客户端默认） */
  maxTokensWhy: string;
}

/**
 * 轻量版策略预览：P1 带工具强制 enabled → P2 options.thinking 显式（非工具，本表单不涉及=未命中）
 * → P3 agent 配置 → P4 env TOKENHUB_THINKING（前端不可知=未设置）→ P5 形态默认（非工具 NULL → disabled）。
 * 命中档实时标注 + thinking / budget_tokens / max_tokens 三值输出。
 */
export function buildStrategyPreview(opts: {
  hasTools: boolean;
  thinking: ThinkingFormValue;
  maxTokens: number | null;
}): StrategyPreview {
  const { hasTools, thinking, maxTokens } = opts;
  const effMax = effectiveMaxTokens(maxTokens, hasTools);
  const maxWhy = hasTools ? '（模型上限）' : '（客户端默认）';

  // P1：带工具强制 enabled（无论配置写什么）
  const p1Hit = hasTools;
  // P3：agent 配置
  const p3Configured = thinking !== 'null';
  // P5：非工具 + 未配置 → 形态默认 disabled
  const p5Hit = !hasTools && thinking === 'null';

  const chain: StrategyChainItem[] = [
    {
      no: 1,
      label: '带工具强制 enabled',
      hit: p1Hit,
      detail: p1Hit
        ? thinking === 'disabled'
          ? '命中 · 纠正 disabled → enabled'
          : '命中'
        : '未命中（无工具）',
    },
    { no: 2, label: 'options.thinking 显式（非工具）', hit: false, detail: '未命中' },
    {
      no: 3,
      label: 'agent 配置',
      hit: p3Configured,
      detail: p3Configured
        ? thinking + (p1Hit && thinking === 'disabled' ? '（被纠正）' : '')
        : 'NULL',
    },
    { no: 4, label: 'env TOKENHUB_THINKING', hit: false, detail: '未设置' },
    {
      no: 5,
      label: '形态默认',
      hit: p5Hit,
      detail: p5Hit ? 'disabled' : '未到达',
    },
  ];

  // 最终 thinking
  let thinkingText: string;
  if (p1Hit) {
    thinkingText = 'enabled（强制）';
  } else if (thinking === 'enabled') {
    thinkingText = 'enabled';
  } else if (thinking === 'disabled') {
    thinkingText = 'disabled';
  } else {
    thinkingText = 'disabled（P5）';
  }

  const finalEnabled = p1Hit || thinking === 'enabled';
  const budgetTokens = finalEnabled ? resolveBudgetTokens(maxTokens, hasTools) : null;
  const budgetFormula = finalEnabled
    ? `= min(${MODEL_MAX_TOKENS}, ${effMax}/2)`
    : null;

  return {
    chain,
    thinkingText,
    budgetTokens,
    budgetFormula,
    maxTokens: effMax,
    maxTokensWhy: maxWhy,
  };
}

// ===== 审计 diff（S6） =====

export interface AuditFieldDiff {
  field: string;
  before: string;
  after: string;
}

const FIELD_LABELS: Record<string, string> = {
  temperature: 'temperature',
  maxTokens: 'maxTokens',
  topP: 'topP',
  thinking: 'thinking',
  maxSteps: 'max_steps',
};

/** 审计展示格式：空值显式「未配置」（禁止 0.7 预填痕迹） */
export function formatTuningValue(field: string, v: unknown): string {
  if (field === 'thinking') {
    return v === 'null' || v === null || v === undefined ? '未配置' : String(v);
  }
  if (v === null || v === undefined || v === '') return '未配置';
  return String(v);
}

/** 五控件改前→改后字段级 diff（只列真正变化的字段） */
export function buildTuningDiffs(before: TuningFields, after: TuningFields): AuditFieldDiff[] {
  const diffs: AuditFieldDiff[] = [];
  const keys: Array<keyof TuningFields> = ['temperature', 'maxTokens', 'topP', 'thinking', 'maxSteps'];
  for (const k of keys) {
    const b = before[k];
    const a = after[k];
    const changed =
      k === 'thinking'
        ? String(b) !== String(a)
        : (b ?? null) !== (a ?? null);
    if (changed) {
      diffs.push({
        field: FIELD_LABELS[k] ?? k,
        before: formatTuningValue(k, b),
        after: formatTuningValue(k, a),
      });
    }
  }
  return diffs;
}

/** 审计条目的运行时生效值行（budget / max_tokens） */
export function buildRuntimeNote(opts: {
  hasTools: boolean;
  maxTokens: number | null;
  thinking: ThinkingFormValue;
}): string {
  const preview = buildStrategyPreview(opts);
  const forced = opts.hasTools ? '（带工具强制 enabled）' : '';
  if (preview.budgetTokens === null) {
    return `运行时生效：thinking=${preview.thinkingText}${forced} · budget_tokens=不下发`;
  }
  return `运行时生效：budget_tokens=${preview.budgetTokens} · max_tokens=${preview.maxTokens}${preview.maxTokensWhy}${forced}`;
}

/** 页面审计区条目（前端展示用；后端审计落库不归 UI 层） */
export interface TuningAuditEntry {
  id: string;
  agentId: string;
  agentName: string;
  operator: string;
  time: string;
  diffs: AuditFieldDiff[];
  runtimeNote: string;
}

/** 保存成功后组装审计条目（改前→改后 diff + 运行时生效值） */
export function buildTuningAuditEntry(opts: {
  agentId: string;
  agentName: string;
  operator: string;
  time?: string;
  before: TuningFields;
  after: TuningFields;
  hasTools: boolean;
}): TuningAuditEntry {
  return {
    id: `${opts.agentId}-${Date.now()}`,
    agentId: opts.agentId,
    agentName: opts.agentName,
    operator: opts.operator,
    time: opts.time ?? new Date().toLocaleString('zh-CN', { hour12: false }),
    diffs: buildTuningDiffs(opts.before, opts.after),
    runtimeNote: buildRuntimeNote({
      hasTools: opts.hasTools,
      maxTokens: opts.after.maxTokens,
      thinking: opts.after.thinking,
    }),
  };
}
