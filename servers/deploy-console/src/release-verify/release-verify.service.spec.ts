import { Test, TestingModule } from '@nestjs/testing';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { ReleaseRegistryService } from '../registry/release-registry.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { FactCollectService, FactBatchReport } from '../fact/fact-collect.service';
import { FactStatus } from '../entities/deploy-fact-snapshot.entity';
import { ReleaseVerifyService } from './release-verify.service';
import { VERIFY_CHECK_KEYS, VerifyCheckKey, ReleaseVerifyReport } from './release-verify.types';

/**
 * 各依赖的**写方法**清单 —— `verify_release`（L1 只读）这条红线的可执行形式。
 *
 * verify 调用其中任何一个，它就不再是"只是看一眼"。新增依赖时必须同步登记，
 * 否则红线会静默失效。
 *
 * ⚠️ `facts.collect` **不在**这里：verify 需要**此刻**的事实，必须调它；
 * 但它是带着 `{ persist: false }` 调的（采集只读、落库才写），
 * 这条由 {@link assertCollectedWithoutPersist} 单独盯住。
 */
const WRITE_METHODS: Record<string, string[]> = {
  modules: [],
  registry: [
    'registerVersion',
    'setPointer',
    'syncAppEnvPointer',
    'setAppEnvPointer',
    'clearAppEnvPointer',
  ],
  pipelines: [
    'submit',
    'cancel',
    'remove',
    'retry',
    'approve',
    'reject',
    'promote',
    'switchPointer',
  ],
  facts: [],
};

interface Opts {
  moduleMissing?: boolean;
  moduleType?: string;
  isShell?: boolean;
  pipelineStatus?: string;
  /** Fact 采集项；不传 = 默认「指针匹配 + 目录非空」 */
  factItems?: Array<{
    kind: string;
    targetKey: string;
    status: FactStatus;
    expected?: string | null;
    actual?: string | null;
    detail?: Record<string, unknown>;
  }>;
  currentVersion?: string | undefined;
  collectThrows?: boolean;
}

const NOW = Date.now();

function buildHarness(opts: Opts = {}) {
  const mocks = {
    modules: {
      get: jest.fn(async () => {
        if (opts.moduleMissing) throw new Error(`模块不存在: admin`);
        return { key: 'admin', type: opts.moduleType ?? 'micro-frontend', isShell: opts.isShell };
      }),
      list: jest.fn(async () => []),
    },
    registry: {
      currentAppVersion: jest.fn(async () => 'currentVersion' in opts ? opts.currentVersion : 'aaa111'),
      currentVersion: jest.fn(async () =>
        'currentVersion' in opts ? opts.currentVersion : 'aaa111',
      ),
      registerVersion: jest.fn(async () => undefined),
      setPointer: jest.fn(async () => undefined),
      syncAppEnvPointer: jest.fn(async () => undefined),
      setAppEnvPointer: jest.fn(async () => ({})),
      clearAppEnvPointer: jest.fn(async () => undefined),
    },
    pipelines: {
      get: jest.fn(async () => ({ status: opts.pipelineStatus ?? 'succeeded' })),
      list: jest.fn(async () => []),
      submit: jest.fn(async () => ({ jobId: 'j', status: 'pending' })),
      cancel: jest.fn(async () => ({})),
      remove: jest.fn(async () => undefined),
      retry: jest.fn(async () => ({})),
      approve: jest.fn(async () => ({})),
      reject: jest.fn(async () => ({})),
      promote: jest.fn(async () => ({})),
      switchPointer: jest.fn(async () => ({})),
    },
    facts: {
      collect: jest.fn(
        async (): Promise<FactBatchReport> => {
          if (opts.collectThrows) throw new Error('采集失败：SSH 连接被拒');
          return {
            batchId: 'b1',
            env: 'dev',
            host: 'local',
            ranAt: NOW,
            status: 'ok',
            checked: opts.factItems?.length ?? 2,
            drift: 0,
            missing: 0,
            error: 0,
            items: (opts.factItems ?? defaultFactItems()) as FactBatchReport['items'],
          };
        },
      ),
      allowedEnvs: jest.fn(() => ['dev']),
      latestBatch: jest.fn(async () => null),
      drift: jest.fn(async () => ({ batchId: 'b1', items: [] as never[] })),
      snapshots: jest.fn(async () => [] as never[]),
    },
  };
  return { mocks };
}

