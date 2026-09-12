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
      // 边界说明（2026-09-12 核实）：远端投递时产物落在目标环境自己的机器上，由**目标环境
      // 自己的发布平台**负责版本保留与清理（例如 dev 后端主机上那套 deploy-console）。
      // 本平台没有远端磁盘的运维边界，不做远端 rm（误删风险远高于收益）。
      // 但"跳过"不能是静默的 —— 否则会让人误以为已经清理过，故落进 result 供控制台展示。
      ctx.log('远端投递模式：远端产物保留/清理由目标环境自行负责，本平台跳过');
      p.result = { ...(p.result ?? {}), cleanup: { skipped: true, reason: 'remote-target' } };
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
