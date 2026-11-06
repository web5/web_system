import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ApprovalService } from '../approval/approval.service';
import { ApproverService } from '../approval/approver.service';
import { AuditService } from '../audit/audit.service';
import { DeployApprovalEntity } from '../entities/deploy-approval.entity';
import { PipelineService } from '../pipeline/pipeline.service';
import { WecomApprovalService, WecomActor } from './wecom-approval.service';
import { WecomConfigService } from './wecom.config';

const enabledEnv = {
  WECOM_APPROVE_ENABLED: '1',
  CONSOLE_PUBLIC_BASE_URL: 'https://dev.kedouai.com/console',
  WECOM_CORP_ID: 'corp-id',
  WECOM_AGENT_ID: '1000002',
  WECOM_SECRET: 'secret',
  JWT_SECRET: 'jwt',
  USER_SERVICE_URL: 'http://user-service:6002',
  INTERNAL_API_KEY: 'internal-key',
};

const actor: WecomActor = { username: 'bob', ext: 'wenzhui', approvalId: 'A1' };

function makeApproval(overrides: Partial<DeployApprovalEntity> = {}): DeployApprovalEntity {
  return {
    id: 'A1', pipelineId: 'P1', env: 'prod', moduleKey: 'admin', mode: 'direct',
    operator: 'alice', status: 'pending', createdAt: 1_700_000_000_000,
    channel: 'console', nodeKey: 'approve-1', nodeLabel: '发布确认',
    ...overrides,
  } as DeployApprovalEntity;
}

function setup(opts: {
  approval?: DeployApprovalEntity;
  pipeline?: Record<string, unknown>;
  gate?: { ok: boolean; degraded: boolean; reason?: string };
  affected?: number;
  enabled?: boolean;
  operatorName?: string | null;
} = {}) {
  const approval = opts.approval ?? makeApproval();
  const pipeline = {
    id: 'P1', status: 'awaiting-approval', versionTag: 'v1.2.3',
    nodes: [{ kind: 'approval', key: 'approve-1', label: '发布确认', approvers: ['bob'] }],
    ...(opts.pipeline ?? {}),
  };
  const approvals = { get: jest.fn().mockResolvedValue(approval) } as unknown as ApprovalService;
  const approvers = {
    canApprove: jest.fn().mockResolvedValue(opts.gate ?? { ok: true, degraded: false }),
    displayName: jest.fn().mockResolvedValue(opts.operatorName ?? null),
  } as unknown as ApproverService;
  const pipelines = {
    get: jest.fn().mockResolvedValue(pipeline),
    approve: jest.fn().mockResolvedValue({ id: 'P1', status: 'pending', resumedFrom: 'approve-1' }),
    reject: jest.fn().mockResolvedValue({ id: 'P1', status: 'failed' }),
  } as unknown as PipelineService;
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const repo = {
    update: jest.fn().mockResolvedValue({ affected: opts.affected ?? 1 }),
  };
  const config = WecomConfigService.forTest(opts.enabled === false ? { WECOM_APPROVE_ENABLED: '0' } : enabledEnv);
  const service = new WecomApprovalService(
    config, approvals, approvers, pipelines, audit,
    repo as unknown as Repository<DeployApprovalEntity>,
  );
  return { service, approvals, approvers, pipelines, audit, repo, approval };
}

