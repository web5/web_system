import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { detectSensitive, maskRow, SensitiveLevel } from './utils/masking';
import { assertReadOnlySql, MAX_ROWS } from './utils/sql-guard';

/** 框架自用的元数据表，不向业务展示 */
const EXCLUDED_TABLES = ['migrations', 'typeorm_metadata'];

export interface DbTableInfo {
  name: string;
  comment: string | null;
  rows: number;
  sizeBytes: number;
  engine: string | null;
  createdAt: string | null;
  sensitive: boolean;
}

export interface DbColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  key: string;
  comment: string | null;
  sensitive: SensitiveLevel;
}

export interface DbIndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface TableSchema {
  tableName: string;
  comment: string | null;
  columns: DbColumnInfo[];
  indexes: DbIndexInfo[];
}

export interface RowsResult {
  tableName: string;
  columns: Array<{ name: string; sensitive: SensitiveLevel }>;
  rows: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
}

export interface SqlResult {
  columns: Array<{ name: string; sensitive: SensitiveLevel }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

export interface QueryContext {
  username: string;
  ip?: string;
}

/**
 * 数据浏览器服务
 *
 * 所有查询都走名为 'readonly' 的独立只读连接 —— 即便应用层校验被绕过，
 * 数据库账号本身也没有写权限。
 */
@Injectable()
export class DatabaseExplorerService {
  private readonly logger = new Logger(DatabaseExplorerService.name);
  private readonly sensitiveTables: Set<string>;

  constructor(
    @InjectDataSource('readonly') private readonly ro: DataSource,
    private readonly config: ConfigService,
    private readonly logs: OperationLogsService,
  ) {
    const raw = this.config.get<string>('DB_SENSITIVE_TABLES', '') || '';
    this.sensitiveTables = new Set(raw.split(',').map((t) => t.trim()).filter(Boolean));
  }

  // ── 表列表 ────────────────────────────────────────────────

