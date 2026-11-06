import { ConfigService } from '@nestjs/config';
import { ApprovalService, APPROVAL_TTL_MS } from '../approval/approval.service';
import { AuditService } from '../audit/audit.service';
import { DeployApprovalEntity } from '../entities/deploy-approval.entity';
import { PipelineService } from '../pipeline/pipeline.service';
import { ApprovalExpiryService, SYSTEM_ACTOR } from './approval-expiry.service';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function makeRow(overrides: Partial<DeployApprovalEntity> = {}): DeployApprovalEntity {
  return {
    id: 'A1',
    pipelineId: 'P1',
    env: 'prod',
    moduleKey: 'admin',
    mode: 'direct',
    operator: 'alice',
    status: 'pending',
    createdAt: NOW - 8 * DAY,
    expiresAt: NOW - DAY,
    channel: 'wecom',
    nodeKey: 'approve-1',
    ...overrides,
  } as DeployApprovalEntity;
}

function setup(opts: {
  expired?: DeployApprovalEntity[];
  pipelineCancel?: 'ok' | 'terminal' | 'throws';
  closeFails?: boolean;
  /** approvals.get 返回的单据状态（决定兜底是否触发） */
  afterStatus?: 'pending' | 'cancelled';
} = {}) {
  const rows = opts.expired ?? [makeRow()];
  const approvals = {
    findExpiredPending: jest.fn().mockResolvedValue(rows),
    get: jest.fn(async (id: string) => {
      const found = rows.find((r) => r.id === id) ?? makeRow({ id });
      return { ...found, status: opts.afterStatus ?? 'pending' };
    }),
    cancel: opts.closeFails
      ? jest.fn().mockRejectedValue(new Error('close boom'))
      : jest.fn().mockResolvedValue({}),
  } as unknown as ApprovalService;

  const pipelines = {
    cancel: jest.fn(async (id: string) => {
      if (opts.pipelineCancel === 'throws') throw new Error('发布已进入产物交付阶段，不允许中断');
      if (opts.pipelineCancel === 'terminal') return { id, status: 'failed' };
      return { id, status: 'cancelled' };
    }),
  } as unknown as PipelineService;

  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const cfg = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;

  const service = new ApprovalExpiryService(cfg, approvals, pipelines, audit);
  return { service, approvals, pipelines, audit, rows };
}

