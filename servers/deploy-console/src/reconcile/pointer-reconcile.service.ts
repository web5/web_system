import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EnvArtifactService } from '../apps/env-artifact.service';
import { GatewayCacheService } from '../common/gateway-cache.service';
import { HttpProbeService } from '../probe/http-probe.service';
import { cdnLayoutMode, toCommitId } from '../pipeline/release-paths';

/** 三方中一侧的取值状态 */
export interface PointerSide {
  /** 原始值（盘指针解析值 / 表 current_version / manifest byEnv version） */
  raw: string | null;
  /** toCommitId 归一后的值（拼写差不误判） */
  commit: string | null;
  /** 该侧是否适用（CDN 模式无盘指针；gateway 未配置/取不到无 manifest 侧） */
  applicable: boolean;
}

export interface PointerTriple {
  app: string;
  env: string;
  disk: PointerSide;
  table: PointerSide;
  manifest: PointerSide;
}

export interface PointerReconcileDiff extends PointerTriple {
  /** value-mismatch = 两侧都有值但不一致；side-missing = 一侧有值另一侧缺失 */
  kind: 'value-mismatch' | 'side-missing';
  reason: string;
}

export interface PointerReconcileReport {
  ranAt: number;
  status: 'ok' | 'drift' | 'error';
  reason?: string;
  checkedPairs: number;
  diffs: PointerReconcileDiff[];
}

/**
 * 三方对账（纯函数）：盘 ↔ 表 ↔ manifest。
 *
 * 判据（05a 专项 P0-2）：
 * - 全部侧都无值 → 未部署，**不算漂移**；
 * - 任一侧缺失而其它侧有值 → `side-missing`（11-09 形态：盘有值、表无行）；
 * - 各侧都有值但归一化后不一致 → `value-mismatch`；
 * - 只有一侧适用且有值（如 CDN 模式且 manifest 取不到，只剩表侧）→ 无从对账，不判漂移。
 */
export function diffPointerTriple(t: PointerTriple): PointerReconcileDiff | null {
  const sides = [t.disk, t.table, t.manifest].filter((s) => s.applicable);
  const withValue = sides.filter((s) => s.commit !== null);
  if (withValue.length === 0) return null;
  if (withValue.length < sides.length && sides.length > 1) {
    return {
      ...t,
      kind: 'side-missing',
      reason: '一侧有值而另一侧缺失（半发布形态：写路径只覆盖了一半的面）',
    };
  }
  if (withValue.length > 1 && withValue.some((s) => s.commit !== withValue[0].commit)) {
    return {
      ...t,
      kind: 'value-mismatch',
      reason: '盘/表/manifest 归一化后版本不一致',
    };
  }
  return null;
}

/** 默认巡检间隔 6 小时（`POINTER_RECONCILE_INTERVAL_MS`，0 = 关闭） */
export const DEFAULT_POINTER_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_FIRST_DELAY_MS = 90 * 1000;

/**
 * 盘↔表↔manifest 三方对账巡检（半发布治理 F2，2026-11-12，05a 专项 P0-2）。
 *
 * 与 `ConsistencyWatchService`（本地库 vs 云库两表比对）互补：那个看「两库镜像」，
 * 这个看「同一条版本真相的三个面是否撕裂」——11-09 portal 半发布错位存活 2 天，
 * 正是因为没有任何判据比对这三个面。
 *
 * 只观测、不修复：drift 即 `logger.error` + 报告可查；修复走受控入口
 * `POST /api/apps/:key/envs/:envId/pointer/repair`（对齐原子步、写审计）。
 */
