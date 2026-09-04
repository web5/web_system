import { BadRequestException } from '@nestjs/common';

/** SQL 控制台单次查询返回的最大行数 */
export const MAX_ROWS = 200;

/**
 * 危险关键词（用 \b 词边界匹配，避免误伤 `deleted`、`offset` 这类含关键词的子串）
 */
const DANGEROUS_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'create', 'truncate',
  'replace', 'rename', 'grant', 'revoke',
  'lock', 'unlock', 'set', 'call', 'exec', 'execute',
  'handler', 'load_file', 'sleep', 'benchmark',
];

/** 危险短语（含空格，用 includes 匹配） */
const DANGEROUS_PHRASES = ['into outfile', 'into dumpfile'];

/**
 * 校验并返回可安全执行的只读 SQL
 *
 * 通过校验后会在**外层包裹**一层 `SELECT * FROM (...) AS _ws_t LIMIT 200`：
 * - 用户自带 LIMIT 500 → 最终仍只返回 200 行
 * - 用户自带 LIMIT 10 / OFFSET → 语义不受破坏（替换 LIMIT 的方案会破坏 OFFSET）
 *
 * @throws BadRequestException 任一规则不通过
 */
export function assertReadOnlySql(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new BadRequestException('SQL 不能为空');
  }

  // 去掉末尾分号（允许 `SELECT 1;` 这种常见写法）
  const sql = raw.trim().replace(/;+\s*$/, '');

  // 去掉末尾分号后仍含分号 → 多语句
  if (sql.includes(';')) {
    throw new BadRequestException('仅允许执行单条语句');
  }

  // 注释符可用于绕过关键词检测（如 `SEL/**/ECT`、尾部 `--` 截断）
  if (/--|\/\*|\*\/|#/.test(sql)) {
    throw new BadRequestException('禁止在 SQL 中使用注释');
  }

  const lower = sql.toLowerCase();

  if (!/^\s*select\b/.test(lower)) {
    throw new BadRequestException('仅允许执行 SELECT 查询');
  }

  for (const kw of DANGEROUS_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`).test(lower)) {
      throw new BadRequestException(`禁止的关键词：${kw.toUpperCase()}`);
    }
  }

  for (const phrase of DANGEROUS_PHRASES) {
    if (lower.includes(phrase)) {
      throw new BadRequestException(`禁止的语句：${phrase.toUpperCase()}`);
    }
  }

  // 系统库：表列表功能需要 information_schema，但 mysql 库必须拒绝
  if (/\bmysql\s*\./.test(lower)) {
    throw new BadRequestException('禁止访问 mysql 系统库');
  }

  return `SELECT * FROM (${sql}) AS _ws_t LIMIT ${MAX_ROWS}`;
}
