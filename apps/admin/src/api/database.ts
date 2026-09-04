/**
 * Admin - 数据浏览器（database 模块）
 *
 * 后端：system-service
 * 接口前缀：/api/admin/db（gateway 通配代理 → system-service /admin/db）
 * 响应经 request.ts 拦截器 unwrap 出 { code, data } 中的 data。
 */
import request from './request';

export type SensitiveLevel = 'none' | 'hidden' | 'masked';

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

export interface TableSchema {
  tableName: string;
  comment: string | null;
  columns: DbColumnInfo[];
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>;
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

export interface RowQueryParams {
  page: number;
  pageSize: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

/** 业务表列表（敏感表仅 super_admin 可见，由后端过滤） */
export function listDbTables(): Promise<DbTableInfo[]> {
  return request.get('/admin/db/tables');
}

/** 表结构（字段 + 索引，标注敏感级别） */
export function getDbSchema(table: string): Promise<TableSchema> {
  return request.get(`/admin/db/tables/${encodeURIComponent(table)}/schema`);
}

/** 分页查询表数据（服务端自动脱敏） */
export function getDbRows(table: string, params: RowQueryParams): Promise<RowsResult> {
  return request.get(`/admin/db/tables/${encodeURIComponent(table)}/rows`, { params });
}

/** 执行只读 SQL（仅 super_admin，自动 LIMIT 200 并写审计日志） */
export function runDbSql(sql: string): Promise<SqlResult> {
  return request.post('/admin/db/query', { sql });
}