@Injectable()
export class PointerReconcileService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PointerReconcileService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private firstTimer: ReturnType<typeof setTimeout> | undefined;
  private last: PointerReconcileReport | undefined;

  constructor(
    private readonly cfg: ConfigService,
    @InjectDataSource() private readonly local: DataSource,
    private readonly artifacts: EnvArtifactService,
    private readonly gatewayCache: GatewayCacheService,
    private readonly probe: HttpProbeService,
  ) {}

  onModuleInit(): void {
    const raw = Number(this.cfg.get<string>('POINTER_RECONCILE_INTERVAL_MS'));
    const interval =
      Number.isFinite(raw) && raw >= 0 && String(this.cfg.get('POINTER_RECONCILE_INTERVAL_MS') ?? '') !== ''
        ? raw
        : DEFAULT_POINTER_RECONCILE_INTERVAL_MS;
    if (interval <= 0) {
      this.logger.log('盘↔表↔manifest 三方对账巡检已关闭（POINTER_RECONCILE_INTERVAL_MS=0）');
      return;
    }
    const run = () => {
      void this.check().catch((e) => this.logger.error(`三方对账巡检异常：${(e as Error).message}`));
    };
    const delayMs = Number(this.cfg.get<string>('POINTER_RECONCILE_FIRST_DELAY_MS')) || DEFAULT_FIRST_DELAY_MS;
    this.firstTimer = setTimeout(() => {
      run();
      this.timer = setInterval(run, interval);
      (this.timer as unknown as { unref?: () => void })?.unref?.();
    }, delayMs);
    (this.firstTimer as unknown as { unref?: () => void })?.unref?.();
    this.logger.log(`盘↔表↔manifest 三方对账巡检已启用：每 ${Math.round(interval / 60000)} 分钟一次`);
  }

  onModuleDestroy(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
  }

  lastReport(): PointerReconcileReport | undefined {
    return this.last;
  }

  /** 执行一次三方对账（定时触发 / `GET /api/reconcile/pointers?run=1` 手动触发共用） */
  async check(): Promise<PointerReconcileReport> {
    const ranAt = Date.now();
    try {
      const pairs = await this.listPairs();
      const tableMap = await this.tablePointerMap();
      const isCdn = cdnLayoutMode((k) => this.cfg.get<string>(k)) === 'cdn';

      // manifest 按 env 只取一次（每组一次 GET /__manifest__，量级 = 环境数）
      const manifestByEnv = new Map<string, { applicable: boolean; versionOf: (app: string) => string | null }>();
      for (const env of new Set(pairs.map((p) => p.env))) {
        manifestByEnv.set(env, await this.manifestSide(env));
      }

      const diffs: PointerReconcileDiff[] = [];
      for (const pair of pairs) {
        const diskRaw = isCdn ? null : await this.readDisk(pair.env, pair.app);
        const m = manifestByEnv.get(pair.env)!;
        const diff = diffPointerTriple({
          app: pair.app,
          env: pair.env,
          disk: {
            raw: diskRaw,
            commit: normCommit(diskRaw),
            applicable: !isCdn,
          },
          table: {
            raw: tableMap.get(`${pair.app}@${pair.env}`) ?? null,
            commit: normCommit(tableMap.get(`${pair.app}@${pair.env}`) ?? null),
            applicable: true,
          },
          manifest: {
            raw: m.applicable ? m.versionOf(pair.app) : null,
            commit: m.applicable ? normCommit(m.versionOf(pair.app)) : null,
            applicable: m.applicable,
          },
        });
        if (diff) diffs.push(diff);
      }

      const report: PointerReconcileReport = {
        ranAt,
        status: diffs.length ? 'drift' : 'ok',
        checkedPairs: pairs.length,
        diffs,
      };
      this.last = report;
      if (diffs.length) {
        this.logger.error(
          `盘↔表↔manifest 三方对账发现 ${diffs.length} 处撕裂：` +
            diffs
              .slice(0, 5)
              .map(
                (d) =>
                  `${d.app}@${d.env}[${d.kind}] 盘=${d.disk.raw ?? '-'} 表=${d.table.raw ?? '-'} manifest=${d.manifest.raw ?? '-'}`,
              )
              .join('；') +
            '（修复走 POST /api/apps/:key/envs/:envId/pointer/repair，勿直写库）',
        );
      } else {
        this.logger.log(`三方对账通过（${pairs.length} 对盘↔表↔manifest 一致）`);
      }
      return report;
    } catch (e) {
      const report: PointerReconcileReport = {
        ranAt,
        status: 'error',
        reason: (e as Error).message,
        checkedPairs: 0,
        diffs: [],
      };
      this.last = report;
      this.logger.error(`三方对账巡检失败：${(e as Error).message}`);
      return report;
    }
  }

  /** env-dir 应用 × 启用环境 的全量对 */
  private async listPairs(): Promise<Array<{ app: string; env: string }>> {
    const rows = (await this.local.query(
      `SELECT a.\`key\` AS app, e.env_id AS env
       FROM deploy_apps a CROSS JOIN deploy_envs e
       WHERE a.deploy_mode = 'env-dir' AND e.enabled = 1`,
    )) as Array<{ app: string; env: string }>;
    return rows.map((r) => ({ app: String(r.app), env: String(r.env) }));
  }

  /** 表侧：deploy_app_env_versions 当前指针（`app@env` → current_version） */
  private async tablePointerMap(): Promise<Map<string, string>> {
    const rows = (await this.local.query(
      'SELECT app_key AS app, env_id AS env, current_version AS v FROM deploy_app_env_versions',
    )) as Array<{ app: string; env: string; v: string | null }>;
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.v) map.set(`${r.app}@${r.env}`, String(r.v));
    }
    return map;
  }

  /** manifest 侧（按 env）：地址未配置 / 取不到 → applicable=false（该侧不参与判定） */
  private async manifestSide(
    env: string,
  ): Promise<{ applicable: boolean; versionOf: (app: string) => string | null }> {
    const base = this.gatewayCache.urlFor(env);
    if (!base) return { applicable: false, versionOf: () => null };
    const manifest = await this.probe.fetchGatewayManifest(base);
    if (!manifest) return { applicable: false, versionOf: () => null };
    return {
      applicable: true,
      versionOf: (app) =>
        manifest.byEnv?.[env]?.[app]?.version ??
        manifest.modules?.find((m) => (m.key ?? m.name) === app)?.version ??
        null,
    };
  }

  /** 盘侧：读远端/本机指针文件；读失败按缺失处理并 warn（不拖垮整轮对账） */
  private async readDisk(env: string, app: string): Promise<string | null> {
    try {
      return await this.artifacts.readPointer(env, app);
    } catch (e) {
      this.logger.warn(`读磁盘指针失败（${app}@${env}）：${(e as Error).message}（按缺失处理）`);
      return null;
    }
  }
}

/** 版本串归一（`<ns>/<commit>` 与纯 commit 两种拼写认作同一版本） */
function normCommit(v: string | null): string | null {
  if (!v) return null;
  return toCommitId(v) ?? v;
}
