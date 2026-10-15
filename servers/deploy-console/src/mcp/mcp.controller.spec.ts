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
    await call({ env: 'prod', moduleKey: 'admin', confirm: true, commitId: 'abc1234' });
    expect(submit).toHaveBeenCalledTimes(1);
    // 放行时同样要把 commit 传下去：prod 是最不能发错版本的场景
    expect(submit.mock.calls[0][0].commitId).toBe('abc1234');
  });
});
