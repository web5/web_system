import { Injectable } from '@nestjs/common';
import { CanaryService } from '../../canary/canary.service';
import { ReleaseRegistryService } from '../../registry/release-registry.service';
import { StepContext } from './step.types';

/**
 * pointer 内置步骤执行体（category=semantic，发布语义真相源，不可被命令覆盖）。
 * direct=upsert 版本指针；grayscale=写灰度规则（不切 stable 指针）。
 */
@Injectable()
export class PointerExecutor {
  constructor(
    private readonly registry: ReleaseRegistryService,
    private readonly canaryService: CanaryService,
  ) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    if (p.mode === 'grayscale') {
      await ctx.enterStage('写入灰度规则（不切 stable 指针）');
      const rule = await this.canaryService.create({
        envId: p.env,
        moduleKey: p.moduleKey,
        canaryVersion: p.versionTag!,
        matchRule: p.grayscaleRule as never,
        enabled: true,
      });
      p.canaryRuleId = rule.id;
      ctx.log(`灰度规则已创建: ${rule.id} → ${p.versionTag}`);
      await ctx.save();
      return;
    }

    await ctx.enterStage('切换当前版本指针');
    await this.registry.setPointer({
      env: p.env,
      moduleKey: p.moduleKey,
      currentVersion: p.versionTag!,
      deployedBy: p.operator,
      taskId: p.id,
    });
    ctx.log(`指针已切换: ${p.env}/${p.moduleKey} → ${p.versionTag}`);
    await ctx.save();
  }
}