  async listTables(opts: { canSeeSensitive: boolean }): Promise<DbTableInfo[]> {
    const rows = await this.ro.query(
      // 注意：ROWS 是 MySQL 8 保留字，别名必须改名（rowCount）不能直接用 rows
      `SELECT TABLE_NAME AS \`name\`,
              TABLE_COMMENT AS \`comment\`,
              TABLE_ROWS AS \`rowCount\`,
              DATA_LENGTH + INDEX_LENGTH AS \`sizeBytes\`,
              ENGINE AS \`engine\`,
              CREATE_TIME AS \`createdAt\`
         FROM information_schema.tables
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
      [this.databaseName()],
    );

    return (rows as Array<Record<string, unknown>>)
      .filter((r) => !EXCLUDED_TABLES.includes(String(r.name)))
      .filter((r) => opts.canSeeSensitive || !this.sensitiveTables.has(String(r.name)))
      .map((r) => ({
        name: String(r.name),
        comment: r.comment ? String(r.comment) : null,
        rows: Number(r.rowCount ?? 0),
        sizeBytes: Number(r.sizeBytes ?? 0),
        engine: r.engine ? String(r.engine) : null,
        createdAt: r.createdAt ? new Date(String(r.createdAt)).toISOString() : null,
        sensitive: this.sensitiveTables.has(String(r.name)),
      }));
  }

  // ── 表结构 ────────────────────────────────────────────────

  async getSchema(tableName: string): Promise<TableSchema> {
    await this.assertTableAllowed(tableName);
    const dbName = this.databaseName();

    const colRows = await this.ro.query(
      `SELECT COLUMN_NAME AS name,
              COLUMN_TYPE AS type,
              IS_NULLABLE AS nullable,
              COLUMN_DEFAULT AS defaultValue,
              COLUMN_KEY AS \`key\`,
              COLUMN_COMMENT AS comment
         FROM information_schema.columns
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [dbName, tableName],
    );

    const idxRows = await this.ro.query(
      `SELECT INDEX_NAME AS name,
              COLUMN_NAME AS columnName,
              NON_UNIQUE AS nonUnique,
              SEQ_IN_INDEX AS seq
         FROM information_schema.statistics
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [dbName, tableName],
    );

    const tblRows = await this.ro.query(
      `SELECT TABLE_COMMENT AS comment
         FROM information_schema.tables
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [dbName, tableName],
    );

    const columns: DbColumnInfo[] = (colRows as Array<Record<string, unknown>>).map((r) => ({
      name: String(r.name),
      type: String(r.type),
      nullable: String(r.nullable).toUpperCase() === 'YES',
      defaultValue: r.defaultValue === null || r.defaultValue === undefined
        ? null
        : String(r.defaultValue),
      key: String(r.key ?? ''),
      comment: r.comment ? String(r.comment) : null,
      sensitive: detectSensitive(String(r.name)),
    }));

    // 索引按名称聚合（复合索引的多列合并为一条）
    const indexMap = new Map<string, DbIndexInfo>();
    for (const r of idxRows as Array<Record<string, unknown>>) {
      const name = String(r.name);
      const existing = indexMap.get(name);
      if (existing) {
        existing.columns.push(String(r.columnName));
      } else {
        indexMap.set(name, {
          name,
          columns: [String(r.columnName)],
          unique: Number(r.nonUnique) === 0,
        });
      }
    }

    return {
      tableName,
      comment: tblRows[0]?.comment ? String(tblRows[0].comment) : null,
      columns,
      indexes: [...indexMap.values()],
    };
  }

  // ── 分页数据 ──────────────────────────────────────────────

  async getRows(
    tableName: string,
    params: { page: number; pageSize: number; sortField?: string; sortOrder?: 'asc' | 'desc' },
  ): Promise<RowsResult> {
    await this.assertTableAllowed(tableName);

    const page = Math.max(1, params.page);
    const pageSize = Math.min(MAX_ROWS, Math.max(1, params.pageSize));
    const columnNames = await this.getColumnNames(tableName);

    let orderBy = '';
    if (params.sortField) {
      if (!columnNames.includes(params.sortField)) {
        throw new BadRequestException(`无效的排序列：${params.sortField}`);
      }
      const dir = params.sortOrder === 'asc' ? 'ASC' : 'DESC';
      orderBy = ` ORDER BY ${this.escapeId(params.sortField)} ${dir}`;
    }

    const countRows = await this.ro.query(
      `SELECT COUNT(*) AS total FROM ${this.escapeId(tableName)}`,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const rawRows = await this.ro.query(
      `SELECT * FROM ${this.escapeId(tableName)}${orderBy} LIMIT ? OFFSET ?`,
      [pageSize, (page - 1) * pageSize],
    );

    return {
      tableName,
      columns: columnNames.map((name) => ({ name, sensitive: detectSensitive(name) })),
      rows: this.maskRows(rawRows as Array<Record<string, unknown>>, columnNames),
      total,
      page,
      pageSize,
    };
  }

  // ── 只读 SQL ──────────────────────────────────────────────

  /** 执行受限的只读 SQL；无论成功失败都写审计日志（AC-27） */
  async runQuery(rawSql: string, ctx: QueryContext): Promise<SqlResult> {
    const safeSql = assertReadOnlySql(rawSql);
    const started = Date.now();

    let rawRows: Array<Record<string, unknown>>;
    try {
      rawRows = await this.ro.query(safeSql);
    } catch (error) {
      const elapsedMs = Date.now() - started;
      await this.audit(ctx, rawSql, -1, elapsedMs, 'failed');
      const message = (error as Error).message;
      this.logger.warn(`SQL 执行失败（${ctx.username}）：${message}`);
      throw new BadRequestException(`SQL 执行失败：${message}`);
    }

    const elapsedMs = Date.now() - started;
    const columnNames = rawRows.length ? Object.keys(rawRows[0]) : [];

    const result: SqlResult = {
      columns: columnNames.map((name) => ({ name, sensitive: detectSensitive(name) })),
      rows: this.maskRows(rawRows, columnNames),
      rowCount: rawRows.length,
      truncated: rawRows.length >= MAX_ROWS,
      elapsedMs,
    };

    await this.audit(ctx, rawSql, result.rowCount, elapsedMs, 'success');
    return result;
  }

  // ── 内部方法 ──────────────────────────────────────────────

  private maskRows(
    rows: Array<Record<string, unknown>>,
    columnNames: string[],
  ): Array<Record<string, unknown>> {
    const levels: Record<string, SensitiveLevel> = {};
    for (const name of columnNames) {
      levels[name] = detectSensitive(name);
    }
    return rows.map((row) => maskRow(row, levels));
  }

  /** 表名白名单校验：必须真实存在于当前库 */
  private async assertTableAllowed(tableName: string): Promise<void> {
    const names = await this.loadTableNames();
    if (!names.has(tableName)) {
      throw new BadRequestException(`表不存在或不允许访问：${tableName}`);
    }
  }

  private async loadTableNames(): Promise<Set<string>> {
    const rows = await this.ro.query(
      `SELECT TABLE_NAME AS name
         FROM information_schema.tables
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [this.databaseName()],
    );
    return new Set(
      (rows as Array<Record<string, unknown>>)
        .map((r) => String(r.name))
        .filter((name) => !EXCLUDED_TABLES.includes(name)),
    );
  }

  private async getColumnNames(tableName: string): Promise<string[]> {
    const rows = await this.ro.query(
      `SELECT COLUMN_NAME AS name
         FROM information_schema.columns
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [this.databaseName(), tableName],
    );
    return (rows as Array<Record<string, unknown>>).map((r) => String(r.name));
  }

  /** 转义标识符（表名 / 列名）：MySQL 用反引号包裹，内部反引号双写 */
  private escapeId(id: string): string {
    return '`' + id.replace(/`/g, '``') + '`';
  }

  private databaseName(): string {
    return this.config.get<string>('DB_DATABASE', 'web_system') || 'web_system';
  }

  /**
   * 写审计日志
   * operation_logs 表没有 detail 字段，SQL 摘要拼进 target（上限 255 字符）
   */
  private async audit(
    ctx: QueryContext,
    sql: string,
    rowCount: number,
    elapsedMs: number,
    status: 'success' | 'failed',
  ): Promise<void> {
    try {
      const flat = sql.replace(/\s+/g, ' ').trim();
      const target = `[${status}] ${flat} | ${rowCount} 行 | ${elapsedMs}ms`;
      await this.logs.log({
        operator: ctx.username || 'unknown',
        type: 'database_query',
        target: target.slice(0, 255),
        ip: ctx.ip || '0.0.0.0',
      });
    } catch (error) {
      // 审计失败不应阻断查询
      this.logger.error(`审计日志写入失败：${(error as Error).message}`);
    }
  }
}
