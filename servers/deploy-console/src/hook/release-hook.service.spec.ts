import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { DeployReleaseEventEntity } from '../entities/deploy-release-event.entity';
import { DeployPipelineEntity } from '../entities/deploy-pipeline.entity';
import { PipelineService } from '../pipeline/pipeline.service';
import { MAX_SKEW_SEC, ReleaseHookService } from './release-hook.service';
import { ReleaseHookDto } from './release-hook.dto';

const SECRET = 'test-hook-secret';

function sign(body: string, ts: number, secret = SECRET): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
}

function makeService(opts: { secret?: string; existing?: DeployReleaseEventEntity } = {}) {
  const cfgGet = jest.fn((k: string) => (k === 'RELEASE_HOOK_SECRET' ? opts.secret : undefined));
  const cfg = { get: cfgGet } as unknown as ConfigService;

  const saved: DeployReleaseEventEntity[] = [];
  const repo = {
    findOne: jest.fn(async () => opts.existing ?? null),
    create: jest.fn((x: Partial<DeployReleaseEventEntity>) => x as DeployReleaseEventEntity),
    save: jest.fn(async (x: DeployReleaseEventEntity) => {
      saved.push(x);
      return x;
    }),
  } as unknown as Repository<DeployReleaseEventEntity>;

  const submitted: Array<{ dto: unknown; operator?: string }> = [];
  const pipeline = {
    submit: jest.fn(async (dto: unknown, operator?: string) => {
      submitted.push({ dto, operator });
      return { jobId: 'job-1', status: 'running' };
    }),
    // 实体字段故意多带 logs / result（含内部路径）：状态查询必须裁剪掉
    get: jest.fn(async (id: string) => ({
      id,
      status: 'running',
      stage: 'build',
      moduleKey: 'admin',
      env: 'local',
      versionTag: 'abc1234',
      progress: { current: 2, total: 3, message: '构建中 2/3' },
      logs: ['[build] 产物写入 /tmp/release-workspace/dist'],
      result: { artifactPath: '/tmp/release-workspace/dist' },
      endTime: undefined,
    })),
  } as unknown as PipelineService;

  return {
    svc: new ReleaseHookService(cfg, repo, pipeline),
    repo,
    submitted,
    saved,
    submitMock: pipeline.submit as unknown as jest.Mock,
    getMock: pipeline.get as unknown as jest.Mock,
  };
}

describe('ReleaseHookService · 签名校验', () => {
  it('签名与时间戳正确时通过', () => {
    const { svc } = makeService({ secret: SECRET });
    const body = '{"deliveryId":"d1"}';
    const ts = Math.floor(Date.now() / 1000);
    expect(() => svc.verifySignature(body, sign(body, ts), String(ts))).not.toThrow();
  });

  it('签名不符时拒绝（401）', () => {
    const { svc } = makeService({ secret: SECRET });
    const ts = Math.floor(Date.now() / 1000);
    expect(() => svc.verifySignature('{"a":1}', sign('{"b":2}', ts), String(ts))).toThrow(
      UnauthorizedException,
    );
  });

  it('时间戳超出窗口时拒绝（防重放）', () => {
    const { svc } = makeService({ secret: SECRET });
    const body = '{}';
    const ts = Math.floor(Date.now() / 1000) - (MAX_SKEW_SEC + 60);
    expect(() => svc.verifySignature(body, sign(body, ts), String(ts))).toThrow(
      UnauthorizedException,
    );
  });

  it('缺少签名头或时间戳头时拒绝', () => {
    const { svc } = makeService({ secret: SECRET });
    const ts = String(Math.floor(Date.now() / 1000));
    expect(() => svc.verifySignature('{}', undefined, ts)).toThrow(UnauthorizedException);
    expect(() => svc.verifySignature('{}', sign('{}', Number(ts)), undefined)).toThrow(
      UnauthorizedException,
    );
  });

  it('未配置 RELEASE_HOOK_SECRET 时端点不可用（拒绝所有请求）', () => {
    const { svc } = makeService({ secret: undefined });
    const ts = String(Math.floor(Date.now() / 1000));
    expect(() => svc.verifySignature('{}', sign('{}', Number(ts)), ts)).toThrow(
      UnauthorizedException,
    );
  });

  it('GET 查询用空请求体签名（与 CI 端 `ts + "."` 一致）', () => {
    const { svc } = makeService({ secret: SECRET });
    const ts = Math.floor(Date.now() / 1000);
    // CI 轮询据此计算：rawBody 为空串
    expect(() => svc.verifySignature('', sign('', ts), String(ts))).not.toThrow();
  });
});

