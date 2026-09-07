/**
 * 合同翻译官 E2E · checker 判定单测（零 token）。
 *
 * 覆盖决策 A~E 的开关逻辑：
 *  - A expectSignalLevels（最低级别）
 *  - B 由 manifest truth.loan 决定（此处不重复）
 *  - C maxSignalLevel + clean-has-ok-signal
 *  - D expectToolCalls / expectToolOrder / requireToolUse
 *  - E rightsMin
 * 使用红线安全写法：无 console / 无裸 any / 无占位标记字面。
 */

import { evaluateRun, checkToolChain } from './checker';
import { EvalSample } from './types';

/** 构造一份合法样本基座（各用例覆盖 truth 字段） */
function baseSample(truthPatch: Partial<EvalSample['truth']>, extra?: Partial<EvalSample>): EvalSample {
  return {
    id: 'unit',
    scene: '消费贷款',
    domain: 'loan',
    contractText: '测试合同',
    truth: {
      expectSignalIds: [],
      redlineForbidden: [],
      ...truthPatch,
    },
    ...extra,
  };
}

/** 一份结构齐全、数值正确的"标准答案"报告 */
function goodReport(): Record<string, unknown> {
  return {
    scene: '消费贷款',
    conclusion: '该合同有 1 处高风险，签字前务必处理。',
    signals: [
      {
        id: 'usury-interest',
        name: '利率上限',
        level: 'danger',
        signalTitle: '实际年化利率 41.30%，远超 24% 红线',
        plainText: '真实借款成本可能远超法定保护线。',
        legalBasis: { law: 'X', article: '25', quote: 'quote' },
        actions: ['action1'],
      },
    ],
    rights: [
      {
        id: 'usury-interest',
        title: '要求调整超出 24% 部分',
        description: 'desc',
        amount: 5000,
        legalBasis: { law: 'X', article: '25', quote: 'quote' },
        actions: ['action1'],
      },
    ],
    loanPlan: { repaymentType: '等额本息', effectiveApr: 41.3, totalInterest: 14000 },
    keyNumbers: [
      { label: '真实年化利率', value: 41.3 },
      { label: '总利息', value: 14000 },
    ],
    optimize: [],
    disclaimer:
      '本工具基于法定标准与维权路径提供知识与建议，不代写法律文书、不出具法律意见；具体可主张金额的最终成立与金额，以裁判机关/监管部门认定或双方协商为准。',
  };
}

describe('evaluateRun · 结构层 L1', () => {
  it('标准答案 → 全 PASS', () => {
    const sample = baseSample({ expectSignalIds: ['usury-interest'] });
    const r = evaluateRun(sample, goodReport(), { calls: ['contract-rule', 'contract-irr'], finalContent: 'x' });
    expect(r.passed).toBe(true);
  });

  it('report 为 null（追问文本/解析失败）→ FAIL', () => {
    const r = evaluateRun(baseSample({}), null, { calls: [], finalContent: '普通追问回答' });
    expect(r.passed).toBe(false);
    expect(r.error).toContain('无法解析');
  });

  it('缺少必填字段 conclusion → FAIL', () => {
    const rep = goodReport();
    delete rep.conclusion;
    const r = evaluateRun(baseSample({}), rep, { calls: ['contract-rule'], finalContent: 'x' });
    expect(r.fieldChecks.find((c) => c.name === 'conclusion')?.pass).toBe(false);
    expect(r.passed).toBe(false);
  });

  it('决策 E：rights 少于 rightsMin → FAIL', () => {
    const rep = goodReport();
    (rep as { rights: unknown[] }).rights = [];
    const r = evaluateRun(
      baseSample({ expectSignalIds: ['usury-interest'], rightsMin: 1 }),
      rep,
      { calls: ['contract-rule'], finalContent: 'x' },
    );
    expect(r.fieldChecks.find((c) => c.name === 'rights-min')?.pass).toBe(false);
  });
});

