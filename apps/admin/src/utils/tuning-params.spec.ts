/**
 * B3 调参表单纯逻辑单测（tuning-params.ts）。
 *
 * 覆盖 B3-原型说明 §2 五控件规格 + §3 三条联动 + D1 §6.3 规则：
 * - thinking 三态映射（NULL / enabled / disabled ↔ json null / {type:…}）
 * - 联动①：带工具默认 enabled + 误配 disabled 判定
 * - 联动②：maxTokens 空值占位与有效值解析
 * - 联动③：budget = min(模型上限, maxTokens/2)（走查用例 2000→1000）
 * - C7-b 互斥：temperature + topP 同填报错、不清值
 * - 生效策略预览 P1–P5 命中档 + 三值输出
 * - 审计 diff（改前→改后 + 运行时生效值）
 *
 * 流程凭证：Proto: 653631a0 + Design: pass + B3-原型说明.md / D1-think统一-技术方案修订.md
 */
import {
  MODEL_MAX_TOKENS,
  CLIENT_DEFAULT_MAX_TOKENS,
  thinkingToForm,
  thinkingToApi,
  hasToolsOf,
  defaultThinkingForm,
  isThinkingMisconfig,
  maxTokensPlaceholder,
  effectiveMaxTokens,
  resolveBudgetTokens,
  validateTuning,
  canAccessTuning,
  buildStrategyPreview,
  formatTuningValue,
  buildTuningDiffs,
  buildRuntimeNote,
  type ThinkingFormValue,
} from './tuning-params';

describe('thinking 三态映射（B3 §2 控件4 ↔ json 值域）', () => {
  it('NULL ↔ 未配置：api null → form "null"，form "null" → api null', () => {
    expect(thinkingToForm(null)).toBe('null');
    expect(thinkingToForm(undefined)).toBe('null');
    expect(thinkingToApi('null')).toBeNull();
  });

  it('enabled ↔ {"type":"enabled"}（budget_tokens 不进 agent 配置）', () => {
    expect(thinkingToForm({ type: 'enabled' })).toBe('enabled');
    const api = thinkingToApi('enabled');
    expect(api).toEqual({ type: 'enabled' });
    expect(api && 'budget_tokens' in api).toBe(false);
  });

  it('disabled ↔ {"type":"disabled"}', () => {
    expect(thinkingToForm({ type: 'disabled' })).toBe('disabled');
    expect(thinkingToApi('disabled')).toEqual({ type: 'disabled' });
  });

  it('非法形状回落 NULL（防联调期旧形状污染）', () => {
    expect(thinkingToForm({ type: 'enabled', budget_tokens: 1024 } as never)).toBe('enabled');
    expect(thinkingToForm({ type: 'unknown' } as never)).toBe('null');
    expect(thinkingToForm({} as never)).toBe('null');
  });

  it('round-trip：form → api → form 稳定', () => {
    const all: ThinkingFormValue[] = ['null', 'enabled', 'disabled'];
    for (const v of all) {
      expect(thinkingToForm(thinkingToApi(v))).toBe(v);
    }
  });
});

describe('hasToolsOf：挂工具判定（tools / capabilities 任一非空）', () => {
  it('tools 非空 → true', () => {
    expect(hasToolsOf(['web-search'], null)).toBe(true);
  });
  it('capabilities 含启用项 → true', () => {
    expect(hasToolsOf([], [{ type: 'tool', ref: 'x', enabled: true }])).toBe(true);
  });
  it('capabilities 全 disabled 且 tools 空 → false', () => {
    expect(hasToolsOf([], [{ type: 'tool', ref: 'x', enabled: false }])).toBe(false);
  });
  it('全空 / null → false', () => {
    expect(hasToolsOf(null, null)).toBe(false);
    expect(hasToolsOf([], [])).toBe(false);
  });
});

