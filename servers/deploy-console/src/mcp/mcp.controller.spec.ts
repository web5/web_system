/**
 * MCP 发布控制器：入参转发契约。
 *
 * 只锁一件事：**网关声明了的参数，必须原样转发到服务层**。
 *
 * 背景（2026-10-15）：mcp-gateway 的 `publish_pipeline` 声明了 `branch` / `commitId`，
 * Agent 会照着声明认真传；但本控制器早前转发给 `PipelineService.submit` 时把这两个
 * 字段漏掉了 → 请求 200、流水线照跑、**发布到默认分支 master 的最新 commit**，
 * 而不是调用方指定的版本。全程没有任何失败信号，事故要等上线后才发现。
 *
 * 「声明了却不生效」比「没声明」更坏：后者 Agent 会换个办法，前者它以为自己成功了。
 * 这个测试把这条转发链钉死，配合 `mcp-tool-declaration.spec.ts`（守住声明侧）形成闭环。
 */
import { Test } from '@nestjs/testing';
import { McpController } from './mcp.controller';
import { McpAuthService } from './mcp-auth.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { DeployService } from '../deploy/deploy.service';
import { ApproverService } from '../approval/approver.service';
import { ReleasePlanService } from '../release-plan/release-plan.service';
import { ReleaseVerifyService } from '../release-verify/release-verify.service';

