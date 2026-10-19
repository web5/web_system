import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApproverService } from '../approval/approver.service';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { DeployService } from '../deploy/deploy.service';
import { FactCollectService } from '../fact/fact-collect.service';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { ReleasePlanService } from '../release-plan/release-plan.service';
import { ReleaseVerifyService } from '../release-verify/release-verify.service';
import { McpAuthService } from './mcp-auth.service';
import { McpController } from './mcp.controller';

describe('MCP 验证与模块回滚 HTTP 契约', () => {
  const moduleRepo = { findOne: jest.fn() };
  const appRepo = { findOne: jest.fn() };
  const serviceRepo = { findOne: jest.fn() };
  const facts = { collect: jest.fn() };
  const pipelines = { submit: jest.fn() };
  const auth = { verifyKey: jest.fn() };
  const deploy = { startRollback: jest.fn() };
  let application: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const registry = new ModuleRegistryService(moduleRepo as never, appRepo as never, serviceRepo as never);
    const verify = new ReleaseVerifyService(registry, {} as never, pipelines as never, facts as unknown as FactCollectService);
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: PipelineService, useValue: pipelines },
        { provide: DeployService, useValue: deploy },
        { provide: ApproverService, useValue: {} },
        { provide: ReleasePlanService, useValue: {} },
        { provide: ReleaseVerifyService, useValue: verify },
        { provide: McpAuthService, useValue: auth },
      ],
    }).compile();
    application = moduleRef.createNestApplication({ logger: false });
    application.setGlobalPrefix('api');
    application.useGlobalFilters(new AllExceptionsFilter());
    await application.listen(0, '127.0.0.1');
    baseUrl = await application.getUrl();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    moduleRepo.findOne.mockResolvedValue(null);
    appRepo.findOne.mockResolvedValue(null);
    serviceRepo.findOne.mockResolvedValue(null);
    auth.verifyKey.mockResolvedValue({ valid: true, ownerId: 'test-owner', keyId: 'test-key' });
    deploy.startRollback.mockResolvedValue('module-rollback-task');
  });

  afterAll(async () => {
    await application?.close();
  });

  async function request(
    authenticated = true,
    route = 'release-verify',
    body: Record<string, unknown> = { env: 'dev', moduleKey: 'missing' },
  ) {
    return fetch(`${baseUrl}/api/mcp/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authenticated ? { 'x-mcp-key': 'test-only-key' } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  }

  it('无凭据仍返回 401，不触发注册表或事实查询', async () => {
    const response = await request(false);
    expect(response.status).toBe(401);
    await response.json();
    expect(auth.verifyKey).not.toHaveBeenCalled();
    expect(serviceRepo.findOne).not.toHaveBeenCalled();
    expect(facts.collect).not.toHaveBeenCalled();
  });

  it('认证后不存在模块返回 404，原错误文案保留且不采集或发布', async () => {
    const response = await request();
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ statusCode: 404, message: '模块不存在: missing' });
    expect(auth.verifyKey).toHaveBeenCalledWith('test-only-key');
    expect(facts.collect).not.toHaveBeenCalled();
    expect(pipelines.submit).not.toHaveBeenCalled();
  });

  it('数据库异常仍为 500，不能伪装成模块不存在', async () => {
    serviceRepo.findOne.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await request();
    expect(response.status).toBe(500);
    await response.json();
    expect(facts.collect).not.toHaveBeenCalled();
    expect(pipelines.submit).not.toHaveBeenCalled();
  });

  it.each([
    { env: 'dev', versionTag: 'versionB' },
    { env: 'dev', versionTag: 'versionB', component: '' },
    { env: 'dev', versionTag: '../versionB', component: 'admin' },
    { env: 'dev', versionTag: 'versionB', component: '../admin' },
    { env: 'dev/invalid', versionTag: 'versionB', component: 'admin' },
    { env: 'prod', versionTag: 'versionB', component: 'admin' },
  ])('不安全模块回滚参数返回 400，且不创建任务：%j', async body => {
    const response = await request(true, 'rollback', body);
    expect(response.status).toBe(400);
    await response.json();
    expect(deploy.startRollback).not.toHaveBeenCalled();
  });

  it('模块回滚仍受 MCP 凭据保护', async () => {
    const response = await request(false, 'rollback', { env: 'dev', versionTag: 'versionB', component: 'admin' });
    expect(response.status).toBe(401);
    await response.json();
    expect(deploy.startRollback).not.toHaveBeenCalled();
  });

  it('合法回滚保留 taskId 契约，操作者取认证身份而非 body', async () => {
    const response = await request(true, 'rollback', {
      env: 'dev', versionTag: 'default/versionB', component: 'admin', operator: 'forged-owner',
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ taskId: 'module-rollback-task', status: 'started', env: 'dev' });
    expect(deploy.startRollback).toHaveBeenCalledWith('dev', 'default/versionB', 'test-owner', 'admin');
  });

  it('prod 回滚仍必须显式确认且带模块', async () => {
    const response = await request(true, 'rollback', {
      env: 'prod', versionTag: 'versionB', component: 'admin', confirm: true,
    });
    expect(response.status).toBe(201);
    await response.json();
    expect(deploy.startRollback).toHaveBeenCalledWith('prod', 'versionB', 'test-owner', 'admin');
  });
});