describe('evaluateRun · 决策 A expectSignalLevels', () => {
  it('usury-interest 实际 danger ≥ 期望 danger → 通过', () => {
    const sample = baseSample({
      expectSignalIds: ['usury-interest'],
      expectSignalLevels: { 'usury-interest': 'danger' },
    });
    const r = evaluateRun(sample, goodReport(), { calls: ['contract-rule'], finalContent: 'x' });
    expect(r.fieldChecks.find((c) => c.name === 'expect-level:usury-interest')?.pass).toBe(true);
  });

  it('期望 danger 但实际 warn → 该检查 FAIL', () => {
    const rep = goodReport();
    (rep.signals as Array<Record<string, unknown>>)[0].level = 'warn';
    const sample = baseSample({
      expectSignalIds: ['usury-interest'],
      expectSignalLevels: { 'usury-interest': 'danger' },
    });
    const r = evaluateRun(sample, rep, { calls: ['contract-rule'], finalContent: 'x' });
    const check = r.fieldChecks.find((c) => c.name === 'expect-level:usury-interest');
    expect(check?.pass).toBe(false);
    expect(check?.detail).toContain('级别不足');
  });
});

describe('evaluateRun · 决策 C maxSignalLevel', () => {
  it('干净样本出现 warn 信号 → FAIL', () => {
    const rep = goodReport();
    (rep.signals as Array<Record<string, unknown>>)[0] = {
      id: 'usury-interest',
      name: '利率上限',
      level: 'warn',
      signalTitle: 'title',
      plainText: 'text',
    };
    const sample = baseSample({ maxSignalLevel: 'ok' });
    const r = evaluateRun(sample, rep, { calls: ['contract-rule'], finalContent: 'x' });
    expect(r.fieldChecks.find((c) => c.name === 'max-signal-level')?.pass).toBe(false);
  });

  it('干净样本只给 ok 信号且无 warn → 通过', () => {
    const rep = goodReport();
    (rep.signals as Array<Record<string, unknown>>)[0] = {
      id: 'ok-1',
      name: '合规检查',
      level: 'ok',
      signalTitle: 'title',
      plainText: 'text',
    };
    (rep as { rights: unknown[] }).rights = [{ id: 'ok-1', title: '通用权益', actions: [] }];
    const sample = baseSample({
      expectSignalIds: [],
      maxSignalLevel: 'ok',
      rightsMin: 1,
    });
    const r = evaluateRun(sample, rep, { calls: ['contract-rule'], finalContent: 'x' });
    expect(r.passed).toBe(true);
  });
});

