/**
 * 日志 / 异常统一脱敏（诊断 #8）。
 *
 * 背景：`INTERNAL_API_KEY` 被平台注入为脚本变量 `CONSOLE_TOKEN`
 * （`pipeline.service.ts:419-420`），动作脚本在 shell 里跑。脚本里只要有一句
 * `set -x`，bash 就会把 `+ curl -H "x-internal-key: <真实 key>"` 回显到 stderr；
 * 而 `shell-runner` 此前是把 stdout/stderr **原样**落库并展示在 UI 上的
 * （`shell-runner.ts:101-107`）—— 一次误开就永久写进 `deploy_tasks.logs`。
 *
 * 同一条链路还有两处：远端 ssh 命令的回显（`deploy.service.ts` 的 sshRun）、
 * 以及云库连接失败时的异常消息（含公网地址与库密码）。
 *
 * 设计取舍：
 * - **双层**：① 进程内已知敏感 env 的**值**直接整体替换（最可靠，无正则误伤）；
 *   ② 值未知时按**名称/形状**匹配（`KEY=value`、`-H "x-internal-key: …"`、
 *   `Bearer …`、URL userinfo），覆盖「值来自别处」的情况
 * - **短值不脱敏**（< 6 字符）：`PORT=0`、`KEEP_VERSIONS=5` 这类不是凭据，
 *   脱了反而让日志没法排障
 * - **纯函数 + 可注入 env**：便于单测；生产用 `process.env` 懒加载并缓存
 */

/** 脱敏占位符 */
export const REDACTED = '***REDACTED***';

/** 进程内已知敏感值的 env 名（值命中即整体替换） */
export const SECRET_ENV_KEYS = [
  'INTERNAL_API_KEY',
  'CONSOLE_TOKEN',
  'CONFIG_MASTER_KEY',
  'CONFIG_MASTER_KEY_FILE',
  'JWT_SECRET',
  'DEPLOY_CLOUD_DB_PASSWORD',
  'MYSQL_PASSWORD',
  'DB_PASSWORD',
  'MCP_ADMIN_KEY',
] as const;

/** 短于此长度的值不当作真实凭据，避免误伤 `PORT=0` 之类 */
export const MIN_SECRET_LEN = 6;

type Env = Record<string, string | undefined>;

/** 转义正则元字符 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 收集进程内已知的敏感值（去重、过滤短值、长的排前面避免短值先匹配截断）。
 */
export function collectSecretValues(env: Env = process.env, extra: string[] = []): string[] {
  const vals: string[] = [];
  for (const k of SECRET_ENV_KEYS) {
    const v = env[k];
    if (v && v.trim().length >= MIN_SECRET_LEN) vals.push(v.trim());
  }
  for (const v of extra) {
    if (v && v.trim().length >= MIN_SECRET_LEN) vals.push(v.trim());
  }
  return Array.from(new Set(vals)).sort((a, b) => b.length - a.length);
}

/**
 * 按「名称 / 形状」匹配（值未知时兜底）。
 * 每条规则都保留前缀（第 1 组），只替换值部分 —— 这样排障时仍能看出
 * 「哪一行、哪个变量被脱敏了」，而不是整行变成一个黑洞。
 */
const SHAPE_PATTERNS: RegExp[] = [
  // KEY=value / KEY: value / "KEY": "value"（env 赋值、JSON、curl -H、set -x 回显）
  /\b((?:CONSOLE_TOKEN|INTERNAL_API_KEY|CONFIG_MASTER_KEY|MCP_ADMIN_KEY|ACCESS_TOKEN|API_KEY|APIKEY|SECRET|PASSWORD|PASSWD|TOKEN)\s*["']?\s*[:=]\s*)(["']?)([^"'\s,;}&]+)\2/gi,
  // -H "x-internal-key: xxx"（curl 头，值里可能有 - 和 .）
  /\b(x-internal-key\s*:\s*)([^\s"',}]+)/gi,
  // Authorization: Bearer xxx
  /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{6,})/gi,
  // URL userinfo：mysql://root:pass@host、redis://:pass@host
  /\b([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)([^@\s]+)(@)/gi,
];

/**
 * 公网地址（云库域名 / IP:端口）。
 *
 * **不并入默认脱敏器**：脚本日志里满是 `curl http://127.0.0.1:6200/...`，
 * 一刀切会把排障最需要的信息也抹掉。只有明确要出站的消息（云库连接错误）
 * 才走 `redactSecretsAndAddress`。
 */
const ADDRESS_PATTERNS: RegExp[] = [
  /((\d{1,3}\.){3}\d{1,3})(:\d+)?/g,
  /[\w.-]+\.sql\.tencentcdb\.com(:\d+)?/g,
];

export interface Redactor {
  (text: string): string;
}

/**
 * 构造脱敏器（纯函数）。把「收集值」与「替换」拆开是为了让替换逻辑可测，
 * 且值只需收集一次（日志逐行调用时不能每次都扫 env）。
 */
export function createRedactor(values: string[] = collectSecretValues()): Redactor {
  // 已知值：整体替换。长值优先（上面已按长度倒序），避免短值是长值前缀时截断
  const valueRe = values.length
    ? new RegExp(values.map(escapeRe).join('|'), 'g')
    : null;

  return (text: string): string => {
    if (text === null || text === undefined) return text;
    let out = String(text);

    if (valueRe) out = out.replace(valueRe, REDACTED);

    for (const re of SHAPE_PATTERNS) {
      // 第 1 组是前缀（保留：看得出是哪个变量被脱敏）；值统一替换成占位符。
      // 三条规则的组数不同：2 组=前缀+值，3 组=前缀+引号+值，4 组=URL userinfo。
      out = out.replace(re, (_m, ...groups: unknown[]) => {
        const [g1 = '', , g3 = ''] = groups as string[];
        return g3 === '@' ? `${g1}${REDACTED}@` : `${g1}${REDACTED}`;
      });
    }

    return out;
  };
}

/** 进程级默认脱敏器（懒加载 + 缓存；env 在进程生命周期内不变） */
let cached: Redactor | null = null;

/** 脱敏凭据（脚本日志、异常消息的统一出口） */
export function redactSecrets(text: string): string {
  if (!cached) cached = createRedactor();
  return cached(text);
}

/** 凭据 + 公网地址：仅用于会出站的云库错误消息 */
export function redactSecretsAndAddress(text: string): string {
  let out = redactSecrets(text);
  for (const re of ADDRESS_PATTERNS) out = out.replace(re, '<address>');
  return out;
}

/** 测试/配置重载后强制重建（如配置中心下发了新凭据） */
export function resetRedactor(): void {
  cached = null;
}

/**
 * 对象/数组深脱敏：审计 payload、异常上下文落库前用。
 * 只处理 string（数字/布尔不含凭据）；循环引用由 WeakSet 兜住。
 */
export function redactDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value === 'string') return redactSecrets(value) as unknown as T;
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, seen)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactDeep(v, seen);
  }
  return out as T;
}
