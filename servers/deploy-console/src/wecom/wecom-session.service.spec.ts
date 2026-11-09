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
  /** 起始已用次数（默认 0 = 从未换过） */
  sessionCount?: number;
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

  // 有状态的假 DB：让「次数上限 / 回退」在单测里真的成立，
  // 而不是靠一个固定 affectedRows 把三条 SQL 都糊过去（那就成了假绿）。
  let count = opts.sessionCount ?? 0;
  const repo = {
    query: jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('SELECT wecom_session_count')) return [{ n: count }];
      if (sql.includes('wecom_session_count = wecom_session_count + 1')) {
        if (count >= WecomSessionService.MAX_EXCHANGES) return { affectedRows: 0 };
        count += 1;
        return { affectedRows: 1 };
      }
      if (sql.includes('wecom_session_count = wecom_session_count - 1')) {
        if (count > 0) count -= 1;
        return { affectedRows: 1 };
      }
      return { affectedRows: opts.affected ?? 1 };
    }),
  };
  const countOf = () => count;

  const service = new WecomSessionService(
    config,
    approvals,
    identity,
    audit,
    jwt as never,
    repo as never,
  );
  return { service, approvals, identity, audit, jwt, repo, approval, countOf };
}

describe('WecomSessionService', () => {
  it('首次换取：签 30min 平台会话 + 写审计（第 1/3 次）', async () => {
    const { service, jwt, audit, repo, countOf } = setup();
    const res = await service.exchange('A1', actor, '1.2.3.4', 1_700_000_000_000);

    expect(res.token).toBe('platform.jwt.token');
    expect(res.user).toEqual({ username: 'admin', role: 'admin' });
    expect(res.expiresInSec).toBe(1800);
    expect(countOf()).toBe(1);

    const [payload, options] = jwt.signAsync.mock.calls[0];
    expect(payload).toMatchObject({
      sub: '1', username: 'admin', roles: ['admin'], systems: ['admin', 'deploy'],
      type: 'access', via: 'wecom', approvalId: 'A1',
    });
    expect(options).toEqual({ expiresIn: 1800 });

    // 占位 SQL 必须是「次数上限写进 WHERE」的原子更新，而不是先查后写
    expect(repo.query.mock.calls[0][0]).toContain('wecom_session_count = wecom_session_count + 1');
    expect(repo.query.mock.calls[0][0]).toContain('wecom_session_count < ?');
    expect(repo.query.mock.calls[0][1]).toEqual([
      1_700_000_000_000,
      'A1',
      WecomSessionService.MAX_EXCHANGES,
    ]);

    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = (audit.log as jest.Mock).mock.calls[0][0];
    expect(entry.action).toBe('wecom.session');
    expect(entry.user).toBe('admin');
    expect(entry.detail).toContain('第 1/3 次');
    expect(entry.detail).toContain('approvalId=A1');
    expect(entry.detail).toContain('identityExternalId=WenZhui');
    expect(entry.detail).toContain('sourceIp=1.2.3.4');
  });

  /**
   * 策略钉子：上限 3 是产品决策（凭据面暴露上限）。
   *
   * 🔴 没有这条，改 `MAX_EXCHANGES` 只会被几条「文案字符串」偶然挡住 ——
   * 边界用例若是用常量插值写的，循环上界会跟着常量一起漂移，永远绿（M1 实测）。
   */
  it('会话次数上限策略常量 = 3', () => {
    expect(WecomSessionService.MAX_EXCHANGES).toBe(3);
  });

  /** L4：第 1–3 次成功，第 4 次 409 —— 上限是硬边界，不是「差不多」 */
  it('同一张单第 1–3 次都成功，第 4 次 409（次数上限 3）', async () => {
    const { service, audit, countOf } = setup();
    // 🔴 边界写死 1..3 / 3，禁止用 MAX_EXCHANGES 插值：
    //    用常量插值时循环上界会跟着常量漂移，改上限这条用例照样绿（M1 假绿）。
    const LIMIT = 3;
    for (let i = 1; i <= LIMIT; i += 1) {
      await expect(service.exchange('A1', actor, '1.2.3.4')).resolves.toMatchObject({
        expiresInSec: 1800,
      });
      expect(countOf()).toBe(i);
      expect((audit.log as jest.Mock).mock.calls[i - 1][0].detail).toContain(`第 ${i}/${LIMIT} 次`);
    }
    await expect(service.exchange('A1', actor, '1.2.3.4')).rejects.toThrow('会话次数已用尽');
    expect(countOf()).toBe(LIMIT);
    expect(audit.log).toHaveBeenCalledTimes(LIMIT);
  });

  it('次数用尽（affectedRows=0）→ 409，且不再签 token', async () => {
    const { service, jwt, audit } = setup({ sessionCount: WecomSessionService.MAX_EXCHANGES });
    await expect(service.exchange('A1', actor, '1.2.3.4')).rejects.toThrow(ConflictException);
    await expect(service.exchange('A1', actor, '1.2.3.4')).rejects.toThrow('3/3');
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

  /** L5：签发失败必须把次数退回去，否则这张单被白扣一次配额 */
  it('签发失败 → 500 且把次数回退（配额不被白扣）', async () => {
    const { service, repo, countOf } = setup({ signFails: true });
    await expect(service.exchange('A1', actor, '1.2.3.4')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    const rollback = repo.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('wecom_session_count = wecom_session_count - 1'),
    );
    expect(rollback).toBeTruthy();
    expect(rollback?.[1]).toEqual(['A1']);
    // 有状态假 DB 上真的回到了 0，而不是只检查 SQL 文本
    expect(countOf()).toBe(0);
  });

  it('回退后仍可再次换取（次数没有被白扣）', async () => {
    const { service, jwt, countOf } = setup({ signFails: true });
    await expect(service.exchange('A1', actor, '1.2.3.4')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(countOf()).toBe(0);
    // 换成能签的 jwt 再来一次：应当是第 1/3 次，而不是第 2/3 次
    (jwt.signAsync as jest.Mock).mockResolvedValue('platform.jwt.token');
    await expect(service.exchange('A1', actor, '1.2.3.4')).resolves.toMatchObject({
      token: 'platform.jwt.token',
    });
    expect(countOf()).toBe(1);
  });

  it('兼容 affectedRows 出现在结果数组里的驱动', async () => {
    const { service, repo } = setup();
    // 用宽松句柄重写实现，模拟 mysql2 在部分配置下把 UPDATE 结果包成数组
    (repo.query as unknown as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT wecom_session_count')) return [{ n: 0 }];
      return [{ affectedRows: 1 }];
    });
    await expect(service.exchange('A1', actor, '1.2.3.4')).resolves.toMatchObject({ expiresInSec: 1800 });
  });
});
