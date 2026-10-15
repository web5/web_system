import {
  buildPlanId,
  buildEvidenceHash,
  buildSummary,
  canonicalizeInput,
  gradeRisk,
  normalizeMode,
  pickLevel,
  DEFAULT_FACT_MAX_AGE_MS,
} from './release-plan-rules';
import {
  invariant,
  INVARIANT_KEYS,
  INVARIANT_TITLES,
  RELEASE_PLAN_KNOWN_GAPS,
  InvariantKey,
  InvariantResult,
  ReleaseImpact,
} from './release-plan.types';

/** 造一条不变量结论（测试夹具） */
function mk(key: InvariantKey, status: InvariantResult['status'], blocking = false): InvariantResult {
  return invariant({ key, status, blocking, detail: `${key}=${status}` });
}

const ALL_PASS: InvariantResult[] = Object.values(INVARIANT_KEYS).map((k) => mk(k, 'pass'));

const IMPACT: ReleaseImpact = {
  currentVersion: 'aaa111',
  targetVersion: 'bbb222',
  versionChange: 'upgrade',
  moduleType: 'micro-frontend',
  mode: 'direct',
  staticRoot: '/data/ws/servers/gateway/public',
  staticTarget: 'local',
};

describe('canonicalizeInput / normalizeMode', () => {
  it('mode 缺省与显式 direct 等价（否则同一意图会算出两个 planId）', () => {
    expect(canonicalizeInput({ env: 'dev', moduleKey: 'admin' }).mode).toBe('direct');
    expect(normalizeMode('grayscale')).toBe('grayscale');
    expect(normalizeMode(undefined)).toBe('direct');
    expect(normalizeMode('weird' as any)).toBe('direct');
  });

  it('首尾空白被裁掉', () => {
    expect(canonicalizeInput({ env: ' dev ', moduleKey: ' admin ', versionTag: ' abc ' })).toEqual({
      env: 'dev',
      moduleKey: 'admin',
      versionTag: 'abc',
      mode: 'direct',
      grayscaleRule: '',
    });
  });
});

describe('buildPlanId（幂等）', () => {
  it('同一份入参重复调用得到同一个 planId', () => {
    const input = { env: 'prod', moduleKey: 'admin', versionTag: 'abc123' };
    expect(buildPlanId(input)).toBe(buildPlanId(input));
  });

  it('键序不同不影响结果', () => {
    const a = { env: 'prod', moduleKey: 'admin', versionTag: 'abc123' };
    const b = { versionTag: 'abc123', moduleKey: 'admin', env: 'prod' };
    expect(buildPlanId(a)).toBe(buildPlanId(b));
  });

  it('mode 缺省与显式 direct 得到同一个 planId', () => {
    expect(buildPlanId({ env: 'dev', moduleKey: 'm' })).toBe(
      buildPlanId({ env: 'dev', moduleKey: 'm', mode: 'direct' }),
    );
  });

  it('换成灰度就换 planId（灰度与全量是两件事）', () => {
    expect(buildPlanId({ env: 'dev', moduleKey: 'm', mode: 'grayscale' })).not.toBe(
      buildPlanId({ env: 'dev', moduleKey: 'm' }),
    );
  });

  it('planId 带 rp- 前缀，肉眼可与流水线 jobId 区分', () => {
    expect(buildPlanId({ env: 'dev', moduleKey: 'm' }).startsWith('rp-')).toBe(true);
  });
});

describe('buildEvidenceHash（事实指纹）', () => {
  it('同一份结论得到同一个 hash', () => {
    const args = { impact: IMPACT, invariants: ALL_PASS, requiresApproval: false };
    expect(buildEvidenceHash(args)).toBe(buildEvidenceHash(args));
  });

  it('某条不变量从 pass 变 drift 时 hash 改变 —— 提案过期可被检出', () => {
    const changed = ALL_PASS.map((i) =>
      i.key === INVARIANT_KEYS.envHealthy ? mk(i.key, 'fail') : i,
    );
    expect(buildEvidenceHash({ impact: IMPACT, invariants: changed, requiresApproval: false })).not.toBe(
      buildEvidenceHash({ impact: IMPACT, invariants: ALL_PASS, requiresApproval: false }),
    );
  });

  it('planId 不变而事实变了（同入参重算），hash 必须跟着变', () => {
    const input = { env: 'dev', moduleKey: 'm' };
    const before = buildPlanId(input);
    const afterRunning = ALL_PASS.map((i) =>
      i.key === INVARIANT_KEYS.noRunningPipeline ? mk(i.key, 'fail') : i,
    );
    expect(buildEvidenceHash({ impact: IMPACT, invariants: afterRunning, requiresApproval: false }))
      .not.toBe(buildEvidenceHash({ impact: IMPACT, invariants: ALL_PASS, requiresApproval: false }));
    expect(buildPlanId(input)).toBe(before);
  });
});

