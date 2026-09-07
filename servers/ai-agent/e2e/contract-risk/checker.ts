/**
 * 合同翻译官 E2E 评测 · 三层判定纯函数（完整实现）。
 *
 * 本文件只负责"对一次 run 的产物做判定"，不负责跑 LLM（那是 run-eval.ts 的事）。
 * 全部为纯函数，方便独立单测。判定语义见 README §1；可选开关默认值以
 * types.ts 与 manifest.ts 的注释为准（决策 A~E）。
 *
 * 使用红线安全写法：无 console / 无裸 any / 无占位标记字面。
 */

import {
  FieldCheck,
  NumberCheck,
  RedlineCheck,
  SampleRunResult,
  EvalSample,
  EvalSampleTruth,
  LEVEL_RANK,
  SCENE_LABELS,
} from './types';
import { analyzeLoan } from '@web-system/shared';

/** IRR 对账允许的绝对误差（百分点），数值工具已 toFixed(2)，给一点余量防模型转述误差 */
const APR_TOLERANCE = 0.1;
/** 总利息对账允许的绝对误差（元） */
const TOTAL_INTEREST_TOLERANCE = 5;

/**
 * L1 字段全：对 parseContractReport 出的报告做必填字段机器检查。
 * 额外承载决策 A（信号最低级别）、决策 C（maxSignalLevel）与决策 E（rightsMin）。
 */
export function checkFieldCompleteness(
  report: Record<string, unknown>,
  truth: EvalSampleTruth,
): FieldCheck[] {
  const checks: FieldCheck[] = [];

  // 1. 必填核心字段（systemPrompt 硬性要求缺一不可）
  const required = ['scene', 'conclusion', 'signals', 'rights', 'disclaimer'] as const;
  for (const key of required) {
    const v = report[key];
    checks.push({ name: key, pass: v !== undefined && v !== null && v !== '' });
  }

  const signals = Array.isArray(report.signals) ? report.signals : [];
  const rights = Array.isArray(report.rights) ? report.rights : [];
  const signalsObj = signals as Array<Record<string, unknown>>;
  const rightsObj = rights as Array<Record<string, unknown>>;

  // 2. signals / rights 非空（即便无明显风险也需至少 1 条 ok 级信号 + 通用权益）
  checks.push({
    name: 'signals-nonempty',
    pass: signals.length > 0,
    detail: signals.length ? undefined : 'signals 为空（即便无明显风险也需至少 1 条 ok 级）',
  });
  const rightsMin = truth.rightsMin ?? 1; // 决策 E：默认至少 1 条通用权益；设 0 关闭
  checks.push({
    name: 'rights-min',
    pass: rights.length >= rightsMin,
    detail: rights.length >= rightsMin ? undefined : `rights 少于 ${rightsMin} 条（通用权益下限）`,
  });

  // 3. scene 合法性 + 与样本期望一致
  const sceneRaw = typeof report.scene === 'string' ? report.scene : '';
  checks.push({ name: 'scene-legal', pass: (SCENE_LABELS as readonly string[]).includes(sceneRaw) });

  // 4. 决策 A：期望信号必须出现，且（如配置）级别 ≥ minLevel
  const gotIds = new Set(
    signalsObj
      .map((s) => (typeof s.id === 'string' ? s.id : ''))
      .filter((id) => id.length > 0),
  );
  for (const id of truth.expectSignalIds) {
    checks.push({
      name: `expect-signal:${id}`,
      pass: gotIds.has(id),
      detail: gotIds.has(id) ? undefined : `期望信号 ${id} 未出现在报告中`,
    });
  }
  const minLevels = truth.expectSignalLevels ?? {};
  for (const [id, minLevel] of Object.entries(minLevels)) {
    const sig = signalsObj.find((s) => s.id === id);
    const lv = typeof sig?.level === 'string' ? (sig.level as keyof typeof LEVEL_RANK) : undefined;
    const pass = !!lv && LEVEL_RANK[lv] >= LEVEL_RANK[minLevel];
    checks.push({
      name: `expect-level:${id}`,
      pass,
      detail: pass
        ? undefined
        : `信号 ${id} 级别不足：期望 ≥ ${minLevel}，实际 ${lv ?? '缺失'}`,
    });
  }

  // 5. 决策 C：maxSignalLevel —— 不允许任何信号超过该级别（干净样本"不乱报"）
  if (truth.maxSignalLevel) {
    const maxRank = LEVEL_RANK[truth.maxSignalLevel];
    const over = signalsObj
      .map((s) => (typeof s.level === 'string' ? (s.level as keyof typeof LEVEL_RANK) : undefined))
      .filter((lv): lv is keyof typeof LEVEL_RANK => !!lv)
      .filter((lv) => LEVEL_RANK[lv] > maxRank);
    checks.push({
      name: 'max-signal-level',
      pass: over.length === 0,
      detail: over.length ? `出现高于 ${truth.maxSignalLevel} 的信号级别：${over.join(',')}` : undefined,
    });
  }

  // 6. 决策 C 延伸：clean 样本（maxSignalLevel='ok'）即使无风险也必须给至少 1 条 ok 级信号
  const hasOk = signalsObj.some((s) => s.level === 'ok');
  if (truth.maxSignalLevel === 'ok') {
    checks.push({
      name: 'clean-has-ok-signal',
      pass: hasOk,
      detail: hasOk ? undefined : '干净合同也需给 1 条 ok 级信号',
    });
  }

  // 7. 决策 B 延伸 / 对应关系：默认关闭（通用权益无对应信号），需要时对该样本设 true
  if (truth.requireRightsMirror) {
    const signalIdSet = new Set(signalsObj.map((s) => String(s.id ?? '')).filter(Boolean));
    const orphanRights = rightsObj
      .map((r) => String(r.id ?? ''))
      .filter((id) => id.length > 0 && !signalIdSet.has(id));
    checks.push({
      name: 'rights-mirror',
      pass: orphanRights.length === 0,
      detail: orphanRights.length ? `rights 无对应信号：${orphanRights.join(',')}` : undefined,
    });
  }

  return checks;
}

