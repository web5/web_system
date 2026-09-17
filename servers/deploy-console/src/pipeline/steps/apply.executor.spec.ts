import { ApplyExecutor } from './apply.executor';
import { resolveServiceStep, SERVICE_TOOL_TO_STEP } from './service-tools';
import { StepContext } from './step.types';
import { DeployService } from '../../deploy/deploy.service';

/** 最小 StepContext（记录调用，不落库） */
function ctxOf(p: any): { ctx: StepContext; stageMessages: string[]; logs: string[] } {
  const stageMessages: string[] = [];
  const logs: string[] = [];
  const ctx = {
    pipeline: p,
    uploadTarget: 'local' as const,
    enterStage: jest.fn(async (m: string) => {
      stageMessages.push(m);
    }),
    log: jest.fn((l: string) => logs.push(l)),
    save: jest.fn(async () => undefined),
    sleep: jest.fn(async () => undefined),
    assertNotCancelled: jest.fn(),
  } as unknown as StepContext;
  return { ctx, stageMessages, logs };
}

describe('ApplyExecutor（后台部署生效：版本目录 → dist + 切指针）', () => {
  const deploy = { deployVersion: jest.fn() } as unknown as DeployService;
  const executor = new ApplyExecutor(deploy);

  const pipeline = {
    id: 'pipe-1',
    moduleKey: 'gateway',
    moduleType: 'backend',
    env: 'local',
    versionTag: 'gateway-local/abc1234',
    operator: 'tester',
  };

  it('调用 DeployService.deployVersion 并写日志', async () => {
    (deploy.deployVersion as jest.Mock).mockResolvedValue({
      env: 'local',
      moduleKey: 'gateway',
      versionTag: 'gateway-local/abc1234',
    });
    const { ctx, stageMessages, logs } = ctxOf(pipeline);

    await executor.run(ctx);

    expect(deploy.deployVersion).toHaveBeenCalledWith({
      moduleKey: 'gateway',
      env: 'local',
      versionTag: 'gateway-local/abc1234',
      operator: 'tester',
    });
    expect(stageMessages.some((m) => m.includes('部署生效'))).toBe(true);
    expect(logs.join('\n')).toContain('已生效');
    expect(ctx.save).toHaveBeenCalled();
  });

  it('版本号为空 → 报错（不让 deployVersion 拿到空版本）', async () => {
    const { ctx } = ctxOf({ ...pipeline, versionTag: undefined });
    await expect(executor.run(ctx)).rejects.toThrow(/版本号为空/);
  });

  it('deployVersion 失败 → 向上抛（流水线按 fail-fast 处理，不做部分生效）', async () => {
    (deploy.deployVersion as jest.Mock).mockRejectedValue(new Error('版本目录是空的'));
    const { ctx } = ctxOf(pipeline);
    await expect(executor.run(ctx)).rejects.toThrow(/版本目录是空的/);
  });

  it('tool 名 apply-version 能解析到 apply 步骤', () => {
    expect(resolveServiceStep('apply-version')).toBe('apply');
    expect(Object.keys(SERVICE_TOOL_TO_STEP)).toContain('apply-version');
  });
});
