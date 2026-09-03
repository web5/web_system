import { Injectable, Logger } from '@nestjs/common';
import { ReleaseGitService } from '../../git/release-git.service';
import { CommandService } from '../../shell/command.service';
import { StepContext } from './step.types';

/**
 * 共享 workspace 包预构建开关。
 *
 * `packages/shared` 与 `packages/types` 是几乎所有前端/微前端的公共依赖，被
 * `package.json: main` 指向 `dist/`（非源码别名）。若不在流水线级一次预构建，
 * 就会出现两类历史问题：
 *   1) 每个模块的 build 脚本各自 `pnpm --filter @web-system/shared build`，
 *      两条 admin/portal 并发流水线会把对方的 dist `mv` 到 `/tmp`，再各自重建——
 *      形成「并发 mv → 重建」竞态，导致 vite 打包解析失败。
 *   2) 单条流水线的 shared/types 重建耗时~几秒（tsc），多个微前端串联就是几倍 N。
 *
 * 因此抽到 pull 阶段一次执行（在 pnpm install 之后、模块 build 之前）。
 * 关闭开关 → 跳过预构建，回退到各模块脚本自理（兼容「临时禁掉共享构建」调试场景）。
 */
const PREBUILD_SHARED_PACKAGES = ['@web-system/shared', '@web-system/types'];

/**
 * pull 内置步骤执行体（category=code）。
 *
 * 发布目录同步到目标分支（git fetch/checkout/reset/clean，含 .git 校验）+
 * pnpm-lock 指纹依赖同步（失败不阻断，构建阶段会再报错）+
 * 共享 workspace 包预构建（@web-system/shared + @web-system/types，流水级一次）。
 */
@Injectable()
export class PullExecutor {
  private readonly logger = new Logger(PullExecutor.name);

  constructor(
    private readonly git: ReleaseGitService,
    private readonly command: CommandService,
  ) {}

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

    // 共享 workspace 包预构建：流水级一次（admin/portal shell 等所有依赖方共用 dist）
    for (const pkg of PREBUILD_SHARED_PACKAGES) {
      try {
        ctx.log(`预构建共享包: ${pkg}`);
        const t0 = Date.now();
        this.command.exec(
          `${this.command.pnpmBin()} --filter ${pkg} build`,
          this.git.workspace(),
        );
        ctx.log(`预构建完成: ${pkg}（${Date.now() - t0}ms）`);
      } catch (e) {
        // 共享包预构建失败不阻断：模块 build 自己也会重建（向后兼容历史脚本）。
        // 但仍打印显著 warning，避免调试时遗漏根因。
        ctx.log(`[warn] 共享包 ${pkg} 预构建失败: ${(e as Error).message}`);
        this.logger.warn(`共享包 ${pkg} 预构建失败: ${(e as Error).message}`);
      }
    }

    await ctx.save();
  }
}
