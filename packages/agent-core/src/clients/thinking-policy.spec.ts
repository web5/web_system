/**
 * D1 think 统一 · 共享策略函数单测（T1–T9，规格文档 §8）。
 *
 * 优先级链唯一判定（P1 最高）：
 *   P1 带工具强制 enabled（纠正一切 disabled）> P2 options.thinking 显式（仅非工具）
 *   > P3 agent 配置 > P4 env TOKENHUB_THINKING > P5 形态默认（非工具→disabled）
 *
 * budget 规则：最终 type='enabled' 时携带 budget_tokens = min(模型上限, maxTokens/2)
 *（maxTokens 取有效值；结果 max(1, floor(...))）；P1 强制场景恒用公式值（显式 budget 不放行）。
 */
import {
  resolveThinking,
  resolveMaxTokens,
  lookupModelMaxTokens,
  MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_MODEL_MAX_OUTPUT,
} from './thinking-policy';

const MODEL_MAX = 8192; // 用显式 modelMaxTokens 固定基数，不依赖常量表占位值

describe('resolveThinking · D1 优先级链', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TOKENHUB_THINKING;
    delete process.env.MODEL_MAX_OUTPUT_TOKENS_JSON;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  // T1：agent 配置 disabled（非工具）→ disabled，不含 budget_tokens
  it('T1: agent 配置 disabled（非工具）→ {type:disabled}，不含 budget_tokens', () => {
    const r = resolveThinking({
      hasTools: false,
      maxTokens: 500,
      agentThinking: { type: 'disabled' },
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 500,
    });
    expect(r).toEqual({ thinking: { type: 'disabled' } });
    expect(r!.thinking).not.toHaveProperty('budget_tokens');
  });

  // T2：带工具 + agent 配置 disabled → 纠正为 enabled + 公式 budget
  it('T2: 带工具 + agent disabled → 纠正 enabled，budget=min(上限, maxTokens/2)', () => {
    const r = resolveThinking({
      hasTools: true,
      maxTokens: 4000,
      agentThinking: { type: 'disabled' },
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 8000,
    });
    expect(r).toEqual({
      thinking: { type: 'enabled', budget_tokens: Math.floor(Math.min(MODEL_MAX, 4000 / 2)) },
    });
    expect(r!.thinking.budget_tokens).toBe(2000);
  });

  // T3：带工具 + override disabled → 同 T2（强制压过显式 disabled）
  it('T3: 带工具 + override disabled → 强制 enabled（显式 disabled 被纠正）', () => {
    const r = resolveThinking({
      hasTools: true,
      maxTokens: 4000,
      override: { type: 'disabled' },
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 8000,
    });
    expect(r!.thinking).toEqual({ type: 'enabled', budget_tokens: 2000 });
  });

  it('T3b: 带工具 + override 自带 budget_tokens 不放行（一律公式值）', () => {
    const r = resolveThinking({
      hasTools: true,
      maxTokens: 4000,
      override: { type: 'enabled', budget_tokens: 7 },
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 8000,
    });
    expect(r!.thinking).toEqual({ type: 'enabled', budget_tokens: 2000 });
  });

  // T4：budget 公式 min(模型上限, maxTokens/2)
  it('T4a: maxTokens/2 小于上限 → 取半', () => {
    const r = resolveThinking({
      hasTools: true,
      maxTokens: 1000,
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 8000,
    });
    expect(r!.thinking.budget_tokens).toBe(500);
  });

  it('T4b: maxTokens/2 大于上限 → 取上限', () => {
    const r = resolveThinking({
      hasTools: true,
      maxTokens: 40000,
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 8000,
    });
    expect(r!.thinking.budget_tokens).toBe(MODEL_MAX);
  });

  it('T4c: maxTokens 缺省 + 带工具 → 有效值=模型上限，budget=上限/2', () => {
    const r = resolveThinking({
      hasTools: true,
      maxTokens: undefined,
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 8000,
    });
    expect(r!.thinking).toEqual({ type: 'enabled', budget_tokens: MODEL_MAX / 2 });
  });

  it('T4d: budget 结果 ≥1（floor + max(1,...) 防 0）', () => {
    const r = resolveThinking({
      hasTools: true,
      maxTokens: 1,
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 8000,
    });
    expect(r!.thinking.budget_tokens).toBe(1);
    const r2 = resolveThinking({
      hasTools: true,
      maxTokens: 1,
      override: { type: 'enabled' },
      modelMaxTokens: 3,
      clientDefaultMaxTokens: 8000,
    });
    // min(3, 0.5)=0.5 → floor 0 → max(1,·)=1
    expect(r2!.thinking.budget_tokens).toBe(1);
  });

  // T5：非工具 override 优先（双向）
  it('T5a: override disabled 压过 agent enabled', () => {
    const r = resolveThinking({
      hasTools: false,
      maxTokens: 800,
      agentThinking: { type: 'enabled' },
      override: { type: 'disabled' },
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 8000,
    });
    expect(r!.thinking).toEqual({ type: 'disabled' });
  });

  it('T5b: override enabled 压过 agent disabled', () => {
    const r = resolveThinking({
      hasTools: false,
      maxTokens: 800,
      agentThinking: { type: 'disabled' },
      override: { type: 'enabled' },
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 8000,
    });
    expect(r!.thinking).toEqual({ type: 'enabled', budget_tokens: 400 });
  });

  it('T5c: override 自带 budget_tokens 用显式值', () => {
    const r = resolveThinking({
      hasTools: false,
      maxTokens: 800,
      override: { type: 'enabled', budget_tokens: 123 },
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 8000,
    });
    expect(r!.thinking).toEqual({ type: 'enabled', budget_tokens: 123 });
  });

  // T6：agent enabled（非工具）→ enabled + 公式 budget
  it('T6: agent enabled（非工具）→ enabled + 公式 budget', () => {
    const r = resolveThinking({
      hasTools: false,
      maxTokens: 1000,
      agentThinking: { type: 'enabled' },
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 500,
    });
    expect(r!.thinking).toEqual({ type: 'enabled', budget_tokens: 500 });
  });

  // T7：env 兜底（仅 P1–P3 未决）
  it('T7a: TOKENHUB_THINKING=none → disabled', () => {
    process.env.TOKENHUB_THINKING = 'none';
    const r = resolveThinking({
      hasTools: false,
      maxTokens: 500,
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 500,
    });
    expect(r!.thinking).toEqual({ type: 'disabled' });
  });

  it('T7b: TOKENHUB_THINKING=disabled → disabled', () => {
    process.env.TOKENHUB_THINKING = 'disabled';
    const r = resolveThinking({
      hasTools: false,
      maxTokens: 500,
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 500,
    });
    expect(r!.thinking).toEqual({ type: 'disabled' });
  });

  it('T7c: TOKENHUB_THINKING=budget:<N> → enabled(N)', () => {
    process.env.TOKENHUB_THINKING = 'budget:256';
    const r = resolveThinking({
      hasTools: false,
      maxTokens: 500,
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 500,
    });
    expect(r!.thinking).toEqual({ type: 'enabled', budget_tokens: 256 });
  });

  it('T7d: agent 已配置时 env 不生效（agent 配置压过 env）', () => {
    process.env.TOKENHUB_THINKING = 'none';
    const r = resolveThinking({
      hasTools: false,
      maxTokens: 500,
      agentThinking: { type: 'enabled' },
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 500,
    });
    expect(r!.thinking.type).toBe('enabled');
  });

  it('T7e: env=none 不压制工具强制（P1 高于 P4）', () => {
    process.env.TOKENHUB_THINKING = 'none';
    const r = resolveThinking({
      hasTools: true,
      maxTokens: 4000,
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 8000,
    });
    expect(r!.thinking).toEqual({ type: 'enabled', budget_tokens: 2000 });
  });

  // T8：形态默认（P5）
  it('T8: 非工具、无配置、无 env → disabled', () => {
    const r = resolveThinking({
      hasTools: false,
      maxTokens: 500,
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 500,
    });
    expect(r!.thinking).toEqual({ type: 'disabled' });
    expect(r!.thinking).not.toHaveProperty('budget_tokens');
  });
});

