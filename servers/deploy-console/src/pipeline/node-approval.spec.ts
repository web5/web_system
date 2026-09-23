import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DeployPipelineEntity } from '../entities/deploy-pipeline.entity';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { DeployPipelineTemplateEntity } from '../entities/deploy-pipeline-template.entity';
import { DeployServiceEnvEntity } from '../entities/deploy-service-env.entity';
import { DeployApprovalEntity } from '../entities/deploy-approval.entity';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { CanaryService } from '../canary/canary.service';
import { AuditService } from '../audit/audit.service';
import { StageCommandService } from '../stage-command/stage-command.service';
import { PipelineStepCommandService } from '../pipeline-step-command/pipeline-step-command.service';
import { StepBranchService } from '../pipeline-step-command/step-branch.service';
import { PipelineOrchestrationService } from '../pipeline-orchestration/pipeline-orchestration.service';
import { ConfigService as ConfigCenterService } from '../config/config.service';
import { ReleaseLockService } from '../release-lock/release-lock.service';
import { NotificationService } from '../notification/notification.service';
import { DeployService } from '../deploy/deploy.service';
import { ApprovalService } from '../approval/approval.service';
// 可审批人（方案 B）：测试里用放行桩，避免真的去调 user-service
import { ApproverService } from '../approval/approver.service';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { PipelineTemplateService } from '../pipeline-template/pipeline-template.service';
import { Pm2ProbeService } from '../pm2/pm2-probe.service';
import { CommandService } from '../shell/command.service';
import { SHELL_RUNNER, ShellRunRequest } from '../shell/shell-runner';
import { ArtifactStoreService } from '../artifact/artifact-store.service';
import { ReleaseRegistryService } from '../registry/release-registry.service';
import { ReleaseGitService } from '../git/release-git.service';
import { PIPELINE_BUILTIN_STEPS } from './steps/step-registry';
import { PipelineService, PIPELINE_AWAITING_APPROVAL } from './pipeline.service';
import { PipelineVarService } from './pipeline-var.service';
import { PipelineSuspended } from './pipeline-suspension';
import type { TemplateNode } from '../pipeline-template/template-node';
import type { StepAction } from '../entities/deploy-pipeline-step-command.entity';

/**
 * approval 节点的端到端单测（P0 核心，T3）。
 *
 * 背景：审批原本是「发布前置门禁」——提交即阻断，且**只能拦在最前面**。
 * design D8 把它升级为**节点**，可以插在任意位置（如「构建完、重启前等人确认」），
 * 这就要求引擎能：执行到该节点 → 挂起（后续节点一个都不跑）→ 批准后**从该节点之后继续**。
 *
 * 技术前提：shell 执行被抽成可注入的 `ShellRunner`（`shell/shell-runner.ts`），
 * 这里注入假实现，因此**不打任何真实子进程**。
 */

/**
 * 三节点模板：shell → approval → shell
 *
 * 注：目标模型里「跑命令的节点」叫 `shell`（design §3），当前实现仍叫 `script` ——
 * platform 三节点降级为普通 shell 节点属 P4 迁移，在此之前 `script` 即 shell 节点。
 */
const NODES: TemplateNode[] = [
  { kind: 'script', key: 'a', label: '第一段' },
  { kind: 'approval', key: 'g', label: '发布确认' },
  { kind: 'script', key: 'b', label: '第三段' },
];

function act(id: string, code: string, extra: Partial<StepAction> = {}): StepAction {
  return { id, type: 'shell', name: id, code, ...extra };
}

/** 假 shell runner：按节点（env.STAGE）返回预设退出码，并记录执行过的节点 */
function makeShellRunner(codes: Record<string, number> = {}) {
  const stages: string[] = [];
  const runner = {
    stages,
    run: jest.fn(async (req: ShellRunRequest) => {
      const stage = String(req.env.STAGE ?? '');
      stages.push(stage);
      req.onLog?.(`${stage} 输出`);
      return codes[stage] ?? 0;
    }),
  };
  return runner;
}

