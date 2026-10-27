/**
 * triggerSource 落库 + 审计 detail 的服务层防回归（2026-10-27 防再犯 S1）。
 *
 * 钉死两件事：
 *  ① submit 把 triggerSource 固化进 deploy_pipeline_runs 实体（列 trigger_source）；
 *  ② pipeline.submit 审计 detail 含 `来源=…`（MySQL + JSONL 双写的 AuditService
 *     收到的 entry.detail 已含来源，两边都会有）。
 *
 * 用 Object.create + 依赖桩直调 submitWithAdmission 的公开入口 submit：
 * PipelineService 构造函数有 20+ 依赖，全量 Test.createTestingModule 噪音大于信号，
 * 这里只桩 submit 路径真正摸到的依赖（与 hook/mcp 控制器测试同一务实风格）。
 */
import { PipelineService, SubmitPipelineDto } from './pipeline.service';

function makeService() {
  const saved: any[] = [];
  const audits: any[] = [];
  const pipelineRepo = {
    findOne: jest.fn(async () => null),
    create: jest.fn((x: any) => ({ ...x })),
    save: jest.fn(async (x: any) => {
      saved.push(x);
      return x;
    }),
  };
  const auditService = {
    log: jest.fn(async (e: any) => {
      audits.push(e);
    }),
  };

  const svc = Object.create(PipelineService.prototype) as PipelineService;
  Object.assign(svc as any, {
    configService: { get: jest.fn(() => undefined) },
    git: { assertWorkspaceSafe: jest.fn() },
    releaseLock: {
      acquire: jest.fn(async () => true),
      release: jest.fn(async () => undefined),
    },
    pipelineRepo,
    templates: {
      resolveForSubmit: jest.fn(async () => ({
        id: 'tpl-1',
        name: '默认模板',
        steps: null,
        nodes: null,
        skipVerify: false,
        rollbackOnFailure: 'previous',
        defaultTarget: 'auto',
      })),
    },
    approvals: {
      needsApproval: jest.fn(async () => false),
      create: jest.fn(async () => ({ id: 'ap-1' })),
      pendingForPipeline: jest.fn(async () => null),
      byPipelineId: jest.fn(async () => null),
      pendingForNode: jest.fn(async () => null),
      resolve: jest.fn(async () => undefined),
    },
    orchestration: { getTree: jest.fn(async () => []) },
    auditService,
    notifications: { notify: jest.fn() },
    assertCanReview: jest.fn(async () => undefined),
    cancelled: new Set(),
    shells: new Map(),
    running: new Map(),
    runTokenJtis: new Map(),
    runTokenWarned: new Set(),
    remoteVarWarned: new Set(),
    logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() },
  });
  // 后台执行体桩掉：本测试只关心提交落库与审计，不跑流水线
  (svc as any).run = jest.fn(async () => undefined);

  return { svc, saved, audits, pipelineRepo, auditService };
}

const baseDto: SubmitPipelineDto = {
  env: 'dev',
  moduleKey: 'admin',
  branch: 'master',
  commitId: 'abc1234',
};

describe('PipelineService.submit（triggerSource 落库 + 审计）', () => {
  it('实体固化 triggerSource（→ deploy_pipeline_runs.trigger_source）', async () => {
    const { svc, saved } = makeService();
    await svc.submit({ ...baseDto, triggerSource: 'mcp:ai-ops-automation' }, '1');

    expect(saved).toHaveLength(1);
    expect(saved[0].triggerSource).toBe('mcp:ai-ops-automation');
    expect(saved[0].operator).toBe('1');
  });

  it('缺省不编造（向后兼容老调用）：triggerSource 为 undefined', async () => {
    const { svc, saved } = makeService();
    await svc.submit({ ...baseDto }, '1');
    expect(saved[0].triggerSource).toBeUndefined();
  });

  it('审计 detail 含 来源=（归因可检索）', async () => {
    const { svc, audits } = makeService();
    await svc.submit({ ...baseDto, triggerSource: 'mcp:ai-ops-automation' }, '1');

    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('pipeline.submit');
    expect(audits[0].detail).toContain('来源=mcp:ai-ops-automation');
    expect(audits[0].detail).toContain('mode=direct');
    expect(audits[0].detail).toContain('模板=默认模板');
  });

  it('非法 triggerSource 直接拒绝（不落库、不审计）', async () => {
    const { svc, saved, audits } = makeService();
    await expect(
      svc.submit({ ...baseDto, triggerSource: 'bad source; drop' }, '1'),
    ).rejects.toThrow(/triggerSource/);
    expect(saved).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('需审批路径同样带来源（pending-approval 审计）', async () => {
    const { svc, audits } = makeService();
    (svc as any).approvals.needsApproval = jest.fn(async () => true);
    const r = await svc.submit(
      { ...baseDto, triggerSource: 'ui:page-releases' },
      'alice',
    );
    expect(r.status).toBe('pending-approval');
    expect(audits[0].status).toBe('pending_approval');
    expect(audits[0].detail).toContain('来源=ui:page-releases');
    expect(audits[0].detail).toContain('需审批，已阻断等待');
  });
});

describe('PipelineService.approve / reject（审批通道审计）', () => {
  const makeAwaiting = (svc: PipelineService) => {
    (svc as any).get = jest.fn(async () => ({
      id: 'job-1',
      env: 'dev',
      moduleKey: 'admin',
      status: 'awaiting-approval',
      stage: 'approval',
      nodes: [{ kind: 'approval', key: 'approval' }],
      logs: [],
      startTime: Date.now(),
    }));
    (svc as any).approvals.pendingForPipeline = jest.fn(async () => ({
      id: 'ap-1',
      nodeKey: 'approval',
    }));
    (svc as any).approvals.pendingForNode = jest.fn(async () => null);
    (svc as any).approvals.resolve = jest.fn(async () => undefined);
    (svc as any).trackRun = jest.fn();
  };

  it('approve 审计 detail 含 通道=（mcp:<keyName>）', async () => {
    const { svc, audits } = makeService();
    makeAwaiting(svc);
    await svc.approve('job-1', 'admin', 'ok', undefined, 'mcp:ai-ops-automation');
    expect(audits[0].action).toBe('pipeline.approve');
    expect(audits[0].detail).toContain('通道: mcp:ai-ops-automation');
    const channelChange = (audits[0].changes as any[]).find(
      (c) => c.field === 'approval.channel',
    );
    expect(channelChange?.after).toBe('mcp:ai-ops-automation');
  });

  it('reject 审计 detail 含 通道=（缺省 ui）', async () => {
    const { svc, audits } = makeService();
    makeAwaiting(svc);
    await svc.reject('job-1', 'admin', 'no', undefined, undefined);
    expect(audits[0].action).toBe('pipeline.reject');
    expect(audits[0].detail).toContain('通道: ui');
    const channelChange = (audits[0].changes as any[]).find(
      (c) => c.field === 'approval.channel',
    );
    expect(channelChange?.after).toBe('ui');
  });
});