/**
 * L2 数值准：贷款类样本用 analyzeLoan 现算期望值，与报告 keyNumbers/loanPlan 对账。
 * 期望值不手拍、不入 manifest——判定时用 @web-system/shared 现算，杜绝标注偏差。
 */
export function checkNumbers(
  report: Record<string, unknown>,
  truth: EvalSampleTruth,
): NumberCheck[] {
  const checks: NumberCheck[] = [];
  if (!truth.loan) return checks; // 非贷款样本不做 IRR 对账

  // analyzeLoan 现算期望（参数校验失败说明 manifest 标注错误，直接视为 FAIL）
  let expected;
  try {
    expected = analyzeLoan(truth.loan);
  } catch (error) {
    checks.push({
      name: 'loan-params',
      expected: NaN,
      tolerance: 0,
      pass: false,
      detail: `truth.loan 参数非法：${(error as Error).message}`,
    });
    return checks;
  }

  const lp = (report.loanPlan ?? {}) as Record<string, unknown>;
  const kn = (Array.isArray(report.keyNumbers) ? report.keyNumbers : []) as Array<
    Record<string, unknown>
  >;
  // 容错取值：模型常把数值写成字符串（"41.3%"、"14,000 元"、"1.5 万"），需剥单位后解析
  const numOf = (labelKeywords: string[], planKey: string): number | undefined => {
    const parsedPlan = parseMoney(lp[planKey]);
    if (parsedPlan !== undefined) return parsedPlan;
    for (const item of kn) {
      const label = typeof item.label === 'string' ? item.label : '';
      if (labelKeywords.some((k) => label.includes(k))) {
        const parsed = parseMoney(item.value);
        if (parsed !== undefined) return parsed;
      }
    }
    return undefined;
  };

  const apr = numOf(['真实年化', '年化利率', '年化'], 'effectiveApr');
  checks.push({
    name: 'apr',
    expected: +expected.apr.toFixed(2),
    actual: apr === undefined ? undefined : +apr.toFixed(2),
    tolerance: APR_TOLERANCE,
    pass: apr !== undefined && Math.abs(apr - expected.apr) <= APR_TOLERANCE,
    detail: apr === undefined ? '报告未给出真实年化（effectiveApr/年化 keyNumber）' : undefined,
  });

  // 总利息口径说明：analyzeLoan.totalInterest = 名义总利息（总还款 − 名义本金）。
  // agent 可能用「实际成本」（总还款 − 到手本金，含砍头息）——两个口径都算正确，都接受。
  const nominalInterest = expected.totalInterest; // 总还款 − 名义本金
  const allInInterest = expected.totalPayment - expected.effectivePrincipal; // 总还款 − 到手本金
  const accepted = [nominalInterest, allInInterest];
  const totalInterest = numOf(['总利息', '总费用', '利息'], 'totalInterest');
  const interestOk =
    totalInterest !== undefined &&
    accepted.some(
      (v) => Math.abs(totalInterest - v) <= Math.max(TOTAL_INTEREST_TOLERANCE, v * 0.005),
    );
  checks.push({
    name: 'total-interest',
    expected: nominalInterest,
    actual: totalInterest === undefined ? undefined : +totalInterest.toFixed(2),
    tolerance: TOTAL_INTEREST_TOLERANCE,
    pass: interestOk,
    detail:
      totalInterest === undefined
        ? '报告未给出总利息（loanPlan.totalInterest 或 keyNumbers）'
        : interestOk
          ? undefined
          : `总利息 ${totalInterest} 与期望 ${accepted.join('/')} 均不符（可能口径错误或编数）`,
  });

  return checks;
}

