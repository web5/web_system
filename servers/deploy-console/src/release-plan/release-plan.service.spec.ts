import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { ArtifactStoreService } from '../artifact/artifact-store.service';
import { ReleaseLockService } from '../release-lock/release-lock.service';
import { ReleaseRegistryService } from '../registry/release-registry.service';
import { ApprovalService } from '../approval/approval.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { FactCollectService } from '../fact/fact-collect.service';
import { FactStatus } from '../entities/deploy-fact-snapshot.entity';
import { ReleasePlanService } from './release-plan.service';
import { INVARIANT_KEYS, InvariantKey, InvariantResult, ReleasePlan } from './release-plan.types';
import { DEFAULT_FACT_MAX_AGE_MS } from './release-plan-rules';

/**
 * 各依赖的**写方法**清单。
 *
 * 这份名单是 release_plan 「L1 只读」这条红线的可执行形式：plan 调用其中任何一个，
 * 它就不再是 dry-run。新增依赖时这里必须同步登记，否则红线会静默失效。
 */
const WRITE_METHODS: Record<string, string[]> = {
  modules: [],
  artifacts: ['uploadLocal', 'cleanup'],
  locks: ['acquire', 'acquireEx', 'release', 'forceRelease', 'releaseExpired'],
  registry: [
    'registerVersion',
    'setPointer',
    'syncAppEnvPointer',
    'setAppEnvPointer',
    'clearAppEnvPointer',
    'withReleaseLock',
  ],
  approvals: ['create', 'createNode', 'resolve'],
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
  // collect 会写 deploy_fact_snapshots 并可能触发远端 SSH —— 只读提案绝不许调
  facts: ['collect'],
};

interface Opts {
  /** 模块是否存在（默认存在） */
  moduleMissing?: boolean;
  moduleType?: string;
  isShell?: boolean;
  artifactExists?: boolean;
  /** 锁持有者；undefined = 默认无锁 */
  lockHolder?: { pipelineId: string; expiresAt: number } | null;
  pipelinesRows?: Array<{ id: string; status: string }>;
  factBatch?: { batchId: string; collectedAt: number; items: Array<{ kind: string; targetKey: string; status: FactStatus; expected?: string | null; actual?: string | null }> } | null;
  factAllowedEnvs?: string[];
  currentVersion?: string | undefined;
  rollback?: { from: string | null; to: string; source: string } | null;
  rollbackThrows?: boolean;
  pendingApproval?: { id: string; pipelineId: string; operator: string } | null;
  needsApproval?: boolean;
  /** 模拟远端静态根（配置 STATIC_SSH_TARGET） */
  sshTarget?: string | null;
  cfgGet?: (k: string) => string | undefined;
}

// 取"此刻"：距今才算新鲜。写成常量会把时间戳时代定死，陈旧判定会误触发
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
    artifacts: {
      exists: jest.fn((..._args: Parameters<ArtifactStoreService['exists']>) => opts.artifactExists ?? true),
      listVersions: jest.fn(() => []),
      uploadLocal: jest.fn(() => '/tmp/x'),
      cleanup: jest.fn(() => ({ kept: [], removed: [] })),
    },
    locks: {
      holder: jest.fn(async () =>
        opts.lockHolder === undefined ? null : opts.lockHolder,
      ),
      listAll: jest.fn(async () => []),
      acquire: jest.fn(async () => true),
      acquireEx: jest.fn(async () => ({ ok: true, newly: true })),
      release: jest.fn(async () => undefined),
      forceRelease: jest.fn(async () => true),
      releaseExpired: jest.fn(async () => 0),
    },
    registry: {
      currentAppVersion: jest.fn(async () => 'currentVersion' in opts ? opts.currentVersion : 'aaa111'),
      currentVersion: jest.fn(async () =>
        // 用 in 而非 ??：调用方要显式区分"没传"（默认有版本）与"传了 undefined"（无版本＝首次发布）
        'currentVersion' in opts ? opts.currentVersion : 'aaa111',
      ),
      resolveRollbackTarget: jest.fn(async () => {
        if (opts.rollbackThrows) throw new Error('没有可回滚的历史版本');
        return opts.rollback ?? { from: 'aaa111', to: 'old999', source: 'pointer' };
      }),
      findByVersionTag: jest.fn(async () => undefined),
      registerVersion: jest.fn(async () => undefined),
      setPointer: jest.fn(async () => undefined),
      syncAppEnvPointer: jest.fn(async () => undefined),
      setAppEnvPointer: jest.fn(async () => ({})),
      clearAppEnvPointer: jest.fn(async () => undefined),
      withReleaseLock: jest.fn(async () => undefined),
    },
    approvals: {
      needsApproval: jest.fn(async () => opts.needsApproval ?? false),
      pendingFor: jest.fn(async () => opts.pendingApproval ?? null),
      create: jest.fn(async () => ({})),
      createNode: jest.fn(async () => ({})),
      resolve: jest.fn(async () => ({})),
    },
    pipelines: {
      list: jest.fn(async () => opts.pipelinesRows ?? []),
      get: jest.fn(async () => ({})),
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
      allowedEnvs: jest.fn(() => opts.factAllowedEnvs ?? ['dev']),
      latestBatch: jest.fn(async () =>
        opts.factBatch === undefined
          ? { batchId: 'b1', collectedAt: NOW, items: [] as any[] }
          : opts.factBatch,
      ),
      drift: jest.fn(async () => ({ batchId: 'b1', items: [] as any[] })),
      snapshots: jest.fn(async () => [] as any[]),
      collect: jest.fn(async () => ({})),
    },
  };

  return { mocks };
}

