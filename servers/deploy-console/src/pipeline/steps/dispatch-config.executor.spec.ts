import { DispatchConfigExecutor } from './dispatch-config.executor';
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

describe('DispatchConfigExecutor（发布流水线里的配置下发 #8493）', () => {
  const deploy = { dispatchConfigForRelease: jest.fn() } as unknown as DeployService;
  const executor = new DispatchConfigExecutor(deploy);

  const pipeline = {
    id: 'pipe-1',
    moduleKey: 'gateway',
    moduleType: 'backend',
    env: 'prod',
    versionTag: 'gateway-prod/abc1234',
    operator: 'tester',
  };

  it('非 local（prod）→ 调用 dispatchConfigForRelease 并写日志', async () => {
    (deploy.dispatchConfigForRelease as jest.Mock).mockResolvedValue(undefined);
    const { ctx, stageMessages, logs } = ctxOf(pipeline);

    await executor.run(ctx);

    expect(deploy.dispatchConfigForRelease).toHaveBeenCalledWith('prod', 'gateway');
    expect(stageMessages.some((m) => m.includes('下发配置'))).toBe(true);
    expect(logs.join('\n')).toContain('配置下发完成');
    expect(ctx.save).toHaveBeenCalled();
  });

  it('local 环境 → 跳过远程下发（不调 dispatchConfigForRelease）', async () => {
    (deploy.dispatchConfigForRelease as jest.Mock).mockClear();
    const { ctx, logs } = ctxOf({ ...pipeline, env: 'local' });

    await executor.run(ctx);

    expect(deploy.dispatchConfigForRelease).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('本地环境跳过');
    expect(ctx.save).toHaveBeenCalled();
  });

  it('dispatchConfigForRelease 失败 → 向上抛（流水线 fail-fast，不吞错）', async () => {
    (deploy.dispatchConfigForRelease as jest.Mock).mockRejectedValue(
      new Error('环境 prod 的 SSH 私钥不存在'),
    );
    const { ctx } = ctxOf(pipeline);
    await expect(executor.run(ctx)).rejects.toThrow(/SSH 私钥不存在/);
  });

  it('tool 名 dispatch-config 能解析到 dispatch-config 步骤', () => {
    expect(resolveServiceStep('dispatch-config')).toBe('dispatch-config');
    expect(Object.keys(SERVICE_TOOL_TO_STEP)).toContain('dispatch-config');
  });
});
