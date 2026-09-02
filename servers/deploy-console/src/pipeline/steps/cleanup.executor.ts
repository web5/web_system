import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CanaryService } from '../../canary/canary.service';
import { ArtifactStoreService } from '../../artifact/artifact-store.service';
import { StepContext } from './step.types';

/**
 * cleanup 内置步骤执行体（category=cleanup）。
 * 保留最近 N 个版本目录（ArtifactStore 默认 KEEP_VERSIONS=5），
 * 当前版本 + 启用中的灰度版本受保护不删；后端/远程投递模式无本地产物可清。
 */
@Injectable()
export class CleanupExecutor {
  private readonly logger = new Logger(CleanupExecutor.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly canaryService: CanaryService,
    private readonly artifacts: ArtifactStoreService,
  ) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    await ctx.enterStage('清理历史版本');
    if (p.moduleType === 'backend') {
      ctx.log('后端模块无静态产物，跳过清理');
      await ctx.save();
      return;
    }
    const target = this.configService.get<string>('PIPELINE_UPLOAD_TARGET');
    if (target === 'remote') {
      ctx.log('远程投递模式跳过本地清理');
      await ctx.save();
      return;
    }

    // 受保护：当前版本 + 所有启用中的灰度版本
    const protectedVersions = new Set<string>([p.versionTag!]);
    try {
      const rules = await this.canaryService.list(p.env, p.moduleKey);
      for (const r of rules) {
        if (r.enabled) protectedVersions.add(r.canaryVersion);
      }
    } catch (e) {
      this.logger.warn(`读取灰度规则失败，清理时可能误删: ${(e as Error).message}`);
    }

    const { kept, removed } = this.artifacts.cleanup(p.moduleKey, undefined, protectedVersions);
    p.result = { ...(p.result ?? {}), kept, removed };
    ctx.log(
      `清理完成，保留 ${kept.length} 个版本${removed.length ? `，删除: ${removed.join(', ')}` : ''}`,
    );
    await ctx.save();
  }
}