describe('ReleaseHookService · 幂等受理', () => {
  const dto: ReleaseHookDto = {
    deliveryId: 'd-1',
    env: 'dev',
    moduleKey: 'admin',
    branch: 'master',
    source: 'release.yml',
  };

  it('首次投递：提交流水线且 operator 记为 ci:<source>', async () => {
    const { svc, submitted, saved } = makeService({ secret: SECRET });
    const r = await svc.handle(dto, JSON.stringify(dto));

    expect(submitted).toHaveLength(1);
    expect(submitted[0].operator).toBe('ci:release.yml');
    expect(r).toEqual({
      deliveryId: 'd-1',
      duplicate: false,
      jobId: 'job-1',
      status: 'running',
      approvalId: undefined,
    });
    expect(saved[0].status).toBe('accepted');
  });

  it('重复投递：不产生第二条流水线，返回首次结果', async () => {
    const existing = {
      deliveryId: 'd-1',
      pipelineId: 'job-0',
      status: 'accepted',
    } as DeployReleaseEventEntity;
    const { svc, submitted } = makeService({ secret: SECRET, existing });
    const r = await svc.handle(dto, JSON.stringify(dto));

    expect(submitted).toHaveLength(0);
    expect(r).toEqual({ deliveryId: 'd-1', duplicate: true, jobId: 'job-0', status: 'accepted' });
  });

  it('提交失败时留痕 rejected 并向上抛错', async () => {
    const { svc, saved, submitMock } = makeService({ secret: SECRET });
    submitMock.mockRejectedValueOnce(new Error('模块不存在'));

    await expect(svc.handle(dto, JSON.stringify(dto))).rejects.toThrow('模块不存在');
    expect(saved[0].status).toBe('rejected');
    expect(saved[0].reason).toContain('模块不存在');
  });
});

describe('ReleaseHookService · 状态查询（CI 轮询）', () => {
  it('只回必要字段：日志与产物路径不出网关', async () => {
    const { svc } = makeService({ secret: SECRET });
    const r = await svc.pipelineStatus('job-1');

    expect(r).toEqual({
      jobId: 'job-1',
      status: 'running',
      stage: 'build',
      moduleKey: 'admin',
      env: 'local',
      versionTag: 'abc1234',
      message: '构建中 2/3',
      endTime: undefined,
    });
    // 回归保护：曾把整实体回给 CI，把发布目录绝对路径与阶段日志一起泄了出去
    const payload = JSON.stringify(r);
    expect(payload).not.toContain('/tmp/release-workspace');
    expect(payload).not.toContain('logs');
    expect(payload).not.toContain('artifactPath');
  });

  it('流水线不存在时抛 404（而不是回空对象让 CI 误判）', async () => {
    const { svc, getMock } = makeService({ secret: SECRET });
    getMock.mockRejectedValueOnce(new NotFoundException('流水线不存在: 乱码'));
    await expect(svc.pipelineStatus('乱码')).rejects.toThrow(NotFoundException);
  });

  it('progress 缺失时 message 退化为空串（不返回 undefined 给 CI 解析）', async () => {
    const { svc, getMock } = makeService({ secret: SECRET });
    getMock.mockResolvedValueOnce({
      id: 'job-2',
      status: 'succeeded',
      moduleKey: 'user-service',
      env: 'local',
    } as DeployPipelineEntity);
    const r = await svc.pipelineStatus('job-2');
    expect(r.message).toBe('');
    expect(r.status).toBe('succeeded');
  });
});