async function buildService(
  mocks: ReturnType<typeof buildHarness>['mocks'],
  configuration: Record<string, string> = {},
): Promise<ReleasePlanService> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      ReleasePlanService,
      { provide: ConfigService, useValue: { get: jest.fn((key: string) => configuration[key]) } },
      { provide: ModuleRegistryService, useValue: mocks.modules },
      { provide: ArtifactStoreService, useValue: mocks.artifacts },
      { provide: ReleaseLockService, useValue: mocks.locks },
      { provide: ReleaseRegistryService, useValue: mocks.registry },
      { provide: ApprovalService, useValue: mocks.approvals },
      { provide: PipelineService, useValue: mocks.pipelines },
      { provide: FactCollectService, useValue: mocks.facts },
    ],
  }).compile();
  return moduleRef.get(ReleasePlanService);
}

/** 断言：一次 plan 全程没有调用任何写方法 */
function assertReadOnly(mocks: Record<string, Record<string, jest.Mock>>) {
  for (const [dep, methods] of Object.entries(WRITE_METHODS)) {
    for (const m of methods) {
      const fn = mocks[dep]?.[m];
      expect(fn).toBeDefined();
      if (fn.mock.calls.length > 0) {
        throw new Error(`只读红线被突破：plan 调用了写方法 ${dep}.${m}()`);
      }
    }
  }
}

function find(p: ReleasePlan, key: InvariantKey): InvariantResult {
  const hit = p.invariants.find((i) => i.key === key);
  expect(hit).toBeDefined();
  return hit!;
}

describe('ReleasePlanService.plan（入参）', () => {
  it('缺少 env 直接抛错', async () => {
    const { mocks } = buildHarness();
    const svc = await buildService(mocks);
    await expect(svc.plan({ env: '', moduleKey: 'admin' })).rejects.toThrow('需要 env');
  });

  it('缺少 moduleKey 直接抛错', async () => {
    const { mocks } = buildHarness();
    const svc = await buildService(mocks);
    await expect(svc.plan({ env: 'dev', moduleKey: '' })).rejects.toThrow('需要 moduleKey');
  });

  it('目标版本含非法字符时抛错（与流水线提交同一口径，防命令注入）', async () => {
    const { mocks } = buildHarness();
    const svc = await buildService(mocks);
    await expect(svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'a;rm -rf /' })).rejects.toThrow(
      '非法字符',
    );
  });

  it('接受完整版本引用 namespace/commit，并归一化为纯 commit', async () => {
    const { mocks } = buildHarness();
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'default/abc123def' });
    expect(p.input.versionTag).toBe('abc123def');
    expect(mocks.artifacts.exists).toHaveBeenCalledWith('admin', 'abc123def', {
      env: 'dev',
      staticRoot: expect.any(String),
    });
  });
});

