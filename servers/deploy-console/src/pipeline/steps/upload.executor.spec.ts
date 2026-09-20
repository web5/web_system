import { UploadExecutor } from './upload.executor';
import { ModuleRegistryService } from '../../module-registry/module-registry.service';
import { ArtifactStoreService } from '../../artifact/artifact-store.service';
import { RemoteDeliveryService } from '../../remote/remote-delivery.service';
import { StepContext } from './step.types';
import { DeployPipelineEntity } from '../../entities/deploy-pipeline.entity';

/**
 * upload 执行体单测。
 *
 * 锁定两件事：
 * ① 本地投递：产物走 ArtifactStore，并把版本产物路径与投递目标写回 result；
 * ② 远程投递：走 RemoteDelivery（tar/scp/ssh），不碰本地产物区。
 */
describe('UploadExecutor', () => {
  let logs: string[];
  let moduleRegistry: any;
  let artifacts: any;
  let remoteDelivery: any;

  const makeCtx = (p: Partial<DeployPipelineEntity>): StepContext =>
    ({
      pipeline: {
        id: 'p1',
        moduleKey: 'admin',
        env: 'dev',
        versionTag: 'default/1a2b3c4',
        operator: 'tester',
        ...p,
      } as DeployPipelineEntity,
      uploadTarget: 'local',
      enterStage: jest.fn(async (_m: string) => undefined),
      log: (line: string) => logs.push(line),
      save: jest.fn(async () => undefined),
      sleep: jest.fn(async () => undefined),
      assertNotCancelled: jest.fn(),
    }) as unknown as StepContext;

  beforeEach(() => {
    logs = [];
    moduleRegistry = { get: jest.fn(async () => ({ key: 'admin', dir: 'admin', type: 'micro-frontend' })) };
    artifacts = { uploadLocal: jest.fn(() => '/ws/static/modules/admin/default/1a2b3c4') };
    remoteDelivery = {
      uploadDist: jest.fn(async () => ({ sshTarget: 'deploy@h', dest: '/data/x' })),
    };
  });

  const build = () =>
    new UploadExecutor(
      { get: () => undefined } as never,
      moduleRegistry as unknown as ModuleRegistryService,
      artifacts as unknown as ArtifactStoreService,
      remoteDelivery as unknown as RemoteDeliveryService,
    );

  it('本地投递：走 ArtifactStore，并写回产物路径与目标', async () => {
    const ctx = makeCtx({});
    await build().run(ctx);

    expect(artifacts.uploadLocal).toHaveBeenCalledWith(
      'admin',
      'default/1a2b3c4',
      expect.stringContaining('apps/admin/dist'),
    );
    expect(ctx.pipeline.result?.artifactPath).toBe('/static/modules/admin/default/1a2b3c4/');
    expect(ctx.pipeline.result?.target).toBe('local');
    expect(logs.some((l) => l.includes('产物已投递到'))).toBe(true);
  });

  it('远程投递：走 RemoteDelivery，不写本地产物区', async () => {
    const ctx = { ...makeCtx({}), uploadTarget: 'remote' } as StepContext;
    await build().run(ctx);

    expect(remoteDelivery.uploadDist).toHaveBeenCalled();
    expect(artifacts.uploadLocal).not.toHaveBeenCalled();
    expect(ctx.pipeline.result?.target).toBe('remote');
  });
});