describe('McpController.submitPipeline（入参转发）', () => {
  let controller: McpController;
  let submit: jest.Mock;

  beforeEach(async () => {
    submit = jest.fn(async () => ({ jobId: 'job-1', status: 'pending' }));

    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: PipelineService, useValue: { submit } },
        {
          provide: DeployService,
          useValue: { listModules: jest.fn(), getCurrentVersions: jest.fn() },
        },
        { provide: ApproverService, useValue: { list: jest.fn(async () => ({ users: [] })) } },
        { provide: ReleasePlanService, useValue: { plan: jest.fn() } },
        { provide: ReleaseVerifyService, useValue: { verify: jest.fn() } },
        // 直调控制器方法，不执行 guard；但 `@UseGuards(McpKeyGuard)` 的元数据要求
        // Nest 能**构造**出这个守卫，故补上它依赖的 McpAuthService 桩
        { provide: McpAuthService, useValue: { verifyKey: jest.fn() } },
      ],
    }).compile();

    controller = moduleRef.get(McpController);
  });

  /** 绕过 guard 直调控制器；req.mcpOperator 由 operator() 读取 */
  const call = (body: unknown) => controller.submitPipeline(body as any, { mcpOperator: 'tester' } as any);

  it('branch / commitId 必须原样转发（漏转会静默发布到 master 最新提交）', async () => {
    await call({
      env: 'dev',
      moduleKey: 'admin',
      branch: 'release/1.2',
      commitId: 'abc1234',
    });

    expect(submit).toHaveBeenCalledTimes(1);
    const dto = submit.mock.calls[0][0];
    expect(dto.branch).toBe('release/1.2');
    expect(dto.commitId).toBe('abc1234');
  });

  it('其余入参同样不得丢失', async () => {
    await call({
      env: 'dev',
      moduleKey: 'admin',
      mode: 'grayscale',
      versionTag: 'v1',
      target: 'remote',
      grayscaleRule: { type: 'percent', value: 10 },
    });

    const dto = submit.mock.calls[0][0];
    expect(dto).toMatchObject({
      env: 'dev',
      moduleKey: 'admin',
      mode: 'grayscale',
      versionTag: 'v1',
      target: 'remote',
      grayscaleRule: { type: 'percent', value: 10 },
    });
  });

  it('prod 未传 confirm=true 一律拒绝（不进入服务层）', async () => {
    await expect(call({ env: 'prod', moduleKey: 'admin' })).rejects.toThrow(/confirm=true/);
    expect(submit).not.toHaveBeenCalled();
  });

  it('prod 传了 confirm=true 才放行', async () => {
    await call({
      env: 'prod',
      moduleKey: 'admin',
      confirm: true,
      branch: 'master',
      commitId: 'abc1234',
    });
    expect(submit).toHaveBeenCalledTimes(1);
    // 放行时同样要把 commit 传下去：prod 是最不能发错版本的场景
    expect(submit.mock.calls[0][0].commitId).toBe('abc1234');
  });

  // ── 版本定位硬校验：转发对了还不够，漏传必须报错 ──
  // 只做转发时，调用方漏传 branch/commitId 会静默发到默认分支最新提交：
  // 请求 200、零失败信号，事故上线后才发现（2026-10-20 实测踩到）。

  it('缺 branch 直接拒绝（不进入服务层）', async () => {
    await expect(call({ env: 'dev', moduleKey: 'admin', commitId: 'abc1234' })).rejects.toThrow(
      /branch 与 commitId 必须显式传入/,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('缺 commitId 直接拒绝（不进入服务层）', async () => {
    await expect(call({ env: 'dev', moduleKey: 'admin', branch: 'master' })).rejects.toThrow(
      /branch 与 commitId 必须显式传入/,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('两个都缺（只给 env + moduleKey）同样拒绝', async () => {
    await expect(call({ env: 'dev', moduleKey: 'admin' })).rejects.toThrow(
      /branch 与 commitId 必须显式传入/,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('空串不算显式传入', async () => {
    await expect(
      call({ env: 'dev', moduleKey: 'admin', branch: '  ', commitId: 'abc1234' }),
    ).rejects.toThrow(/branch 与 commitId 必须显式传入/);
    expect(submit).not.toHaveBeenCalled();
  });

  it('显式传 versionTag 发布既有产物时不需要 branch / commitId', async () => {
    await call({ env: 'dev', moduleKey: 'admin', versionTag: 'admin-dev/abc1234' });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

/**
 * triggerSource 强制并入（2026-10-27 防再犯 S1）。
 *
 * 背景：两轮非预期 PROD 批量发布经 MCP Key 通道提交 + 自动审批一体触发，
 * operator=1 无法区分「哪把 Key/谁的会话」。MCP 通道必须把 Key 名并入触发来源，
 * 且**不可被调用方抹掉** —— 本组测试钉死强制段。
 */
describe('McpController.submitPipeline（triggerSource 强制并入 Key 名）', () => {
  let controller: McpController;
  let submit: jest.Mock;

  beforeEach(async () => {
    submit = jest.fn(async () => ({ jobId: 'job-1', status: 'pending' }));
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: PipelineService, useValue: { submit } },
        {
          provide: DeployService,
          useValue: { listModules: jest.fn(), getCurrentVersions: jest.fn() },
        },
        { provide: ApproverService, useValue: { list: jest.fn(async () => ({ users: [] })) } },
        { provide: ReleasePlanService, useValue: { plan: jest.fn() } },
        { provide: ReleaseVerifyService, useValue: { verify: jest.fn() } },
        { provide: McpAuthService, useValue: { verifyKey: jest.fn() } },
      ],
    }).compile();
    controller = moduleRef.get(McpController);
  });

  const call = (body: unknown, req: any) =>
    controller.submitPipeline(body as any, req as any);

  const baseBody = {
    env: 'dev',
    moduleKey: 'admin',
    branch: 'master',
    commitId: 'abc1234',
  };

  it('缺省 → mcp:<keyName>（Key 名强制在场）', async () => {
    await call(baseBody, {
      mcpOperator: '1',
      mcpKeyInfo: { ownerId: '1', keyName: 'ai-ops-automation' },
    });
    const dto = submit.mock.calls[0][0];
    expect(dto.triggerSource).toBe('mcp:ai-ops-automation');
  });

  it('调用方传了 triggerSource 也抹不掉 Key 名：拼成 <body>|mcp:<keyName>', async () => {
    await call(
      { ...baseBody, triggerSource: 'web|sess-1' },
      { mcpOperator: '1', mcpKeyInfo: { ownerId: '1', keyName: 'ai-ops-automation' } },
    );
    const dto = submit.mock.calls[0][0];
    expect(dto.triggerSource).toBe('web|sess-1|mcp:ai-ops-automation');
  });

  it('keyName 缺失 → mcp:unknown（不静默丢通道）', async () => {
    await call(baseBody, { mcpOperator: '1' });
    const dto = submit.mock.calls[0][0];
    expect(dto.triggerSource).toBe('mcp:unknown');
  });

  it('非法 triggerSource（含空格）直接 400，不进服务层', async () => {
    await expect(
      call(
        { ...baseBody, triggerSource: 'has space' },
        { mcpOperator: '1', mcpKeyInfo: { ownerId: '1', keyName: 'k' } },
      ),
    ).rejects.toThrow(/triggerSource/);
    expect(submit).not.toHaveBeenCalled();
  });
});

/**
 * S2：prod 去 auto-approve（2026-10-27 防再犯）。
 *
 * 背景：`/tmp/prod-deploy.sh` 式脚本经 MCP 通道提交后用 confirm=true 自动审批，
 * 两轮非预期 PROD 批量发布由此触发。prod 必须人工审批（控制台），
 * MCP 通道 approve 对 prod 一律拒绝；reject 保留（拒绝不放行，风险方向不同）。
 */
describe('McpController.approvePipeline / rejectPipeline（prod 去 auto-approve）', () => {
  let controller: McpController;
  let approve: jest.Mock;
  let reject: jest.Mock;
  let get: jest.Mock;

  const makePipeline = (env: string) => ({
    id: 'job-1',
    env,
    moduleKey: 'admin',
    operator: '1',
    status: 'pending-approval',
    triggerSource: 'mcp:ai-ops-automation',
  });

  beforeEach(async () => {
    approve = jest.fn(async () => ({ id: 'job-1', status: 'approved' }));
    reject = jest.fn(async () => ({ id: 'job-1', status: 'rejected' }));
    get = jest.fn(async () => makePipeline('prod'));
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: PipelineService, useValue: { submit: jest.fn(), approve, reject, get } },
        {
          provide: DeployService,
          useValue: { listModules: jest.fn(), getCurrentVersions: jest.fn() },
        },
        // reviewerOf 会调 list() 把 ownerId 解析成用户名；返回 admin 便于断言
        {
          provide: ApproverService,
          useValue: {
            list: jest.fn(async () => ({
              users: [{ id: 1, username: 'admin' }],
            })),
          },
        },
        { provide: ReleasePlanService, useValue: { plan: jest.fn() } },
        { provide: ReleaseVerifyService, useValue: { verify: jest.fn() } },
        { provide: McpAuthService, useValue: { verifyKey: jest.fn() } },
      ],
    }).compile();
    controller = moduleRef.get(McpController);
  });

  const req = {
    mcpOperator: '1',
    mcpKeyInfo: { ownerId: '1', keyName: 'ai-ops-automation' },
  };

  it('prod + confirm=true 也拒绝（不再走放行）——错误信息可读', async () => {
    await expect(
      controller.approvePipeline(
        'job-1',
        { comment: 'auto', confirm: true },
        req as any,
      ),
    ).rejects.toThrow(/prod 环境必须人工审批/);
    await expect(
      controller.approvePipeline('job-1', { confirm: true }, req as any),
    ).rejects.toThrow(/MCP 通道不允许审批 prod/);
    expect(approve).not.toHaveBeenCalled();
  });

  it('prod 未传 confirm 同样拒绝（拒绝发生在 confirm 判定之前）', async () => {
    await expect(
      controller.approvePipeline('job-1', { comment: 'x' }, req as any),
    ).rejects.toThrow(/prod 环境必须人工审批/);
    expect(approve).not.toHaveBeenCalled();
  });

  it('dev 非 prod 环境 MCP approve 正常放行（自动化 dev 发布仍可用）', async () => {
    get.mockResolvedValueOnce(makePipeline('dev'));
    const r = await controller.approvePipeline(
      'job-1',
      { comment: 'dev ok' },
      req as any,
    );
    expect(r.status).toBe('approved');
    expect(approve).toHaveBeenCalledTimes(1);
    // 审批通道写进服务层（审计用）：mcp:<keyName>
    expect(approve.mock.calls[0][4]).toBe('mcp:ai-ops-automation');
    // 审批人由 ownerId 解析成用户名
    expect(approve.mock.calls[0][1]).toBe('admin');
  });

  it('MCP reject prod 仍可用（拒绝不放行，风险方向不同）', async () => {
    const r = await controller.rejectPipeline(
      'job-1',
      { comment: 'prod 异常，叫停' },
      req as any,
    );
    expect(r.status).toBe('rejected');
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][4]).toBe('mcp:ai-ops-automation');
  });

  it('reject 仍强制填意见（与控制台同语义）', async () => {
    await expect(
      controller.rejectPipeline('job-1', { comment: '  ' }, req as any),
    ).rejects.toThrow(/拒绝必须填写审批意见/);
    expect(reject).not.toHaveBeenCalled();
  });
});

describe('McpController.getPipeline（triggerSource 查询出口）', () => {
  it('返回体含 triggerSource（归因检索用）', async () => {
    const get = jest.fn(async () => ({
      id: 'job-1',
      env: 'prod',
      moduleKey: 'admin',
      versionTag: 'abc',
      mode: 'direct',
      status: 'succeeded',
      stage: 'verify',
      progress: { current: 9, total: 9, message: 'done' },
      logs: [],
      error: undefined,
      result: undefined,
      operator: '1',
      triggerSource: 'mcp:ai-ops-automation',
      startTime: 1,
      endTime: 2,
    }));
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        { provide: PipelineService, useValue: { get } },
        {
          provide: DeployService,
          useValue: { listModules: jest.fn(), getCurrentVersions: jest.fn() },
        },
        { provide: ApproverService, useValue: { list: jest.fn(async () => ({ users: [] })) } },
        { provide: ReleasePlanService, useValue: { plan: jest.fn() } },
        { provide: ReleaseVerifyService, useValue: { verify: jest.fn() } },
        { provide: McpAuthService, useValue: { verifyKey: jest.fn() } },
      ],
    }).compile();
    const controller = moduleRef.get(McpController);
    const r = await controller.getPipeline('job-1', {
      mcpOperator: '1',
    } as any);
    expect(r.triggerSource).toBe('mcp:ai-ops-automation');
  });
});
