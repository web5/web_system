import { Injectable, Logger } from '@nestjs/common';
import { CommandService } from '../../shell/command.service';
import { ReleaseGitService } from '../../git/release-git.service';
import { StepContext } from './step.types';

/**
 * prebuild 内置步骤执行体（category=build）。
 *
 * 为什么独立成步骤（2026-10-26）：
 *   后端打包 `executeBackendRuntime` 的 `copyWorkspaceOutputs` 直接 cpSync
 *   `packages/<pkg>/dist`，不判陈旧。此前预构建散落在 `pull.afterSync` 的硬编码
 *   清单（`PREBUILD_SHARED_PACKAGES = shared/types`），漏了 `@kedouai/agent-core`
 *   —— 典型症状：改了 agent-core 字段（如 runId）发布后仍吃旧产物。
 *
 * 本步骤：调 `scripts/prebuild-workspace-deps.mjs`（isStale + 目录锁），
 * 对 `packages` 下全量判定，陈旧即重建。幂等 —— 与 `pull.afterSync` 兜底
 * 二次执行开销可忽略（dist 新于源码即跳过）。
 *
 * 位置：pull 之后 build 之前 —— 模块构建与后端打包都消费 workspace 包的 dist，
 * 必须在两者之前完成重建。
 */
@Injectable()
export class PrebuildExecutor {
  private readonly logger = new Logger(PrebuildExecutor.name);

  constructor(
    private readonly git: ReleaseGitService,
    private readonly command: CommandService,
  ) {}

  async run(ctx: StepContext): Promise<void> {
    await ctx.enterStage('预构建 workspace 依赖');

    if (process.env.SKIP_WORKSPACE_PREBUILD === '1') {
      ctx.log('SKIP_WORKSPACE_PREBUILD=1，跳过 workspace 预构建');
      await ctx.save();
      return;
    }

    const workspace = this.git.workspace();
    const script = 'scripts/prebuild-workspace-deps.mjs';
    const t0 = Date.now();
    try {
      const output = this.command.exec(`node ${script}`, workspace, {}, 300000);
      for (const line of (output || '').split('\n')) {
        if (line.trim()) ctx.log(line);
      }
      ctx.log(`workspace 预构建完成（${Date.now() - t0}ms）`);
    } catch (e) {
      // 预构建失败必须阻断：后续 build/packaging 会吃旧 dist，静默失败比显式失败更糟
      const msg = (e as Error).message;
      this.logger.error(`workspace 预构建失败（${ctx.pipeline.moduleKey}）: ${msg}`);
      throw new Error(`workspace 依赖预构建失败: ${msg}`);
    }
    await ctx.save();
  }
}
