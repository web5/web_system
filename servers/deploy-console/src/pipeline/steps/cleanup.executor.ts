import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CanaryService } from '../../canary/canary.service';
import { ArtifactStoreService } from '../../artifact/artifact-store.service';
// 远端产物保留（诊断 #10）：prod 的产物在 prod 机，本机清理扫不到
import { RemoteArtifactCleanupService } from '../../remote/remote-artifact-cleanup.service';
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
    private readonly remoteCleanup: RemoteArtifactCleanupService,
  ) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    await ctx.enterStage('清理历史版本');

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

    if (p.moduleType === 'backend') {
      ctx.log('后端模块无静态产物，跳过清理');
      await ctx.save();
      return;
    }
    const target = this.configService.get<string>('PIPELINE_UPLOAD_TARGET');
    if (target === 'remote') {
      /**
       * 远端投递（诊断 #10）：产物落在目标环境的机器上，此前这里是**直接跳过**，
       * 注释写「由目标环境自己的发布平台负责」——但实测目标机（如 prod）并没有
       * 部署另一套 console，**没有任何一方在清理**，版本目录只增不减。
       *
       * 改为：扫描远端并计算保留计划；默认只观测（`REMOTE_CLEANUP_ENABLED`），
       * 真要删由运维确认后开启。受保护版本与形态校验在服务端做，远端只执行 rm。
       */
      const r = await this.remoteCleanup.cleanup(p.env, p.moduleKey, { protectedVersions });
      ctx.log(
        `远端清理：扫描到 ${r.scanned} 个版本，保留 ${r.keep.length} 个` +
          (r.remove.length ? `，待清理 ${r.remove.length} 个（${r.applied ? '已执行' : '未开启删除'}）` : ''),
      );
      p.result = {
        ...(p.result ?? {}),
        cleanup: {
          remote: true,
          dir: r.dir,
          scanned: r.scanned,
          kept: r.keep,
          removed: r.remove,
          applied: r.applied,
          reason: r.reason,
        },
      };
      await ctx.save();
      return;
    }

    const { kept, removed } = this.artifacts.cleanup(p.moduleKey, undefined, protectedVersions);
    p.result = { ...(p.result ?? {}), kept, removed };
    ctx.log(
      `清理完成，保留 ${kept.length} 个版本${removed.length ? `，删除: ${removed.join(', ')}` : ''}`,
    );
    await ctx.save();
  }
}
