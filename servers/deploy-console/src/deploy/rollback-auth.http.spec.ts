import { randomBytes } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { AuthModule } from '../auth/auth.module';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { DeployController } from './deploy.controller';
import { DeployService } from './deploy.service';

describe('模块回滚 HTTP JWT 鉴权契约', () => {
  const secret = randomBytes(32).toString('hex');
  const deploy = { rollbackUnified: jest.fn() };
  const audit = { log: jest.fn() };
  const identity = { sub: 'test-owner', username: 'test-operator', roles: ['admin'], systems: ['deploy'], type: 'access' };
  const body = { env: 'prod', moduleKey: 'todo-service', to: 'test-only/checkpoint', confirm: true };
  let application: INestApplication;
  let jwt: JwtService;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, ignoreEnvVars: true, load: [() => ({ JWT_SECRET: secret })] }),
        AuthModule,
      ],
      controllers: [DeployController],
      providers: [
        { provide: DeployService, useValue: deploy },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    application = moduleRef.createNestApplication({ logger: false });
    application.setGlobalPrefix('api');
    application.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    application.useGlobalFilters(new AllExceptionsFilter());
    await application.listen(0, '127.0.0.1');
    baseUrl = await application.getUrl();
    jwt = application.get(JwtService);
  });

  beforeEach(() => {
    jest.resetAllMocks();
    deploy.rollbackUnified.mockResolvedValue({ moduleKey: 'todo-service', env: 'prod', from: 'test-only/current', to: body.to, mode: 'backend', source: 'explicit' });
    audit.log.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await application?.close();
  });

  async function request(token?: string, input: Record<string, unknown> = body) {
    const response = await fetch(`${baseUrl}/api/deploy/rollback-version`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json() };
  }

  function expectNoMutation() {
    expect(deploy.rollbackUnified).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  }

  it('缺少 Bearer 返回401，不能到达回滚或审计', async () => {
    expect((await request()).status).toBe(401);
    expectNoMutation();
  });

  it('畸形令牌返回401', async () => {
    expect((await request('not-a-jwt')).status).toBe(401);
    expectNoMutation();
  });

  it('错误签名返回401', async () => {
    const token = jwt.sign(identity, { secret: randomBytes(32).toString('hex') });
    expect((await request(token)).status).toBe(401);
    expectNoMutation();
  });

  it('过期令牌返回401', async () => {
    expect((await request(jwt.sign(identity, { expiresIn: -1 }))).status).toBe(401);
    expectNoMutation();
  });

  it('refresh 令牌不能当 access 令牌使用', async () => {
    expect((await request(jwt.sign({ ...identity, type: 'refresh' }))).status).toBe(401);
    expectNoMutation();
  });

  it('缺少用户名返回401', async () => {
    expect((await request(jwt.sign({ ...identity, username: undefined }))).status).toBe(401);
    expectNoMutation();
  });

  it.each([undefined, [], ['consumer'], 'deploy'])('非 deploy 系统身份返回403：%j', async systems => {
    const token = jwt.sign({ ...identity, systems });
    expect((await request(token, { ...body, username: 'admin', roles: ['super_admin'], systems: ['deploy'] })).status).toBe(403);
    expectNoMutation();
  });

  it.each([undefined, false, 'true'])('prod 必须显式传布尔 confirm=true：%j', async confirm => {
    expect((await request(jwt.sign(identity), { ...body, confirm })).status).toBe(400);
    expectNoMutation();
  });

  it.each([{ ...body, env: '' }, { ...body, moduleKey: '' }])('缺少环境或模块返回400：%j', async input => {
    expect((await request(jwt.sign(identity), input)).status).toBe(400);
    expectNoMutation();
  });

  it('合法 JWT 与 prod 确认进入模块回滚，操作人与审计只取认证身份', async () => {
    const response = await request(jwt.sign(identity), { ...body, operator: 'forged-owner', username: 'forged-user' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: 'rolled-back', from: 'test-only/current', to: body.to, mode: 'backend' });
    expect(deploy.rollbackUnified).toHaveBeenCalledTimes(1);
    expect(deploy.rollbackUnified).toHaveBeenCalledWith({ env: 'prod', moduleKey: 'todo-service', to: body.to, operator: identity.username });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ user: identity.username, action: 'deploy.rollback-version', env: 'prod', component: 'todo-service', status: 'success' }));
  });

  it('dev 合法身份可省略生产确认', async () => {
    expect((await request(jwt.sign(identity), { ...body, env: 'dev', confirm: undefined })).status).toBe(201);
    expect(deploy.rollbackUnified).toHaveBeenCalledWith({ env: 'dev', moduleKey: 'todo-service', to: body.to, operator: identity.username });
  });

  it('兼容未带 type 的既有合法令牌，但仍校验系统归属', async () => {
    expect((await request(jwt.sign({ ...identity, type: undefined }))).status).toBe(201);
    expect(deploy.rollbackUnified).toHaveBeenCalledTimes(1);
  });

  it('执行失败保留500，不记成功审计', async () => {
    deploy.rollbackUnified.mockRejectedValueOnce(new Error('test-only activation rejected'));
    expect((await request(jwt.sign(identity))).status).toBe(500);
    expect(deploy.rollbackUnified).toHaveBeenCalledTimes(1);
    expect(audit.log).not.toHaveBeenCalled();
  });
});
