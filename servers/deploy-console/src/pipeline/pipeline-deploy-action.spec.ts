import { PipelineService } from './pipeline.service';
import { DeployPipelineEntity } from '../entities/deploy-pipeline.entity';

/**
 * 部署动作单测（发布部署整体的第二个动作）。
 *
 * 锁定四件事（design: specs/pipeline-deploy-action/design.md）：
 * ① 开关未开 → 绝不部署（dev/prod 与现状一致）；
 * ② 开关开启但非 local 环境 → 不部署（用户定：只在 local 打通）；
 * ③ local + 前端 → 切指针（AppsService.switchVersion），版本用**纯 commit**；
 * ④ local + 后端 → 走 restart 执行体；部署失败只记录、不改变发布结果。
 */
describe('部署动作（发布成功后的第二个流程动作）', () => {
  let flags: Record<string, string>;
  let switchVersion: jest.Mock;
  let restartRun: jest.Mock;
  let svc: any;

  const pipe = (over: Partial<DeployPipelineEntity> = {}): DeployPipelineEntity =>
    ({
      id: 'p1',
      moduleKey: 'admin',
      env: 'local',
      versionTag: 'admin-local/abc1234',
      operator: 'tester',
      result: {},
      logs: [],
      ...over,
    } as unknown as DeployPipelineEntity);

  beforeEach(() => {
    flags = {};
    switchVersion = jest.fn(async () => ({ appKey: 'admin', envId: 'local', to: 'abc1234' }));
    restartRun = jest.fn(async () => undefined);
    svc = Object.create(PipelineService.prototype);
    svc.configService = { get: (k: string) => flags[k] };
    svc.appsService = { switchVersion };
    // 默认：域归属 = 应用（前端）
    svc.targetResolver = { resolve: jest.fn(async () => ({ rootDir: 'apps' })) };
    svc.callServiceDeploy = jest.fn(async () => undefined);
    svc.builtinSteps = { restart: { run: restartRun } };
    svc.buildStepContext = () => ({}) as never;
    svc.save = jest.fn(async () => undefined);
  });

  const run = (p: DeployPipelineEntity) =>
    (svc as unknown as { autoDeployAfterPublish: (p: DeployPipelineEntity, t: 'local' | 'remote') => Promise<void> })
      .autoDeployAfterPublish.call(svc, p, 'local');

  it('① 开关未开：不执行任何部署动作', async () => {
    await run(pipe());
    expect(switchVersion).not.toHaveBeenCalled();
    expect(restartRun).not.toHaveBeenCalled();
  });

  it('② 开关开启但环境是 dev：不部署（只在 local 打通）', async () => {
    flags.PIPELINE_AUTO_DEPLOY = '1';
    await run(pipe({ env: 'dev' }));
    expect(switchVersion).not.toHaveBeenCalled();
    expect(restartRun).not.toHaveBeenCalled();
  });

  it('③ local + 前端：切指针，版本取纯 commit（去掉 <模板key>/ 前缀）', async () => {
    flags.PIPELINE_AUTO_DEPLOY = '1';
    const p = pipe();
    await run(p);
    expect(switchVersion).toHaveBeenCalledWith('admin', 'local', 'abc1234', 'tester');
    expect(restartRun).not.toHaveBeenCalled();
    expect((p.result as any).deploy).toEqual({ ok: true, version: 'abc1234' });
    expect(p.logs?.some((l) => l.includes('部署生效完成'))).toBe(true);
  });

  it('④ local + 服务域（rootDir=servers）：调服务管理的部署接口，不切指针', async () => {
    flags.PIPELINE_AUTO_DEPLOY = '1';
    svc.targetResolver = { resolve: jest.fn(async () => ({ rootDir: 'servers' })) };
    await run(pipe({ moduleKey: 'gateway' }));
    expect(svc.callServiceDeploy).toHaveBeenCalledWith('gateway', 'local');
    expect(switchVersion).not.toHaveBeenCalled();
  });

  it('⑤ 部署失败：只记录 result.deploy 与日志，不抛错（不改变发布结果）', async () => {
    flags.PIPELINE_AUTO_DEPLOY = '1';
    switchVersion.mockRejectedValue(new Error('版本产物不存在，无法切换'));
    const p = pipe();
    await expect(run(p)).resolves.toBeUndefined();
    expect((p.result as any).deploy.ok).toBe(false);
    expect((p.result as any).deploy.error).toContain('版本产物不存在');
    expect(p.logs?.some((l) => l.includes('部署失败'))).toBe(true);
  });

  it('无 versionTag 时跳过部署（避免拿空串当版本）', async () => {
    flags.PIPELINE_AUTO_DEPLOY = '1';
    await run(pipe({ versionTag: undefined }));
    expect(switchVersion).not.toHaveBeenCalled();
  });
});