describe('联动①：挂工具默认 enabled + 误配 disabled 判定（D2 可点+警示）', () => {
  it('带工具默认 enabled', () => {
    expect(defaultThinkingForm(true)).toBe('enabled');
  });
  it('非工具默认未配置（NULL）', () => {
    expect(defaultThinkingForm(false)).toBe('null');
  });
  it('带工具 + disabled = 误配（红字警示条件）', () => {
    expect(isThinkingMisconfig(true, 'disabled')).toBe(true);
  });
  it('带工具 + enabled / 未配置 不算误配', () => {
    expect(isThinkingMisconfig(true, 'enabled')).toBe(false);
    expect(isThinkingMisconfig(true, 'null')).toBe(false);
  });
  it('非工具 + disabled 不算误配（合法配置）', () => {
    expect(isThinkingMisconfig(false, 'disabled')).toBe(false);
  });
});

describe('联动②：maxTokens 空值占位与有效值（D1 §4.3 默认解析）', () => {
  it('带工具占位 = 模型上限（8192 占位，W5 待核定）', () => {
    expect(maxTokensPlaceholder(true)).toContain('模型上限');
    expect(maxTokensPlaceholder(true)).toContain(String(MODEL_MAX_TOKENS));
  });
  it('非工具占位 = 系统默认', () => {
    expect(maxTokensPlaceholder(false)).toContain('系统默认');
    expect(maxTokensPlaceholder(false)).not.toContain(String(MODEL_MAX_TOKENS));
  });
  it('有效值：配置了就用配置值', () => {
    expect(effectiveMaxTokens(2000, true)).toBe(2000);
    expect(effectiveMaxTokens(2000, false)).toBe(2000);
    expect(effectiveMaxTokens(500, true)).toBe(500);
  });
  it('有效值：空 + 带工具 = 模型上限（不人为压小）', () => {
    expect(effectiveMaxTokens(null, true)).toBe(MODEL_MAX_TOKENS);
    expect(effectiveMaxTokens(undefined, true)).toBe(MODEL_MAX_TOKENS);
  });
  it('有效值：空 + 非工具 = 客户端现状默认（C7-e 回归口径）', () => {
    expect(effectiveMaxTokens(null, false)).toBe(CLIENT_DEFAULT_MAX_TOKENS);
  });
});

describe('联动③：budget_tokens = min(模型上限, maxTokens/2)（D1 拍板公式）', () => {
  it('走查用例：maxTokens 2000 → budget 1000', () => {
    expect(resolveBudgetTokens(2000, true)).toBe(1000);
    expect(resolveBudgetTokens(2000, false)).toBe(1000);
  });
  it('maxTokens 空 + 带工具 → min(8192, 8192/2) = 4096', () => {
    expect(resolveBudgetTokens(null, true)).toBe(4096);
  });
  it('maxTokens 空 + 非工具 → min(8192, 2000/2) = 1000', () => {
    expect(resolveBudgetTokens(null, false)).toBe(1000);
  });
  it('被模型上限截断：maxTokens 20000 → 8192', () => {
    expect(resolveBudgetTokens(20000, true)).toBe(MODEL_MAX_TOKENS);
  });
  it('floor + max(1, …) 防 0：maxTokens 1 → 1', () => {
    expect(resolveBudgetTokens(1, true)).toBe(1);
    expect(resolveBudgetTokens(3, true)).toBe(1);
  });
});

