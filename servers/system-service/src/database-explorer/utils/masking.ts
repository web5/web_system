/**
 * 字段脱敏工具（数据浏览器专用）
 *
 * 设计原则：脱敏一律在**后端**完成，前端只负责展示后端返回的值与标注，
 * 避免"前端藏了但接口把明文吐出去"这类假脱敏。
 */

export type SensitiveLevel = 'none' | 'hidden' | 'masked';

/** 完全隐藏：凭证类，任何角色都不返回原值 */
const HIDDEN_PATTERNS = [
  'password',
  'secret',
  'token',
  'api_key',
  'apikey',
  'private_key',
  'session_key',
  'salt',
  'credential',
];

/** 打码：个人信息类，保留首尾便于人工核对，super_admin 可申请明文 */
const MASKED_PATTERNS = [
  'phone',
  'mobile',
  'id_card',
  'idcard',
  'openid',
  'unionid',
  'email',
];

export const MASK_PLACEHOLDER = '***';

/**
 * 判定字段的敏感级别
 * @param column 列名（大小写不敏感，子串匹配）
 */
export function detectSensitive(column: string): SensitiveLevel {
  const c = column.toLowerCase();
  if (HIDDEN_PATTERNS.some((p) => c.includes(p))) return 'hidden';
  if (MASKED_PATTERNS.some((p) => c.includes(p))) return 'masked';
  return 'none';
}

/**
 * 对单个字符串打码
 * - 邮箱：`kevin@example.com` → `k***@example.com`
 * - 常规：`13812348888` → `138****8888`（保留前 3 后 4）
 * - 过短（≤4）全星；≤7 保留首尾各 1 位
 */
export function maskString(value: string): string {
  const v = value.trim();
  if (!v) return v;

  if (v.includes('@')) {
    const at = v.indexOf('@');
    const local = v.slice(0, at);
    const domain = v.slice(at + 1);
    return `${local.slice(0, 1)}***@${domain}`;
  }

  if (v.length <= 4) return '*'.repeat(v.length);
  if (v.length <= 7) return `${v.slice(0, 1)}***${v.slice(-1)}`;
  return `${v.slice(0, 3)}****${v.slice(-4)}`;
}

/**
 * 按敏感级别处理单个值
 * - hidden → 固定占位符 `***`
 * - masked → 字符串走 maskString；数字先转字符串；其余类型（JSON/布尔/空）不脱敏
 * - none   → 原值返回
 */
export function applyMask(value: unknown, level: SensitiveLevel): unknown {
  if (level === 'none' || value === null || value === undefined) return value;

  if (level === 'hidden') return MASK_PLACEHOLDER;

  if (typeof value === 'string') return maskString(value);
  if (typeof value === 'number') return maskString(String(value));

  // Buffer / 对象 / 布尔等不逐项处理：命中 masked 但非标量时整体隐藏，避免漏脱敏
  return MASK_PLACEHOLDER;
}

/**
 * 对一行数据按列的敏感级别批量脱敏
 * @param row 原始行
 * @param levels 列名 → 敏感级别
 */
export function maskRow(
  row: Record<string, unknown>,
  levels: Record<string, SensitiveLevel>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = applyMask(value, levels[key] ?? 'none');
  }
  return out;
}
