import {
  normalizeVersion,
  stableJson,
  buildVerifyId,
  buildResultHash,
  gradeVerdict,
  compareCheck,
  skippedCheck,
  unknownCheck,
  resolveStrict,
  normalizeInput,
} from './release-verify-rules';
import { VERIFY_CHECK_KEYS, verifyCheck, VerifyCheckResult } from './release-verify.types';

/** 构造一条检查结论（core 默认 true，便于聚焦 status 分支） */
function chk(key: VerifyCheckResult['key'], status: VerifyCheckResult['status'], core = true) {
  return verifyCheck({ key, status, core, expected: 'e', actual: 'a', detail: `d-${status}` });
}

describe('release-verify-rules', () => {
  describe('normalizeVersion', () => {
    it('纯 commit 原样返回', () => {
      expect(normalizeVersion('abc1234')).toBe('abc1234');
    });

    it('namespace/commit 取末段（与流水线提交同源口径）', () => {
      expect(normalizeVersion('web5/admin/abc1234')).toBe('abc1234');
    });

    it('空值统一为 null（不返回空串，避免"空串 == 空串"的假一致）', () => {
      expect(normalizeVersion('')).toBeNull();
      expect(normalizeVersion(undefined)).toBeNull();
      expect(normalizeVersion(null)).toBeNull();
    });

    it('含非法字符返回 null 而不是原样放行（会进 git 命令）', () => {
      expect(normalizeVersion('abc; rm -rf /')).toBeNull();
      expect(normalizeVersion('a'.repeat(100))).toBeNull();
    });
  });

  describe('stableJson', () => {
    it('对象键序无关（否则键序变化会造成假漂移）', () => {
      const a = { name: 'env', type: 'string', required: true };
      const b = { required: true, type: 'string', name: 'env' };
      expect(stableJson(a)).toBe(stableJson(b));
      // 对照：naive JSON.stringify 会误判 —— 这正是需要 stableJson 的原因
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    });

    it('数组顺序敏感（顺序是语义，不能抹平）', () => {
      expect(stableJson([{ name: 'x' }, { name: 'y' }])).not.toBe(
        stableJson([{ name: 'y' }, { name: 'x' }]),
      );
    });

    it('null 与空数组不相等（二者语义不同，不能互相兜底）', () => {
      expect(stableJson(null)).not.toBe(stableJson([]));
    });
  });

  describe('buildVerifyId', () => {
    const base = { env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' };

    it('同一份入参恒得同值（幂等）', () => {
      expect(buildVerifyId(base)).toBe(buildVerifyId({ ...base }));
    });

    it('键序不同不影响结果', () => {
      expect(buildVerifyId(base)).toBe(
        buildVerifyId({ moduleKey: 'admin', env: 'dev', versionTag: 'abc1234' }),
      );
    });

    it('版本引用写法归一化后同值（namespace/commit ≡ 纯 commit）', () => {
      expect(buildVerifyId({ ...base, versionTag: 'abc1234' })).toBe(
        buildVerifyId({ ...base, versionTag: 'web5/admin/abc1234' }),
      );
    });

    it('关键入参变化 → ID 变化', () => {
      const id = buildVerifyId(base);
      expect(buildVerifyId({ ...base, env: 'prod' })).not.toBe(id);
      expect(buildVerifyId({ ...base, moduleKey: 'portal' })).not.toBe(id);
      expect(buildVerifyId({ ...base, versionTag: 'def5678' })).not.toBe(id);
      expect(buildVerifyId({ ...base, jobId: 'job-1' })).not.toBe(id);
      expect(buildVerifyId({ ...base, strict: true })).not.toBe(id);
    });
  });

  describe('buildResultHash', () => {
    const mk = (status: VerifyCheckResult['status']) => [
      chk(VERIFY_CHECK_KEYS.pointerMatches, status),
    ];

    it('同样的结论 → 同样的指纹', () => {
      expect(
        buildResultHash({ expected: { version: 'v1', source: 'input' }, actual: { version: 'v1', entries: 1, processes: null, ports: null }, checks: mk('pass') }),
      ).toBe(
        buildResultHash({ expected: { version: 'v1', source: 'input' }, actual: { version: 'v1', entries: 1, processes: null, ports: null }, checks: mk('pass') }),
      );
    });

    it('结论状态变了 → 指纹变（供调用方判断线上是否动过）', () => {
      const common = {
        expected: { version: 'v1', source: 'input' as const },
        actual: { version: 'v1', entries: 1, processes: null, ports: null },
      };
      expect(buildResultHash({ ...common, checks: mk('pass') })).not.toBe(
        buildResultHash({ ...common, checks: mk('fail') }),
      );
    });

    it('实测值变了 → 指纹变', () => {
      const common = { expected: { version: 'v1', source: 'input' as const }, checks: mk('pass') };
      expect(
        buildResultHash({ ...common, actual: { version: 'v1', entries: 1, processes: null, ports: null } }),
      ).not.toBe(
        buildResultHash({ ...common, actual: { version: 'v2', entries: 1, processes: null, ports: null } }),
      );
    });

    it('期望来源变了 → 指纹变（防止拿"现状"冒充"目标"）', () => {
      const common = {
        actual: { version: 'v1', entries: 1, processes: null, ports: null },
        checks: mk('pass'),
      };
      expect(
        buildResultHash({ ...common, expected: { version: 'v1', source: 'input' as const } }),
      ).not.toBe(
        buildResultHash({ ...common, expected: { version: 'v1', source: 'current-pointer' as const } }),
      );
    });
  });

  describe('gradeVerdict', () => {
    it('核心项 fail → failed（已能下负面结论）', () => {
      const r = gradeVerdict({
        checks: [chk(VERIFY_CHECK_KEYS.pointerMatches, 'fail'), chk(VERIFY_CHECK_KEYS.processAlive, 'pass', false)],
        strict: false,
      });
      expect(r.verdict).toBe('failed');
      expect(r.blockers).toEqual(['线上版本指针等于目标版本']);
    });

    it('核心项 unknown → unknown（判不了不给结论）', () => {
      const r = gradeVerdict({
        checks: [chk(VERIFY_CHECK_KEYS.pointerMatches, 'unknown')],
        strict: false,
      });
      expect(r.verdict).toBe('unknown');
      expect(r.blockers).toEqual([]);
    });

    it('⚠️ 核心 unknown 优先于非核心 fail —— 不能因端口正常就把"指针判不了"包装成通过', () => {
      const r = gradeVerdict({
        checks: [
          chk(VERIFY_CHECK_KEYS.pointerMatches, 'unknown'),
          chk(VERIFY_CHECK_KEYS.portListening, 'fail', false),
        ],
        strict: true,
      });
      expect(r.verdict).toBe('unknown');
    });

    it('核心 pass + 非核心 fail → degraded（默认非严格）', () => {
      const r = gradeVerdict({
        checks: [
          chk(VERIFY_CHECK_KEYS.pointerMatches, 'pass'),
          chk(VERIFY_CHECK_KEYS.processAlive, 'fail', false),
        ],
        strict: false,
      });
      expect(r.verdict).toBe('degraded');
    });

    it('核心 pass + 非核心 fail + strict → failed', () => {
      const r = gradeVerdict({
        checks: [
          chk(VERIFY_CHECK_KEYS.pointerMatches, 'pass'),
          chk(VERIFY_CHECK_KEYS.processAlive, 'fail', false),
        ],
        strict: true,
      });
      expect(r.verdict).toBe('failed');
    });

    it('核心 pass + 非核心 unknown → degraded（非严格）', () => {
      const r = gradeVerdict({
        checks: [
          chk(VERIFY_CHECK_KEYS.pointerMatches, 'pass'),
          chk(VERIFY_CHECK_KEYS.portListening, 'unknown', false),
        ],
        strict: false,
      });
      expect(r.verdict).toBe('degraded');
    });

    it('核心全 pass → verified', () => {
      const r = gradeVerdict({
        checks: [
          chk(VERIFY_CHECK_KEYS.pipelineSucceeded, 'pass'),
          chk(VERIFY_CHECK_KEYS.pointerMatches, 'pass'),
          chk(VERIFY_CHECK_KEYS.processAlive, 'skipped', false),
        ],
        strict: false,
      });
      expect(r.verdict).toBe('verified');
    });

    it('⚠️ 核心项全部 skipped → unknown，绝不当成 verified（什么都没验 ≠ 验证通过）', () => {
      const r = gradeVerdict({
        checks: [
          chk(VERIFY_CHECK_KEYS.pointerMatches, 'skipped'),
          chk(VERIFY_CHECK_KEYS.versionDirPresent, 'skipped'),
        ],
        strict: false,
      });
      expect(r.verdict).toBe('unknown');
    });
  });

  describe('compareCheck', () => {
    it('期望与实测都有且一致 → pass', () => {
      const r = compareCheck({
        key: VERIFY_CHECK_KEYS.pointerMatches,
        core: true,
        expected: 'abc1234',
        actual: 'abc1234',
        passDetail: 'ok',
        failDetail: 'no',
      });
      expect(r.status).toBe('pass');
    });

    it('期望与实测不一致 → fail', () => {
      const r = compareCheck({
        key: VERIFY_CHECK_KEYS.pointerMatches,
        core: true,
        expected: 'abc1234',
        actual: 'def5678',
        passDetail: 'ok',
        failDetail: 'no',
      });
      expect(r.status).toBe('fail');
    });

    it('没采到实测值 → unknown（不读作"没生效"）', () => {
      const r = compareCheck({
        key: VERIFY_CHECK_KEYS.pointerMatches,
        core: true,
        expected: 'abc1234',
        actual: null,
        passDetail: 'ok',
        failDetail: 'no',
      });
      expect(r.status).toBe('unknown');
    });

    it('无期望版本 → unknown（不读作"生效了"）', () => {
      const r = compareCheck({
        key: VERIFY_CHECK_KEYS.pointerMatches,
        core: true,
        expected: null,
        actual: 'abc1234',
        passDetail: 'ok',
        failDetail: 'no',
      });
      expect(r.status).toBe('unknown');
    });
  });

  describe('skippedCheck / unknownCheck', () => {
    it('skipped 不进 blockers（不适用 ≠ 失败）', () => {
      const r = gradeVerdict({
        checks: [
          chk(VERIFY_CHECK_KEYS.pointerMatches, 'pass'),
          skippedCheck(VERIFY_CHECK_KEYS.processAlive, '前端模块无进程'),
        ],
        strict: false,
      });
      expect(r.verdict).toBe('verified');
      expect(r.warnings.some((w) => w.includes('前端模块无进程'))).toBe(true);
    });

    it('未知项也要出现在 warnings（调用方默认"没报警=通过"，跳过必须可见）', () => {
      const r = gradeVerdict({
        checks: [chk(VERIFY_CHECK_KEYS.pointerMatches, 'pass'), unknownCheck(VERIFY_CHECK_KEYS.portListening, false, new Error('boom'))],
        strict: false,
      });
      expect(r.warnings.some((w) => w.includes('boom'))).toBe(true);
    });
  });

  describe('resolveStrict / normalizeInput', () => {
    it('只有显式 true 才算严格（字符串 "true" 不算，避免误伤）', () => {
      expect(resolveStrict(true)).toBe(true);
      expect(resolveStrict('true')).toBe(false);
      expect(resolveStrict(undefined)).toBe(false);
    });

    it('入参归一化：trim + 版本引用折算 + 空 jobId 归 null', () => {
      expect(
        normalizeInput({ env: ' dev ', moduleKey: ' admin ', versionTag: 'web5/x/abc1234', jobId: '  ' }),
      ).toEqual({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234', jobId: null, strict: false });
    });
  });
});

describe('VerifyCheckKeys 稳定性', () => {
  it('key 值不得随意更改（下游按 key 稳定取用）', () => {
    expect(VERIFY_CHECK_KEYS).toEqual({
      pipelineSucceeded: 'pipeline.succeeded',
      pointerMatches: 'pointer.matches',
      versionDirPresent: 'artifact.versionDir',
      processAlive: 'process.alive',
      portListening: 'port.listening',
    });
  });
});

describe('verifyCheck helper', () => {
  it('title 一律由 key 推导，不可能与兜底路径给出两个说法', () => {
    const r = verifyCheck({
      key: VERIFY_CHECK_KEYS.pointerMatches,
      status: 'pass',
      core: true,
      expected: 'a',
      actual: 'a',
      detail: 'x',
    });
    expect(r.title).toBe('线上版本指针等于目标版本');
  });
});

describe('VerifyCheckResult 形状', () => {
  it('证据可选：不传 evidence 时字段缺失而非空对象（避免误判"有证据"）', () => {
    const r: VerifyCheckResult = chk(VERIFY_CHECK_KEYS.pointerMatches, 'pass');
    expect(r.evidence).toBeUndefined();
  });
});