describe('C7-b 互斥校验：temperature 与 topP 同填保存被拒、不清值', () => {
  it('同填 → 两个字段都有错，ok=false', () => {
    const r = validateTuning({ temperature: 0.7, maxTokens: null, topP: 0.9, maxSteps: 10 });
    expect(r.ok).toBe(false);
    expect(r.errors.temperature).toBeTruthy();
    expect(r.errors.topP).toBeTruthy();
  });
  it('只填 temperature → ok', () => {
    const r = validateTuning({ temperature: 0.7, maxTokens: null, topP: null, maxSteps: 10 });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual({});
  });
  it('只填 topP → ok', () => {
    const r = validateTuning({ temperature: null, maxTokens: null, topP: 0.9, maxSteps: 10 });
    expect(r.ok).toBe(true);
  });
  it('都空 → ok（空 = 不覆盖）', () => {
    const r = validateTuning({ temperature: null, maxTokens: null, topP: null, maxSteps: 10 });
    expect(r.ok).toBe(true);
  });
  it('temperature 越界（<0 或 >2）报错', () => {
    expect(validateTuning({ temperature: -0.1, maxTokens: null, topP: null, maxSteps: 10 }).ok).toBe(false);
    expect(validateTuning({ temperature: 2.1, maxTokens: null, topP: null, maxSteps: 10 }).ok).toBe(false);
  });
  it('topP 越界（<0 或 >1）报错', () => {
    expect(validateTuning({ temperature: null, maxTokens: null, topP: 1.5, maxSteps: 10 }).ok).toBe(false);
    expect(validateTuning({ temperature: null, maxTokens: null, topP: -0.01, maxSteps: 10 }).ok).toBe(false);
  });
  it('maxTokens < 1 / maxSteps 越界报错', () => {
    expect(validateTuning({ temperature: null, maxTokens: 0, topP: null, maxSteps: 10 }).ok).toBe(false);
    expect(validateTuning({ temperature: null, maxTokens: null, topP: null, maxSteps: 0 }).ok).toBe(false);
    expect(validateTuning({ temperature: null, maxTokens: null, topP: null, maxSteps: 51 }).ok).toBe(false);
  });
});

describe('仅超管可见（S5：普通管理员无入口）', () => {
  it('super_admin → 可见', () => {
    expect(canAccessTuning(['super_admin'])).toBe(true);
    expect(canAccessTuning(['super_admin', 'admin'])).toBe(true);
  });
  it('admin / editor / viewer → 不可见', () => {
    expect(canAccessTuning(['admin'])).toBe(false);
    expect(canAccessTuning(['editor'])).toBe(false);
    expect(canAccessTuning(['viewer'])).toBe(false);
    expect(canAccessTuning([])).toBe(false);
  });
});

describe('生效策略预览（轻量版 P1–P5 + 三值输出）', () => {
  it('S1 带工具：P1 命中，thinking=enabled（强制），budget 公式值', () => {
    const p = buildStrategyPreview({ hasTools: true, thinking: 'enabled', maxTokens: null });
    expect(p.chain[0].hit).toBe(true); // P1 带工具强制
    expect(p.chain[4].hit).toBe(false); // P5 未到达
    expect(p.thinkingText).toContain('enabled');
    expect(p.thinkingText).toContain('强制');
    expect(p.budgetTokens).toBe(4096);
    expect(p.budgetFormula).toContain('8192');
    expect(p.maxTokens).toBe(MODEL_MAX_TOKENS);
    expect(p.maxTokensWhy).toContain('模型上限');
  });

  it('S3 带工具误配 disabled：P1 命中「纠正」，最终仍是 enabled', () => {
    const p = buildStrategyPreview({ hasTools: true, thinking: 'disabled', maxTokens: 2000 });
    expect(p.chain[0].hit).toBe(true);
    expect(p.chain[0].detail).toContain('纠正');
    expect(p.thinkingText).toContain('enabled');
    expect(p.budgetTokens).toBe(1000); // 强制场景恒用公式值（W4）
  });

  it('S2 非工具全 NULL：P5 命中 disabled，budget 不下发', () => {
    const p = buildStrategyPreview({ hasTools: false, thinking: 'null', maxTokens: null });
    expect(p.chain[0].hit).toBe(false); // P1 未命中（无工具）
    expect(p.chain[2].hit).toBe(false); // P3 NULL
    expect(p.chain[4].hit).toBe(true); // P5 形态默认
    expect(p.chain[4].detail).toContain('disabled');
    expect(p.thinkingText).toContain('disabled');
    expect(p.budgetTokens).toBeNull(); // 不下发
    expect(p.budgetFormula).toBeNull();
  });

  it('非工具显式 enabled：P3 命中，budget 按公式', () => {
    const p = buildStrategyPreview({ hasTools: false, thinking: 'enabled', maxTokens: 2000 });
    expect(p.chain[2].hit).toBe(true);
    expect(p.chain[2].detail).toBe('enabled');
    expect(p.budgetTokens).toBe(1000);
    expect(p.thinkingText).toBe('enabled');
  });

  it('非工具显式 disabled：P3 命中 disabled，budget 不下发', () => {
    const p = buildStrategyPreview({ hasTools: false, thinking: 'disabled', maxTokens: null });
    expect(p.chain[2].detail).toBe('disabled');
    expect(p.budgetTokens).toBeNull();
  });

  it('带工具 + 未配置 NULL：P1 仍命中（强制 enabled），P3 显示 NULL', () => {
    const p = buildStrategyPreview({ hasTools: true, thinking: 'null', maxTokens: null });
    expect(p.chain[0].hit).toBe(true);
    expect(p.chain[2].detail).toBe('NULL');
    expect(p.thinkingText).toContain('enabled');
    expect(p.budgetTokens).toBe(4096);
  });
});

