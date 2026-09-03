import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleRegistryService } from '../../module-registry/module-registry.service';
import { ArtifactStoreService } from '../../artifact/artifact-store.service';
import { ReleaseRegistryService } from '../../registry/release-registry.service';
import { StepContext } from './step.types';

/**
 * check 内置步骤执行体（category=semantic 安全基线）。
 *
 * 校验模块类型 / 目标分支 / prod 约束，设置 moduleType 快照；
 * 指定 commitId 时按「发布目录是否已有产物」决定 reuseArtifact（复用则跳过后续拉取构建）。
 */
@Injectable()
export class CheckExecutor {
  constructor(
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly artifacts: ArtifactStoreService,
    private readonly registry: ReleaseRegistryService,
  ) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    await ctx.enterStage('校验模块、分支与目标版本');

    const mod = await this.moduleRegistry.get(p.moduleKey);
    if (!['micro-frontend', 'frontend', 'backend'].includes(mod.type)) {
      throw new BadRequestException(
        `模块 ${p.moduleKey} 类型为 ${mod.type}，流水线暂不支持（支持 micro-frontend/frontend/backend）`,
      );
    }
    p.moduleType = mod.type;

    // 目标分支：未指定默认 master（与 prod 约束一致）
    const branch = p.gitBranch || 'master';
    p.gitBranch = branch;

    // ── 按 commit 发布 ──────────────────────────────────────────
    if (p.versionTag) {
      p.reuseArtifact = this.artifacts.exists(p.moduleKey, p.versionTag);
      if (p.reuseArtifact) {
        const history = await this.registry.findByVersionTag(p.versionTag);
        p.gitCommit = history?.gitCommit ?? p.versionTag;
        ctx.log(`复用已有产物: ${p.moduleKey}/${p.versionTag}（跳过拉取与构建）`);
      }
    } else {
      p.reuseArtifact = false;
    }

    if (p.env === 'prod' && branch !== 'master') {
      throw new BadRequestException(`现网仅允许发布 master 分支版本，目标分支: ${branch}`);
    }
    await ctx.save();
  }
}
