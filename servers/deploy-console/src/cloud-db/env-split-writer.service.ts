import { Injectable, Logger } from '@nestjs/common';
import { CloudDbService } from './cloud-db.service';

export interface MirrorPointerInput {
  env: string;
  moduleKey: string;
  currentVersion: string;
  deployedBy?: string;
  taskId?: string;
}

export type MirrorOutcome = 'skipped' | 'ok' | 'failed';

export interface MirrorResult {
  outcome: MirrorOutcome;
  /** skipped 的原因（未启用 / 非 prod 环境） */
  reason?: string;
  /** failed 的错误信息 */
  error?: string;
}

/**
 * 按环境分流的镜像写（本地库 → 云数据库）。
 *
 * 规则（design.md §4）：**只有 prod 数据写云库**。
 * dev / local 的数据留在 dev 本机库（dev gateway 内网读本地库），不镜像。
 *
 * 只镜像 **gateway 实际会读的表**：
 * - `deploy_app_env_versions`：版本指针（gateway NEW 域唯一读取源）→ **prod 必写**
 * - `deploy_deployments`：legacy 指针（`DEPLOY_LEGACY_READ=1` 应急才读）→ prod 也写，但**不阻断**
 * - 模块元数据 / 服务 / 路由等配置表：M4 阶段接入 `mirrorRows`
 *
 * pipeline 模板、节点命令、流水线变量**不在镜像范围**（gateway 不读，见 design §4 说明）。
 */
@Injectable()
export class EnvSplitWriterService {
  private readonly logger = new Logger(EnvSplitWriterService.name);

  constructor(private readonly cloud: CloudDbService) {}

  /** 该环境的数据是否落在云库 */
  shouldMirror(env: string): boolean {
    return this.cloud.enabled && env === 'prod';
  }

  /**
   * 镜像版本指针到云库（env=prod 时）。
   *
   * **失败语义（design §6，P0）**：env=prod 且开启严格模式时**抛出**。
   * 原因：本地库写成功 + 云库写失败 = 「流水线显示成功、prod 实际没切版本」，
   * 与 2026-09-30 基座事故形态一致。宁可让任务红掉，也不要静默不一致。
   */
  async mirrorPointer(input: MirrorPointerInput): Promise<MirrorResult> {
    if (!this.cloud.enabled) {
      return { outcome: 'skipped', reason: 'DEPLOY_CLOUD_DB_ENABLED 未开启（等同人工同步现状）' };
    }
    if (input.env !== 'prod') {
      return { outcome: 'skipped', reason: `env=${input.env} 数据留本地库，不镜像` };
    }

    try {
      // 先取旧值，保证云库的 previous_version 与本地语义一致（旧 current → previous）。
      // 不做「ON DUPLICATE 里引用自身列」的写法：赋值顺序语义依赖 MySQL 版本，易踩坑。
      const rows = await this.cloud.query<Array<{ current_version: string | null }>>(
        'SELECT current_version FROM deploy_app_env_versions WHERE app_key = ? AND env_id = ?',
        [input.moduleKey, input.env],
      );
      const previous = rows?.[0]?.current_version ?? null;

      await this.cloud.query(
        `INSERT INTO deploy_app_env_versions
           (id, app_key, env_id, current_version, previous_version, status, deployed_at, deployed_by, task_id)
         VALUES (UUID(), ?, ?, ?, ?, 'deployed', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           current_version = VALUES(current_version),
           previous_version = VALUES(previous_version),
           status = VALUES(status),
           deployed_at = VALUES(deployed_at),
           deployed_by = VALUES(deployed_by),
           task_id = VALUES(task_id)`,
        [
          input.moduleKey,
          input.env,
          input.currentVersion,
          previous,
          new Date(),
          input.deployedBy ?? null,
          input.taskId ?? null,
        ],
      );
      this.logger.log(
        `prod 指针已同步云库：${input.moduleKey} → ${input.currentVersion}` +
          (previous ? `（previous=${previous}）` : ''),
      );
      return { outcome: 'ok' };
    } catch (e) {
      const msg = (e as Error).message;
      if (this.cloud.strict) {
        throw new Error(
          `prod 指针未生效：写云数据库失败（${msg}）。本地库已更新，但 prod gateway 读的是云库，` +
            `prod 仍运行旧版本。请检查云库公网连通性与白名单后重试发布。`,
        );
      }
      this.logger.error(`prod 指针写云库失败（STRICT=false，仅告警）：${msg}`);
      return { outcome: 'failed', error: msg };
    }
  }