describe('resolveMaxTokens · T9', () => {
  it('T9a: 带工具未配 → 模型上限', () => {
    expect(
      resolveMaxTokens({ hasTools: true, maxTokens: undefined, modelMaxTokens: MODEL_MAX, clientDefault: 8000 }),
    ).toBe(MODEL_MAX);
    expect(
      resolveMaxTokens({ hasTools: true, maxTokens: null, modelMaxTokens: MODEL_MAX, clientDefault: 8000 }),
    ).toBe(MODEL_MAX);
  });

  it('T9b: 带工具已配 → 配置值', () => {
    expect(
      resolveMaxTokens({ hasTools: true, maxTokens: 300, modelMaxTokens: MODEL_MAX, clientDefault: 8000 }),
    ).toBe(300);
  });

  it('T9c: 非工具未配 → 调用方默认值透传不变', () => {
    expect(
      resolveMaxTokens({ hasTools: false, maxTokens: undefined, modelMaxTokens: MODEL_MAX, clientDefault: 2000 }),
    ).toBe(2000);
    expect(
      resolveMaxTokens({ hasTools: false, maxTokens: undefined, modelMaxTokens: MODEL_MAX, clientDefault: 4000 }),
    ).toBe(4000);
    expect(
      resolveMaxTokens({ hasTools: false, maxTokens: undefined, modelMaxTokens: MODEL_MAX, clientDefault: 500 }),
    ).toBe(500);
  });

  it('T9d: 非工具已配 → 配置值', () => {
    expect(
      resolveMaxTokens({ hasTools: false, maxTokens: 42, modelMaxTokens: MODEL_MAX, clientDefault: 2000 }),
    ).toBe(42);
  });
});

