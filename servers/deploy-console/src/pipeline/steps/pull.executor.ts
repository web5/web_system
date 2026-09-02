import { Injectable } from '@nestjs/common';
import { ReleaseGitService } from '../../git/release-git.service';
import { StepContext } from './step.types';

/**
 * pull 内置步骤执行体（category=code）。
 *
 * 发布目录同步到目标分支（git fetch/checkout/reset/clean，含 .git 校验）+
 * pnpm-lock 指纹依赖同步（失败不阻断，构建阶段会再报错）。
 */
@Injectable()
export class PullExecutor {
  constructor(private readonly git: ReleaseGitService) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    await ctx.enterStage(`拉取代码: ${p.gitBranch}@${p.versionTag || '最新'}`);

    const commit = this.git.syncToBranch(p.gitBranch!, p.versionTag);
    p.gitCommit = commit;
    p.versionTag = commit;
    ctx.log(`代码已就绪: ${p.gitBranch}@${commit}（发布目录 ${this.git.workspace()}）`);

    // 依赖同步：pnpm-lock.yaml 变化才重装（避免每次全量 install；失败不阻断）
    try {
      if (this.git.syncDependencies() === 'installed') {
        ctx.log('依赖安装完成');
      }
    } catch (e) {
      ctx.log(`[warn] 依赖同步失败: ${(e as Error).message}`);
    }

    await ctx.save();
  }
}