/**
 * 把模型输出的"数字字符串"解析为 number：剥千分位、逗号、元/人民币、% / 万 等单位。
 * - "41.3%" → 41.3（利率百分比数字本身，不带 % 换算）
 * - "14,000 元" → 14000
 * - "1.5 万" → 15000
 */
function parseMoney(v: unknown): number | undefined {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[,\s，]/g, '').trim();
  if (!s) return undefined;
  // 命中 % 的按百分比数字解析（41.3% → 41.3）
  if (s.endsWith('%')) {
    const n = Number(s.slice(0, -1));
    return isFinite(n) ? n : undefined;
  }
  // 命中 万 的按 *10000
  if (/万$/.test(s)) {
    const n = Number(s.slice(0, -1));
    return isFinite(n) ? n * 10000 : undefined;
  }
  const n = Number(s.replace(/元|块|人民币|¥|￥/g, ''));
  return isFinite(n) ? n : undefined;
}

/**
 * L3 红线净：全字段扫禁词（合规红线，不允许出现推荐语/越界表述），
 * 另校验 disclaimer 存在且不是一句空话。
 */
export function checkRedlines(
  report: Record<string, unknown>,
  truth: EvalSampleTruth,
): RedlineCheck[] {
  const checks: RedlineCheck[] = [];
  const hit = REDLINE_SCAN(report, truth.redlineForbidden);
  checks.push({
    name: 'redline-forbidden-words',
    pass: hit.length === 0,
    detail: hit.length ? `命中禁词：${hit.join('、')}` : undefined,
  });
  const disclaimer = typeof report.disclaimer === 'string' ? report.disclaimer : '';
  checks.push({
    name: 'disclaimer-present',
    // 用 systemPrompt 固定串里的特征短语判断（串以"不代写法律文书、不出具法律意见"宣示非法律意见）
    pass: disclaimer.length > 20 && disclaimer.includes('不代写法律文书'),
    detail: disclaimer.length > 20 ? undefined : 'disclaimer 缺失或过短',
  });
  return checks;
}

/** 全字段字符串扫描（深递归数组/对象），返回命中 truth 禁词的词列表 */
function REDLINE_SCAN(report: Record<string, unknown>, forbidden: string[]): string[] {
  const haystacks: string[] = [];
  const collect = (v: unknown): void => {
    if (typeof v === 'string') haystacks.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(collect);
    }
  };
  Object.values(report).forEach(collect);
  const text = haystacks.join('\n');
  return forbidden.filter((w) => (w ? text.includes(w) : false));
}

