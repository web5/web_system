import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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
        // 用 HttpException（而非裸 Error）：全局异常过滤器会把非 HttpException 的消息
        // 统一替换成「服务器内部错误」，运维就看不到「prod 没切」这个关键事实。
        throw new ServiceUnavailableException(
          `prod 指针未生效：写云数据库失败（${redactEndpoint(msg)}）。本地库已更新，` +
            `但 prod gateway 读的是云库，prod 仍运行旧版本。请检查云库公网连通性与白名单后重试发布。`,
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
      this.logger.warn(`legacy 指针（deploy_deployments）写云库失败，不阻断发布：${redactEndpoint(msg)}`);
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
   * 每张表的镜像唯一键（决定 INSERT ... ON DUPLICATE KEY UPDATE 是否命中已有行）。
   *
   * **必须取实体上的业务唯一键，不能用 uuid 主键**（除非该表没有业务唯一键）：
   * 主键是 TypeORM 本地生成的，同一行业务数据在本地删掉再重建时 uuid 会变，
   * 云库就会「老行 + 新行」并存。
   *
   * ⚠️ 例外：
   * - `deploy_service_routes`：实体唯一键是 `(service_key, env_id, path_prefix)`，但 `env_id` 可为 NULL，
   *   而 MySQL 唯一索引把 NULL 视为互不相等 → upsert 永远命中不了「全环境默认」那行，会插重复行。
   *   故这里退回 uuid 主键，配合 `deleteMirror()` 做删除补偿。
   * - `deploy_canary_rules`：实体上 `env_id + module_key` 只是普通索引（业务上允许同模块多条规则），
   *   没有可用业务唯一键，只能用主键。
   */
  static readonly MIRROR_UNIQUE_KEYS: Record<string, string[]> = {
    deploy_modules: ['key'],
    deploy_apps: ['key'],
    deploy_sites: ['key'],
    deploy_hosts: ['name', 'host'],
    deploy_envs: ['env_id'],
    deploy_endpoints: ['service_key', 'method', 'path_pattern'],
    deploy_services: ['key'],
    deploy_service_envs: ['service_key', 'env_id'],
    deploy_service_routes: ['id'],
    deploy_canary_rules: ['id'],
  };

  /** 镜像队列：保证写云库**永不阻塞业务写**（配置漂移不直接影响线上运行，design §6） */
  private queue = new Map<string, () => Promise<void>>();
  private draining = false;
  private scheduled = false;
  /** 连续失败计数，用于降低日志噪音（同一失败原因只报摘要） */
  private failureStreak = 0;

  /**
   * 镜像单行到云库（**异步不阻塞**，失败只告警）。
   *
   * @param table 白名单内的表名
   * @param entity TypeORM 实体（camelCase 键），内部自动转 snake_case 列名 + 序列化 json 列
   */
  mirrorRow(table: string, entity: object | null | undefined): void {
    if (!entity) return;
    this.enqueueMirror(table, [entity as Record<string, unknown>]);
  }

  /** 批量镜像多行（**异步不阻塞**） */
  mirrorEntities(table: string, entities: Array<object | null | undefined>): void {
    const rows = (entities || []).filter(Boolean) as Array<Record<string, unknown>>;
    if (!rows.length) return;
    this.enqueueMirror(table, rows);
  }

  /**
   * 删除补偿：`repo.delete()` / `repo.remove()` 这类**本地物理删除**不会通过任何写事件透出，
   * 必须由调用方显式通知，否则云库会长期留残留行。
   *
   * ⚠️ 残留行不是「脏数据」那么简单：gateway 读 `deploy_service_routes` / `deploy_endpoints`
   * 时会命中这些残留（比如 NULL env_id 的默认路由优先级最高），直接改变线上转发行为。
   *
   * @param table 白名单内的表名
   * @param where 删除条件（camelCase 键，自动转 snake_case）
   */
  deleteMirror(table: string, where: Record<string, unknown>): void {
    if (!this.cloud.enabled) return;
    if (!EnvSplitWriterService.MIRROR_TABLES.includes(table as never)) return;
    const cols = Object.keys(where || {}).filter((c) => where[c] !== undefined);
    if (!cols.length) {
      this.logger.warn(`deleteMirror(${table}) 条件为空，拒绝执行（防误删整表）`);
      return;
    }
    const run = async () => {
      await this.cloud.query(
        `DELETE FROM ${table} WHERE ${cols.map((c) => `\`${toSnake(c)}\` = ?`).join(' AND ')}`,
        cols.map((c) => normalizeValue(where[c])),
      );
      this.logger.log(`配置镜像删除云库：${table} WHERE ${cols.join(', ')}`);
    };
    this.enqueue(`del:${table}:${cols.map((c) => `${c}=${String(where[c])}`).join('&')}`, run);
  }

  /**
   * 等待镜像队列排空（**仅测试 / 进程退出前**使用）。
   * 业务路径一律不 await，避免公网抖动拖慢控制台操作。
   */
  async flush(): Promise<void> {
    // drain 已在跑就等它跑完；否则立即触发一次
    if (this.draining) {
      while (this.draining) await sleep(20);
      return;
    }
    await this.drain();
  }

  /** 入队：同一「表 + 唯一键」的多次写在 flush 前只保留最后一次（后覆盖前） */
  private enqueueMirror(table: string, rows: Array<Record<string, unknown>>): void {
    if (!this.cloud.enabled) return;
    if (!EnvSplitWriterService.MIRROR_TABLES.includes(table as never)) return;
    const uniqueKeys = EnvSplitWriterService.MIRROR_UNIQUE_KEYS[table] || ['id'];
    for (const row of rows) {
      const snake = toSnakeRow(row);
      const missing = uniqueKeys.filter((k) => snake[k] === undefined || snake[k] === null);
      if (missing.length) {
        this.logger.warn(
          `配置镜像跳过 ${table}：缺少唯一键 ${missing.join(', ')}（无法 upsert，行内容=${JSON.stringify(snake).slice(0, 120)}）`,
        );
        continue;
      }
      const key = uniqueKeys.map((k) => `${k}=${String(snake[k])}`).join('&');
      const run = async () => {
        const r = await this.mirrorRows(table, [snake], uniqueKeys);
        if (r.outcome === 'failed') this.failureStreak += 1;
        else this.failureStreak = 0;
      };
      this.enqueue(`upsert:${table}:${key}`, run);
    }
  }

  private enqueue(key: string, run: () => Promise<void>): void {
    this.queue.set(key, run);
    // 延迟到下一个事件循环再排空：同一 tick 内对同一行的多次写会被合并成最后一次，
    // 既避免了公网写放大，也保证写入内容始终是最新值。
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.size) {
        const [key, run] = this.queue.entries().next().value as [string, () => Promise<void>];
        this.queue.delete(key);
        try {
          await run();
        } catch (e) {
          // 配置镜像失败不阻断（design §6）；连续失败时降噪，避免刷爆日志
          const msg = redactEndpoint((e as Error).message);
          if (this.failureStreak <= 3) {
            this.logger.warn(`配置镜像写云库失败（${key.split(':')[1]}），不阻断：${msg}`);
          } else if (this.failureStreak === 4) {
            this.logger.warn(`配置镜像写云库持续失败，后续同类告警抑制：${msg}`);
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }

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

/**
 * 错误信息里的公网地址一律脱敏（IP:端口 / 云数据库域名）。
 * 异常消息会经 HTTP 响应回到控制台 UI 与流水线脚本日志，不该带上公网入口信息。
 */
function redactEndpoint(msg: string): string {
  return String(msg)
    .replace(/(\d{1,3}\.){3}\d{1,3}(:\d+)?/g, '<云库地址>')
    .replace(/[\w.-]+\.sql\.tencentcdb\.com(:\d+)?/g, '<云库地址>');
}

/**
 * camelCase → snake_case。
 *
 * TypeORM 主连接配了 `SnakeNamingStrategy`（app.module.ts），实体字段在库里一律是 snake_case，
 * 而镜像写用的是原生 SQL —— 列名必须自己转换，否则 SQL 报 Unknown column。
 * 这里的规则与 SnakeNamingStrategy 保持一致：`serviceKey → service_key`、`envId → env_id`。
 */
function toSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * 实体对象 → 可直接写库的行（列名 snake_case + 值序列化）。
 *
 * 为什么要序列化：`mysql2` 不接受 JS 对象作为 json 列的值（会报 "undefined/incorrect value"），
 * 也不接受 `undefined`。Date / Buffer 可原样透传。
 */
function toSnakeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[toSnake(k)] = normalizeValue(v);
  }
  return out;
}

function normalizeValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  // json 列（externals / config / match_rule 等）：mysql2 需要字符串或 Buffer
  if (typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
    return JSON.stringify(v);
  }
  return v;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