  /**
   * 镜像 legacy 指针（`deploy_deployments`）到云库。
   *
   * 为什么仍写：应急开关 `DEPLOY_LEGACY_READ=1` 时 gateway 会读它，排障时也有比对价值。
   * 为什么**不阻断发布**：gateway 默认不读本表，写失败不影响线上运行；让它成为发布阻塞项
   * 只会制造噪音（对比：新表 `deploy_app_env_versions` 是唯一读取源，必须严格）。
   */
  async mirrorLegacyPointer(input: MirrorPointerInput): Promise<MirrorResult> {
    if (!this.shouldMirror(input.env)) {
      return { outcome: 'skipped', reason: `未启用或 env=${input.env} 留本地库` };
    }
    try {
      await this.cloud.query(
        `INSERT INTO deploy_deployments
           (id, env_id, module_key, current_version, status, deployed_at, deployed_by, task_id)
         VALUES (UUID(), ?, ?, ?, 'deployed', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           current_version = VALUES(current_version),
           status = VALUES(status),
           deployed_at = VALUES(deployed_at),
           deployed_by = VALUES(deployed_by),
           task_id = VALUES(task_id)`,
        [
          input.env,
          input.moduleKey,
          input.currentVersion,
          new Date(),
          input.deployedBy ?? null,
          input.taskId ?? null,
        ],
      );
      return { outcome: 'ok' };
    } catch (e) {
      const msg = (e as Error).message;
      // 非阻断：legacy 表不是 gateway 默认读取源
      this.logger.warn(`legacy 指针（deploy_deployments）写云库失败，不阻断发布：${msg}`);
      return { outcome: 'failed', error: msg };
    }
  }

  /** 允许镜像的配置表白名单（gateway 实际会读的表，design §4） */
  static readonly MIRROR_TABLES = [
    'deploy_modules',
    'deploy_apps',
    'deploy_sites',
    'deploy_hosts',
    'deploy_envs',
    'deploy_endpoints',
    'deploy_services',
    'deploy_service_envs',
    'deploy_service_routes',
    'deploy_canary_rules',
  ] as const;

  /**
   * 通用镜像写（M4 配置表双写用）：把本地刚写入的行 upsert 到云库同表。
   *
   * @param table 必须在白名单内（防止误写平台内部表）
   * @param rows  要镜像的行（对象数组，键为 snake_case 列名）
   * @param uniqueKeys 唯一键列（决定 ON DUPLICATE 命中），默认 ['id']
   */
  async mirrorRows(
    table: string,
    rows: Array<Record<string, unknown>>,
    uniqueKeys: string[] = ['id'],
  ): Promise<MirrorResult> {
    if (!this.cloud.enabled) {
      return { outcome: 'skipped', reason: 'DEPLOY_CLOUD_DB_ENABLED 未开启' };
    }
    if (!EnvSplitWriterService.MIRROR_TABLES.includes(table as never)) {
      return { outcome: 'skipped', reason: `表 ${table} 不在镜像白名单（gateway 不读）` };
    }
    if (!rows.length) return { outcome: 'skipped', reason: '空行集' };

    try {
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => c !== 'id' || uniqueKeys.includes('id'));
        const updates = cols.filter((c) => !uniqueKeys.includes(c));
        if (!cols.length) continue;
        const sql =
          `INSERT INTO ${table} (${cols.map((c) => `\`${c}\``).join(', ')}) ` +
          `VALUES (${cols.map(() => '?').join(', ')}) ` +
          (updates.length
            ? `ON DUPLICATE KEY UPDATE ${updates.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')}`
            : '');
        await this.cloud.query(sql, cols.map((c) => row[c] ?? null));
      }
      this.logger.log(`配置镜像写云库：${table} × ${rows.length} 行`);
      return { outcome: 'ok' };
    } catch (e) {
      const msg = (e as Error).message;
      // 配置漂移不直接影响线上运行（gateway 读的是指针 + 模块元数据，且发布时用不到新配置）→ 只告警
      this.logger.warn(`配置镜像写云库失败（${table}），不阻断：${msg}`);
      return { outcome: 'failed', error: msg };
    }
  }
}
