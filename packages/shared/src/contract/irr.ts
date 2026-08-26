/**
 * 合同翻译官 — IRR / 贷款分析精确计算模块
 *
 * 设计原则：能用规则算的绝不用 AI 算。金融成本测算必须 100% 准确。
 * 纯函数、无副作用、无 any。
 *
 * 现金流约定：positive = 收入（借款到手），negative = 支出（每期还款）。
 * IRR 为使得 净现值 NPV = 0 的折现率。
 */
import type { LoanAnalysis, LoanParams } from './types';

/** 净现值：NPV(rate) = Σ cashflow[i] / (1+rate)^i */
export function npv(rate: number, cashflows: number[]): number {
  let value = 0;
  for (let i = 0; i < cashflows.length; i++) {
    value += cashflows[i] / Math.pow(1 + rate, i);
  }
  return value;
}

/**
 * 计算内部收益率 IRR（使 NPV=0 的折现率）。
 * @param cashflows 现金流序列（至少一个正 + 一个负）
 * @param guess 初始猜测
 * @param maxIter 最大迭代次数
 * @param tol 精度
 * @returns 期利率（如 0.01 表示 1%）
 */
export function calculateIRR(
  cashflows: number[],
  guess = 0.1,
  maxIter = 200,
  tol = 1e-8,
): number {
  if (!cashflows || cashflows.length < 2) {
    throw new Error('IRR 需要至少 2 期现金流');
  }

  let hasPositive = false;
  let hasNegative = false;
  for (const cf of cashflows) {
    if (cf > 0) hasPositive = true;
    if (cf < 0) hasNegative = true;
  }
  if (!hasPositive || !hasNegative) {
    throw new Error('IRR 现金流必须同时包含收入和支出（正负号）');
  }

  // 牛顿迭代
  let rate = guess;
  for (let iter = 0; iter < maxIter; iter++) {
    let npvValue = 0;
    let derivative = 0;
    for (let i = 0; i < cashflows.length; i++) {
      const cf = cashflows[i];
      const factor = Math.pow(1 + rate, i);
      npvValue += cf / factor;
      if (i > 0) {
        derivative -= (i * cf) / Math.pow(1 + rate, i + 1);
      }
    }

    if (Math.abs(npvValue) < tol) {
      return rate;
    }

    if (derivative === 0) {
      break;
    }

    const nextRate = rate - npvValue / derivative;
    // 防发散：限制在 (-0.999, 10] 区间
    if (nextRate <= -0.999 || nextRate > 10 || !isFinite(nextRate)) {
      break;
    }
    rate = nextRate;
  }

  // 牛顿不收敛时退化为二分法（更稳）
  return solveByBisection(cashflows, tol);
}

/** 二分法求解 IRR，保证在 (-0.999, 10] 区间内有解时返回 */
function solveByBisection(cashflows: number[], tol: number): number {
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo, cashflows);

  // 若两端同号且 NVP 单调，则扩大范围或直接返回端点近似
  let fHi = npv(hi, cashflows);
  if (fLo * fHi > 0) {
    // 找不到变号区间，返回绝对值更小的那一端近似
    return Math.abs(fLo) <= Math.abs(fHi) ? lo : hi;
  }

  for (let iter = 0; iter < 400; iter++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, cashflows);
    if (Math.abs(fMid) < tol || (hi - lo) / 2 < tol) {
      return mid;
    }
    if (fLo * fMid <= 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * 贷款分期分析：
 * - monthlyRate：由月供反推的月费率（含全部费用后的等效）
 * - apr：有效年化（复利年化）
 * - totalPayment / totalInterest：总还款与总利息
 * - effectivePrincipal：实际到手本金（扣除前置费用）
 */
export function analyzeLoan(params: LoanParams): LoanAnalysis {
  const { principal, upfrontFee, periods, monthlyPayment } = params;

  if (!isPositiveNumber(principal)) throw new Error('本金必须大于 0');
  if (!isPositiveNumber(periods)) throw new Error('期数必须大于 0');
  if (!isPositiveNumber(monthlyPayment)) throw new Error('每期还款额必须大于 0');
  if (upfrontFee < 0) throw new Error('前置费用不能为负');

  // 实际到手本金（砍头息/前置费用扣除）
  const effectivePrincipal = principal - upfrontFee;
  if (effectivePrincipal <= 0) {
    throw new Error('前置费用不能超过本金');
  }

  const totalPayment = monthlyPayment * periods;
  const totalInterest = totalPayment - principal;

  // 构建现金流：期初到手 effectivePrincipal，之后每期 -monthlyPayment
  const cashflows: number[] = [effectivePrincipal];
  for (let i = 0; i < periods; i++) {
    cashflows.push(-monthlyPayment);
  }

  const monthlyRate = calculateIRR(cashflows);
  // 有效年化（复利）：(1+月利率)^12 - 1，转成百分比数值
  const apr = (Math.pow(1 + monthlyRate, 12) - 1) * 100;

  return {
    monthlyRate,
    apr,
    totalPayment,
    totalInterest,
    effectivePrincipal,
  };
}

/** 判断是否为正的有限数 */
function isPositiveNumber(value: number): boolean {
  return typeof value === 'number' && isFinite(value) && value > 0;
}
