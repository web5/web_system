import { Injectable, Logger } from '@nestjs/common';
import { ReleaseRegistryService } from '../registry/release-registry.service';
import { AppsService } from '../apps/apps.service';
import { GatewayCacheService } from '../common/gateway-cache.service';
import { HttpProbeService } from '../probe/http-probe.service';
import { toCommitId } from './release-paths';
import { ManifestGateError, manifestMatches, manifestVersionOf } from './release-final-guard';

export interface FinalizePointerInput {
  /** 流水线 run id（env-dir 原子步的 lockOwner / legacy setPointer 的 taskId） */
  id: string | number;
  env: string;
  moduleKey: string;
  versionTag: string;
  operator?: string;
}

/**
 * 发布收尾器（半发布治理 F1-②/③，2026-11-12，05a 专项 P0-1）。
 *
 * 非后端模块发布成功的两个收尾动作，收敛到这一个入口，两条模式（经典/编排）共用：
 * 1. **指针收敛**：env-dir 应用走唯一原子步 `AppsService.switchVersion`
 *    （表 → 磁盘入口指针 → 云库镜像，失败补偿回滚）——编排收尾此前直连
 *    `registry.setPointer`（只写表不写盘），是路径 D 的半发布形态；
 *    其余前端（site-version shell 等无磁盘指针）保持 setPointer + toCommitId 兜底。
 * 2. **manifest 硬门禁**：gateway `/__manifest__` 实供版本必须 == 本次 versionTag
 *    （双侧 toCommitId 归一）。不一致 → 抛 {@link ManifestGateError}，run 判 failed。
 *
 * 取不到 gateway 地址 = 判不了，按 skipped 处理（不阻断）——与 verify_release
 * 「事实采不到不判 fail」的 unknown 语义对齐，避免无 gateway 环境被误杀。
 */
@Injectable()
export class ReleaseFinalizerService {
  private readonly logger = new Logger(ReleaseFinalizerService.name);

  constructor(
    private readonly registry: ReleaseRegistryService,
    private readonly apps: AppsService,
    private readonly gatewayCache: GatewayCacheService,
    private readonly probe: HttpProbeService,
  ) {}

  /** 指针收敛 + manifest 门禁（门禁失败抛错） */
  async finalizeFrontendPointer(p: FinalizePointerInput): Promise<{
    finalVersion: string;
    via: 'atomic-step' | 'setPointer';
    gate: 'passed' | 'skipped';
  }> {
    // env-dir 指针与产物目录以纯 commit 为准（toCommitId 契约）；site-version 保持原兜底口径
    const finalVersion = toCommitId(p.versionTag) || p.versionTag;
    const app = await this.apps.findAppOrNull(p.moduleKey);
    let via: 'atomic-step' | 'setPointer' = 'setPointer';
    if (app?.deployMode === 'env-dir') {
      await this.apps.switchVersion(p.moduleKey, p.env, finalVersion, p.operator, String(p.id));
      via = 'atomic-step';
    } else {
      await this.registry.setPointer({
        env: p.env,
        moduleKey: p.moduleKey,
        currentVersion: finalVersion,
        deployedBy: p.operator || 'unknown',
        taskId: String(p.id),
      });
    }
    const gate = await this.assertManifestMatches({
      env: p.env,
      moduleKey: p.moduleKey,
      expectVersion: finalVersion,
    });
    return { finalVersion, via, gate };
  }

  /**
   * manifest 硬门禁（可独立调用，如经典模式收尾只补门禁）。
   *
   * 重试语义：原子步已 `notifyVersionChange` 主动失效缓存，但通知是 best-effort；
   * gateway 版本缓存 TTL 10s，默认 4 次 × 3s 的重试窗口覆盖 TTL 边界，
   * 把「缓存滞后」与「真撕裂」区分开 —— 只有后者才配判 failed。
   */
  async assertManifestMatches(
    input: { env: string; moduleKey: string; expectVersion: string },
    opts?: {
      attempts?: number;
      intervalMs?: number;
      sleep?: (ms: number) => Promise<void>;
    },
  ): Promise<'passed' | 'skipped'> {
    const base = this.gatewayCache.urlFor(input.env);
    if (!base) {
      this.logger.warn(
        `manifest 门禁跳过：未配置 GATEWAY_INTERNAL_URL_${input.env.toUpperCase()} / GATEWAY_INTERNAL_URL（${input.moduleKey}@${input.env}）`,
      );
      return 'skipped';
    }
    const attempts = Math.max(1, opts?.attempts ?? 4);
    const intervalMs = opts?.intervalMs ?? 3000;
    const sleep = opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    let lastVersion: string | null = null;
    for (let i = 0; i < attempts; i++) {
      const manifest = await this.probe.fetchGatewayManifest(base);
      lastVersion = manifestVersionOf(manifest, input.env, input.moduleKey);
      if (manifestMatches(manifest, input.env, input.moduleKey, input.expectVersion)) {
        return 'passed';
      }
      if (i < attempts - 1) await sleep(intervalMs);
    }
    throw new ManifestGateError(input.env, input.moduleKey, input.expectVersion, lastVersion);
  }
}