describe('ReleasePlanService.plan（结构与幂等）', () => {
  it('返回体包含调用方做决策需要的全部字段', async () => {
    const { mocks } = buildHarness();
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });

    expect(p.dryRun).toBe(true);
    expect(p.planId).toMatch(/^rp-/);
    expect(p.evidenceHash).toBeTruthy();
    expect(p.summary.length).toBeGreaterThan(10);
    expect(p.invariants.map((i) => i.key)).toEqual(Object.values(INVARIANT_KEYS));
    // 缺口必须回给调用方，否则"没报警"会被当成"都通过了"
    expect(p.knownGaps.length).toBeGreaterThan(0);
  });

  it('幂等：同一份入参两次调用得到同一个 planId', async () => {
    const { mocks } = buildHarness();
    const svc = await buildService(mocks);
    const a = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const b = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    expect(a.planId).toBe(b.planId);
  });

  it('每条不变量的标题取自唯一定义处（不会与兜底路径说法不一致）', async () => {
    const { mocks } = buildHarness({ moduleMissing: true });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin' });
    for (const i of p.invariants) {
      expect(i.title).toBeTruthy();
      expect(typeof i.title).toBe('string');
    }
  });

  it('影响面：版本齐全时给出方向，任一侧缺失则 unknown', async () => {
    const { mocks } = buildHarness();
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'bbb222' });
    expect(p.impact.versionChange).toBe('upgrade');

    const same = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'aaa111' });
    expect(same.impact.versionChange).toBe('same');

    const noTarget = await svc.plan({ env: 'dev', moduleKey: 'admin' });
    expect(noTarget.impact.versionChange).toBe('unknown');
  });

  it('静态根在本机时报 local（便于排障时确认看的是哪台机器）', async () => {
    const { mocks } = buildHarness();
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    expect(p.impact.staticTarget).toBe('local');
  });
});

describe('ReleasePlanService 不变量：模块登记', () => {
  it('模块不存在时该项 unknown，且不拖垮其余检查', async () => {
    const { mocks } = buildHarness({ moduleMissing: true });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });

    expect(find(p, INVARIANT_KEYS.moduleRegistered).status).toBe('unknown');
    expect(find(p, INVARIANT_KEYS.releaseLock).status).toBe('pass');
    expect(find(p, INVARIANT_KEYS.envHealthy).status).toBe('pass');
    assertReadOnly(mocks as any);
  });
});

describe('ReleasePlanService 不变量：目标产物', () => {
  it('本机有产物 → pass', async () => {
    const { mocks } = buildHarness({ artifactExists: true });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    expect(find(p, INVARIANT_KEYS.targetArtifact).status).toBe('pass');
  });

  it('本机无产物 → 阻塞（会在切指针阶段失败）', async () => {
    const { mocks } = buildHarness({ artifactExists: false });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const it = find(p, INVARIANT_KEYS.targetArtifact);
    expect(it.status).toBe('fail');
    expect(it.blocking).toBe(true);
    expect(p.blockers).toContain(it.title);
    expect(p.risk.level).toBe('critical');
  });

  it('未指定版本 → unknown，不是 fail（现场构建时产物还没生成，不能报"不存在"）', async () => {
    const { mocks } = buildHarness();
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin' });
    const it = find(p, INVARIANT_KEYS.targetArtifact);
    expect(it.status).toBe('unknown');
    expect(it.blocking).toBe(false);
    expect(mocks.artifacts.exists).not.toHaveBeenCalled();
    // 判定不了要进 warnings 让人看见
    expect(p.warnings.join()).toContain(it.title);
  });

  it('远端静态根 → unknown，且不去连 SSH（dry-run 不该有副作用）', async () => {
    const { mocks } = buildHarness({ sshTarget: 'root@1.2.3.4' });
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ReleasePlanService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((k: string) => (k === 'STATIC_SSH_TARGET_DEV' ? 'root@1.2.3.4' : undefined)),
          },
        },
        { provide: ModuleRegistryService, useValue: mocks.modules },
        { provide: ArtifactStoreService, useValue: mocks.artifacts },
        { provide: ReleaseLockService, useValue: mocks.locks },
        { provide: ReleaseRegistryService, useValue: mocks.registry },
        { provide: ApprovalService, useValue: mocks.approvals },
        { provide: PipelineService, useValue: mocks.pipelines },
        { provide: FactCollectService, useValue: mocks.facts },
      ],
    }).compile();
    const svc = moduleRef.get(ReleasePlanService);

    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const it = find(p, INVARIANT_KEYS.targetArtifact);
    expect(it.status).toBe('unknown');
    expect(it.evidence?.reason).toBe('remote-static-root');
    expect(p.impact.staticTarget).toBe('root@1.2.3.4');
    // 远端时反而**不得**用本机 fs 去查，那会给出关于另一台机器的错误结论
    expect(mocks.artifacts.exists).not.toHaveBeenCalled();
  });
});

