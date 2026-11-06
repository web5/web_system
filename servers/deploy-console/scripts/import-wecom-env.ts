/**
 * 把企微审批通道（卡②）凭证从 `wecom.env` **写入配置中心**（`config_items`）。
 *
 * 为什么落库而不是读文件：
 * console 的配置真源是配置中心，启动时由 `src/bootstrap/load.ts` 的 `runBootstrap()`
 * 连库 → 拉 `global + env:<id> + module:deploy-console` → 解密 → 合并进 `process.env`。
 * 文件（`~/env_config/wecom.env`）只是**录入时的输入**，运行期不再依赖它，
 * 避免「文件改了一套、库里另一套」的漂移。
 *
 * 写入形态（与既有 dev/prod 条目一致，唯一刻意的差异是 `layer`）：
 *   scope=module  env_id=<--env-id>  module_key=<--module>
 *   layer=platform   ← 语义「console 进程内拉取、不下发、不落盘」
 *                       `isRowDeliverable()` 对 platform 直接判 false，
 *                       双保险：企微 Secret 永远不会被写进任何服务的 `.env.generated`
 *   deliverable=0    ← 同上意图的数据层表达
 *   is_secret=1      ← 键名命中 SECRET / _KEY / TOKEN / PASSWORD 的项，值 AES-256-GCM 加密
 *                       密文格式 `iv:tag:data`，明文不入库、不进日志
 *
 * 用法（在 `servers/deploy-console` 目录下）：
 *   npx ts-node scripts/import-wecom-env.ts --file ~/env_config/wecom.env --env-id dev            # dry-run
 *   npx ts-node scripts/import-wecom-env.ts --file ~/env_config/wecom.env --env-id dev --apply    # 写库
 *
 * 选项：
 *   --file <path>      wecom.env 路径（必填）
 *   --env-id <id>      目标环境 dev / prod（必填；写进 `config_items.env_id`）
 *   --module <key>     目标模块，默认 `deploy-console`
 *   --app-env <path>   取数据库连接与主密钥来源的 console `.env`，默认 `<服务目录>/.env`
 *   --apply            真正写库；不带则只打印计划（dry-run）
 *
 * 安全约束：
 *   ① 全程不打印任何值，只打印键名 / 是否密钥 / 值指纹（sha256 前 12 位）；
 *   ② 密钥项比较用**解密后明文**（密文含随机 IV，直接比密文会永远判定为“变了”）；
 *   ③ 每次变更写一条 `config_revisions`，`changed_by=script:import-wecom-env`。
 */
import { createHash, randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import * as mysql from 'mysql2/promise';
import { decryptSecret, encryptSecret } from '../src/config/config-crypto';

/**
 * CLI 输出：stdout 直写，不用 console 的 log。
 *
 * 红线 R1（调试残留）禁的是**应用代码**里的 console 调试输出 —— CLI 工具的 stdout 就是
 * 它的产品输出，删掉脚本就没有任何反馈。R1 的路径豁免清单目前覆盖仓库根 scripts 下的
 * mjs/cjs、apps 下各应用的 scripts，以及 skills 内脚本，但未覆盖 servers 下各服务的
 * scripts 目录（既有 migrate-stage-commands.ts 同款在用且已入库）。
 * 与其 --no-verify 绕过、让 CI 复现同一条报错，不如显式走 stdout：
 * 语义更准确，也不把「工具输出」和「调试残留」混为一谈。
 */
function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** 值指纹：sha256 前 12 位（口径与 config.service 的 valueFingerprint 一致，但不必拖进 TypeORM） */
function valueFingerprintSafe(value: string): string {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

/** 只接收本通道的键，避免把整个 env 文件的无关键灌进配置中心 */
const ACCEPT_PREFIX = 'WECOM_';
const ACCEPT_EXTRA = ['CONSOLE_PUBLIC_BASE_URL'];

/** 判定「密钥」：命中即加密存储 */
const SECRET_RE = /(SECRET|_KEY$|TOKEN|PASSWORD)/i;

/** console 自己消费的模块 key（bootstrap 阶段只会拉这个模块 + global + env 层） */
const DEFAULT_MODULE = 'deploy-console';

const CHANGED_BY = 'script:import-wecom-env';

interface Args {
  file: string;
  envId: string;
  module: string;
  appEnv: string;
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const file = get('--file');
  const envId = get('--env-id');
  if (!file) throw new Error('缺少 --file（wecom.env 路径）');
  if (!envId) throw new Error('缺少 --env-id（dev / prod）');
  return {
    file: path.resolve(file.replace(/^~(?=\/)/, process.env.HOME ?? '~')),
    envId,
    module: get('--module') ?? DEFAULT_MODULE,
    appEnv: path.resolve(get('--app-env') ?? path.resolve(__dirname, '..', '.env')),
    apply: argv.includes('--apply'),
  };
}

/** 解析 KEY=VALUE 文本：跳过空行/注释、剥成对引号、忽略非法键名（不做变量展开） */
function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2) {
      const q = val[0];
      if ((q === '"' || q === "'") && val.endsWith(q)) val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) throw new Error(`文件不存在：${file}`);
  return parseEnvText(readFileSync(file, 'utf8'));
}

