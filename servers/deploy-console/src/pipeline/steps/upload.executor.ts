import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { ModuleRegistryService } from '../../module-registry/module-registry.service';
import { ArtifactStoreService } from '../../artifact/artifact-store.service';
import { RemoteDeliveryService } from '../../remote/remote-delivery.service';
import { StepContext } from './step.types';

/**
 * upload 内置步骤执行体（category=deploy，前端/微前端产物投递）。
 * local=ArtifactStore 拷贝到发布目录静态目录；remote=RemoteDelivery tar/scp/ssh 到远端。
 */
@Injectable()
export class UploadExecutor {
  constructor(
    private readonly configService: ConfigService,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly artifacts: ArtifactStoreService,
    private readonly remoteDelivery: RemoteDeliveryService,
  ) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    await ctx.enterStage(`投递产物（${ctx.uploadTarget}）`);

    const mod = await this.moduleRegistry.get(p.moduleKey);
    const ws =
      this.configService.get<string>('RELEASE_WORKSPACE') || '/Users/geekwen/web_system_release';
    const src = path.join(ws, 'apps', mod.dir, 'dist');

    if (ctx.uploadTarget === 'local') {
      const dest = this.artifacts.uploadLocal(p.moduleKey, p.versionTag!, src);
      ctx.log(`产物已投递到 ${dest}`);
    } else {
      const { sshTarget, dest } = this.remoteDelivery.uploadDist({
        env: p.env,
        moduleKey: p.moduleKey,
        version: p.versionTag!,
        srcDir: src,
      });
      ctx.log(`产物已投递到 ${sshTarget}:${dest}`);
    }

    p.result = {
      ...(p.result ?? {}),
      artifactPath: `/static/modules/${p.moduleKey}/${p.versionTag}/`,
      target: ctx.uploadTarget,
    };
    await ctx.save();
  }
}
