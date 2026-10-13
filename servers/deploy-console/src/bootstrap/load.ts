/**
 * console **两阶段自举** —— 让 console 自己「不依赖部署环境」（设计 §3.6）。
 *
 * 现状：console 的配置全在 `servers/deploy-console/.env`（30 个键），换一台机器部署
 * 就得把这份文件整个复制过去。「不依赖部署环境」不是说零配置 —— 读配置中心要先连库、
 * 解密钥要先有主密钥，鸡生蛋躲不掉 —— 而是把依赖**收敛到三个键，且键名在任何环境都
 * 一样**：
 *
 * ```
 * 阶段 0 · bootstrap（进程环境或 .env.bootstrap，仅 3 项）
 *     CONSOLE_ENV_ID            我是哪个环境（local/dev/prod）
 *     CONSOLE_DB_DSN            我连哪个库（mysql://user:pass@host:port/db）
 *     CONFIG_MASTER_KEY(_FILE)  主密钥（env 值或 0600 文件路径）
 *
 * 阶段 1 · 拉配置
 *     连库 → 读 global + env:<id> + module:deploy-console
 *     → 解密密钥 → 合并进 process.env（bootstrap 键与基础设施连接键除外）
 *
 * 阶段 2 · 正常 Nest 启动（ConfigModule 读合并后的 process.env）
 * ```
 *
 * 三条硬约束（都在代码里有对应实现，不是口头约定）：
 *
 * 1. **绝不给自己写 `.env.generated`**。落盘会触发发布钩子 → console 重启自己 →
 *    又落盘，自杀式循环。只做进程内合并（M2 通道）。
 * 2. **基础设施连接键硬保护**。见 {@link PROTECTED_ENV_KEYS}：一条误配把 `DB_HOST`
 *    落到 app 层，就能把发布系统连到别的库。数据层的 `layer` 表达「意图」，
 *    这里的名单是「兜底」，两者缺一不可。
 * 3. **渐进切换，不搞一刀切**。现网 dev/prod 的 `.env` 里没有 `CONSOLE_ENV_ID`，
 *    若缺失即 FATAL，等于要求先改部署才能升级代码 —— 发布工具自身不该这么升级。
 *    故：只有显式提供 `CONSOLE_ENV_ID` 才进入严格模式（缺另外两键即 FATAL + 指引）；
 *    否则按现状启动并告警，等运维侧把三键补上再自动切换。
 */
import { Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { decryptSecret, masterKeyFingerprint, masterKeySource } from '../config/config-crypto';

const logger = new Logger('Bootstrap');

/** bootstrap 三键：模式判定的依据是**是否显式声明了 CONSOLE_ENV_ID** */
export const BOOTSTRAP_KEYS = ['CONSOLE_ENV_ID', 'CONSOLE_DB_DSN', 'CONFIG_MASTER_KEY'] as const;

/**
 * 永不被配置中心覆盖的键（硬保护，与 `layer='bootstrap'` 互为兜底）。
 *
 * 为什么名单里连 `DB_SYNCHRONIZE` 都有：那是「TypeORM 自动改表」的开关，一旦被配置
 * 中心误开，console 启动就会去改线上表结构 —— 属于「宁可麻烦也不可自动化」的一类。
 */
export const PROTECTED_ENV_KEYS: ReadonlySet<string> = new Set([
  // 自举三键本身
  'CONSOLE_ENV_ID',
  'CONSOLE_DB_DSN',
  'CONFIG_MASTER_KEY',
  'CONFIG_MASTER_KEY_FILE',
  // 数据库连接（配置中心自己就住在这个库里，下发它等于把可用性单点套在自己身上）
  'DB_TYPE',
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
  'MYSQL_HOST',
  'MYSQL_PORT',
  'MYSQL_USER',
  'MYSQL_PASSWORD',
  'MYSQL_DB',
  'REDIS_URL',
  // 危险行为开关
  'DB_SYNCHRONIZE',
]);

/** 连接超时：bootstrap 卡住会拖住整个发布系统，宁可快失败 */
const CONNECT_TIMEOUT_MS = 5000;

/** 本服务在配置中心里的模块 key（阶段 1 拉取 module 级条目用） */
const SELF_MODULE_KEY = 'deploy-console';

export interface ConsoleDsn {
  driver: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * 解析 `CONSOLE_DB_DSN`。
 *
 * 只支持 `mysql://`（dev/prod 都是 MySQL）；遇到其它 driver 明确抛错而不是猜 ——
 * 解析错一个字符就会连到别的库，这种错必须当场炸。
 *
 * 密码走 `decodeURIComponent`：DSN 里含 `@` `:` `/` 等特殊字符时必须百分号编码，
 * 否则无法与分隔符区分（线上密码常带特殊字符，这不是理论问题）。
 */
export function parseConsoleDsn(raw: string): ConsoleDsn {
  const dsn = String(raw || '').trim();
  if (!dsn) throw new Error('CONSOLE_DB_DSN 为空');
  if (!/^mysql:\/\//i.test(dsn)) {
    throw new Error(
      `CONSOLE_DB_DSN 只支持 mysql:// 形式（当前值以 "${dsn.slice(0, dsn.indexOf(':') + 1)}" 开头）`,
    );
  }
  let u: URL;
  try {
    u = new URL(dsn);
  } catch (e) {
    throw new Error(`CONSOLE_DB_DSN 格式非法：${(e as Error).message}`);
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('CONSOLE_DB_DSN 缺少库名（形如 mysql://user:pass@host:3306/db）');
  if (!u.hostname) throw new Error('CONSOLE_DB_DSN 缺少主机');
  return {
    driver: 'mysql',
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
  };
}

/** bootstrap 文件名（放在服务目录根，与 `.env` 同级） */
export const BOOTSTRAP_FILE = '.env.bootstrap';

/**
 * 加载 `.env.bootstrap`（若存在）→ 填进 `process.env`，**不覆盖已有键**。
 *
 * 为什么必须自己读文件：pm2 启动 console 时，`.env` 系列文件是 Nest 的 `ConfigModule`
 * 用 dotenv 读的，而本函数在 `NestFactory.create()` **之前**跑 —— 此刻 `process.env`
 * 里只有 pm2 注入的那几个键，`.env.bootstrap` 还没人读过。不自己读，运维文档里
 * 「写三行就能起」就是假的（第一次部署验证时就会撞上）。
 *
 * 「不覆盖已有」是刻意的：进程环境（pm2 env / systemd `EnvironmentFile`）是运维显式
 * 注入的，优先级应高于文件 —— 否则排障时改了环境却不生效，比没有还糟。
 *
 * @returns 实际写入的**键名**（不含值，便于安全打日志）
 */
export function loadBootstrapFile(env: NodeJS.ProcessEnv = process.env): string[] {
  // dist/bootstrap 与 src/bootstrap 深度相同，故同一相对路径在两种运行态都指向服务根
  const candidates = [
    path.resolve(__dirname, '..', '..', BOOTSTRAP_FILE),
    path.resolve(process.cwd(), BOOTSTRAP_FILE),
  ];
  const loaded: string[] = [];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1];
      const value = m[2].trim().replace(/^['"]|['"]$/g, '');
      if (!value) continue; // 空值不算配置（模板里的占位行很常见）
      if (env[key] !== undefined) continue; // 进程环境优先
      env[key] = value;
      loaded.push(key);
    }
    break; // 只认第一个存在的文件
  }
  return loaded;
}

/**
 * 把 bootstrap 键对齐到 `process.env`（`env === process.env` 时为空操作）。
 *
 * 为什么需要：`config-crypto` 的主密钥解析（含默认文件兜底）只读 `process.env`，
 * 而 `runBootstrap(env)` 允许传入任意 env（测试 / 未来的调用方）。若不对齐，就会
 * 出现「env 里明明给了密钥、同源校验却读 process.env 判定缺失」的假 FATAL ——
 * 与 dev 三键演练撞到的是同一类错位（那次错在默认文件，这次错在传参环境）。
 * 生产链路 `main.ts` 传的就是 `process.env`，此函数不产生任何效果。
 *
 * 空值也要对齐（delete）：否则上一次调用留下的残留会让校验误判成「密钥可用」。
 */
function alignBootstrapKeysToProcess(env: NodeJS.ProcessEnv): void {
  if (env === process.env) return;
  for (const key of [...BOOTSTRAP_KEYS, 'CONFIG_MASTER_KEY_FILE']) {
    const v = env[key];
    if (v === undefined) continue;
    if (v) process.env[key] = v;
    else delete process.env[key];
  }
}

/** 启动模式：显式声明 CONSOLE_ENV_ID 才算切到 bootstrap 模式 */
export type BootstrapMode = 'bootstrap' | 'legacy';

export function resolveBootstrapMode(env: NodeJS.ProcessEnv = process.env): BootstrapMode {
  return String(env.CONSOLE_ENV_ID || '').trim() ? 'bootstrap' : 'legacy';
}

export interface ConfigRow {
  scope: string;
  envId: string;
  moduleKey: string;
  key: string;
  value: string;
  isSecret: boolean;
  layer: string;
}

/**
 * 阶段 1：直连库读本进程该消费的配置条目。
 *
 * 用 `mysql2` 原生 SQL 而**不是** TypeORM 实体：此刻 Nest 还没起来，实体会拖进
 * `@web-system/shared` 与一批装饰器，而 bootstrap 阶段要的是「最小依赖、最快失败」。
 * 代价是 SQL 要手写 —— 表结构稳定（`config_items` 已加唯一约束），可接受。
 */
async function fetchConfigRows(conn: Connection, envId: string): Promise<ConfigRow[]> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT scope, env_id AS envId, module_key AS moduleKey, \`key\`, value,
            is_secret AS isSecret, layer
       FROM config_items
      WHERE enabled = 1
        AND (
              (scope = 'global')
           OR (scope = 'env' AND env_id = ?)
           OR (scope = 'module' AND env_id = ? AND module_key = ?)
        )`,
    [envId, envId, SELF_MODULE_KEY],
  );
  return rows as unknown as ConfigRow[];
}

