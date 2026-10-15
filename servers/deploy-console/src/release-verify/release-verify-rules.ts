import { createHash } from 'crypto';
import {
  verifyCheck,
  VerifyCheckResult,
  VerifyCheckKey,
  VerifyCheckStatus,
  ReleaseVerifyInput,
  ReleaseVerifyReport,
  ReleaseVerifyVerdict,
  ExpectationSource,
} from './release-verify.types';

/**
 * `verify_release` 的纯规则层（指纹 / 结论定级 / 摘要）。
 *
 * 全部为纯函数、无 IO —— 便于单测穷举分支，也保证"同输入同输出"。
 */

/** 版本号的合法形态（与流水线同源的 commit 短哈希） */
export function normalizeVersion(raw?: string | null): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  // `namespace/commit` → 取末段
  const short = s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s;
  return /^[A-Za-z0-9._-]{4,64}$/.test(short) ? short : null;
}

/** 稳定序列化：键序无关的 JSON。用于指纹，避免键序变化造成"假漂移" */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
    .join(',')}}`;
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

/**
 * `verifyId` —— **入参指纹**（幂等）。
 *
 * 只包含入参，**不含任何检查结果**：同一份"想验证什么"永远得到同一个 ID。
 * 它不代表此刻的事实 —— 事实看 {@link buildResultHash}。
 */
export function buildVerifyId(input: ReleaseVerifyInput): string {
  const payload = {
    env: String(input?.env ?? '').trim(),
    moduleKey: String(input?.moduleKey ?? '').trim(),
    versionTag: normalizeVersion(input?.versionTag),
    jobId: String(input?.jobId ?? '').trim() || null,
    strict: input?.strict === true,
  };
  return `vr_${sha256(stableJson(payload))}`;
}

/**
 * `resultHash` —— **结论指纹**。
 *
 * 含各项 key/status/expected/actual 与期望态来源。事实一变它就变，
 * 调用方可据此判断"两次验证之间线上是否动过"。
 */
export function buildResultHash(input: {
  expected: ReleaseVerifyReport['expected'];
  actual: ReleaseVerifyReport['actual'];
  checks: VerifyCheckResult[];
}): string {
  const payload = {
    expected: input.expected,
    actual: input.actual,
    checks: input.checks.map((c) => ({
      key: c.key,
      status: c.status,
      expected: c.expected,
      actual: c.actual,
    })),
  };
  return sha256(stableJson(payload));
}

/**
 * 总体结论定级。
 *
 * 判定顺序**有意如此**，每一步都在回答一个不同性质的问题：
 *
 *  1. 核心项 fail  → `failed`   「确实没生效」—— 已经能下负面结论，直接返回
 *  2. 核心项 unknown → `unknown`「给不出结论」—— 不能因为"没找到它失败的证据"
 *                                                就顺手说它成功了
 *  3. 非核心项 fail → strict ? failed : degraded「生效了但有瑕疵」
 *
 * ⚠️ 第 2 步必须排在第 3 步之前：核心判不了，比"某个次要检查没过"严重得多，
 *    两者不能互相覆盖。反过来（先判非核心）会让一份"指针根本没采到"的验证
 *    因为端口正常而被报成 `degraded`，把"我不知道"包装成"大概没问题"。
 */
export function gradeVerdict(input: {
  checks: VerifyCheckResult[];
  strict: boolean;
}): { verdict: ReleaseVerifyVerdict; blockers: string[]; warnings: string[] } {
  const { checks, strict } = input;

  // ⚠️ 先判「有没有任何一项核心检查真正给出了结论」。
  // 全 skipped（该模块在此环境无任何登记期望态）时下面每一步都会落空，
  // 最终掉到 verified —— 那就把"什么都没验"报成了"验证通过"，
  // 正是 #342 反复踩的 failure 模式（把"判不了"静默报成"没问题"）。
  const coreDecided = checks.some(
    (c) => c.core && (c.status === 'pass' || c.status === 'fail'),
  );
  if (!coreDecided) {
    return { verdict: 'unknown', blockers: [], warnings: collectWarnings(checks) };
  }

  const coreFails = checks.filter((c) => c.core && c.status === 'fail');
  if (coreFails.length) {
    return {
      verdict: 'failed',
      blockers: coreFails.map((c) => c.title),
      warnings: collectWarnings(checks),
    };
  }

  const coreUnknowns = checks.filter((c) => c.core && c.status === 'unknown');
  if (coreUnknowns.length) {
    return {
      verdict: 'unknown',
      // 核心项判不了时 blockers 保持为空：它不是"确认失败"，
      // 是"确认不了"，两者不能混用同一个字段。
      blockers: [],
      warnings: collectWarnings(checks),
    };
  }

  const softFails = checks.filter((c) => !c.core && c.status === 'fail');
  const softUnknowns = checks.filter((c) => !c.core && c.status === 'unknown');
  if (softFails.length || softUnknowns.length) {
    return {
      verdict: strict ? (softFails.length ? 'failed' : 'unknown') : 'degraded',
      blockers: strict ? softFails.map((c) => c.title) : [],
      warnings: collectWarnings(checks),
    };
  }

  return { verdict: 'verified', blockers: [], warnings: collectWarnings(checks) };
}

/**
 * 汇总"不挡路但要知道"的结论。
 *
 * `skipped` 也要报：调用方（尤其 LLM Agent）默认"返回里没报警 = 检查通过"，
 * 静默跳过等于制造假绿灯。这里把跳过的**原因**一并给出，让人能判断跳得对不对。
 */
function collectWarnings(checks: VerifyCheckResult[]): string[] {
  const out: string[] = [];
  for (const c of checks) {
    if (c.status === 'unknown' || c.status === 'skipped') {
      out.push(`${c.title}：${c.detail}`);
    } else if (!c.core && c.status === 'fail') {
      out.push(`${c.title}：${c.detail}`);
    }
  }
  return out;
}

/**
 * 一句话结论：先回答"生效没生效"，再补原因。
 *
 * 刻意不写成"检查了 N 项，M 项通过" —— 那是过程，不是结论。
 * 调用方要的是能不能放心。
 */
export function buildSummary(input: {
  env: string;
  moduleKey: string;
  version: string | null;
  verdict: ReleaseVerifyVerdict;
  blockers: string[];
  unknowns: string[];
  skipped: string[];
}): string {
  const target = input.version ? `${input.moduleKey}@${input.env} → ${input.version}` : `${input.moduleKey}@${input.env}`;
  const head: Record<ReleaseVerifyVerdict, string> = {
    verified: `发布已生效：${target}`,
    failed: `发布未生效：${target}`,
    unknown: `无法判定是否生效：${target}`,
    degraded: `发布已生效但有瑕疵：${target}`,
  };
  const parts = [head[input.verdict]];
  if (input.blockers.length) parts.push(`阻塞项=${input.blockers.join('、')}`);
  if (input.unknowns.length) parts.push(`判不了=${input.unknowns.join('、')}`);
  if (input.skipped.length) parts.push(`不适用=${input.skipped.join('、')}`);
  return parts.join('；');
}

/** 严格模式默认关闭：非核心项失败只降级，不误判为整次发布失败 */
export function resolveStrict(v: unknown): boolean {
  return v === true;
}

/** 入参归一化（供 service 与指纹共用，避免出现第二套清洗逻辑） */
export function normalizeInput(input: ReleaseVerifyInput): {
  env: string;
  moduleKey: string;
  versionTag: string | null;
  jobId: string | null;
  strict: boolean;
} {
  return {
    env: String(input?.env ?? '').trim(),
    moduleKey: String(input?.moduleKey ?? '').trim(),
    versionTag: normalizeVersion(input?.versionTag),
    jobId: String(input?.jobId ?? '').trim() || null,
    strict: resolveStrict(input?.strict),
  };
}

/**
 * 构造"检查未能完成"的兜底结论。
 *
 * 状态一律 **`unknown`（非 fail）**："这项查不到"和"这项不通过"是两件事，
 * 前者不该假装成了后者 —— 那是 #342 修掉的同一个 failure 模式。
 */
export function unknownCheck(key: VerifyCheckKey, core: boolean, err: unknown): VerifyCheckResult {
  const msg = (err as Error)?.message ?? String(err);
  return verifyCheck({
    key,
    status: 'unknown',
    core,
    expected: null,
    actual: null,
    detail: `该项检查未能完成：${msg}`,
    evidence: { reason: 'check-threw', message: msg },
  });
}

/** 构造"不适用"结论（如前端模块没有 pm2 进程） */
export function skippedCheck(key: VerifyCheckKey, detail: string): VerifyCheckResult {
  return verifyCheck({ key, status: 'skipped', core: false, expected: null, actual: null, detail });
}

/** 单项比对结论（expected/actual 任一缺失即 unknown，不猜） */
export function compareCheck(spec: {
  key: VerifyCheckKey;
  core: boolean;
  expected: string | null;
  actual: string | null;
  passDetail: string;
  failDetail: string;
  evidence?: Record<string, unknown>;
}): VerifyCheckResult {
  if (spec.actual === null) {
    return verifyCheck({
      key: spec.key,
      status: 'unknown',
      core: spec.core,
      expected: spec.expected,
      actual: null,
      detail:
        spec.expected === null
          ? '无期望态且未采到实际值，无从判定'
          : `未采到实际状态，无法与期望（${spec.expected}）比对`,
      evidence: { ...spec.evidence, reason: 'not-collected' },
    });
  }
  if (spec.expected === null) {
    return verifyCheck({
      key: spec.key,
      status: 'unknown',
      core: spec.core,
      expected: null,
      actual: spec.actual,
      detail: `未指定期望版本（实际采到 ${spec.actual}），无法判定是否生效`,
      evidence: { ...spec.evidence, reason: 'no-expectation' },
    });
  }
  const same = spec.expected === spec.actual;
  return verifyCheck({
    key: spec.key,
    status: same ? 'pass' : 'fail',
    core: spec.core,
    expected: spec.expected,
    actual: spec.actual,
    detail: same ? spec.passDetail : spec.failDetail,
    evidence: spec.evidence,
  });
}

export type { ReleaseVerifyInput, ExpectationSource };
export { VerifyCheckStatus };
