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
  /**
   * 思考预算。
   *
   * ⚠️ 口径订正（#8272）：这个字段**不是「仅运行时用、配置里不会有」**。实测 PUT
   * `{type:'enabled',budget_tokens:2048}` 后端会接收并落库（`agent-def.dto.ts` 声明了该字段、
   * `agent-def.service.ts` 还做了 ≥1 校验），回读仍是 2048；运行时 `agent-def-sync.service.ts`
   * 把它当**显式 budget** 用，会覆盖 `min(模型上限, maxTokens/2)` 公式值。
   * ⇒ 本 UI 从不写它（见 `thinkingToApi`），但手工塞进去就是**永久生效**的，别拿它做「临时调一下」。
   * 想调预算请改 maxTokens。
   */
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

/**
 * 表单三态 → API 值。
 * `enabled` 只发 `{type:'enabled'}`，**不带** budget_tokens —— 预算一律由运行时按
 * `min(模型 max_tokens 上限, maxTokens/2)` 公式算（见 agent-core `thinking-policy.ts`，P3 分支）。
 *
 * ⚠️ 别把「UI 不发」读成「配置里不会有」：后端 DTO 仍接受 budget_tokens（存量兼容 + 校验），
 * 显式传了会落库并被运行时当显式 budget 用。详见 `ThinkingOption.budget_tokens`（#8272）。
 */
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

// ===== 联动②：maxTokens 空值语义 =====

