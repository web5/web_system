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

  it('非 prod 无需 confirm，可直接通过', async () => {
    const s = setup({ approval: makeApproval({ env: 'dev' }) });
    await expect(s.service.approve('A1', actor, {}, '1.2.3.4')).resolves.toMatchObject({
      status: 'approved',
    });
  });
});