describe('evaluateRun · L2 数值对账', () => {
  it('贷款样本 APR/总利息与 analyzeLoan 现算一致 → 通过', () => {
    const sample = baseSample({
      loan: { principal: 100000, upfrontFee: 5000, periods: 12, monthlyPayment: 9500 },
    });
    const r = evaluateRun(sample, goodReport(), { calls: ['contract-irr'], finalContent: 'x' });
    expect(r.numberChecks.find((c) => c.name === 'apr')?.pass).toBe(true);
    expect(r.numberChecks.find((c) => c.name === 'total-interest')?.pass).toBe(true);
  });

  it('APR 明显编错（写 20 而不是 41.3）→ FAIL', () => {
    const rep = goodReport();
    (rep.loanPlan as Record<string, unknown>).effectiveApr = 20;
    const sample = baseSample({
      loan: { principal: 100000, upfrontFee: 5000, periods: 12, monthlyPayment: 9500 },
    });
    const r = evaluateRun(sample, rep, { calls: ['contract-irr'], finalContent: 'x' });
    expect(r.numberChecks.find((c) => c.name === 'apr')?.pass).toBe(false);
  });

  it('数值以字符串呈现（"41.3%" / "14,000 元"）也能解析对账 → 通过', () => {
    const rep = goodReport();
    (rep.loanPlan as Record<string, unknown>).effectiveApr = '41.3%';
    (rep.loanPlan as Record<string, unknown>).totalInterest = '14,000 元';
    const sample = baseSample({
      loan: { principal: 100000, upfrontFee: 5000, periods: 12, monthlyPayment: 9500 },
    });
    const r = evaluateRun(sample, rep, { calls: ['contract-irr'], finalContent: 'x' });
    expect(r.numberChecks.find((c) => c.name === 'apr')?.pass).toBe(true);
    expect(r.numberChecks.find((c) => c.name === 'total-interest')?.pass).toBe(true);
  });

  it('总利息用「实际成本口径」（还款114,000−到手95,000=19,000）也通过', () => {
    const rep = goodReport();
    (rep.loanPlan as Record<string, unknown>).totalInterest = 19000;
    const sample = baseSample({
      loan: { principal: 100000, upfrontFee: 5000, periods: 12, monthlyPayment: 9500 },
    });
    const r = evaluateRun(sample, rep, { calls: ['contract-irr'], finalContent: 'x' });
    expect(r.numberChecks.find((c) => c.name === 'total-interest')?.pass).toBe(true);
  });

  it('非贷款样本不要求数值对账', () => {
    const sample = baseSample({}, { domain: 'insurance' as const, scene: '医疗保险' as const });
    const rep = goodReport();
    rep.scene = '医疗保险';
    const r = evaluateRun(sample, rep, { calls: ['contract-rule'], finalContent: 'x' });
    expect(r.numberChecks).toHaveLength(0);
  });
});

describe('evaluateRun · L3 红线', () => {
  it('conclusion 含禁词「推荐购买」→ FAIL', () => {
    const rep = goodReport();
    rep.conclusion = '这款产品很划算，推荐购买。';
    const sample = baseSample({ redlineForbidden: ['推荐购买', '该不该买'] });
    const r = evaluateRun(sample, rep, { calls: ['contract-rule'], finalContent: 'x' });
    expect(r.redlineChecks.find((c) => c.name === 'redline-forbidden-words')?.pass).toBe(false);
  });

  it('disclaimer 缺失 → FAIL', () => {
    const rep = goodReport();
    delete rep.disclaimer;
    const r = evaluateRun(baseSample({}), rep, { calls: ['contract-rule'], finalContent: 'x' });
    expect(r.redlineChecks.find((c) => c.name === 'disclaimer-present')?.pass).toBe(false);
  });
});

describe('checkToolChain · 决策 D', () => {
  const calls = ['contract-cleaner', 'contract-rule', 'contract-irr'];

  it('0 次工具调用 → 默认 requireToolUse FAIL', () => {
    const sample = baseSample({}, { requireToolUse: undefined });
    const checks = checkToolChain(sample, []);
    expect(checks.find((c) => c.name === 'tool-used')?.pass).toBe(false);
  });

  it('expectToolCalls 缺失 → FAIL', () => {
    const sample = baseSample({}, { expectToolCalls: ['contract-irr'] });
    const checks = checkToolChain(sample, ['contract-rule']);
    expect(checks.find((c) => c.name === 'tool-call:contract-irr')?.pass).toBe(false);
  });

  it('expectToolOrder 子序列匹配（cleaner 在 rule 前）→ 通过', () => {
    const sample = baseSample({}, { expectToolOrder: ['contract-cleaner', 'contract-rule'] });
    const checks = checkToolChain(sample, calls);
    expect(checks.find((c) => c.name === 'tool-order')?.pass).toBe(true);
  });

  it('顺序颠倒 → FAIL', () => {
    const sample = baseSample({}, { expectToolOrder: ['contract-rule', 'contract-cleaner'] });
    const checks = checkToolChain(sample, calls);
    expect(checks.find((c) => c.name === 'tool-order')?.pass).toBe(false);
  });
});
