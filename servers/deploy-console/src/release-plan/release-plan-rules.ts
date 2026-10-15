import * as crypto from 'crypto';
import {
  ReleasePlanInput,
  ReleasePlanMode,
  InvariantResult,
  ReleaseImpact,
  RiskAssessment,
  RiskLevel,
} from './release-plan.types';

/**
 * `release_plan` 的**纯规则层**（无 IO、无注入，全部可单测）。
 *
 * 与 service 的分工：service 负责把事实查出来，这里负责把事实变成结论。
 * 判定口径集中在此，避免"同一份事实在不同入口得出不同风险等级"。
 */

/** 事实新鲜度上限：超过这个时长的事实快照不再作为健康判据（默认 24h） */
export const DEFAULT_FACT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** planId 前缀（肉眼可辨这是 release plan 的 ID，而非流水线 jobId） */
const PLAN_ID_PREFIX = 'rp-';

/** planId 取指纹的前若干位（够短好贴，碰撞概率可接受：48bit） */
const PLAN_ID_LEN = 12;

/**
 * 入参规范化（用于指纹）。
 *
 * 为什么要规范化：同一个意图可以有很多种写法（`mode` 缺省 vs 显式 `direct`、
 * 键序不同、`versionTag` 带不带空格），若直接 hash 原文会得到不同的 planId，
 * 幂等就失效了。
 */
export function canonicalizeInput(input: ReleasePlanInput): Record<string, string> {
  return {
    env: (input.env ?? '').trim(),
    moduleKey: (input.moduleKey ?? '').trim(),
    versionTag: (input.versionTag ?? '').trim(),
    mode: normalizeMode(input.mode),
    grayscaleRule: (input.grayscaleRule ?? '').trim(),
  };
}

export function normalizeMode(mode?: string): ReleasePlanMode {
  return mode === 'grayscale' ? 'grayscale' : 'direct';
}

function stableStringify(obj: Record<string, unknown>): string {
  return Object.keys(obj)
    .sort()
    .map((k) => `${k}=${JSON.stringify(obj[k])}`)
    .join('&');
}

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf-8').digest('hex');
}

/**
 * 输入指纹 → planId。
 *
 * 幂等语义：**同一份入参 → 同一个 planId**（不随时间、实例、调用次数变化）。
 * 它标识"这个提案"，不标识"当时的事实"（后者是 evidenceHash 的职责）。
 */
export function buildPlanId(input: ReleasePlanInput): string {
  const fp = sha256Hex(stableStringify(canonicalizeInput(input)));
  return `${PLAN_ID_PREFIX}${fp.slice(0, PLAN_ID_LEN)}`;
}

/**
 * 结论指纹 → evidenceHash。
 *
 * 输入的影响面 + 全部不变量结论（含每条的 status 与 evidence）。
 * 事实一变它就变 —— 下游 release_submit 据此判断"提案是否已过期"。
 */
export function buildEvidenceHash(args: {
  impact: ReleaseImpact;
  invariants: InvariantResult[];
  requiresApproval: boolean;
}): string {
  const payload = {
    impact: stableStringify({ ...args.impact }),
    invariants: args.invariants
      .map((i) => `${i.key}:${i.status}:${i.detail}`)
      .sort()
      .join('|'),
    requiresApproval: args.requiresApproval,
  };
  return sha256Hex(stableStringify(payload)).slice(0, 16);
}

/**
 * 风险评级。
 *
 * 两条规则的优先级（顺序很重要）：
 *  1. **有 blocking 失败 → 直接 critical**，不再看分数。
 *     理由：风险等级是用来回答"要不要拦住"，有一条硬伤就应该是最高级，
 *     累加制可能因为其它项干净而被稀释（这是累加制最典型的失效方式）。
 *  2. 其余按累加分 + 环境档。
 *
 * 每个加分项都推进 `reasons`，让人/LLM 能看懂"分是怎么来的"，而不是只给个数字。
 */
export function gradeRisk(args: {
  env: string;
  mode: ReleasePlanMode;
  invariants: InvariantResult[];
  requiresApproval: boolean;
  /** 环境是否在需审批清单内（用于"受控环境"判定，避免外部重复传 prod 白名单） */
  isApprovalEnv: boolean;
}): RiskAssessment {
  const { invariants } = args;
  const reasons: string[] = [];
  let score = 0;

  const blockingFails = invariants.filter((i) => i.blocking && i.status === 'fail');
  const softFails = invariants.filter((i) => !i.blocking && i.status === 'fail');
  const unknowns = invariants.filter((i) => i.status === 'unknown');

  if (blockingFails.length) {
    reasons.push(`存在 ${blockingFails.length} 项硬性前置未通过：${blockingFails.map((i) => i.title).join('、')}`);
  }
  score += blockingFails.length * 40;

  if (softFails.length) {
    reasons.push(`存在 ${softFails.length} 项软性告警：${softFails.map((i) => i.title).join('、')}`);
  }
  score += softFails.length * 15;

  if (unknowns.length) {
    reasons.push(
      `${unknowns.length} 项无法判定（缺真相源）：${unknowns.map((i) => i.title).join('、')}`,
    );
  }
  score += unknowns.length * 5;

  if (args.isApprovalEnv) {
    score += 15;
    reasons.push(`目标环境 ${args.env} 属于受控环境（默认需审批），发布影响面为线上`);
  }
  if (args.isApprovalEnv && args.mode === 'direct') {
    score += 10;
    reasons.push('全量直发（未走灰度），受控环境无小流量缓冲');
  }

  const level: RiskLevel = pickLevel(blockingFails.length, score, args.isApprovalEnv);
  if (!reasons.length) reasons.push('全部前置检查通过，无已知风险项');

  return { level, score, reasons };
}

/**
 * 分数 → 等级（单独抽出便于单测边界）。
 *
 * 「受控环境地板 = medium」：即使一分未加，发到 prod 也不该报 low ——
 * low 会让人不加思索地执行。
 */
export function pickLevel(blockingFails: number, score: number, isApprovalEnv: boolean): RiskLevel {
  if (blockingFails > 0) return 'critical';
  if (score >= 50) return 'critical';
  if (score >= 20) return 'high';
  if (isApprovalEnv) return 'medium';
  if (score > 0) return 'medium';
  return 'low';
}

/**
 * 一句话结论。
 *
 * 给 LLM 的 summary：先说能不能发，再说为什么。不要写成"检查了 N 项"
 * 这种没有信息量的句子 —— Agent 拿到后无法据此决策。
 */
export function buildSummary(args: {
  env: string;
  moduleKey: string;
  targetVersion: string | null;
  risk: RiskAssessment;
  blockers: string[];
  unknowns: string[];
  requiresApproval: boolean;
}): string {
  const target = args.targetVersion ? `→ ${args.targetVersion}` : '→ 现场构建（未指定版本）';
  const head = args.blockers.length
    ? `不建议提交：${args.blockers.join('、')}`
    : args.unknowns.length
      ? `可提交但有 ${args.unknowns.length} 项未能验证：${args.unknowns.join('、')}`
      : '前置检查通过，可以提交';

  const parts = [
    head,
    `${args.moduleKey}@${args.env} ${target}`,
    `风险 ${args.risk.level.toUpperCase()}（${args.risk.score} 分）`,
    args.requiresApproval ? '需人工审批' : '无需审批',
  ];
  return `${parts.join('；')}。`;
}