// 2026-10-29 拍板（B1）：占位文案统一「未配置」（与 Temperature / Top P 一致），
// 原 maxTokensPlaceholder(hasTools) 删除——它唯一用途就是切占位，三种字段两种写法观感不一致，
// 且与 extra 重复表达。留空的上限语义只在 extra 表达（组件用 MODEL_MAX_TOKENS 插值）。

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

  // D6（2026-11-06 盲测）：这些串直接渲染成字段下的红字，属**产品文案** ——
  // 一律用业务词（Temperature / Top P / 输出上限 / 最大步数），不出现内部字段名
  // （topP / maxTokens / max_steps）与契约措辞「互斥校验」（page-spec §3.2 hint 禁止项）。
  if (tempSet && topPSet) {
    errors.temperature = 'Temperature 与 Top P 只能填一个';
    errors.topP = 'Temperature 与 Top P 只能填一个';
  }
  if (tempSet && (p.temperature! < 0 || p.temperature! > 2)) {
    errors.temperature = 'Temperature 需在 0–2 之间';
  }
  if (topPSet && (p.topP! < 0 || p.topP! > 1)) {
    errors.topP = 'Top P 需在 0–1 之间';
  }
  if (p.maxTokens !== null && p.maxTokens !== undefined && p.maxTokens < 1) {
    errors.maxTokens = '输出上限需 ≥ 1';
  }
  if (!(p.maxSteps >= 1 && p.maxSteps <= 50)) {
    errors.maxSteps = '最大步数需在 1–50 之间';
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

// ===== 角色门禁（S5） =====

/**
 * 调参入口/区块管理员及以上可见（原型 data-need-role="admin" 口径）。
 * 用户 2026-10-29 拍板放开 admin（原仅 super_admin）；editor/viewer 不可见。
 * 后端本就允许 admin（agent-def.controller 仅 agents:view/manage，
 * ROLE_PERMISSIONS.admin 含 agents:manage），此处只是 UI 层门禁对齐。
 */
export function canAccessTuning(roles: string[] | undefined | null): boolean {
  return Array.isArray(roles) && (roles.includes('super_admin') || roles.includes('admin'));
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
  /** 展示用本地化时间串（形如 2026/10/29 14:42:40）。仅用于渲染，不可用于时间比较 */
  time: string;
  /** 机器可读时间戳（epoch 毫秒）。D4 留存期判定只认这个字段 —— time 是本地化串，解析它做过滤会随 locale 静默失效 */
  ts: number;
  diffs: AuditFieldDiff[];
  runtimeNote: string;
}

/** D4 留存期：审计条目保留近 7 天（用户 2026-10-29 拍板：条数口径改为时间口径） */
export const TUNING_AUDIT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 判断审计条目是否落在 D4 留存期内。
 *
 * 判据（左闭右开）：`now - ts < TUNING_AUDIT_RETENTION_MS` 视为在留存期内。
 * - `now - ts === RETENTION_MS`（刚好 7 天）→ **不在**留存期，边界取开；
 *   语义上「近 7 天内」不含第 7 天整点这一刻。
 * - `ts > now`（未来时间：时钟回拨 / 跨设备数据）→ `now - ts` 为负 → **在**留存期内，
 *   不误藏；留存期是「清更老的」，不该把更新的数据清掉。
 */
export function isWithinTuningAuditRetention(ts: number, now = Date.now()): boolean {
  return now - ts < TUNING_AUDIT_RETENTION_MS;
}

/** 按 D4 留存期裁剪审计条目（写入时 prune，避免超期条目白占内存） */
export function pruneTuningAuditEntries(entries: TuningAuditEntry[], now = Date.now()): TuningAuditEntry[] {
  return entries.filter((e) => isWithinTuningAuditRetention(e.ts, now));
}

/** 保存成功后组装审计条目（改前→改后 diff + 运行时生效值） */
export function buildTuningAuditEntry(opts: {
  agentId: string;
  agentName: string;
  operator: string;
  time?: string;
  /** 仅供单测/回放注入固定时间戳；不传则取当前时刻 */
  ts?: number;
  before: TuningFields;
  after: TuningFields;
  hasTools: boolean;
}): TuningAuditEntry {
  const ts = opts.ts ?? Date.now();
  return {
    id: `${opts.agentId}-${ts}`,
    agentId: opts.agentId,
    agentName: opts.agentName,
    operator: opts.operator,
    time: opts.time ?? new Date(ts).toLocaleString('zh-CN', { hour12: false }),
    ts,
    diffs: buildTuningDiffs(opts.before, opts.after),
    runtimeNote: buildRuntimeNote({
      hasTools: opts.hasTools,
      maxTokens: opts.after.maxTokens,
      thinking: opts.after.thinking,
    }),
  };
}

// ===== 未保存变更对比（B2c · 字段级 badge / 面板级变更条） =====
//
// 真源：docs/ui/page-specs/agent-def-detail-v2.md §4「参数对比（三级，口径必须一致）」。
// 与上面审计 diff 的分工：
//   · 审计（S6）= **已保存**的历史留痕，字段名用技术名（temperature / max_steps），偏排障。
//   · 本段 = **未保存**的草稿 vs 载入值，字段名用业务词、thinking 用业务词，
//     因为它直接出现在 hint 行右侧和变更条里（page-spec §3.2 明禁内部字段名/实现枚举）。
//   ⚠️ 两处口径差异是**有意的**，不是漏改：
//     · 字段名：技术名（审计）↔ 业务词（这里）。
//     · thinking 值：审计保留契约值（`enabled`/`disabled`，排障要看原值）↔ 这里用业务词
//       （「跟随默认/开启/关闭」—— §3 控件 5 明确「契约值只在代码与契约文档里，不进 UI」）。
//     · maxSteps：审计**含**（`buildTuningDiffs` 的 keys 有它，排障要全字段）↔ 这里**不含**
//       （见下：不是模型 API 参数，page-spec §4 不计入）。两边不一致是对的，别「统一」掉。

/**
 * 参与「参数对比」的字段。
 *
 * 口径（page-spec v2 §4）：只统计**真正下发给模型、且用户可改**的参数。
 * 逐项为什么在/不在：
 * - `temperature` / `topP` / `maxTokens` / `thinking`：四控件，进保存 payload 也进模型 API。
 * - `budget`：§4 表里列了它，但 v2.4 起 `budget_tokens` **不是 agent 级配置**（原型 :1346 同口径
 *   「budget 不再是配置字段（只读预览）」、本仓库 `thinkingToApi()` 从不写它）。它是
 *   `min(模型上限, maxTokens/2)` 的派生只读值 —— 计入会与 `maxTokens` **同一原因出两条变更**，
 *   计数虚高一倍，故不计入。
 * - `maxSteps`：Agent 引擎的工具编排轮数上限，不是模型 API 参数（面板 hint 同口径）。
 * - 采样方式：已废弃（B3 定稿拆成 temp/topP 两个输入），且它本身是 UI 态。
 *
 * ⚠️ 与**原型**的两处已知偏离（照规格而非照原型，登记在此防后人当 bug 改回去）：
 * ① 原型 `FIELDS`（:1347-1357）把 `maxSteps` 当 param 且**有** `badge-maxSteps`（:1021），
 *    也就是原型把它计入计数；我们按 §4 不计入。
 * ② 原型还把 4 个基础配置字段（用途说明 / 路由关键词 / 模型 / System Prompt）计入同一个计数
 *    （机检 `verify-agent-def-detail.mjs` 5e/5f 锁死这一行为），我们按 §4「计数 = 上述字段
 *    变化数」只算参数 —— 变更条自己的文案也是「N 项**参数**未保存」，只算参数才自洽。
 *    （未保存改动不会因此被吞：`dirty` 走整表单快照，放弃/返回拦截照旧生效。）
 * 锚点面不受影响：原型 5 个 badge 里只有 4 个带 `data-dr`（`badge-maxSteps` 没打），
 * 所以原型侧 `data-dr` 是 4 个 badge + `diff-bar` + `diff-table` = 6，与本实现的 6 个一一对应。
 *
 * 🔴 要加字段必须同时改 page-spec §4 + 原型（含 `data-dr`），否则会出现「界面多一条 badge、
 *    规格里查不到出处」，R11b 锚点比对也会报 EXTRA。
 */
export const TUNING_DIFF_FIELDS = ['temperature', 'maxTokens', 'topP', 'thinking'] as const;
export type TuningDiffField = (typeof TUNING_DIFF_FIELDS)[number];

/** 对比表的字段展示名（业务词，非内部字段名 —— page-spec §3.2） */
export const TUNING_DIFF_LABELS: Record<TuningDiffField, string> = {
  temperature: 'Temperature',
  maxTokens: '输出上限',
  topP: 'Top P',
  thinking: '思考',
};

/** thinking 三态的业务词选项。抽到本文件做单一真源：面板 segmented 与 diff badge 共用，
 *  避免两处各写一份「跟随默认/开启/关闭」后漂移。 */
export const THINKING_FORM_OPTIONS: Array<{ label: string; value: ThinkingFormValue }> = [
  { label: '跟随默认', value: 'null' },
  { label: '开启', value: 'enabled' },
  { label: '关闭', value: 'disabled' },
];

/** thinking 三态 → 业务词（禁把 enabled/disabled 这类契约值摆到用户面前） */
export function thinkingFormLabel(v: ThinkingFormValue | null | undefined): string {
  return THINKING_FORM_OPTIONS.find((o) => o.value === (v ?? 'null'))?.label ?? '跟随默认';
}

/** diff 展示值：thinking 走业务词，其余复用审计口径的格式化（空值显式「未配置」）。
 *  与 formatTuningValue 的唯一差异就是 thinking —— 审计区保留契约值是刻意的（排障要看原值）。 */
export function formatDiffValue(field: TuningDiffField, v: unknown): string {
  if (field === 'thinking') return thinkingFormLabel(v as ThinkingFormValue);
  return formatTuningValue(field, v);
}

export interface TuningFieldDiff {
  field: TuningDiffField;
  /** 业务词字段名（对比表左侧列用；badge 不显示字段名） */
  label: string;
  before: string;
  after: string;
}

/**
 * 未保存参数 vs 载入值的字段级 diff（只返回**真正变化**的字段）。
 *
 * 面板级变更条的计数与字段级 badge 都从这里取 —— page-spec §4 要求「口径必须一致」，
 * 所以两边绝不能各算一套。返回空数组 = 无参数变更（变更条隐藏）。
 */
export function buildTuningFieldDiffs(before: TuningFields, after: TuningFields): TuningFieldDiff[] {
  const diffs: TuningFieldDiff[] = [];
  for (const k of TUNING_DIFF_FIELDS) {
    const b = before[k];
    const a = after[k];
    // thinking 是字符串三态、其余是 number|null。
    // 🔴 thinking 必须先归一化再比：旧形状（DB 里 thinking 缺失）漏到 undefined 时，
    //    `String(undefined) !== 'null'` 会算成「有变更」，而两侧展示值都被
    //    `formatDiffValue` 归成「跟随默认」—— 界面上就会出现一条「跟随默认 → 跟随默认」
    //    的变更，用户完全无从理解。归一化口径与 `thinkingFormLabel` 保持一致（undefined ≡ 'null'）。
    const changed =
      k === 'thinking' ? (b ?? 'null') !== (a ?? 'null') : (b ?? null) !== (a ?? null);
    if (!changed) continue;
    diffs.push({
      field: k,
      label: TUNING_DIFF_LABELS[k],
      before: formatDiffValue(k, b),
      after: formatDiffValue(k, a),
    });
  }
  return diffs;
}

