import { Injectable } from '@nestjs/common';
import { ReleaseRegistryService } from '../../registry/release-registry.service';
import { StepContext } from './step.types';

/**
 * version 内置步骤执行体（category=semantic，发布语义真相源，不可被命令覆盖）。
 * 写版本记录到 deploy_versions（库 web_system_deploy）。
 */
@Injectable()
export class VersionExecutor {
  constructor(private readonly registry: ReleaseRegistryService) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    await ctx.enterStage('写入版本记录');
    await this.registry.registerVersion({
      env: p.env,
      moduleKey: p.moduleKey,
      versionTag: p.versionTag!,
      gitCommit: p.gitCommit,
      gitBranch: p.gitBranch,
      releasedBy: p.operator,
      taskId: p.id,
      note: p.mode === 'grayscale' ? '流水线灰度发布' : '流水线发布',
    });
    ctx.log(`版本记录已写入: ${p.versionTag}`);
    await ctx.save();
  }
}
