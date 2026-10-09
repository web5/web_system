import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RemoteArtifactCleanupService, RemoteCleanupResult } from './remote-artifact-cleanup.service';

/**
 * 远端产物清理**定时化**（诊断 #10 遗留④）。
 *
 * 背景：`RemoteArtifactCleanupService` 此前只挂在流水线的 cleanup 步骤上 ——
 * 也就是说「只有发版时才会顺手清一次」。不发版的模块（例如长期稳定的后端服务）
 * 的产物就永远不会被清理，直到磁盘告警。
 *
 * 与一致性巡检（#13）同样的两个原则：
 * - **不引 `@nestjs/schedule`**：一个 interval 就够
 * - **默认关闭**：`REMOTE_CLEANUP_INTERVAL_MS=0`（不配即关）。清理是删除动作，
 *   定时 + 默认开 = 无人值守地删线上文件，这条默认必须是关。
 *   真删还要 `REMOTE_CLEANUP_ENABLED=true`（双重开关）。
 */
export interface CleanupWatchReport {
  ranAt: number;
  /** 本次扫描的「模块 × 环境」数 */
  scannedTargets: number;
  results: RemoteCleanupResult[];
}

/** 默认间隔：24 小时（配了才启用，不配 = 0 = 关闭） */
export const DEFAULT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RemoteCleanupWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemoteCleanupWatchService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private firstTimer: ReturnType<typeof setTimeout> | undefined;
  private last: CleanupWatchReport | undefined;

  constructor(
    private readonly cfg: ConfigService,
    private readonly cleanup: RemoteArtifactCleanupService,
    @InjectDataSource() private readonly local: DataSource,
  ) {}

  onModuleInit(): void {
    const raw = Number(this.cfg.get<string>('REMOTE_CLEANUP_INTERVAL_MS'));
    const interval = Number.isFinite(raw) && raw >= 0 ? raw : 0;
    if (interval <= 0) {
      this.logger.log('远端产物定时清理已关闭（REMOTE_CLEANUP_INTERVAL_MS 未配置或为 0）');
      return;
    }
    const run = () => {
      void this.run().catch((e) => this.logger.error(`远端产物定时清理异常：${(e as Error).message}`));
    };
    const delayMs = Number(this.cfg.get<string>('REMOTE_CLEANUP_FIRST_DELAY_MS')) || 180000;
    this.firstTimer = setTimeout(() => {
      run();
      this.timer = setInterval(run, interval);
      (this.timer as unknown as { unref?: () => void })?.unref?.();
    }, delayMs);
    (this.firstTimer as unknown as { unref?: () => void })?.unref?.();
    this.logger.log(
      `远端产物定时清理已启用：每 ${Math.round(interval / 3600000)} 小时一次` +
        `（是否真删取决于 REMOTE_CLEANUP_ENABLED）`,
    );
  }

  onModuleDestroy(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
  }

  lastReport(): CleanupWatchReport | undefined {
    return this.last;
  }

  /**
   * 待清理目标：**指针表里出现过的「应用 × 环境」**。
   *
   * 为什么从指针表取而不是遍历模块表：指针表里的行列 = 真发过版、真有产物堆积的地方；
   * 模块表里那些从没发布过的组合，远端压根没有目录，扫了也是空跑。
   */
  async targets(): Promise<Array<{ env: string; moduleKey: string; protectedVersions: Set<string> }>> {
    const rows = (await this.local.query(
      'SELECT app_key, env_id, current_version, previous_version FROM deploy_app_env_versions',
    )) as Array<Record<string, unknown>>;
    return rows
      .filter((r) => r.app_key && r.env_id)
      .map((r) => ({
        env: String(r.env_id),
        moduleKey: String(r.app_key),
        protectedVersions: new Set(
          [r.current_version, r.previous_version].filter(Boolean).map((v) => String(v)),
        ),
      }));
  }

  /** 执行一次（定时与手动共用） */
  async run(): Promise<CleanupWatchReport> {
    const ranAt = Date.now();
    const targets = await this.targets();
    const results: RemoteCleanupResult[] = [];
    for (const t of targets) {
      try {
        results.push(
          await this.cleanup.cleanup(t.env, t.moduleKey, {
            envId: t.env,
            protectedVersions: t.protectedVersions,
          }),
        );
      } catch (e) {
        // 单个目标失败不影响其他目标
        this.logger.warn(`定时清理跳过 ${t.moduleKey}@${t.env}：${(e as Error).message}`);
      }
    }
    const report: CleanupWatchReport = { ranAt, scannedTargets: targets.length, results };
    this.last = report;
    return report;
  }
}