describe('ApprovalExpiryService（审批单超时作废）', () => {
  /** L7：过期 pending 单被作废，且流水线同步终止 */
  it('过期单 → 走 PipelineService.cancel（传 pipelineId 而非审批单号）+ 记账 approval.expire', async () => {
    const s = setup();
    const report = await s.service.sweep(NOW);

    expect(report).toMatchObject({ scanned: 1, expired: 1, failed: 0, pipelineCancelled: 1 });

    // 🔴 必须传流水线 id。传成审批单 id 会静默取消不掉（cancel 里 get 会 404）
    expect(s.pipelines.cancel).toHaveBeenCalledWith('P1', SYSTEM_ACTOR, expect.stringContaining('审批超时作废'));
    expect((s.pipelines.cancel as jest.Mock).mock.calls[0][2]).toContain('7 天');

    // 流水线 cancel 已联动关单 → 兜底不应重复作废
    const auditEntry = (s.audit.log as jest.Mock).mock.calls.find(
      (c) => c[0]?.action === 'approval.expire',
    );
    expect(auditEntry).toBeTruthy();
    expect(auditEntry?.[0]).toMatchObject({
      user: SYSTEM_ACTOR,
      env: 'prod',
      component: 'admin',
      status: 'cancelled',
    });
    expect(auditEntry?.[0].detail).toContain('单号 A1');
    expect(auditEntry?.[0].detail).toContain('已超时 24h');
    expect(auditEntry?.[0].detail).toContain('pipelineId=P1');
  });

  it('流水线已终态（cancel 不联动关单）→ 兜底用 ApprovalService.cancel 关掉这张单', async () => {
    const s = setup({ pipelineCancel: 'terminal' });
    const report = await s.service.sweep(NOW);

    expect(report).toMatchObject({ scanned: 1, expired: 1, pipelineCancelled: 0 });
    expect(s.approvals.cancel).toHaveBeenCalledWith(
      'A1',
      expect.stringContaining('审批超时作废'),
      SYSTEM_ACTOR,
    );
  });

  /**
   * 🔴 审计里的「流水线状态」必须是**本行**结论，不能拿整批累计计数去填。
   * 用 `report.pipelineCancelled` 时：同轮第 1 张取消成功后，第 2 张
   * （流水线已终态、根本没取消）也会被写成「已联动取消」—— 审计失真。
   */
  it('审计的「流水线状态」按单行判断，同轮第 2 张不串味', async () => {
    const rows = [
      makeRow({ id: 'A1', pipelineId: 'P1' }),
      makeRow({ id: 'A2', pipelineId: 'P2' }),
    ];
    const s = setup({ expired: rows });
    (s.pipelines.cancel as jest.Mock).mockImplementation(async (id: string) =>
      id === 'P1' ? { id, status: 'cancelled' } : { id, status: 'failed' },
    );

    const report = await s.service.sweep(NOW);
    expect(report).toMatchObject({ scanned: 2, expired: 2, pipelineCancelled: 1 });

    const details = (s.audit.log as jest.Mock).mock.calls
      .filter((c) => c[0]?.action === 'approval.expire')
      .map((c) => String(c[0].detail));
    expect(details).toHaveLength(2);

    const d1 = details.find((d) => d.includes('单号 A1')) ?? '';
    const d2 = details.find((d) => d.includes('单号 A2')) ?? '';
    expect(d1).toContain('流水线状态=已联动取消');
    expect(d2).toContain('流水线状态=未取消');
  });

  it('已经关掉的单不重复作废（幂等：cancel 已联动时兜底是空操作）', async () => {
    const s = setup({ afterStatus: 'cancelled' });
    await s.service.sweep(NOW);
    expect(s.approvals.cancel).not.toHaveBeenCalled();
  });

  it('取消流水线抛错（禁止中断）→ 仍然关单，不算失败', async () => {
    const s = setup({ pipelineCancel: 'throws' });
    const report = await s.service.sweep(NOW);

    expect(s.approvals.cancel).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ expired: 1, failed: 0 });
  });

  it('单条失败不中断整批：第一张关单失败，第二张照常作废', async () => {
    const rows = [makeRow({ id: 'A1' }), makeRow({ id: 'A2', pipelineId: 'P2' })];
    const s = setup({ expired: rows, closeFails: true, afterStatus: 'pending' });
    // 只让 A1 的关单失败
    (s.approvals.cancel as jest.Mock).mockImplementation(async (id: string) => {
      if (id === 'A1') throw new Error('close boom');
      return {};
    });

    const report = await s.service.sweep(NOW);
    expect(report).toMatchObject({ scanned: 2, expired: 1, failed: 1 });
    // 两条流水线都被尝试取消（失败不影响下一张）
    expect(s.pipelines.cancel).toHaveBeenCalledTimes(2);
  });

  it('没有过期单 → 一条 SQL 就结束，不调用 cancel', async () => {
    const s = setup({ expired: [] });
    const report = await s.service.sweep(NOW);
    expect(report).toMatchObject({ scanned: 0, expired: 0, failed: 0 });
    expect(s.pipelines.cancel).not.toHaveBeenCalled();
    expect(s.audit.log).not.toHaveBeenCalled();
  });

  it('防重入：上一轮没跑完时再调，直接返回上一轮结果，不叠着扫', async () => {
    const s = setup();
    let release: (v: unknown) => void = () => undefined;
    (s.approvals.findExpiredPending as jest.Mock).mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );
    const first = s.service.sweep(NOW);
    // 第一次还在等 DB 时再进来
    const second = await s.service.sweep(NOW);
    expect(second).toMatchObject({ scanned: 0, expired: 0 });
    release([]);
    await expect(first).resolves.toMatchObject({ scanned: 0 });
  });

  it('暴露最近一次报告，便于排障（report()）', async () => {
    const s = setup();
    expect(s.service.report()).toBeUndefined();
    await s.service.sweep(NOW);
    expect(s.service.report()).toMatchObject({ scanned: 1, expired: 1 });
  });

  it('TTL 常量是 7 天（改它等于改策略，必须有意识）', () => {
    expect(APPROVAL_TTL_MS).toBe(7 * DAY);
  });
});