/** 作用域优先级：module > env > global（数字越大越优先） */
const SCOPE_RANK: Record<string, number> = { global: 0, env: 1, module: 2 };

export interface MergeResult {
  /** 合并后的键值（已解密、已按优先级裁决） */
  values: Map<string, string>;
  /** 被 {@link PROTECTED_ENV_KEYS} 拦下的键（排障时最想知道的就是这个） */
  skipped: string[];
  /** `layer='bootstrap'` 而跳过的键 */
  skippedByLayer: string[];
  /** 解密失败的键（主密钥不匹配 / 密文被改） */
  decryptErrors: string[];
}

/**
 * 按作用域裁决 + 解密。
 *
 * 排除 `layer='bootstrap'`：那些键的语义就是「读配置中心之前它就得在」，
 * 从配置中心读回来覆盖自己，逻辑上不成立（且现实中会把 console 连到错误的地方）。
 */
export function mergeConfigRows(rows: readonly ConfigRow[]): MergeResult {
  const picked = new Map<string, { row: ConfigRow; rank: number }>();
  const skippedByLayer: string[] = [];

  for (const row of rows) {
    if (row.layer === 'bootstrap') {
      skippedByLayer.push(row.key);
      continue;
    }
    const rank = SCOPE_RANK[row.scope] ?? -1;
    if (rank < 0) continue; // 未知作用域：宁可忽略，也不猜语义
    const prev = picked.get(row.key);
    if (!prev || rank > prev.rank) picked.set(row.key, { row, rank });
  }

  const values = new Map<string, string>();
  const skipped: string[] = [];
  const decryptErrors: string[] = [];

  for (const [key, { row }] of picked) {
    if (PROTECTED_ENV_KEYS.has(key)) {
      skipped.push(key);
      continue;
    }
    if (row.isSecret) {
      try {
        values.set(key, decryptSecret(row.value));
      } catch (e) {
        // 单个键解不开不该拖垮整个启动（否则一次误操作就让发布系统不可用），
        // 但必须点名 —— 静默跳过会变成"配了没生效"的悬案
        decryptErrors.push(`${key}: ${(e as Error).message}`);
      }
      continue;
    }
    values.set(key, row.value);
  }

  return { values, skipped, skippedByLayer, decryptErrors };
}