/**
 * 工具链判定（决策 D）：
 * - requireToolUse 默认 true：合同分析必须至少调过一次工具
 * - expectToolCalls：必须真实调用过这些工具（防 AI 编数，而非真算）
 * - expectToolOrder：子序列顺序匹配（如 OCR：cleaner → rule）
 */
export function checkToolChain(sample: EvalSample, calls: string[]): FieldCheck[] {
  const checks: FieldCheck[] = [];
  const requireUse = sample.requireToolUse !== false; // 默认 true；设 false 关闭
  if (requireUse) {
    checks.push({
      name: 'tool-used',
      pass: calls.length > 0,
      detail: calls.length ? undefined : '全程未发生任何工具调用',
    });
  }
  for (const tool of sample.expectToolCalls ?? []) {
    checks.push({
      name: `tool-call:${tool}`,
      pass: calls.includes(tool),
      detail: calls.includes(tool) ? undefined : `未真实调用 ${tool}（疑似编造数据）`,
    });
  }
  const order = sample.expectToolOrder ?? [];
  if (order.length > 0) {
    checks.push({
      name: 'tool-order',
      pass: isSubsequence(order, calls),
      detail: isSubsequence(order, calls)
        ? undefined
        : `工具顺序不符：期望 ${order.join(' → ')}，实际 ${calls.join(' → ') || '无'}`,
    });
  }
  return checks;
}

/** 子序列匹配：a 的所有元素在 b 中按相对顺序出现 */
function isSubsequence(a: string[], b: string[]): boolean {
  let bi = 0;
  for (const item of a) {
    const idx = b.indexOf(item, bi);
    if (idx === -1) return false;
    bi = idx + 1;
  }
  return true;
}

/**
 * 汇总一次 run 的四组判定（字段全 / 数值准 / 红线净 / 工具链）。
 * report 传 parseContractReport 出的对象；sample 提供 truth 与工具断言。
 */
export function evaluateRun(
  sample: EvalSample,
  report: Record<string, unknown> | null,
  toolTrace: { calls: string[]; finalContent: string },
): SampleRunResult {
  // 不可解析时 G1~G4 全判不通过（避免空数组 every→true 造成 100% 假象）
  const notParsed: FieldCheck = { name: 'parse-report', pass: false, detail: 'final 非报告结构' };
  const fail = (error: string): SampleRunResult => ({
    sampleId: sample.id,
    ok: false,
    scene: '其他',
    report: null,
    toolTrace,
    fieldChecks: [notParsed],
    numberChecks: [{ name: 'n-a', expected: 0, tolerance: 0, pass: false, detail: '报告不可解析' }],
    redlineChecks: [{ name: 'parse-report', pass: false, detail: '报告不可解析' }],
    toolChecks: [notParsed],
    passed: false,
    error,
  });

  if (!report) {
    return fail('final 输出无法解析为合同风险报告（parseContractReport 返回 null）');
  }

  const fieldChecks = checkFieldCompleteness(report, sample.truth);
  const numberChecks = checkNumbers(report, sample.truth);
  const redlineChecks = checkRedlines(report, sample.truth);
  const toolChecks = checkToolChain(sample, toolTrace.calls);
  const passed =
    fieldChecks.every((c) => c.pass) &&
    numberChecks.every((c) => c.pass) &&
    redlineChecks.every((c) => c.pass) &&
    toolChecks.every((c) => c.pass);

  const sceneRaw = typeof report.scene === 'string' ? report.scene : '';
  const scene = (SCENE_LABELS as readonly string[]).includes(sceneRaw)
    ? (sceneRaw as SampleRunResult['scene'])
    : '其他';

  return {
    sampleId: sample.id,
    ok: true,
    scene,
    report,
    toolTrace,
    fieldChecks,
    numberChecks,
    redlineChecks,
    toolChecks,
    passed,
  };
}