describe('WecomApprovalService（卡② W-a~W-g / V3–V8 / V10 / V12）', () => {
  it('prod 未带 confirm=true → 400，且不领权、不调 PipelineService', async () => {
    const s = setup();
    await expect(s.service.approve('A1', actor, {}, '1.2.3.4')).rejects.toThrow(BadRequestException);
    expect(s.repo.update).not.toHaveBeenCalled();
    expect(s.pipelines.approve).not.toHaveBeenCalled();
  });

  it('prod confirm=true → 复用 PipelineService.approve，带 channel=wecom', async () => {
    const s = setup();
    const r = await s.service.approve('A1', actor, { confirm: true }, '1.2.3.4');
    expect(r.status).toBe('approved');
    expect(r.message).toContain('审批结果 ≠ 发布结果');
    expect(s.pipelines.approve).toHaveBeenCalledWith('P1', 'bob', undefined, 'approve-1', 'wecom');
  });

  it('CAS 领权写 3 列：channel / identityExternalId / sourceIp', async () => {
    const s = setup();
    await s.service.approve('A1', actor, { confirm: true }, '1.2.3.4');
    expect(s.repo.update).toHaveBeenCalledWith(
      { id: 'A1', status: 'pending' },
      { channel: 'wecom', identityExternalId: 'wenzhui', sourceIp: '1.2.3.4' },
    );
  });

  it('审计必落 channel / identityExternalId / sourceIp（V10）', async () => {
    const s = setup();
    await s.service.approve('A1', actor, { confirm: true }, '1.2.3.4');
    const entry = (s.audit.log as jest.Mock).mock.calls[0][0] as { detail: string; status: string };
    expect(entry.status).toBe('approved');
    expect(entry.detail).toContain('channel=wecom');
    expect(entry.detail).toContain('identityExternalId=wenzhui');
    expect(entry.detail).toContain('sourceIp=1.2.3.4');
  });

  it('🔴 W-a fail-closed：ApproverService 降级放行（degraded=true）也拒绝', async () => {
    const s = setup({ gate: { ok: true, degraded: true, reason: 'user-service 不可达' } });
    await expect(s.service.approve('A1', actor, { confirm: true }, '1.2.3.4')).rejects.toThrow(
      /身份服务不可用/,
    );
    expect(s.repo.update).not.toHaveBeenCalled();
    expect(s.pipelines.approve).not.toHaveBeenCalled();
  });

  it('不在白名单 → 403，审批单保持 pending', async () => {
    const s = setup({ gate: { ok: false, degraded: false } });
    await expect(s.service.approve('A1', actor, { confirm: true }, '1.2.3.4')).rejects.toThrow(
      ForbiddenException,
    );
    expect(s.approval.status).toBe('pending');
  });

  it('短令牌绑定单号不匹配 → 403（S4）', async () => {
    const s = setup();
    await expect(
      s.service.approve('A1', { ...actor, approvalId: 'OTHER' }, { confirm: true }, '1.2.3.4'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('V6 幂等：CAS affected=0 → 409，resume 不发生', async () => {
    const s = setup({ affected: 0 });
    await expect(s.service.approve('A1', actor, { confirm: true }, '1.2.3.4')).rejects.toThrow(
      ConflictException,
    );
    expect(s.pipelines.approve).not.toHaveBeenCalled();
  });

  it('审批单已处理 → 409 且提示处理人与时间', async () => {
    const s = setup({
      approval: makeApproval({ status: 'approved', reviewer: 'carol', reviewedAt: 1_700_000_060_000 }),
    });
    await expect(s.service.approve('A1', actor, { confirm: true }, '1.2.3.4')).rejects.toThrow(
      /已由 carol/,
    );
    expect(s.pipelines.approve).not.toHaveBeenCalled();
  });

  it('流水线已终态 → 409「无需审批」', async () => {
    const s = setup({ pipeline: { status: 'cancelled' } });
    await expect(s.service.approve('A1', actor, { confirm: true }, '1.2.3.4')).rejects.toThrow(
      /无需审批/,
    );
  });

  it('V5 驳回意见必填：空意见 400，有意见才调 PipelineService.reject', async () => {
    const s = setup();
    await expect(s.service.reject('A1', actor, { comment: '   ' }, '1.2.3.4')).rejects.toThrow(
      BadRequestException,
    );
    expect(s.pipelines.reject).not.toHaveBeenCalled();
    const r = await s.service.reject('A1', actor, { comment: '分支错' }, '1.2.3.4');
    expect(r.status).toBe('rejected');
    expect(s.pipelines.reject).toHaveBeenCalledWith('P1', 'bob', '分支错', 'approve-1', 'wecom');
  });

  it('PipelineService 失败 → 审计落 failed，不谎报「已通过」', async () => {
    const s = setup();
    (s.pipelines.approve as jest.Mock).mockRejectedValueOnce(new Error('resume 失败'));
    await expect(s.service.approve('A1', actor, { confirm: true }, '1.2.3.4')).rejects.toThrow(
      /resume 失败/,
    );
    const calls = (s.audit.log as jest.Mock).mock.calls as Array<[Record<string, string>]>;
    expect(calls.some(([e]) => e.status === 'failed')).toBe(true);
  });

  it('V12 总开关关闭 → 端点语义上不存在（404），零调用', async () => {
    const s = setup({ enabled: false });
    await expect(s.service.detail('A1', actor, '1.2.3.4')).rejects.toThrow(NotFoundException);
    expect(s.approvers.canApprove).not.toHaveBeenCalled();
  });

  it('S1 详情脱敏：有判断依据四项，不含日志正文 / 密钥 / 内部路径', async () => {
    const s = setup();
    const d = await s.service.detail('A1', actor, '1.2.3.4');
    expect(d.env).toBe('prod');
    expect(d.moduleKey).toBe('admin');
    expect(d.versionTag).toBe('v1.2.3');
    expect(d.operator).toBe('alice');
    expect(d.requiresConfirm).toBe(true);
    expect(d.recentNodes).toHaveLength(0); // anchorIdx=0，其前无已完成节点
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain('logs');
    expect(serialized).not.toContain('WECOM_SECRET');
    expect(serialized).not.toContain('/data/');
  });

  it('提交人 id 能反查成用户名（S1 不该显示「1」）', async () => {
    const s = setup({ operatorName: 'admin' });
    const d = await s.service.detail('A1', actor, '1.2.3.4');
    expect(d.operator).toBe('alice');
    expect(d.operatorName).toBe('admin');
    // 只传 id 去查，不能拿 username 冒充 id
    expect(s.approvers.displayName).toHaveBeenCalledWith('alice');
  });

  it('反查不到时 operatorName 为 undefined，前端回落显示原值', async () => {
    const s = setup({ operatorName: null });
    const d = await s.service.detail('A1', actor, '1.2.3.4');
    expect(d.operatorName).toBeUndefined();
  });

  it('返回 templateId：控制台链接必须用模板 id，用运行实例 id 会落到列表页', async () => {
    // 实体里的 pipelineId 映射列 template_id（模板 id），与 approval.pipelineId（运行实例 id）同名不同义
    const s = setup({ pipeline: { pipelineId: 'TPL1' } });
    const d = await s.service.detail('A1', actor, '1.2.3.4');
    expect(d.pipelineId).toBe('P1');
    expect(d.templateId).toBe('TPL1');
  });

  it('旧运行缺 template_id 时 templateId 为 undefined，前端回落列表页而非拼出坏链接', async () => {
    const s = setup({ pipeline: { pipelineId: null } });
    const d = await s.service.detail('A1', actor, '1.2.3.4');
    expect(d.templateId).toBeUndefined();
  });

  it('非 prod 无需 confirm，可直接通过', async () => {
    const s = setup({ approval: makeApproval({ env: 'dev' }) });
    await expect(s.service.approve('A1', actor, {}, '1.2.3.4')).resolves.toMatchObject({
      status: 'approved',
    });
  });
});

/**
 * S5 运行结果快照（GET /wecom/approvals/:id/run）。
 * 关键约束：只读、白名单与 detail 一致、错误摘要必须脱敏、不得带出日志正文。
 */
describe('WecomApprovalService.runSnapshot（S5 只读运行结果）', () => {
  const runPipeline = {
    id: 'P1',
    pipelineId: 'TPL1',
    templateName: 'todo-service 发布',
    env: 'dev',
    moduleKey: 'todo-service',
    mode: 'direct',
    status: 'failed',
    stage: 'verify',
    versionTag: 'todo-service/abc1234',
    gitBranch: 'master',
    gitCommit: 'abc1234',
    triggerSource: 'ui',
    operator: 'alice',
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_060_000,
    progress: { current: 7, total: 9, message: '探活失败' },
    nodes: [
      { kind: 'shell', key: 'build', label: '构建' },
      { kind: 'approval', key: 'approve-1', label: '发布确认', approvers: ['bob'] },
      { kind: 'shell', key: 'verify', label: '探活' },
    ],
    error: 'health check failed: /home/ubuntu/deploy/verify.sh exit 1\nsecond line should be dropped',
    logs: ['SECRET-TOKEN=abc', '/home/ubuntu/deploy'],
  };

  it('返回只读快照：状态/节点/耗时齐全，且不含日志正文', async () => {
    const s = setup({ pipeline: runPipeline });
    const snap = await s.service.runSnapshot('A1', actor, '1.2.3.4');

    expect(snap).toMatchObject({
      runId: 'P1',
      approvalId: 'A1',
      templateId: 'TPL1',
      status: 'failed',
      stage: 'verify',
      env: 'dev',
      moduleKey: 'todo-service',
      live: false,
    });
    // 节点顺序与 key 原样给出（状态交给前端 stepState 推导，后端不复制展示状态机）
    expect(snap.stages.map((x) => x.key)).toEqual(['build', 'approve-1', 'verify']);
    expect(snap.endTime).toBe(1_700_000_060_000);
    // 脱敏：不得出现日志正文
    const raw = JSON.stringify(snap);
    expect(raw).not.toContain('SECRET-TOKEN');
    expect(raw).not.toContain('/home/ubuntu');
  });

  it('失败摘要只取首行、抹掉绝对路径、截断', async () => {
    const s = setup({ pipeline: runPipeline });
    const snap = await s.service.runSnapshot('A1', actor, '1.2.3.4');
    expect(snap.errorBrief).toBe('health check failed: <path> exit 1');
    expect(snap.errorBrief).not.toContain('second line');
  });

  it('运行中（running / awaiting-approval）标记 live=true，前端据此轮询', async () => {
    for (const status of ['running', 'awaiting-approval']) {
      const s = setup({ pipeline: { ...runPipeline, status } });
      const snap = await s.service.runSnapshot('A1', actor, '1.2.3.4');
      expect(snap.live).toBe(true);
    }
  });

  it('票据与单号不匹配 → 403（沿用 detail 的白名单校验）', async () => {
    const s = setup({ pipeline: runPipeline });
    await expect(
      s.service.runSnapshot('A1', { ...actor, approvalId: 'A2' }, '1.2.3.4'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('身份服务降级 → 403（fail-closed，只读也不放行）', async () => {
    const s = setup({ pipeline: runPipeline, gate: { ok: true, degraded: true, reason: 'unavailable' } });
    await expect(s.service.runSnapshot('A1', actor, '1.2.3.4')).rejects.toThrow(ForbiddenException);
  });

  it('通道关闭 → 404（端点语义上不存在）', async () => {
    const s = setup({ pipeline: runPipeline, enabled: false });
    await expect(s.service.runSnapshot('A1', actor, '1.2.3.4')).rejects.toThrow(NotFoundException);
  });

  it('审计落 wecom.viewRun，含运行 id 与状态', async () => {
    const s = setup({ pipeline: runPipeline });
    await s.service.runSnapshot('A1', actor, '1.2.3.4');
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wecom.viewRun',
        status: 'viewed',
        detail: expect.stringContaining('runId=P1'),
      }),
    );
  });

  it('旧实例无 nodes 时回落 steps 子集，且不因缺字段抛错', async () => {
    const s = setup({ pipeline: { ...runPipeline, nodes: null, steps: ['check', 'build'] } });
    const snap = await s.service.runSnapshot('A1', actor, '1.2.3.4');
    expect(snap.stages.map((x) => x.key)).toEqual(['check', 'build']);
  });
});