/**
 * 把裁决结果写进 `process.env`。
 *
 * 为什么直接写 process.env 而不是塞给 ConfigModule：Nest 的 `ConfigModule` 从
 * `process.env` 取值，写在启动前等价于"这些值本来就在环境里"，对下游零感知 ——
 * 这正是我们想要的（应用代码不该知道自己是被下发的还是被注入的）。
 */
export function applyToProcessEnv(
  result: MergeResult,
  env: NodeJS.ProcessEnv = process.env,
): number {
  let applied = 0;
  for (const [key, value] of result.values) {
    if (env[key] === value) continue;
    env[key] = value;
    applied++;
  }
  return applied;
}

/** bootstrap 缺键时的可执行指引（照抄即可修复，不给"请检查配置"这种废话） */
export function bootstrapFixHint(missing: readonly string[]): string {
  return [
    'console 未进入 bootstrap 模式：以下键缺失 —— ' + missing.join('、'),
    '',
    '修复（写入 servers/deploy-console/.env.bootstrap，权限 0600）：',
    '  CONSOLE_ENV_ID=dev                                        # 我是哪个环境',
    '  CONSOLE_DB_DSN=mysql://用户:密码@127.0.0.1:3306/库名       # 含特殊字符请 URL 编码',
    '  CONFIG_MASTER_KEY_FILE=/etc/web-system/config-master.key   # 主密钥文件（0600）',
    '',
    '或退回现状模式：删除 CONSOLE_ENV_ID（保留原 .env 全量配置）即可按现有方式启动。',
    '设计见 docs/architecture/ 平台边界与配置中心设计 §3.6',
  ].join('\n');
}

export interface BootstrapOutcome {
  mode: BootstrapMode;
  /** 是否真正从配置中心拉到了配置 */
  loaded: boolean;
  applied: number;
  skipped: string[];
  skippedByLayer: string[];
  decryptErrors: string[];
  /** 失败原因（不阻断启动的那些，供日志与排障） */
  warning?: string;
}

/**
 * 启动入口：由 `main.ts` 在 `NestFactory.create()` **之前** await。
 *
 * 失败策略分三档，理由是「发布工具自身的可用性 > 配置的新鲜度」：
 *  - bootstrap 键缺失（严格模式）→ FATAL：都声明要自举了还不给全，属于配置错误；
 *  - 库连不上 / 查询失败 → 只告警并按现有 env 继续（DB 抖动不该让发布系统起不来）；
 *  - 个别密钥解不开 → 只告警并跳过该键（同上）。
 */