describe('ReleasePlanService site-version proposal', () => {
  it('后端产物不能套静态 index.js 判据，未访问目标机时明确标 unknown', async () => {
    const { mocks } = buildHarness({ moduleType: 'backend', artifactExists: false });
    const service = await buildService(mocks);
    const result = await service.plan({ env: 'dev', moduleKey: 'todo-service', versionTag: 'todo-service-dev/abc1234' });
    expect(mocks.artifacts.exists).not.toHaveBeenCalled();
    expect(result.invariants.find(item => item.key === INVARIANT_KEYS.targetArtifact)).toMatchObject({ status: 'unknown', blocking: false, evidence: { reason: 'backend-runtime-artifact' } });
    assertReadOnly(mocks as any);
  });

  it('shell 提案检查 env/version/index.html，而非微前端 index.js', async () => {
    const { mocks } = buildHarness({ moduleType: 'frontend', isShell: true });
    const service = await buildService(mocks);
    const result = await service.plan({ env: 'dev', moduleKey: 'shell', versionTag: 'dev/abc1234' });
    expect(mocks.artifacts.exists).toHaveBeenCalledWith('shell', 'abc1234', { env: 'dev', staticRoot: expect.any(String), entry: 'index.html' });
    expect(result.invariants.find(item => item.key === INVARIANT_KEYS.targetArtifact)).toMatchObject({ status: 'pass', evidence: { layout: 'site-version' } });
    assertReadOnly(mocks as any);
  });

  it('uses the restored Shell application pointer instead of a stale legacy deployment in its impact', async () => {
    const { mocks } = buildHarness({ moduleType: 'frontend', isShell: true });
    mocks.registry.currentVersion.mockResolvedValue('stale123');
    mocks.registry.currentAppVersion.mockResolvedValue('a82270f9');
    const result = await (await buildService(mocks)).plan({ env: 'dev', moduleKey: 'shell', versionTag: 'a82270f9' });
    expect(result.impact).toMatchObject({ currentVersion: 'a82270f9', versionChange: 'same' });
    expect(mocks.registry.currentVersion).not.toHaveBeenCalled();
    assertReadOnly(mocks as any);
  });
});

describe('ReleasePlanService 环境目录实盘回归', () => {
  let workspace: string;
  let staticRoot: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'release-plan-layout-'));
    staticRoot = path.join(workspace, 'external-public');
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  async function planWithRealArtifacts(useConfiguredRoot = true) {
    const { mocks } = buildHarness();
    const configuration: Record<string, string> = { RELEASE_WORKSPACE: workspace };
    if (useConfiguredRoot) configuration.STATIC_PUBLIC_ROOT_DEV = staticRoot;
    const artifacts = new ArtifactStoreService(new ConfigService(configuration));
    mocks.artifacts.exists.mockImplementation((...args) => artifacts.exists(...args));
    const service = await buildService(mocks, configuration);
    const result = await service.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'default/abc1234' });
    assertReadOnly(mocks);
    return result;
  }

  function createEntry(root: string, ...segments: string[]) {
    const directory = path.join(root, 'static', 'modules', 'admin', ...segments);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'index.js'), 'export default {};');
  }

  it('环境目录：使用配置静态根和 dev 层读取真实产物', async () => {
    createEntry(staticRoot, 'dev', 'abc1234');
    const result = await planWithRealArtifacts();
    expect(find(result, INVARIANT_KEYS.targetArtifact).status).toBe('pass');
    expect(result.blockers).not.toContain(find(result, INVARIANT_KEYS.targetArtifact).title);
  });

  it('环境目录：旧目录存在同版本不能冒充 dev 环境产物', async () => {
    createEntry(path.join(workspace, 'servers', 'gateway', 'public'), 'abc1234');
    const result = await planWithRealArtifacts();
    expect(find(result, INVARIANT_KEYS.targetArtifact).status).toBe('fail');
  });

  it('环境目录：未配置静态根时仍读取默认根下的环境层', async () => {
    createEntry(path.join(workspace, 'servers', 'gateway', 'public'), 'dev', 'abc1234');
    const result = await planWithRealArtifacts(false);
    expect(find(result, INVARIANT_KEYS.targetArtifact).status).toBe('pass');
  });

  it('跨环境：prod 存在同版本不能放行 dev 发布', async () => {
    createEntry(staticRoot, 'prod', 'abc1234');
    const result = await planWithRealArtifacts();
    expect(find(result, INVARIANT_KEYS.targetArtifact).status).toBe('fail');
  });
});

