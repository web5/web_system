import { Injectable, Logger } from '@nestjs/common';
import { ReleaseGitService } from '../../git/release-git.service';
import { CommandService } from '../../shell/command.service';
import { parseReleaseRef } from '../release-paths';
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
 * 因此抽到拉码之后一次执行（在 pnpm install 之后、模块 build 之前）。
 * 关闭开关 → 跳过预构建，回退到各模块脚本自理（兼容「临时禁掉共享构建」调试场景）。
 */
const PREBUILD_SHARED_PACKAGES = ['@web-system/shared', '@web-system/types'];

/**
 * pull 内置步骤执行体（category=code）——「拉码」的回退实现。
 *
 * 职责边界（重要）：
 * - **只负责把代码拉到目标 commit**（fetch/checkout/reset/clean，含 .git 校验）；
 * - 版本身份（`gitCommit` / `versionTag`）由平台统一回填（`PipelineService.resolveGitIdentity`），
 *   因为 v5 下该阶段可能改由 DB 锁定脚本执行（`nodeKey='git'`），两条路径必须同源；
 * - 依赖同步与共享包预构建在 `afterSync()`：脚本驱动时引擎会显式调用它。
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

    // 目标 commit 可能是完整引用（`default/<commit>`），取末段交给 git；无 commit 时同步分支最新
    this.git.syncToBranch(p.gitBranch!, parseReleaseRef(p.versionTag || '').version || undefined);

    await this.afterSync(ctx);
    await ctx.save();
  }

  /**
   * 拉码之后的平台侧收尾：依赖同步 + 共享包预构建。
   *
   * 单独暴露的原因：git 阶段可能由 **DB 锁定脚本**驱动（脚本只负责"把代码拉到位"），
   * 此时依赖安装与预构建仍必须由平台执行 —— 预构建要流水线级只做一次，
   * 交给各模块脚本会重现「并发 mv → 重建」竞态（见文件头注释）。
   */
  async afterSync(ctx: StepContext): Promise<void> {
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
  }
}
