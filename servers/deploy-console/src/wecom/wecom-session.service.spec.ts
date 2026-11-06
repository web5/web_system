import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ApprovalService } from '../approval/approval.service';
import { DeployApprovalEntity } from '../entities/deploy-approval.entity';
import { WecomActor } from './wecom-approval.service';
import { WecomConfigService } from './wecom.config';
import { WecomIdentityClient } from './wecom-identity.client';
import { WecomSessionService } from './wecom-session.service';

const actor: WecomActor = { username: 'admin', ext: 'WenZhui', approvalId: 'A1' };

function makeApproval(overrides: Partial<DeployApprovalEntity> = {}): DeployApprovalEntity {
  return {
    id: 'A1', pipelineId: 'P1', env: 'dev', moduleKey: 'todo-service', mode: 'direct',
    operator: '1', status: 'pending', createdAt: 1_700_000_000_000,
    channel: 'wecom', nodeKey: 'gate', nodeLabel: '发布确认',
    ...overrides,
  } as DeployApprovalEntity;
}

function setup(opts: {
  approval?: DeployApprovalEntity;
  resolved?:
    | { ok: true; identity: Record<string, unknown> }
    | { ok: false; reason: string };
  affected?: number;
  enabled?: boolean;
  signFails?: boolean;
} = {}) {
  const approval = opts.approval ?? makeApproval();
  const resolved = opts.resolved ?? {
    ok: true,
    identity: {
      userId: '1', username: 'admin', roles: ['admin'], systems: ['admin', 'deploy'],
    },
  };

  const config = { enabled: opts.enabled ?? true } as WecomConfigService;
  const approvals = { get: jest.fn().mockResolvedValue(approval) } as unknown as ApprovalService;
  const identity = {
    resolve: jest.fn().mockResolvedValue(resolved),
  } as unknown as WecomIdentityClient;
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const jwt = {
    signAsync: opts.signFails
      ? jest.fn().mockRejectedValue(new Error('sign boom'))
      : jest.fn().mockResolvedValue('platform.jwt.token'),
  };
  const repo = {
    query: jest.fn().mockResolvedValue({ affectedRows: opts.affected ?? 1 }),
  };

  const service = new WecomSessionService(
    config,
    approvals,
    identity,
    audit,
    jwt as never,
    repo as never,
  );
  return { service, approvals, identity, audit, jwt, repo, approval };
}

describe('WecomSessionService', () => {
  it('首次换取：签 30min 平台会话 + 写审计', async () => {
    const { service, jwt, audit, repo } = setup();
    const res = await service.exchange('A1', actor, '1.2.3.4', 1_700_000_000_000);

    expect(res.token).toBe('platform.jwt.token');
    expect(res.user).toEqual({ username: 'admin', role: 'admin' });
    expect(res.expiresInSec).toBe(1800);

    const [payload, options] = jwt.signAsync.mock.calls[0];
    expect(payload).toMatchObject({
      sub: '1', username: 'admin', roles: ['admin'], systems: ['admin', 'deploy'],
      type: 'access', via: 'wecom', approvalId: 'A1',
    });
    expect(options).toEqual({ expiresIn: 1800 });

    // 占位 SQL 必须是「仅当从未换过」的原子更新
    expect(repo.query.mock.calls[0][0]).toContain('wecom_session_issued_at IS NULL');
    expect(repo.query.mock.calls[0][1]).toEqual([1_700_000_000_000, 'A1']);

    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = (audit.log as jest.Mock).mock.calls[0][0];
    expect(entry.action).toBe('wecom.session');
    expect(entry.user).toBe('admin');
    expect(entry.detail).toContain('approvalId=A1');
    expect(entry.detail).toContain('identityExternalId=WenZhui');
    expect(entry.detail).toContain('sourceIp=1.2.3.4');
  });

  it('已换过（affectedRows=0）→ 409，且不再签 token', async () => {
    const { service, jwt, audit } = setup({ affected: 0 });
    await expect(service.exchange('A1', actor, '1.2.3.4')).rejects.toBeInstanceOf(ConflictException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('身份服务不可用 → 403 且不占位（保住唯一一次机会）', async () => {
    const { service, repo } = setup({ resolved: { ok: false, reason: 'unavailable' } });
    await expect(service.exchange('A1', actor, '1.2.3.4')).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.query).not.toHaveBeenCalled();
  });

  it('票据身份与解析出的身份不一致 → 403', async () => {
    const { service, jwt } = setup({
      resolved: {
        ok: true,
        identity: { userId: '9', username: 'someone-else', roles: ['admin'], systems: ['deploy'] },
      },
    });
    await expect(service.exchange('A1', actor, '1.2.3.4')).rejects.toThrow('票据身份与企微身份不一致');
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('账号不属于 deploy → 403（早失败，不让前端白屏）', async () => {
    const { service, jwt } = setup({
      resolved: { ok: true, identity: { userId: '1', username: 'admin', roles: [], systems: ['portal'] } },
    });
    await expect(service.exchange('A1', actor, '1.2.3.4')).rejects.toThrow('不属于运维控制台');
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('通道未启用 → 404', async () => {
    const { service, identity } = setup({ enabled: false });
    await expect(service.exchange('A1', actor, '1.2.3.4')).rejects.toBeInstanceOf(NotFoundException);
    expect(identity.resolve).not.toHaveBeenCalled();
  });

  it('票据与 URL 单号不匹配 → 403', async () => {
    const { service } = setup();
    await expect(service.exchange('A2', actor, '1.2.3.4')).rejects.toThrow('短令牌与审批单不匹配');
  });

  it('签发失败 → 500 且把占位回滚（否则这张单永远换不到）', async () => {
    const { service, repo } = setup({ signFails: true });
    await expect(service.exchange('A1', actor, '1.2.3.4')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    const rollback = repo.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('SET wecom_session_issued_at = NULL'),
    );
    expect(rollback).toBeTruthy();
    expect(rollback?.[1]).toEqual(['A1']);
  });

  it('兼容 affectedRows 出现在结果数组里的驱动', async () => {
    const { service, repo } = setup();
    repo.query.mockResolvedValue([{ affectedRows: 1 }]);
    await expect(service.exchange('A1', actor, '1.2.3.4')).resolves.toMatchObject({ expiresInSec: 1800 });
  });
});
