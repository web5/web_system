import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CloudDbService } from '../cloud-db/cloud-db.service';

export interface ConsistencyDiff {
  table: string;
  /** 业务键（如 `portal@prod`） */
  key: string;
  field: string;
  local: unknown;
  cloud: unknown;
}

export interface ConsistencyReport {
  ranAt: number;
  /** 云库未启用 → skipped，不算失败也不算通过 */
  status: 'ok' | 'drift' | 'skipped' | 'error';
  reason?: string;
  /** 本次比对的 prod 行数 */
  checkedRows: number;
  diffs: ConsistencyDiff[];
}

/**
 * 比对的**业务唯一键**（行级对齐用）。
 * `id` 是 uuid、两库各自生成，不能用来对齐（M5 脚本同样忽略它）。
 */
const UNIQUE_KEYS: Record<string, string[]> = {
  deploy_app_env_versions: ['app_key', 'env_id'],
  deploy_deployments: ['module_key', 'env_id'],
};

/**
 * 不做比对的行外字段：两库**本就允许不同**（写入时序 / 操作人 / 审计信息）。
 * 与 scripts/check-cloud-db-consistency.sh 保持一致，否则噪音会淹没真实漂移。
 */
const IGNORED_FIELDS = new Set([
  'id',
  'task_id',
  'deployed_by',
  'deployed_at',
  'created_at',
  'updated_at',
]);

/** 默认巡检间隔（可配 `CONSISTENCY_CHECK_INTERVAL_MS`，0 = 关闭） */
export const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 首次巡检延迟（默认 60s）：别让启动瞬间多一条云库往返 */
const DEFAULT_FIRST_DELAY_MS = 60 * 1000;

/**
 * 两库一致性定时巡检（诊断 #13）。
 *
 * 背景：`scripts/check-cloud-db-consistency.sh` 能发现漂移，但**没人定时跑它**
 * （全仓无 cron），于是「镜像失败 / `DEPLOY_CLOUD_DB_ENABLED=false`」这类问题
 * 只有在人想起来时才被发现——而它恰恰是 prod 发布是否真的生效的**唯一信号**。
 *
 * 只比对**指针表**：那是 gateway 的读取源，漂移 = 线上跑的不是你以为的版本。
 * 配置表由 M5 脚本按需巡检（行多、且漂移不直接影响线上加载）。
 *
 * 不引 `@nestjs/schedule`：一个 interval 就够，没必要为一个定时任务加依赖。
 * `CONSISTENCY_CHECK_INTERVAL_MS=0` 可完全关闭。
 */