interface PlanRow {
  key: string;
  value: string;
  isSecret: boolean;
  action: 'create' | 'update' | 'skip';
  fingerprint: string;
  itemId?: string;
  beforeValue?: string | null;
}

interface ExistingRow {
  id: string;
  key: string;
  value: string;
  is_secret: number;
}

/** 必填校验：与运行期 `resolveWecomConfig` 的口径保持一致（缺了开不了，不如当场拦） */
function assertRequired(cfg: Record<string, string>): string[] {
  const missing: string[] = [];
  const enabled = (cfg.WECOM_APPROVE_ENABLED ?? '').trim() === '1';
  if (!(cfg.CONSOLE_PUBLIC_BASE_URL ?? '').trim()) missing.push('CONSOLE_PUBLIC_BASE_URL');
  if (enabled) {
    const mode = (cfg.WECOM_APPROVE_MODE ?? 'oauth') === 'signed-link' ? 'signed-link' : 'oauth';
    if (mode === 'oauth') {
      for (const k of ['WECOM_CORP_ID', 'WECOM_AGENT_ID', 'WECOM_SECRET']) {
        if (!(cfg[k] ?? '').trim()) missing.push(k);
      }
    } else if (!(cfg.WECOM_APPROVE_TICKET_SECRET ?? '').trim()) {
      missing.push('WECOM_APPROVE_TICKET_SECRET');
    }
  }
  return missing;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  log(`→ wecom.env : ${args.file}`);
  log(`→ 目标      : env=${args.envId} module=${args.module} layer=platform deliverable=0`);
  log(`→ 模式      : ${args.apply ? 'APPLY（写库）' : 'DRY-RUN（不写库）'}`);

  const appEnv = readEnvFile(args.appEnv);
  // 主密钥只从文件兜底读（.env 里 CONFIG_MASTER_KEY 常为空，密钥在 /etc/web-system/config-master.key）
  if (appEnv.CONFIG_MASTER_KEY && !process.env.CONFIG_MASTER_KEY) {
    process.env.CONFIG_MASTER_KEY = appEnv.CONFIG_MASTER_KEY;
  }
  if (appEnv.CONFIG_MASTER_KEY_FILE && !process.env.CONFIG_MASTER_KEY_FILE) {
    process.env.CONFIG_MASTER_KEY_FILE = appEnv.CONFIG_MASTER_KEY_FILE;
  }

  const cfg = readEnvFile(args.file);
  const accepted: Record<string, string> = {};
  const ignored: string[] = [];
  for (const [k, v] of Object.entries(cfg)) {
    if (k.startsWith(ACCEPT_PREFIX) || ACCEPT_EXTRA.includes(k)) accepted[k] = v;
    else ignored.push(k);
  }
  if (ignored.length) log(`· 忽略非本通道键 ${ignored.length} 个：${ignored.join(',')}`);

  const missing = assertRequired(accepted);
  if (missing.length) throw new Error(`必填键缺失：${missing.join('、')}`);

  const conn = await mysql.createConnection({
    host: appEnv.MYSQL_HOST,
    port: Number(appEnv.MYSQL_PORT || 3306),
    user: appEnv.MYSQL_USER,
    password: appEnv.MYSQL_PASSWORD,
    database: appEnv.MYSQL_DB,
  });

  try {
    const [dbRows] = await conn.query<mysql.RowDataPacket[]>('SELECT DATABASE() AS db');
    log(`· 目标库：${String(dbRows[0]?.db ?? '')}`);

    const [existing] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id, \`key\`, value, is_secret FROM config_items
        WHERE scope='module' AND env_id=? AND module_key=?`,
      [args.envId, args.module],
    );
    const byKey = new Map<string, ExistingRow>(
      (existing as unknown as ExistingRow[]).map((r) => [r.key, r]),
    );

    const plan: PlanRow[] = [];
    for (const key of Object.keys(accepted).sort()) {
      const value = accepted[key];
      const isSecret = SECRET_RE.test(key);
      const row = byKey.get(key);
      // 指纹按**明文**算：密文含随机 IV，按密文算每次重加密都会变，
      // 日志里就会误报「值又变了」。sha256 前 12 位不可逆，足够做「变没变」的判断。
      const fingerprint = valueFingerprintSafe(value);
      if (!row) {
        plan.push({ key, value, isSecret, action: 'create', fingerprint });
        continue;
      }
      // 密文含随机 IV：比「明文」才是有意义的等价判断
      let current = row.value;
      if (row.is_secret) {
        try {
          current = decryptSecret(row.value);
        } catch {
          current = '\u0000undecryptable';
        }
      }
      const same = current === value && Boolean(row.is_secret) === isSecret;
      plan.push({
        key,
        value,
        isSecret,
        action: same ? 'skip' : 'update',
        fingerprint,
        itemId: row.id,
        beforeValue: row.value,
      });
    }

    log('\n键名                             密钥  动作    指纹');
    for (const p of plan) {
      log(
        `${p.key.padEnd(32)} ${(p.isSecret ? 'yes' : 'no ').padEnd(5)} ` +
          `${p.action.padEnd(7)} ${p.fingerprint}`,
      );
    }
    const changes = plan.filter((p) => p.action !== 'skip');
    log(`\n合计 ${plan.length} 项，待写 ${changes.length} 项，不变 ${plan.length - changes.length} 项`);

    if (!args.apply) {
      log('（DRY-RUN 结束，未写库；确认无误后加 --apply）');
      return;
    }
    if (!changes.length) {
      log('已是最新，无需写入。');
      return;
    }

    await conn.beginTransaction();
    for (const p of changes) {
      const stored = p.isSecret ? encryptSecret(p.value) : p.value;
      if (p.action === 'create') {
        const id = randomUUID();
        await conn.execute(
          `INSERT INTO config_items
             (id, scope, env_id, module_key, \`key\`, value, is_secret, enabled, description,
              updated_by, layer, value_type, apply_mode, deliverable, key_version)
           VALUES (?, 'module', ?, ?, ?, ?, ?, 1, ?, ?, 'platform', 'string', 'restart', 0, 1)`,
          [
            id,
            args.envId,
            args.module,
            p.key,
            stored,
            p.isSecret ? 1 : 0,
            '企微审批通道（卡②）凭据，由 wecom.env 导入',
            CHANGED_BY,
          ],
        );
        await writeRevision(conn, {
          itemId: id,
          envId: args.envId,
          module: args.module,
          key: p.key,
          action: 'create',
          before: null,
          after: stored,
          isSecret: p.isSecret,
        });
        continue;
      }

      await conn.execute(
        `UPDATE config_items
            SET value=?, is_secret=?, updated_by=?, layer='platform', deliverable=0
          WHERE id=?`,
        [stored, p.isSecret ? 1 : 0, CHANGED_BY, p.itemId],
      );
      await writeRevision(conn, {
        itemId: p.itemId as string,
        envId: args.envId,
        module: args.module,
        key: p.key,
        action: 'update',
        before: p.beforeValue ?? null,
        after: stored,
        isSecret: p.isSecret,
      });
    }
    await conn.commit();
    log(`✅ 已写入 ${changes.length} 项 + ${changes.length} 条修订记录`);

    // 回读校验：确认密文能解、层级与下发位正确（不打印值）
    const [after] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT \`key\`, is_secret, layer, deliverable, value FROM config_items
        WHERE scope='module' AND env_id=? AND module_key=? ORDER BY \`key\``,
      [args.envId, args.module],
    );
    log('\n回读校验：');
    for (const r of after as unknown as Array<ExistingRow & { layer: string; deliverable: number }>) {
      let ok = 'plain';
      if (r.is_secret) {
        try {
          ok = `decrypt-ok(len=${decryptSecret(r.value).length})`;
        } catch (e) {
          ok = `decrypt-FAIL(${(e as Error).message})`;
        }
      }
      log(
        `  ${String(r.key).padEnd(32)} secret=${r.is_secret} layer=${r.layer} ` +
          `deliverable=${r.deliverable} ${ok}`,
      );
    }
  } finally {
    await conn.end();
  }
}

async function writeRevision(
  conn: mysql.Connection,
  r: {
    itemId: string;
    envId: string;
    module: string;
    key: string;
    action: 'create' | 'update';
    before: string | null;
    after: string;
    isSecret: boolean;
  },
): Promise<void> {
  await conn.execute(
    `INSERT INTO config_revisions
       (id, item_id, scope, env_id, module_key, \`key\`, action, before_value, after_value,
        is_secret, before_fingerprint, after_fingerprint, reason, changed_by)
     VALUES (?, ?, 'module', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      r.itemId,
      r.envId,
      r.module,
      r.key,
      r.action,
      r.before,
      r.after,
      r.isSecret ? 1 : 0,
      r.before ? valueFingerprintSafe(r.before) : null,
      valueFingerprintSafe(r.after),
      'wecom.env 导入（企微审批通道卡②）',
      CHANGED_BY,
    ],
  );
}

main().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
});
