import { Injectable, Logger } from '@nestjs/common';
import { ReleaseGitService } from '../../git/release-git.service';
import { CommandService } from '../../shell/command.service';
import { parseReleaseRef } from '../release-paths';
import { StepContext } from './step.types';

/**
 * 共享 workspace 包预构建**不再由平台兜底**（2026-10-27 拍板 Q2：完全移除）：
 * 预构建改为画布上的普通脚本节点（key=prebuild，脚本 `node scripts/prebuild-workspace-deps.mjs`，
 * 需要的流水线自行添加）。⚠️ 切勿恢复硬编码包清单（原 PREBUILD_SHARED_PACKAGES）——
 * 2026-10-26 故障根因即清单漏 @kedouai/agent-core；要跑就走统一脚本全量扫 packages/*。
 */

/**
 * pull 内置步骤执行体（category=code）——「拉码」的回退实现。
 *
 * 职责边界（重要）：
 * - **只负责把代码拉到目标 commit**（fetch/checkout/reset/clean，含 .git 校验）；
 * - 版本身份（`gitCommit` / `versionTag`）由平台统一回填（`PipelineService.resolveGitIdentity`），
 *   因为 v5 下该阶段可能改由 DB 锁定脚本执行（`nodeKey='git'`），两条路径必须同源；
 * - 依赖同步在 `afterSync()`：脚本驱动时引擎会显式调用它。
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
   * 拉码之后的平台侧收尾：依赖同步。
   *
   * 单独暴露的原因：git 阶段可能由 **DB 锁定脚本**驱动（脚本只负责"把代码拉到位"），
   * 此时依赖安装仍必须由平台执行。
   */
  async afterSync(ctx: StepContext): Promise<void> {
    // 依赖同步：pnpm-lock.yaml 变化才重装（避免每次全量 install；失败不阻断）
    try {
      if (this.git.syncDependencies() === 'installed') {
        ctx.log('依赖安装完成');
      }
    } catch (e) {
      // ⚠️ 依赖同步失败是后续构建失败的高频根因（2026-09-21 portal 实测）：
      // workspace 包（@web-system/*）的 node_modules 链接缺失 → vite resolve 失败，
      // 表象是「Rollup failed to resolve import "@web-system/ui/tokens.css"」这类误导性报错。
      // 失败不阻断（历史兼容），但日志必须醒目指向根因。
      ctx.log(
        `[warn] 依赖同步失败: ${(e as Error).message} —— workspace 包链接可能缺失，` +
          `后续模块构建大概率报 resolve 失败；请在发布目录手工 pnpm install 后重试`,
      );
      this.logger.warn(`依赖同步失败（${ctx.pipeline.moduleKey}）: ${(e as Error).message}`);
    }
  }
}