describe('ReleasePlanService 不变量：并发（锁 / 流水线）', () => {
  it('无锁 → pass', async () => {
    const { mocks } = buildHarness({ lockHolder: null });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    expect(find(p, INVARIANT_KEYS.releaseLock).status).toBe('pass');
  });

  it('他人持有未过期锁 → 阻塞', async () => {
    const { mocks } = buildHarness({ lockHolder: { pipelineId: 'p-9', expiresAt: NOW + 60_000 } });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const it = find(p, INVARIANT_KEYS.releaseLock);
    expect(it.status).toBe('fail');
    expect(it.blocking).toBe(true);
    expect(it.detail).toContain('p-9');
  });

  it('锁已过期 → pass（可抢占，与 canAcquire 同口径）', async () => {
    const { mocks } = buildHarness({ lockHolder: { pipelineId: 'p-9', expiresAt: NOW - 1 } });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    expect(find(p, INVARIANT_KEYS.releaseLock).status).toBe('pass');
  });

  it('有运行中的流水线 → 阻塞并给出 jobId', async () => {
    const { mocks } = buildHarness({ pipelinesRows: [{ id: 'job-1', status: 'running' }] });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const it = find(p, INVARIANT_KEYS.noRunningPipeline);
    expect(it.status).toBe('fail');
    expect(it.blocking).toBe(true);
    expect(it.detail).toContain('job-1');
  });

  it('历史流水线都结束 → pass', async () => {
    const { mocks } = buildHarness({
      pipelinesRows: [
        { id: 'job-1', status: 'succeeded' },
        { id: 'job-2', status: 'failed' },
      ],
    });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    expect(find(p, INVARIANT_KEYS.noRunningPipeline).status).toBe('pass');
  });
});

describe('ReleasePlanService 不变量：环境健康（从不把"没数据"当"健康"）', () => {
  it('从未采集 → unknown，绝不报 pass', async () => {
    const { mocks } = buildHarness({ factBatch: null });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const it = find(p, INVARIANT_KEYS.envHealthy);
    expect(it.status).toBe('unknown');
    expect(it.evidence?.reason).toBe('no-snapshot');
    expect(p.warnings.join()).toContain(it.title);
  });

  it('环境不在巡检清单内 → unknown 并提示这是持续性缺口', async () => {
    const { mocks } = buildHarness({ factBatch: null, factAllowedEnvs: ['prod'] });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const it = find(p, INVARIANT_KEYS.envHealthy);
    expect(it.status).toBe('unknown');
    expect(it.detail).toContain('FACT_SNAPSHOT_ENVS');
  });

  it('快照陈旧 → unknown（陈旧事实不等于此刻现状）', async () => {
    const { mocks } = buildHarness({
      factBatch: { batchId: 'b1', collectedAt: NOW - DEFAULT_FACT_MAX_AGE_MS - 1000, items: [] },
    });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const it = find(p, INVARIANT_KEYS.envHealthy);
    expect(it.status).toBe('unknown');
    expect(it.evidence?.reason).toBe('stale');
  });

  it('刚采过且干净 → pass', async () => {
    const { mocks } = buildHarness({
      factBatch: { batchId: 'b1', collectedAt: NOW, items: [{ kind: 'dir', targetKey: 'admin', status: 'ok' }] },
    });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    expect(find(p, INVARIANT_KEYS.envHealthy).status).toBe('pass');
  });

  it('有漂移 → fail 但**不阻塞**（带病发版有时正是修复手段）', async () => {
    const { mocks } = buildHarness({
      factBatch: {
        batchId: 'b1',
        collectedAt: NOW,
        items: [{ kind: 'version', targetKey: 'admin', status: 'drift', expected: 'aaaa', actual: 'bbbb' }],
      },
    });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const it = find(p, INVARIANT_KEYS.envHealthy);
    expect(it.status).toBe('fail');
    expect(it.blocking).toBe(false);
    expect(p.blockers).not.toContain(it.title);
    expect(it.detail).toContain('drift');
  });
});