export async function runBootstrap(
  env: NodeJS.ProcessEnv = process.env,
): Promise<BootstrapOutcome> {
  // 先补文件：此刻 ConfigModule 还没起来，`.env.bootstrap` 无人读取
  const fromFile = loadBootstrapFile(env);
  if (fromFile.length) logger.log(`已加载 ${BOOTSTRAP_FILE}：${fromFile.join('、')}`);
  // 同源校验的前提：主密钥解析读 process.env，而 env 未必就是它
  alignBootstrapKeysToProcess(env);

  const mode = resolveBootstrapMode(env);
  if (mode === 'legacy') {
    logger.warn(
      '未设置 CONSOLE_ENV_ID —— 按现状模式启动（配置全部来自 .env）。' +
        '完成 bootstrap 三键配置后将自动切换，见 docs/operations/config-center.md',
    );
    return {
      mode,
      loaded: false,
      applied: 0,
      skipped: [],
      skippedByLayer: [],
      decryptErrors: [],
      warning: 'legacy 模式：配置未走配置中心',
    };
  }

  const envId = String(env.CONSOLE_ENV_ID || '').trim();
  const missing: string[] = [];
  if (!String(env.CONSOLE_DB_DSN || '').trim()) missing.push('CONSOLE_DB_DSN');
  // 主密钥**不自己看 env 变量**，而是调用运行期同一套解析（config-crypto）：
  // 它还有一个默认文件路径（/etc/web-system/config-master.key）。若这里只看变量，
  // 就会出现「运行期明明能用默认文件里的密钥、启动期却判定缺失」的假 FATAL ——
  // dev 三键演练实测撞到过：.env 里 CONFIG_MASTER_KEY 是空值、文件名也没写，
  // 密钥其实一直在默认文件里。启动校验与运行解析必须同源。
  try {
    masterKeyFingerprint();
  } catch {
    missing.push('CONFIG_MASTER_KEY / CONFIG_MASTER_KEY_FILE（或默认文件 /etc/web-system/config-master.key）');
  }
  if (missing.length) {
    // FATAL：已声明走 bootstrap 却给不全 —— 半自举比不自举更危险（看似去中心化，实际还是硬编码）
    logger.error(bootstrapFixHint(missing));
    throw new Error(`bootstrap 键缺失：${missing.join('、')}`);
  }

  const dsn = parseConsoleDsn(String(env.CONSOLE_DB_DSN));
  let conn: Connection | undefined;
  try {
    const mysql = await import('mysql2/promise');
    conn = await mysql.createConnection({
      host: dsn.host,
      port: dsn.port,
      user: dsn.user,
      password: dsn.password,
      database: dsn.database,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });

    const rows = await fetchConfigRows(conn, envId);
    const merged = mergeConfigRows(rows);
    const applied = applyToProcessEnv(merged, env);

    const src = masterKeySourceSafe();
    logger.log(
      `bootstrap 完成 env=${envId} 条目=${rows.length} 生效=${applied} ` +
        `保护跳过=${merged.skipped.length} bootstrap层跳过=${merged.skippedByLayer.length}` +
        (src ? ` 主密钥=${src}` : ''),
    );
    if (merged.skipped.length) {
      logger.warn(
        `以下键属基础设施/自举键，已忽略配置中心的同名条目（防误配连错库）：${merged.skipped.join('、')}`,
      );
    }
    if (merged.decryptErrors.length) {
      logger.warn(`以下密钥项解密失败，已跳过（主密钥可能不是加密时的那一把）：${merged.decryptErrors.join('；')}`);
    }

    return {
      mode,
      loaded: true,
      applied,
      skipped: merged.skipped,
      skippedByLayer: merged.skippedByLayer,
      decryptErrors: merged.decryptErrors,
    };
  } catch (e) {
    // 到这里只有「库连不上 / 查询炸 / 解密全挂」三种，都不该阻断启动
    const msg = (e as Error).message;
    logger.warn(`从配置中心加载失败，按现有 env 继续（${msg}）`);
    return {
      mode,
      loaded: false,
      applied: 0,
      skipped: [],
      skippedByLayer: [],
      decryptErrors: [],
      warning: msg,
    };
  } finally {
    // bootstrap 连接用完即弃：Nest 起来后 TypeORM 会用自己的连接池，
    // 留着这条会占一个连接且不走 TypeORM 的生命周期
    try {
      await conn?.end();
    } catch {
      /* 关不掉无所谓，进程后面还有正式连接 */
    }
  }
}

/** 主密钥来源描述（取不到时返回空串，bootstrap 不该因为日志需求而失败） */
function masterKeySourceSafe(): string {
  try {
    return `${masterKeySource().source} fp=${masterKeyFingerprint()}`;
  } catch {
    return '';
  }
}