@Injectable()
export class ConsistencyWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsistencyWatchService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private firstTimer: ReturnType<typeof setTimeout> | undefined;
  private last: ConsistencyReport | undefined;

  constructor(
    private readonly cfg: ConfigService,
    private readonly cloud: CloudDbService,
    @InjectDataSource() private readonly local: DataSource,
  ) {}

  onModuleInit(): void {
    const raw = Number(this.cfg.get<string>('CONSISTENCY_CHECK_INTERVAL_MS'));
    const interval =
      Number.isFinite(raw) && raw >= 0 && String(this.cfg.get('CONSISTENCY_CHECK_INTERVAL_MS') ?? '') !== ''
        ? raw
        : DEFAULT_CHECK_INTERVAL_MS;
    if (interval <= 0) {
      this.logger.log('两库一致性巡检已关闭（CONSISTENCY_CHECK_INTERVAL_MS=0）');
      return;
    }

    const run = () => {
      void this.check().catch((e) => this.logger.error(`一致性巡检异常：${(e as Error).message}`));
    };
    const delayMs = Number(this.cfg.get<string>('CONSISTENCY_CHECK_FIRST_DELAY_MS')) || DEFAULT_FIRST_DELAY_MS;
    this.firstTimer = setTimeout(() => {
      run();
      this.timer = setInterval(run, interval);
      // unref：定时器不该拖住进程退出（也避免测试环境被它挂住）
      (this.timer as unknown as { unref?: () => void })?.unref?.();
    }, delayMs);
    (this.firstTimer as unknown as { unref?: () => void })?.unref?.();
    this.logger.log(
      `两库一致性巡检已启用：每 ${Math.round(interval / 60000)} 分钟一次（首次 ${Math.round(
        delayMs / 1000,
      )}s 后）`,
    );
  }

  onModuleDestroy(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
  }

  /** 最近一次巡检结果（供诊断接口/页面展示；未跑过时 undefined） */
  lastReport(): ConsistencyReport | undefined {
    return this.last;
  }

  /** 执行一次比对（定时触发 / 手动触发共用） */
  async check(): Promise<ConsistencyReport> {
    const ranAt = Date.now();
    if (!this.cloud.enabled) {
      const report: ConsistencyReport = {
        ranAt,
        status: 'skipped',
        reason: '云库未启用（DEPLOY_CLOUD_DB_ENABLED≠true）',
        checkedRows: 0,
        diffs: [],
      };
      this.last = report;
      return report;
    }

    try {
      const diffs: ConsistencyDiff[] = [];
      let checkedRows = 0;

      for (const table of Object.keys(UNIQUE_KEYS)) {
        const cols = await this.comparableColumns(table);
        if (!cols.length) continue;

        const select = [...UNIQUE_KEYS[table], ...cols].map((c) => `\`${c}\``).join(', ');
        const sql = `SELECT ${select} FROM \`${table}\` WHERE env_id = ?`;
        const localRows = (await this.local.query(sql, ['prod'])) as Record<string, unknown>[];
        const cloudRows = (await this.cloud.query(sql, ['prod'])) as Record<string, unknown>[];

        checkedRows += localRows.length;
        diffs.push(...this.diffRows(table, localRows, cloudRows, cols));
      }

      const report: ConsistencyReport = {
        ranAt,
        status: diffs.length ? 'drift' : 'ok',
        checkedRows,
        diffs,
      };
      this.last = report;

      if (diffs.length) {
        // 漂移 = prod 线上可能跑的不是平台以为的版本 → 必须留痕
        this.logger.error(
          `两库一致性巡检发现 ${diffs.length} 处漂移（prod 指针/配置可能未同步）：` +
            diffs.slice(0, 5).map((d) => `${d.table}[${d.key}].${d.field}: 本地=${String(d.local)} 云库=${String(d.cloud)}`).join('；'),
        );
      } else {
        this.logger.log(`两库一致性巡检通过（prod 指针 ${checkedRows} 行一致）`);
      }
      return report;
    } catch (e) {
      const report: ConsistencyReport = {
        ranAt,
        status: 'error',
        reason: (e as Error).message,
        checkedRows: 0,
        diffs: [],
      };
      this.last = report;
      this.logger.error(`两库一致性巡检失败：${(e as Error).message}`);
      return report;
    }
  }

  /** 取该表参与比对的列（以本地库为准，排除允许不同的字段） */
  private async comparableColumns(table: string): Promise<string[]> {
    const rows = (await this.local.query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    )) as { name: string }[];
    return rows
      .map((r) => r.name)
      .filter((c) => !IGNORED_FIELDS.has(c) && !UNIQUE_KEYS[table].includes(c));
  }

  /** 按业务键对齐后逐字段比对；只存在于一侧的行也算漂移 */
  private diffRows(
    table: string,
    localRows: Record<string, unknown>[],
    cloudRows: Record<string, unknown>[],
    cols: string[],
  ): ConsistencyDiff[] {
    const keys = UNIQUE_KEYS[table];
    const keyOf = (r: Record<string, unknown>) => keys.map((k) => String(r[k])).join('@');
    const cloudMap = new Map(cloudRows.map((r) => [keyOf(r), r]));
    const localMap = new Map(localRows.map((r) => [keyOf(r), r]));
    const diffs: ConsistencyDiff[] = [];

    for (const [key, lr] of localMap) {
      const cr = cloudMap.get(key);
      if (!cr) {
        diffs.push({ table, key, field: '(行)', local: '存在', cloud: '缺失' });
        continue;
      }
      for (const c of cols) {
        const a = lr[c];
        const b = cr[c];
        if (!sameValue(a, b)) diffs.push({ table, key, field: c, local: a, cloud: b });
      }
    }
    for (const key of cloudMap.keys()) {
      if (!localMap.has(key)) {
        diffs.push({ table, key, field: '(行)', local: '缺失', cloud: '存在' });
      }
    }
    return diffs;
  }
}

/** 值比较：Buffer/Date/数字与字符串要能互相认（两库驱动返回类型可能不同） */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    return na === nb;
  }
  return String(a) === String(b);
}