describe('lookupModelMaxTokens · 模型上限常量表', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MODEL_MAX_OUTPUT_TOKENS_JSON;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('已知模型查常量表', () => {
    for (const id of ['hy3', 'hy4-preview', 'deepseek-v4-flash', 'glm-5.3', 'kimi-k3', 'qwen3.5-plus', 'minimax-m3']) {
      expect(lookupModelMaxTokens(id)).toBe(MODEL_MAX_OUTPUT_TOKENS[id]);
      expect(lookupModelMaxTokens(id)).toBeGreaterThan(0);
    }
  });

  it('未知模型回落 DEFAULT_MODEL_MAX_OUTPUT（8192）', () => {
    expect(lookupModelMaxTokens('totally-unknown-model')).toBe(DEFAULT_MODEL_MAX_OUTPUT);
    expect(DEFAULT_MODEL_MAX_OUTPUT).toBe(8192);
    expect(lookupModelMaxTokens(undefined)).toBe(DEFAULT_MODEL_MAX_OUTPUT);
  });

  it('env MODEL_MAX_OUTPUT_TOKENS_JSON 覆盖（运维修正不发版）', () => {
    process.env.MODEL_MAX_OUTPUT_TOKENS_JSON = JSON.stringify({ 'deepseek-v4-flash': 16384, hy3: 4096 });
    expect(lookupModelMaxTokens('deepseek-v4-flash')).toBe(16384);
    expect(lookupModelMaxTokens('hy3')).toBe(4096);
    // 未列出的模型仍走常量表
    expect(lookupModelMaxTokens('kimi-k3')).toBe(MODEL_MAX_OUTPUT_TOKENS['kimi-k3']);
  });

  it('deepseek/ 前缀形态也能命中裸名', () => {
    expect(lookupModelMaxTokens('deepseek/deepseek-v4-flash')).toBe(
      MODEL_MAX_OUTPUT_TOKENS['deepseek-v4-flash'],
    );
  });
});