describe('ReleasePlanService 不变量：回滚点', () => {
  it('有回滚目标 → pass 并说明来源', async () => {
    const { mocks } = buildHarness({ rollback: { from: 'aaa111', to: 'old999', source: 'pointer' } });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const it = find(p, INVARIANT_KEYS.rollbackPoint);
    expect(it.status).toBe('pass');
    expect(it.detail).toContain('old999');
  });

  it('首次发布无回滚点 → fail 但不阻塞，并标明是首次（拦住就永远发不了第一个版本）', async () => {
    const { mocks } = buildHarness({ currentVersion: undefined, rollbackThrows: true });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const it = find(p, INVARIANT_KEYS.rollbackPoint);
    expect(it.status).toBe('fail');
    expect(it.blocking).toBe(false);
    expect(it.evidence?.firstRelease).toBe(true);
    expect(it.detail).toContain('首次发布');
  });

  it('已发布过却找不到回滚目标 → fail 且明确是数据异常', async () => {
    const { mocks } = buildHarness({ currentVersion: 'aaa111', rollbackThrows: true });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const it = find(p, INVARIANT_KEYS.rollbackPoint);
    expect(it.status).toBe('fail');
    expect(it.evidence?.firstRelease).toBe(false);
    expect(it.detail).toContain('数据异常');
  });
});

describe('ReleasePlanService 不变量：重复审批单', () => {
  it('已有待审单 → 阻塞（提交会 409）', async () => {
    const { mocks } = buildHarness({
      pendingApproval: { id: 'ap-1', pipelineId: 'p-1', operator: 'chase' },
    });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    const it = find(p, INVARIANT_KEYS.noPendingApproval);
    expect(it.status).toBe('fail');
    expect(it.blocking).toBe(true);
    expect(it.detail).toContain('ap-1');
  });

  it('无待审单 → pass', async () => {
    const { mocks } = buildHarness({ pendingApproval: null });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    expect(find(p, INVARIANT_KEYS.noPendingApproval).status).toBe('pass');
  });
});

describe('ReleasePlanService：审批与受控环境', () => {
  it('受控环境 → requiresApproval，且风险不低于 medium', async () => {
    const { mocks } = buildHarness({ needsApproval: true });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'prod', moduleKey: 'admin', versionTag: 'abc1234' });
    expect(p.requiresApproval).toBe(true);
    expect(p.approvalReason).toContain('REQUIRE_APPROVAL_ENVS');
    expect(['medium', 'high', 'critical']).toContain(p.risk.level);
  });

  it('审批开关读不到时兜底 false —— 不假装"要审批"，也不假装"放行"', async () => {
    const { mocks } = buildHarness();
    mocks.approvals.needsApproval.mockRejectedValue(new Error('settings down'));
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    expect(p.requiresApproval).toBe(false);
    // 真正的门禁仍在 pipeline.submit 独立重跑，这里必须说清这一点
    expect(p.approvalReason).toContain('模板策略');
  });
});

describe('ReleasePlanService：只读红线', () => {
  it('一次完整 plan 全程不触碰任何写方法', async () => {
    const { mocks } = buildHarness();
    const svc = await buildService(mocks);
    await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    assertReadOnly(mocks as any);
  });

  it('即便全部前置都失败，也不去触碰写方法（失败场景最容易顺手自愈）', async () => {
    const { mocks } = buildHarness({
      moduleMissing: true,
      artifactExists: false,
      lockHolder: { pipelineId: 'p-1', expiresAt: NOW + 1000 },
      pipelinesRows: [{ id: 'job-1', status: 'running' }],
      factBatch: null,
      rollbackThrows: true,
      pendingApproval: { id: 'ap-1', pipelineId: 'p-1', operator: 'chase' },
    });
    const svc = await buildService(mocks);
    const p = await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    expect(p.risk.level).toBe('critical');
    expect(p.blockers.length).toBeGreaterThan(0);
    assertReadOnly(mocks as any);
  });

  it('不触发事实采集（collect 会写库并可能连远端机器）', async () => {
    const { mocks } = buildHarness({ factBatch: null });
    const svc = await buildService(mocks);
    await svc.plan({ env: 'dev', moduleKey: 'admin', versionTag: 'abc1234' });
    // 没数据就是没数据，plan 不该为了"给个答案"顺手采一轮
    expect(mocks.facts.collect).not.toHaveBeenCalled();
  });
});