function defaultFactItems() {
  return [
    { kind: 'version', targetKey: 'admin', status: 'ok', expected: 'aaa111', actual: 'aaa111' },
    { kind: 'dir', targetKey: 'admin', status: 'ok', expected: '非空', actual: '12 个条目' },
  ];
}

async function buildService(mocks: ReturnType<typeof buildHarness>['mocks']) {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      ReleaseVerifyService,
      { provide: ModuleRegistryService, useValue: mocks.modules },
      { provide: ReleaseRegistryService, useValue: mocks.registry },
      { provide: PipelineService, useValue: mocks.pipelines },
      { provide: FactCollectService, useValue: mocks.facts },
    ],
  }).compile();
  return moduleRef.get(ReleaseVerifyService);
}

function find(r: ReleaseVerifyReport, key: VerifyCheckKey) {
  const hit = r.checks.find((c) => c.key === key);
  expect(hit).toBeDefined();
  return hit!;
}

/** 断言：全程没有调用任何写方法 */
function assertReadOnly(mocks: Record<string, Record<string, jest.Mock>>) {
  for (const [dep, methods] of Object.entries(WRITE_METHODS)) {
    for (const m of methods) {
      const fn = mocks[dep]?.[m];
      expect(fn).toBeDefined();
      if (fn.mock.calls.length > 0) {
        throw new Error(`只读红线被突破：verify 调用了写方法 ${dep}.${m}()`);
      }
    }
  }
}

/**
 * 断言：事实是**现采**的，且**没有落库**。
 *
 * 这两件事必须同时成立：只读最新快照会验到几小时前的事实（等于没验），
 * 而落库则会让"看一眼发成功没"改写巡检时间线。
 */
function assertCollectedWithoutPersist(mocks: { facts: Record<string, jest.Mock> }, env: string) {
  expect(mocks.facts.collect).toHaveBeenCalledTimes(1);
  expect(mocks.facts.collect).toHaveBeenCalledWith(env, 'manual', { persist: false });
}