/** 内存版审批单仓储（验证 pipelineId+nodeKey 去重与状态机） */
function makeApprovalRepo() {
  const rows: Record<string, any>[] = [];
  return {
    rows,
    create: (x: any) => ({ ...x }),
    save: async (x: any) => {
      const i = rows.findIndex((r) => r.id === x.id);
      if (i >= 0) rows[i] = { ...x };
      else rows.push({ ...x });
      return { ...x };
    },
    findOne: async ({ where }: any) =>
      rows.find((r) =>
        Object.entries(where ?? {}).every(([k, v]) => r[k] === v),
      ) ?? null,
    find: async (opts: any = {}) => {
      let out = rows.filter((r) =>
        Object.entries(opts.where ?? {}).every(([k, v]) => r[k] === v),
      );
      if (opts.order?.createdAt === 'ASC') out = [...out].sort((a, b) => a.createdAt - b.createdAt);
      return out;
    },
  };
}

interface Ctx {
  svc: PipelineService;
  p: DeployPipelineEntity;
  runner: ReturnType<typeof makeShellRunner>;
  approvals: ReturnType<typeof makeApprovalRepo>;
  audit: { log: jest.Mock };
  notify: { notify: jest.Mock };
}

async function setup(nodes: TemplateNode[] = NODES, codes: Record<string, number> = {}): Promise<Ctx> {
  const runner = makeShellRunner(codes);
  const approvals = makeApprovalRepo();
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notify = { notify: jest.fn().mockResolvedValue(undefined) };
  const pipelineRepo = {
    save: jest.fn(async (x: any) => x),
    findOne: jest.fn(async ({ where }: any) => (where?.id === 'p1' ? ctxP : null)),
    create: (x: any) => x,
    find: jest.fn(async () => []),
  };
  const stepCommands = {
    // 节点 key → 操作序列；approval 节点没有命令（返回空）
    resolveActions: jest.fn(async (_tplId: string, nodeKey: string) =>
      nodeKey === 'g' ? [] : [act('a1', `echo ${nodeKey}`)],
    ),
    // 步骤执行条件（gate）：runStageCommand 会读它，本 spec 不涉及 → 无条件（null）
    getRow: jest.fn(async () => null),
  };
  // 配置中心：脚本注入走 resolveForScriptsDetailed（**不含密钥**，见 specs/service-config-delivery）
  const configs = { resolve: jest.fn(async () => ({})) };
  (configs as any).resolveForScriptsDetailed = jest.fn(async () => ({
    config: {},
    excludedSecrets: [],
  }));
  const moduleRegistry = { get: jest.fn(async () => ({ type: 'backend', dir: 'x', pm2: 'web-x' })) };
  const canary = { list: jest.fn(async () => []) };
  const pm2Probe = { listProcesses: jest.fn(() => []) };
  const command = { nodeBinDir: jest.fn(() => '/usr/local/bin'), exec: jest.fn(() => '') };
  const cfgGet = jest.fn((key: string) => {
    // 关掉发布后的权限同步（该测试不关心，且避免额外 HTTP 调用）
    if (key === 'PIPELINE_PERM_SYNC') return 'false';
    if (key === 'RELEASE_WORKSPACE') return '/tmp/ws-release';
    return undefined;
  });

  const ctxP: DeployPipelineEntity = {
    id: 'p1',
    env: 'local',
    moduleKey: 'todo-service',
    pipelineId: 'tpl1',
    templateName: '测试模板',
    mode: 'direct',
    status: 'pending',
    stage: nodes[0]?.key,
    logs: [],
    nodes,
    steps: null,
    operator: 'alice',
    startTime: Date.now(),
    progress: { current: 0, total: nodes.length, message: '' },
  } as unknown as DeployPipelineEntity;

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      PipelineService,
      { provide: ConfigService, useValue: { get: cfgGet } },
      { provide: getRepositoryToken(DeployPipelineEntity), useValue: pipelineRepo },
      { provide: getRepositoryToken(DeployVersionEntity), useValue: {} },
      { provide: getRepositoryToken(DeployDeploymentEntity), useValue: { findOne: async () => null } },
      { provide: getRepositoryToken(DeployPipelineTemplateEntity), useValue: {} },
      // 服务×环境登记（远端端口真相源）：本 spec 关注审批挂起/恢复 → 查不到即空
      { provide: getRepositoryToken(DeployServiceEnvEntity), useValue: { findOne: async () => null } },
      // 流水线变量：本 spec 关注审批挂起/恢复，变量不参与 → 空实现
      { provide: PipelineVarService, useValue: { resolve: async () => ({}) } },
      { provide: ModuleRegistryService, useValue: moduleRegistry },
      { provide: CanaryService, useValue: canary },
      { provide: AuditService, useValue: audit },
      { provide: StageCommandService, useValue: {} },
      { provide: PipelineStepCommandService, useValue: stepCommands },
      // 步骤分支（步骤 1:N 任务按条件命中）：本 spec 不涉及 → 无分支
      { provide: StepBranchService, useValue: { list: async () => [] } },
      { provide: PipelineOrchestrationService, useValue: {} },
      { provide: ConfigCenterService, useValue: configs },
      { provide: ReleaseLockService, useValue: { acquire: async () => true, release: async () => undefined } },
      { provide: NotificationService, useValue: notify },
      { provide: DeployService, useValue: {} },
      ApprovalService,
      { provide: getRepositoryToken(DeployApprovalEntity), useValue: approvals },
      { provide: SystemSettingsService, useValue: { get: async () => null } },
      // 审批权限校验：默认放行（真实拦截逻辑由 approver.service 自己测）
      {
        provide: ApproverService,
        useValue: {
          list: async () => ({ users: [], degraded: true, reason: 'test' }),
          canApprove: async () => ({ ok: true, degraded: true, reason: 'test' }),
          clearCache: () => undefined,
        },
      },
      { provide: PipelineTemplateService, useValue: {} },
      { provide: Pm2ProbeService, useValue: pm2Probe },
      { provide: CommandService, useValue: command },
      { provide: SHELL_RUNNER, useValue: runner },
      { provide: ArtifactStoreService, useValue: {} },
      { provide: ReleaseRegistryService, useValue: {} },
      { provide: ReleaseGitService, useValue: {} },
      { provide: PIPELINE_BUILTIN_STEPS, useValue: {} },
    ],
  }).compile();

  return { svc: moduleRef.get(PipelineService), p: ctxP, runner, approvals, audit, notify };
}