describe('审计 diff（S6：改前→改后 + 运行时生效值）', () => {
  const base = {
    temperature: null as number | null,
    maxTokens: null as number | null,
    topP: null as number | null,
    thinking: 'null' as ThinkingFormValue,
    maxSteps: 10,
  };

  it('formatTuningValue：空值显式「未配置」，不显示 0.7 预填', () => {
    expect(formatTuningValue('temperature', null)).toBe('未配置');
    expect(formatTuningValue('maxTokens', null)).toBe('未配置');
    expect(formatTuningValue('thinking', 'null')).toBe('未配置');
    expect(formatTuningValue('thinking', 'enabled')).toBe('enabled');
    expect(formatTuningValue('temperature', 0.7)).toBe('0.7');
    expect(formatTuningValue('maxTokens', 2000)).toBe('2000');
    expect(formatTuningValue('maxSteps', 10)).toBe('10');
  });

  it('只列出真正变化的字段', () => {
    const diffs = buildTuningDiffs(base, { ...base, temperature: 0.3, thinking: 'enabled' });
    expect(diffs.map((d) => d.field).sort()).toEqual(['temperature', 'thinking']);
    const temp = diffs.find((d) => d.field === 'temperature')!;
    expect(temp.before).toBe('未配置');
    expect(temp.after).toBe('0.3');
  });

  it('无变化 → 空 diff', () => {
    expect(buildTuningDiffs(base, { ...base })).toEqual([]);
  });

  it('thinking 改动记 enabled/disabled 文本', () => {
    const diffs = buildTuningDiffs(base, { ...base, thinking: 'disabled' });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ field: 'thinking', before: '未配置', after: 'disabled' });
  });

  it('运行时生效值行：enabled 带 budget + max_tokens', () => {
    const note = buildRuntimeNote({ hasTools: true, maxTokens: 2000, thinking: 'enabled' });
    expect(note).toContain('budget_tokens=1000');
    expect(note).toContain('max_tokens=2000');
  });

  it('运行时生效值行：disabled / NULL(非工具) 不下发 budget', () => {
    const n1 = buildRuntimeNote({ hasTools: false, maxTokens: null, thinking: 'disabled' });
    expect(n1).toContain('不下发');
    const n2 = buildRuntimeNote({ hasTools: false, maxTokens: null, thinking: 'null' });
    expect(n2).toContain('不下发');
    expect(n2).toContain('disabled'); // P5 形态默认
  });
});