describe('ReleaseVerifyService', () => {
  it.each([
    ['aaa111', 'skipped', 'verified'],
    ['bbb222', 'skipped', 'failed'],
    ['aaa111', 'missing', 'failed'],
    ['aaa111', 'error', 'unknown'],
  ])('uses the Shell application pointer and actual HTML probe (%s/%s)', async (versionTag, factStatus, verdict) => {
    const { mocks } = buildHarness({
      moduleType: 'frontend', isShell: true, currentVersion: 'aaa111',
      factItems: [{ kind: 'version', targetKey: 'admin', status: factStatus as FactStatus,
        expected: 'aaa111', actual: null, detail: { pointerApplicable: factStatus !== 'skipped' } }],
    });
    const service = await buildService(mocks);
    const report = await service.verify({ env: 'dev', moduleKey: 'admin', versionTag });
    expect(report.verdict).toBe(verdict);
    expect(report.actual.version).toBe('aaa111');
    expect(find(report, VERIFY_CHECK_KEYS.versionDirPresent).status).toBe(factStatus === 'error' ? 'unknown' : factStatus === 'missing' ? 'fail' : 'pass');
    assertReadOnly(mocks);
    assertCollectedWithoutPersist(mocks, 'dev');
  });

  it('does not certify a Shell HTML entry from a JS pointer or a nonempty directory', async () => {
    const { mocks } = buildHarness({ isShell: true, moduleType: 'frontend' });
    const report = await (await buildService(mocks)).verify({ env: 'dev', moduleKey: 'admin', versionTag: 'aaa111' });
    expect(report.verdict).toBe('unknown');
    expect(find(report, VERIFY_CHECK_KEYS.versionDirPresent).status).toBe('unknown');
  });

  it('reports an inconclusive Shell pointer when it changes during collection', async () => {
    const { mocks } = buildHarness({ isShell: true, moduleType: 'frontend', currentVersion: 'bbb222' });
    const report = await (await buildService(mocks)).verify({ env: 'dev', moduleKey: 'admin', versionTag: 'bbb222' });
    expect(find(report, VERIFY_CHECK_KEYS.pointerMatches).status).toBe('unknown');
    expect(report.verdict).toBe('unknown');
  });
  it('全部一致 → verified（前端模块：进程/端口不适用）', async () => {
    const { mocks } = buildHarness({ moduleType: 'micro-frontend' });
    const svc = await buildService(mocks);

    const r = await svc.verify({ env: 'dev', moduleKey: 'admin', versionTag: 'aaa111', jobId: 'job-1' });

    expect(r.verdict).toBe('verified');
    expect(r.dryRun).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(find(r, VERIFY_CHECK_KEYS.pointerMatches).status).toBe('pass');
    expect(find(r, VERIFY_CHECK_KEYS.pipelineSucceeded).status).toBe('pass');
    // 前端模块无常驻进程/端口 → 不适用，且必须在 warnings 里可见
    expect(find(r, VERIFY_CHECK_KEYS.processAlive).status).toBe('skipped');
    expect(find(r, VERIFY_CHECK_KEYS.portListening).status).toBe('skipped');
    expect(r.warnings.some((w) => w.includes('无常驻进程'))).toBe(true);

    assertReadOnly(mocks);
    assertCollectedWithoutPersist(mocks, 'dev');
  });

  it('⚠️ 线上指针 ≠ 目标版本 → failed，且进 blockers（这就是"脚本跑完但没生效"）', async () => {
    const { mocks } = buildHarness({
      factItems: [
        { kind: 'version', targetKey: 'admin', status: 'drift', expected: 'aaa111', actual: 'old999' },
        { kind: 'dir', targetKey: 'admin', status: 'ok', expected: '非空', actual: '12 个条目' },
      ],
    });
    const svc = await buildService(mocks);

    const r = await svc.verify({ env: 'dev', moduleKey: 'admin', versionTag: 'aaa111' });

    expect(r.verdict).toBe('failed');
    expect(r.blockers).toEqual(['线上版本指针等于目标版本']);
    expect(find(r, VERIFY_CHECK_KEYS.pointerMatches).status).toBe('fail');
    expect(r.actual.version).toBe('old999');

    assertReadOnly(mocks);
  });

  it('流水线未成功 → failed（核心前置项）', async () => {
    const { mocks } = buildHarness({ pipelineStatus: 'failed' });
    const svc = await buildService(mocks);

    const r = await svc.verify({ env: 'dev', moduleKey: 'admin', versionTag: 'aaa111', jobId: 'job-1' });

    expect(r.verdict).toBe('failed');
    expect(find(r, VERIFY_CHECK_KEYS.pipelineSucceeded).status).toBe('fail');
    expect(r.blockers).toEqual(['流水线执行成功']);

    assertReadOnly(mocks);
  });

  it('未提供 jobId → 流水线项 skipped，只做事实比对', async () => {
    const { mocks } = buildHarness();
    const svc = await buildService(mocks);

    const r = await svc.verify({ env: 'dev', moduleKey: 'admin', versionTag: 'aaa111' });

    expect(find(r, VERIFY_CHECK_KEYS.pipelineSucceeded).status).toBe('skipped');
    expect(mocks.pipelines.get).not.toHaveBeenCalled();
    expect(r.verdict).toBe('verified');

    assertReadOnly(mocks);
  });

  it('⚠️ 采集故障 → 核心项 unknown → verdict unknown，而不是 failed', async () => {
    const { mocks } = buildHarness({
      factItems: [
        {
          kind: 'version',
          targetKey: 'admin',
          status: 'error',
          expected: 'aaa111',
          actual: null,
          detail: { reason: 'SSH 连接超时' },
        },
      ],
    });
    const svc = await buildService(mocks);

    const r = await svc.verify({ env: 'dev', moduleKey: 'admin', versionTag: 'aaa111' });

    expect(find(r, VERIFY_CHECK_KEYS.pointerMatches).status).toBe('unknown');
    expect(r.verdict).toBe('unknown');
    expect(r.blockers).toEqual([]);
    expect(r.warnings.some((w) => w.includes('SSH 连接超时'))).toBe(true);

    assertReadOnly(mocks);
  });

  it('⚠️ 未传 versionTag → expected.source=current-pointer（是"确认现状"，不能当生效证据）', async () => {
    const { mocks } = buildHarness({ currentVersion: 'aaa111' });
    const svc = await buildService(mocks);

    const r = await svc.verify({ env: 'dev', moduleKey: 'admin' });

    expect(r.expected).toEqual({ version: 'aaa111', source: 'current-pointer' });

    assertReadOnly(mocks);
  });

  it('⚠️ 核心项全部不适用（环境无登记期望态）→ unknown，不是 verified', async () => {
    const { mocks } = buildHarness({ moduleType: 'service', factItems: [] });
    const svc = await buildService(mocks);

    const r = await svc.verify({ env: 'dev', moduleKey: 'admin', versionTag: 'aaa111' });

    expect(find(r, VERIFY_CHECK_KEYS.pointerMatches).status).toBe('skipped');
    expect(find(r, VERIFY_CHECK_KEYS.processAlive).status).toBe('skipped');
    expect(r.verdict).toBe('unknown');

    assertReadOnly(mocks);
  });

  describe('后端服务（service）', () => {
    const baseServiceFact: Opts['factItems'] = [
      { kind: 'version', targetKey: 'admin', status: 'ok', expected: 'aaa111', actual: 'aaa111' },
      { kind: 'process', targetKey: 'admin', status: 'ok', expected: 'online', actual: 'online' },
      { kind: 'port', targetKey: 'admin', status: 'ok', expected: '6000', actual: 'listening' },
    ];

    it('进程在线 + 端口监听 → verified', async () => {
      const { mocks } = buildHarness({
        moduleType: 'service',
        factItems: baseServiceFact,
      });
      const svc = await buildService(mocks);

      const r = await svc.verify({ env: 'prod', moduleKey: 'admin', versionTag: 'aaa111' });

      expect(find(r, VERIFY_CHECK_KEYS.processAlive).status).toBe('pass');
      expect(find(r, VERIFY_CHECK_KEYS.portListening).status).toBe('pass');
      expect(r.verdict).toBe('verified');
      // 后端服务不走版本目录检查
      expect(find(r, VERIFY_CHECK_KEYS.versionDirPresent).status).toBe('skipped');

      assertReadOnly(mocks);
    });

    it('进程掉线 → 默认 degraded（非核心项不误判整次发布失败）', async () => {
      const { mocks } = buildHarness({
        moduleType: 'service',
        factItems: [
          { kind: 'version', targetKey: 'admin', status: 'ok', expected: 'aaa111', actual: 'aaa111' },
          { kind: 'process', targetKey: 'admin', status: 'missing', expected: 'online', actual: null },
        ],
      });
      const svc = await buildService(mocks);

      const r = await svc.verify({ env: 'prod', moduleKey: 'admin', versionTag: 'aaa111' });

      expect(find(r, VERIFY_CHECK_KEYS.processAlive).status).toBe('fail');
      expect(r.verdict).toBe('degraded');

      assertReadOnly(mocks);
    });

    it('进程掉线 + strict → failed', async () => {
      const { mocks } = buildHarness({
        moduleType: 'service',
        factItems: [
          { kind: 'version', targetKey: 'admin', status: 'ok', expected: 'aaa111', actual: 'aaa111' },
          { kind: 'process', targetKey: 'admin', status: 'missing', expected: 'online', actual: null },
        ],
      });
      const svc = await buildService(mocks);

      const r = await svc.verify({
        env: 'prod',
        moduleKey: 'admin',
        versionTag: 'aaa111',
        strict: true,
      });

      expect(r.verdict).toBe('failed');
      assertReadOnly(mocks);
    });

    it('⚠️ 全部检查失败时仍不触发任何自愈动作（失败时最容易顺手修）', async () => {
      const { mocks } = buildHarness({
        moduleType: 'service',
        pipelineStatus: 'failed',
        factItems: [
          { kind: 'version', targetKey: 'admin', status: 'drift', expected: 'aaa111', actual: 'old999' },
          { kind: 'process', targetKey: 'admin', status: 'missing', expected: 'online', actual: null },
          { kind: 'port', targetKey: 'admin', status: 'missing', expected: '6000', actual: 'not-listening' },
        ],
      });
      const svc = await buildService(mocks);

      const r = await svc.verify({
        env: 'prod',
        moduleKey: 'admin',
        versionTag: 'aaa111',
        jobId: 'job-1',
      });

      expect(r.verdict).toBe('failed');
      expect(r.blockers.length).toBeGreaterThan(0);
      assertReadOnly(mocks);
      assertCollectedWithoutPersist(mocks, 'prod');
    });
  });

  describe('入参校验', () => {
    it('空 env → 抛错', async () => {
      const { mocks } = buildHarness();
      const svc = await buildService(mocks);
      await expect(svc.verify({ env: '', moduleKey: 'admin' })).rejects.toThrow(/需要 env/);
    });

    it('空 moduleKey → 抛错', async () => {
      const { mocks } = buildHarness();
      const svc = await buildService(mocks);
      await expect(svc.verify({ env: 'dev', moduleKey: '' })).rejects.toThrow(/需要 moduleKey/);
    });

    it('模块未登记 → 抛错（不返回"全是 unknown"的空报告）', async () => {
      const { mocks } = buildHarness({ moduleMissing: true });
      const svc = await buildService(mocks);
      await expect(svc.verify({ env: 'dev', moduleKey: 'admin' })).rejects.toThrow(/模块不存在/);
    });
  });

  describe('指纹', () => {
    it('verifyId 幂等：同入参两次调用结果一致', async () => {
      const { mocks } = buildHarness();
      const svc = await buildService(mocks);
      const input = { env: 'dev', moduleKey: 'admin', versionTag: 'aaa111' };

      const a = await svc.verify(input);
      const b = await svc.verify(input);

      expect(a.verifyId).toBe(b.verifyId);
    });

    it('⚠️ resultHash 随事实变化：指针漂移后两次结果哈希不同', async () => {
      const ok = buildHarness();
      const drift = buildHarness({
        factItems: [
          { kind: 'version', targetKey: 'admin', status: 'drift', expected: 'aaa111', actual: 'old999' },
          { kind: 'dir', targetKey: 'admin', status: 'ok', expected: '非空', actual: '12 个条目' },
        ],
      });

      const svcOk = await buildService(ok.mocks);
      const svcDrift = await buildService(drift.mocks);

      const a = await svcOk.verify({ env: 'dev', moduleKey: 'admin', versionTag: 'aaa111' });
      const b = await svcDrift.verify({ env: 'dev', moduleKey: 'admin', versionTag: 'aaa111' });

      expect(a.resultHash).not.toBe(b.resultHash);
      expect(a.verdict).toBe('verified');
      expect(b.verdict).toBe('failed');
    });
  });

  describe('只读红线', () => {
    it('⚠️ 现采事实但不落库：collect 必须带 persist:false', async () => {
      const { mocks } = buildHarness();
      const svc = await buildService(mocks);

      await svc.verify({ env: 'dev', moduleKey: 'admin', versionTag: 'aaa111' });

      assertCollectedWithoutPersist(mocks, 'dev');
    });

    it('⚠️ 异常路径也只读：collect 抛错时仍不调用任何写方法', async () => {
      const { mocks } = buildHarness({ collectThrows: true });
      const svc = await buildService(mocks);

      await expect(svc.verify({ env: 'dev', moduleKey: 'admin', versionTag: 'aaa111' })).rejects.toThrow(
        /采集失败/,
      );

      assertReadOnly(mocks);
    });
  });
});
