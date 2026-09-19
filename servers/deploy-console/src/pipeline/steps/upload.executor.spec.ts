import { UploadExecutor } from './upload.executor';
import { ModuleRegistryService } from '../../module-registry/module-registry.service';
import { ArtifactStoreService } from '../../artifact/artifact-store.service';
import { RemoteDeliveryService } from '../../remote/remote-delivery.service';
import { AppArtifactService } from '../../apps/app-artifact.service';
import { StepContext } from './step.types';
import { DeployPipelineEntity } from '../../entities/deploy-pipeline.entity';

/**
 * upload 执行体单测（P3 · 流水线接「投递激活」原语）
 *
 * 锁定三件事：
 * ① 开关未开 → 绝不调用应用域原语（旧链路逐字节不变）；
 * ② 开关开启 + 应用域 → 用**归一化后的纯 commit** 调 publishLocal，并把 env 产物路径写回 result；
 * ③ 非应用域（后端服务）→ 跳过；其它失败 → 抛错（不静默降级成"以为发了其实没发"）。
 */
describe('UploadExecutor（应用域环境目录投递）', () => {
  const FLAG = 'PIPELINE_APP_ENV_DIR';

  let logs: string[];
  let moduleRegistry: any;
  let artifacts: any;
  let remoteDelivery: any;
  let appArtifacts: any;
  let flags: Record<string, string>;

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
    flags = {};
    moduleRegistry = { get: jest.fn(async () => ({ key: 'admin', dir: 'admin', type: 'micro-frontend' })) };
    artifacts = { uploadLocal: jest.fn(() => '/ws/static/modules/admin/default/1a2b3c4') };
    remoteDelivery = {
      uploadDist: jest.fn(async () => ({ sshTarget: 'deploy@h', dest: '/data/x' })),
    };
    appArtifacts = {
      publishLocal: jest.fn(async (appKey: string, envId: string, version: string) => ({
        appKey,
        envId,
        version,
        artifactDir: `/ws/static/modules/${appKey}/${envId}/${version}`,
        pointerFile: `/ws/static/modules/${appKey}/${envId}/index.js`,
        entryUrl: `/static/modules/${appKey}/${envId}/index.js`,
        previousVersion: null,
      })),
    };
  });

  const build = () =>
    new UploadExecutor(
      { get: (k: string) => flags[k] } as never,
      moduleRegistry as unknown as ModuleRegistryService,
      artifacts as unknown as ArtifactStoreService,
      remoteDelivery as unknown as RemoteDeliveryService,
      appArtifacts as unknown as AppArtifactService,
    );

  it('① 开关未开：不调用应用域原语（旧链路不变）', async () => {
    const ctx = makeCtx({});
    await build().run(ctx);
    expect(appArtifacts.publishLocal).not.toHaveBeenCalled();
    // 旧产物路径照旧写回
    expect(ctx.pipeline.result?.artifactPath).toBe('/static/modules/admin/default/1a2b3c4/');
  });

  it('② 开关开启 + 应用域：按纯 commit 投递，并写回 env 产物路径与入口', async () => {
    flags[FLAG] = '1';
    const ctx = makeCtx({});
    await build().run(ctx);

    // versionTag 是 `default/1a2b3c4` → 必须归一化成纯 commit 作为目录名
    expect(appArtifacts.publishLocal).toHaveBeenCalledWith('admin', 'dev', '1a2b3c4', 'tester');
    expect(ctx.pipeline.result?.envArtifactPath).toBe('/static/modules/admin/dev/1a2b3c4/');
    expect(ctx.pipeline.result?.envEntryUrl).toBe('/static/modules/admin/dev/index.js');
    expect(logs.some((l) => l.includes('应用域投递'))).toBe(true);
  });

  it('② 远程投递不走环境目录（原语只写本地发布目录）', async () => {
    flags[FLAG] = '1';
    const ctx = { ...makeCtx({}), uploadTarget: 'remote' } as StepContext;
    await build().run(ctx);
    expect(appArtifacts.publishLocal).not.toHaveBeenCalled();
    expect(remoteDelivery.uploadDist).toHaveBeenCalled();
  });

  it('③ 非应用域（后端服务）：跳过且不抛错', async () => {
    flags[FLAG] = '1';
    appArtifacts.publishLocal.mockRejectedValue(new Error('应用不存在或已删除：todo-service'));
    const ctx = makeCtx({});
    await expect(build().run(ctx)).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes('非应用域模块'))).toBe(true);
  });

  it('③ 其它失败（如产物缺失）：抛错，不静默降级', async () => {
    flags[FLAG] = '1';
    appArtifacts.publishLocal.mockRejectedValue(new Error('构建产物不存在或缺入口文件'));
    await expect(build().run(makeCtx({}))).rejects.toThrow(/构建产物不存在/);
  });

  it('无 versionTag 时不投递（避免拿空串当目录名）', async () => {
    flags[FLAG] = '1';
    const ctx = makeCtx({ versionTag: undefined });
    await build().run(ctx);
    expect(appArtifacts.publishLocal).not.toHaveBeenCalled();
  });
});
