import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RemoteArtifactCleanupService, planRetain } from '../remote/remote-artifact-cleanup.service';
import { RetentionService } from './retention.service';
import { CleanupScanLogService, RemoteScanOutcome } from './cleanup-scan-log.service';

/**
 * 清理巡检编排（「会删什么」的只读答案）。
 *
 * 定位：把两个已有的清理能力**只以观测方式**跑一遍，并把结论落库。
 * - `RetentionService`：数据保留（deploy_tasks / deploy_versions / audit_logs）
 * - `RemoteArtifactCleanupService`：远端版本产物（只调 `scan`，绝不调 `cleanup`）
 *
 * ⚠️ 硬约束：**本服务不删任何东西**。
 * 「看」和「删」必须分开 —— 观测入口随手可点，删除入口要显式开关（RETENTION_ENABLED /
 * REMOTE_CLEANUP_ENABLED）。合在一个入口里，迟早有人点错。
 */
@Injectable()
export class CleanupScanService {
  private readonly logger = new Logger(CleanupScanService.name);

  constructor(
    private readonly retention: RetentionService,
    private readonly remote: RemoteArtifactCleanupService,
    private readonly scanLog: CleanupScanLogService,
    @InjectDataSource() private readonly local: DataSource,
  ) {}

  /** 跑一次数据保留巡检（是否真删由 RETENTION_ENABLED 决定，本服务不改它） */
  async runRetention(operator?: string) {
    const report = await this.retention.run();
    const scan = await this.scanLog.recordRetention(report, operator);
    return { report, scan };
  }

  /**
   * 跑一次远端产物巡检（只列出版本目录，按保留规则算出「会删哪些」）。
   *
   * 受保护版本取指针表（当前 + 上一个版本）—— 这是 `RetentionService.protectedVersionKeys`
   * 已有的口径，这里**复用而不是重写**，避免两处对「什么算受保护」的判断漂移。
   */
  async runRemote(env: string, moduleKey: string | undefined, operator?: string) {
    const keys = moduleKey ? [moduleKey] : await this.knownModuleKeys(env);
    const protectedKeys = await this.retention.protectedVersionKeys();

    const outcomes: RemoteScanOutcome[] = [];
    for (const key of keys) {
      const entries = await this.remote.scan(env, key, env);
      const protect = new Set(
        protectedKeys.filter((p) => p.env === env && p.component === key).map((p) => p.version),
      );
      if (!entries.length) {
        // 目录不存在 / 静态根没配 SSH 目标 → 明确记为 skipped，而不是假装「0 个候选、一切正常」
        outcomes.push({
          moduleKey: key,
          scanned: 0,
          keep: [],
          remove: [],
          reason: '未扫描到条目（远端目录不存在或该环境静态根未配置 SSH 目标）',
        });
        continue;
      }
      const plan = planRetain(entries, { protectedVersions: protect });
      outcomes.push({
        moduleKey: key,
        scanned: entries.length,
        keep: plan.keep,
        remove: plan.remove,
      });
    }

    const scan = await this.scanLog.recordRemote(env, outcomes, operator);
    return { env, outcomes, scan };
  }

  /** 某环境已知模块 key（未指定 moduleKey 时的兜底：以指针表为准） */
  async knownModuleKeys(env: string): Promise<string[]> {
    try {
      const rows = (await this.local.query(
        'SELECT DISTINCT app_key FROM deploy_app_env_versions WHERE env_id = ?',
        [env],
      )) as Array<{ app_key: string }>;
      return rows.map((r) => String(r.app_key)).filter(Boolean);
    } catch (e) {
      // 指针表读不出来就退化成空列表（记录里会体现为 skipped），不让接口 500
      this.logger.warn(`读取已知模块失败（${env}）：${(e as Error).message}`);
      return [];
    }
  }

  list(opts: { kind?: string; env?: string; limit?: number }) {
    return this.scanLog.list(opts);
  }

  one(id: string) {
    return this.scanLog.one(id);
  }
}