/** 触发一次执行（run 是私有方法：测试里直连主循环，等价于提交后的后台执行） */
const runPipeline = (ctx: Ctx, opts?: { resumeAfter?: string | null }) =>
  (ctx.svc as unknown as { run: (p: any, t?: any, o?: any) => Promise<void> }).run(
    ctx.p,
    undefined,
    opts,
  );

describe('approval 节点：挂起与恢复（P0 核心）', () => {
  it('V1 执行到 approval 节点 ⇒ 建节点级审批单 + 挂起，后续节点不执行', async () => {
    const ctx = await setup();
    await runPipeline(ctx);
    expect(ctx.p.status).toBe(PIPELINE_AWAITING_APPROVAL);
    // 恢复锚点 = 被挂起的节点
    expect(ctx.p.stage).toBe('g');
    // 只跑了第一个 shell 节点
    expect(ctx.runner.stages).toEqual(['a']);

    const pending = ctx.approvals.rows.filter((r) => r.status === 'pending');
    expect(pending.length).toBe(1);
    expect(pending[0].pipelineId).toBe('p1');
    expect(pending[0].nodeKey).toBe('g');
    expect(pending[0].nodeLabel).toBe('发布确认');
    // 挂起不是失败：不写 error、不算终态
    expect(ctx.p.error).toBeUndefined();
    expect(ctx.p.endTime).toBeUndefined();
  });

  it('V1 同一节点重复触发只保留一条待决审批单（去重）', async () => {
    const ctx = await setup();
    await runPipeline(ctx);
    await runPipeline(ctx); // 重入（如服务重启后续跑）

    const pending = ctx.approvals.rows.filter((r) => r.status === 'pending' && r.nodeKey === 'g');
    expect(pending.length).toBe(1);
  });

  it('V2 approve ⇒ 从该节点之后继续，已完成的 shell 节点不重跑', async () => {
    const ctx = await setup();
    await runPipeline(ctx);

    const res = await ctx.svc.approve('p1', 'bob', '可以发');
    await ctx.svc.waitFor('p1'); // 引擎是非阻塞的，这里显式等它跑完再断言
    expect(res.status).toBe('approved');
    expect(res.resumedFrom).toBe('g');

    // 关键：'a' 没有再跑一次
    expect(ctx.runner.stages).toEqual(['a', 'b']);
    expect(ctx.p.status).toBe('succeeded');
    expect(
      ctx.approvals.rows.find((r) => r.nodeKey === 'g')?.status,
    ).toBe('approved');
    expect(ctx.p.logs?.some((l) => l.includes('跳过已完成节点 a'))).toBe(true);
  });

  it('V4 三节点端到端：审批前停在节点 2，approve 后节点 3 执行并最终 succeeded', async () => {
    const ctx = await setup();

    // 审批前
    await runPipeline(ctx);
    expect(ctx.p.status).toBe(PIPELINE_AWAITING_APPROVAL);
    expect(ctx.runner.stages).toEqual(['a']);
    expect(ctx.runner.stages).not.toContain('b');

    // 审批后
    await ctx.svc.approve('p1', 'bob');
    await ctx.svc.waitFor('p1');
    expect(ctx.runner.stages).toEqual(['a', 'b']);
    expect(ctx.p.status).toBe('succeeded');
    expect(ctx.p.progress?.message).toBe('发布完成');
    // 审批单已决议，且记录了审批人
    const row = ctx.approvals.rows.find((r) => r.nodeKey === 'g');
    expect(row?.status).toBe('approved');
    expect(row?.reviewer).toBe('bob');
  });

  it('V3 reject ⇒ 流水线 failed（onReject=abort）', async () => {
    const ctx = await setup();
    await runPipeline(ctx);

    const res = await ctx.svc.reject('p1', 'bob', '还没验证');
    expect(res.status).toBe('rejected');
    expect(ctx.p.status).toBe('failed');
    expect(ctx.p.error).toContain('审批拒绝');
    expect(ctx.p.endTime).toBeDefined();
    // 拒绝后不会再执行后续节点
    expect(ctx.runner.stages).toEqual(['a']);
    expect(ctx.approvals.rows.find((r) => r.nodeKey === 'g')?.status).toBe('rejected');
  });

  it('V3 后续节点失败 ⇒ 流水线 failed（挂起过也不影响失败判定）', async () => {
    const ctx = await setup(NODES, { b: 3 });
    await runPipeline(ctx);
    await ctx.svc.approve('p1', 'bob');
    await ctx.svc.waitFor('p1');
    expect(ctx.p.status).toBe('failed');
    expect(String(ctx.p.error)).toContain('exit 3');
  });

  it('已挂起的流水线被取消 ⇒ cancelled，且关闭待决审批单（不留孤儿单）', async () => {
    const ctx = await setup();
    await runPipeline(ctx);
    const res = await ctx.svc.cancel('p1', 'alice');
    expect(res.status).toBe('cancelled');
    expect(ctx.approvals.rows.filter((r) => r.status === 'pending').length).toBe(0);
  });

  it('挂起信号类型：PipelineSuspended 携带节点 key 与审批单 id', () => {
    const e = new PipelineSuspended('g', 'ap-1', '发布确认');
    expect(e.nodeKey).toBe('g');
    expect(e.approvalId).toBe('ap-1');
    expect(e.name).toBe('PipelineSuspended');
    expect(e.message).toContain('发布确认');
  });
});
