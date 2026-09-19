import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { ModuleRegistryService } from '../../module-registry/module-registry.service';
import { ArtifactStoreService } from '../../artifact/artifact-store.service';
import { RemoteDeliveryService } from '../../remote/remote-delivery.service';
import { AppArtifactService } from '../../apps/app-artifact.service';
import { StepContext } from './step.types';
import { defaultReleaseWorkspace, toCommitId } from '../release-paths';

/**
 * upload 内置步骤执行体（category=deploy，前端/微前端产物投递）。
 * local=ArtifactStore 拷贝到发布目录静态目录；remote=RemoteDelivery tar/scp/ssh 到远端。
 *
 * 双域重构 P3：本地投递且目标属于**应用域**时，追加一次「按环境目录投递 + 改写入口指针」
 * （`PIPELINE_APP_ENV_DIR=1` 开启，默认关闭 —— 未开启时行为与改造前逐字节一致）。
 * 远程投递不走此路径：AppArtifactService 只写本地发布目录。
 */
@Injectable()
export class UploadExecutor {
  constructor(
    private readonly configService: ConfigService,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly artifacts: ArtifactStoreService,
    private readonly remoteDelivery: RemoteDeliveryService,
    private readonly appArtifacts: AppArtifactService,
  ) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    await ctx.enterStage(`投递产物（${ctx.uploadTarget}）`);

    const mod = await this.moduleRegistry.get(p.moduleKey);
    const ws =
      this.configService.get<string>('RELEASE_WORKSPACE') || defaultReleaseWorkspace();
    const src = path.join(ws, 'apps', mod.dir, 'dist');

    if (ctx.uploadTarget === 'local') {
      const dest = this.artifacts.uploadLocal(p.moduleKey, p.versionTag!, src);
      ctx.log(`产物已投递到 ${dest}`);
      // 应用域：追加「<key>/<envId>/<version>/ + 入口指针」（仅在开关开启时）
      await this.publishToEnvDir(ctx);
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

  /**
   * 应用域按环境目录投递并激活（PIPELINE_APP_ENV_DIR=1 时生效）。
   *
   * - 目标 key 不属于应用域（是后端服务）→ 静默跳过（后端走 restart 链路，永不写版本指针）
   * - 版本引用可能是 `<pipelineKey>/<commit>`，用 `toCommitId` 归一化成纯 commit 作为目录名
   * - 其它失败（如产物缺失、env 不存在）→ **抛错**，不做静默降级（避免"以为发了其实没发"）
   */
  private async publishToEnvDir(ctx: StepContext): Promise<void> {
    if (this.configService.get<string>('PIPELINE_APP_ENV_DIR') !== '1') return;
    const p = ctx.pipeline;
    if (!p.versionTag) return;

    // 版本引用可能是 `<pipelineKey>/<commit>`，归一化为纯 commit 作为目录名
    const version = toCommitId(p.versionTag);
    if (!version) return;

    let res: Awaited<ReturnType<AppArtifactService['publishLocal']>>;
    try {
      res = await this.appArtifacts.publishLocal(p.moduleKey, p.env, version, p.operator ?? undefined);
    } catch (e) {
      const msg = (e as Error).message || '';
      // 非应用域（后端服务 / 未登记的应用）不是错误，跳过即可
      if (msg.includes('应用不存在')) {
        ctx.log(`非应用域模块 ${p.moduleKey}，跳过环境目录投递`);
        return;
      }
      throw e;
    }

    ctx.log(`应用域投递：${res.artifactDir}；入口指针 → ${res.entryUrl}（上一版本 ${res.previousVersion ?? '-'}）`);
    p.result = {
      ...(p.result ?? {}),
      envArtifactPath: `/static/modules/${p.moduleKey}/${p.env}/${version}/`,
      envEntryUrl: res.entryUrl,
    };
  }
}