describe('pickLevel（风险等级）', () => {
  it('有硬性失败 → critical，即便分数很低', () => {
    expect(pickLevel(1, 1, false)).toBe('critical');
  });

  it('≥50 分 → critical', () => {
    expect(pickLevel(0, 50, false)).toBe('critical');
  });

  it('≥20 分 → high', () => {
    expect(pickLevel(0, 20, false)).toBe('high');
  });

  it('受控环境零分也不能是 low（low 会让人不假思索执行）', () => {
    expect(pickLevel(0, 0, true)).toBe('medium');
  });

  it('非受控环境零分 → low', () => {
    expect(pickLevel(0, 0, false)).toBe('low');
  });

  it('非受控环境有软性告警（15 分）→ medium', () => {
    expect(pickLevel(0, 15, false)).toBe('medium');
  });

  it('边界：19 分非受控仍是 medium，20 分升 high', () => {
    expect(pickLevel(0, 19, false)).toBe('medium');
    expect(pickLevel(0, 20, false)).toBe('high');
  });
});

describe('gradeRisk（理由可追溯）', () => {
  const baseArgs = {
    env: 'dev',
    mode: 'direct' as const,
    requiresApproval: false,
    isApprovalEnv: false,
  };

  it('全绿且非受控 → low，理由有一条兜底文案', () => {
    const r = gradeRisk({ ...baseArgs, invariants: ALL_PASS });
    expect(r.level).toBe('low');
    expect(r.score).toBe(0);
    expect(r.reasons).toHaveLength(1);
  });

  it('硬性失败的理由里要点名具体是哪一项', () => {
    const invariants = ALL_PASS.map((i) =>
      i.key === INVARIANT_KEYS.releaseLock ? mk(i.key, 'fail', true) : i,
    );
    const r = gradeRisk({ ...baseArgs, invariants });
    expect(r.level).toBe('critical');
    expect(r.reasons.join()).toContain(INVARIANT_TITLES[INVARIANT_KEYS.releaseLock]);
  });

  it('unknown 单独计权，且出现在理由里（判定不了 ≠ 没问题）', () => {
    const invariants = ALL_PASS.map((i) =>
      i.key === INVARIANT_KEYS.targetArtifact ? mk(i.key, 'unknown') : i,
    );
    const r = gradeRisk({ ...baseArgs, invariants });
    expect(r.score).toBeGreaterThan(0);
    expect(r.reasons.join()).toContain('无法判定');
    expect(r.reasons.join()).toContain(INVARIANT_TITLES[INVARIANT_KEYS.targetArtifact]);
  });

  it('受控环境 + 全量直发比受控环境灰度风险更高', () => {
    const asDirect = gradeRisk({ ...baseArgs, env: 'prod', isApprovalEnv: true, invariants: ALL_PASS });
    const asGray = gradeRisk({
      ...baseArgs,
      env: 'prod',
      mode: 'grayscale',
      isApprovalEnv: true,
      invariants: ALL_PASS,
    });
    expect(asDirect.score).toBeGreaterThan(asGray.score);
    expect(asDirect.reasons.join()).toContain('灰度');
  });
});

describe('buildSummary（结论先行）', () => {
  const risk = { level: 'low' as const, score: 0, reasons: [] };

  it('有阻塞项时明确不建议提交', () => {
    expect(
      buildSummary({
        env: 'dev',
        moduleKey: 'admin',
        targetVersion: 'abc',
        risk,
        blockers: ['目标版本产物存在'],
        unknowns: [],
        requiresApproval: false,
      }),
    ).toContain('不建议提交');
  });

  it('有未知项时说清是"未能验证"而不是"通过"', () => {
    const s = buildSummary({
      env: 'dev',
      moduleKey: 'admin',
      targetVersion: 'abc',
      risk,
      blockers: [],
      unknowns: ['目标版本产物存在'],
      requiresApproval: false,
    });
    expect(s).toContain('未能验证');
    expect(s).not.toContain('前置检查通过');
  });

  it('未指定版本时写明是现场构建', () => {
    expect(
      buildSummary({
        env: 'dev',
        moduleKey: 'admin',
        targetVersion: null,
        risk,
        blockers: [],
        unknowns: [],
        requiresApproval: false,
      }),
    ).toContain('现场构建');
  });
});

describe('新鲜度常量', () => {
  it('默认事实新鲜度窗口为 24h（与 release_plan 文档口径一致）', () => {
    expect(DEFAULT_FACT_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('INVARIANT_TITLES 与 INVARIANT_KEYS 不漂移', () => {
  it('每个 key 都有标题（新增时不变量不会是空标题）', () => {
    for (const k of Object.values(INVARIANT_KEYS)) {
      expect(INVARIANT_TITLES[k]).toBeTruthy();
    }
  });

  it('标题表不残留已删除的 key', () => {
    expect(Object.keys(INVARIANT_TITLES)).toHaveLength(Object.keys(INVARIANT_KEYS).length);
  });
});

describe('RELEASE_PLAN_KNOWN_GAPS（没有假绿灯）', () => {
  it('缺口清单非空：设计里的 7 项不变量目前有没覆盖的，必须说出口', () => {
    expect(RELEASE_PLAN_KNOWN_GAPS.length).toBeGreaterThan(0);
  });

  it('每条缺口都要写清为什么做不了，以及有没有兜底手段', () => {
    for (const g of RELEASE_PLAN_KNOWN_GAPS) {
      expect(g.key).toBeTruthy();
      expect(g.title).toBeTruthy();
      expect(g.reason.length).toBeGreaterThan(10);
      // coveredBy 允许为 null，但不允许用空串含糊过去
      expect(g.coveredBy === null || g.coveredBy.length > 0).toBe(true);
    }
  });
});
