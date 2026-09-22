#!/usr/bin/env node
/**
 * 主密钥「域拆分 / 换库」迁移助手（一次性用途）
 *
 * 设计：specs/config-master-key-distribution/design.md §10
 * 指南：specs/config-master-key-distribution/domain-split-guide.md
 *
 * 做什么：把源域配置库中 is_secret=1 的密文，用「源域主密钥」解密，
 *         改用「目标域主密钥」加密（写入目标 keyId）后写入目标域配置库；
 *         同时处理 config_snapshots.payload 内的密文。
 *
 * 安全默认：
 *   · 默认 dry-run（只读、不写任何数据）；必须显式 --apply 才动数据；
 *   · --apply 前先在目标库建影子表备份，回退用 --rollback=<ts>；
 *   · 默认不删源库任何行（--prune-src 才删）；
 *   · 密钥值禁止走命令行（会进 shell 历史），只接受文件路径；
 *   · 源与目标指向同一库实例时直接拒绝。
 *
 * 用法：
 *   node scripts/master-key-domain-split.mjs \
 *     --src-env servers/deploy-console/.env \
 *     --dst-env /tmp/new-domain.env \
 *     --src-key-file /etc/web-system/config-master.key \
 *     --dst-key-file /etc/web-system/config-master.key.new \
 *     --key-id p1
 *   加 --apply 落库；加 --rollback=<ts> 回退。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- 常量（与 config-crypto.ts 保持一致）
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32;
const DERIVE_SALT = 'deploy-console-config';
const DEFAULT_LEGACY_KEY_ID = 'k1';

const ITEM_COLS =
  'id, scope, env_id, module_key, `key`, `value`, is_secret, enabled, description, updated_by, created_at';

// ---------------------------------------------------------------- 小工具
function log(...a) {
  console.log(...a);
}
function die(msg, code = 1) {
  console.error(`\n[中止] ${msg}\n`);
  process.exit(code);
}

/** 支持 `--k=v` 与 `--k v` 两种写法（帮助里用的是后者）；无值即布尔开关 */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const body = raw.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[body] = next;
        i += 1;
      } else {
        out[body] = true;
      }
    }
  }
  return out;
}

/** 读 env 文件 → { 键: 值 }（不注入 process.env，避免污染） */
function loadEnvFile(file) {
  if (!existsSync(file)) {
    die(`读不到 env 文件 ${file} —— --src-env / --dst-env 必须指向存在且可读的文件（别用占位路径）`);
  }
  const txt = readFileSync(file, 'utf8');
  const o = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const v = m[2].trim().replace(/^["']|["']$/g, '');
    o[m[1]] = v;
  }
  return o;
}

function dbConf(envFile) {
  const e = loadEnvFile(envFile);
  const pick = (...keys) => {
    for (const k of keys) if (e[k]) return e[k];
    return undefined;
  };
  return {
    host: pick('MYSQL_HOST', 'DB_HOST') || '127.0.0.1',
    port: Number(pick('MYSQL_PORT', 'DB_PORT') || 3306),
    user: pick('MYSQL_USER', 'DB_USER') || 'root',
    password: pick('MYSQL_PASSWORD', 'DB_PASSWORD') || '',
    database: pick('MYSQL_DB', 'DB_NAME', 'DB_DATABASE') || 'web_system_deploy',
  };
}

function sameInstance(a, b) {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

/** 与 config-crypto.ts 同口径：base64 / 64 hex / 任意字符串 scrypt */
function deriveKey(raw, label) {
  const s = String(raw).trim();
  let key;
  if (/^[A-Za-z0-9+/]{43}=$/.test(s)) key = Buffer.from(s, 'base64');
  else if (/^[0-9a-fA-F]{64}$/.test(s)) key = Buffer.from(s, 'hex');
  else key = scryptSync(s, DERIVE_SALT, KEY_LEN);
  if (key.length !== KEY_LEN) die(`${label} 派生结果须为 ${KEY_LEN} 字节，实际 ${key.length}`);
  return key;
}

function readKeyFile(file, label) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    die(`读不到 ${label}：${file}`);
  }
  return deriveKey(raw, label);
}

/** 密钥指纹：sha256(派生钥) 前 8 位 hex —— 可安全打印/比对 */
function fingerprint(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function encryptWith(key, plain, keyId) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [keyId, iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

function splitPayload(payload) {
  return String(payload).split(':');
}

/** 解析密文段数 → { legacy, keyId } */
function inspectPayload(payload) {
  const parts = splitPayload(payload);
  if (parts.length === 3) return { legacy: true, keyId: DEFAULT_LEGACY_KEY_ID };
  if (parts.length === 4) return { legacy: false, keyId: parts[0] };
  return { legacy: false, keyId: '(非法段数)' };
}

function decryptWith(key, payload) {
  const parts = splitPayload(payload);
  let ivB64;
  let tagB64;
  let dataB64;
  if (parts.length === 3) [ivB64, tagB64, dataB64] = parts;
  else if (parts.length === 4) [, ivB64, tagB64, dataB64] = parts;
  else throw new Error(`密文段数非法（${parts.length}）`);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function tsNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function loadMysql() {
  try {
    return require(path.join(ROOT, 'node_modules/.pnpm/node_modules/mysql2/promise.js'));
  } catch {
    try {
      return require('mysql2/promise');
    } catch {
      return die('未找到 mysql2，请先安装后端依赖（pnpm install）');
    }
  }
}

// ---------------------------------------------------------------- 主流程
const args = parseArgs(process.argv.slice(2));

if (args.help || (!args['src-env'] && !args['rollback'])) {
  console.log(`
主密钥域拆分 / 换库迁移助手（默认 dry-run，加 --apply 才写入）

  --src-env <file>        源域 env（MYSQL_HOST/PORT/USER/PASSWORD/DB）
  --dst-env <file>        目标域 env
  --src-key-file <file>   源域主密钥文件
  --dst-key-file <file>   目标域主密钥文件（新钥）
  --key-id <id>           写入目标库的 keyId（默认 p1）
  --filter-env <envId>    只迁该 env 的密文行（global 行始终包含）
  --overwrite             目标库已存在同键行时覆盖（默认跳过并报告）
  --prune-src             迁移成功后删除源库对应密文行（默认保留）
  --sample <n>            回读抽样校验条数（默认 10）
  --apply                 真正写入（不加 = dry-run）
  --rollback <ts>         从影子表 <表>_bak_domainsplit_<ts> 恢复目标库（需配合 --apply）

密钥只接受文件路径：不要用 --src-key=xxx 这类形式（会进 shell 历史）。
`);
  process.exit(args.help ? 0 : 1);
}

const mysql = loadMysql();

const srcConf = dbConf(args['src-env']);
const dstConf = dbConf(args['dst-env']);

if (sameInstance(srcConf, dstConf)) {
  die('源与目标指向同一个库实例（host/port/database 相同）。本脚本只用于跨库迁移；同库换钥请用轮换流程。');
}

const srcKey = readKeyFile(args['src-key-file'], '源域主密钥');
const dstKey = readKeyFile(args['dst-key-file'], '目标域主密钥');
const newKeyId = args['key-id'] || 'p1';
const dryRun = !args.apply && !args.rollback;
const filterEnv = args['filter-env'];
const overwrite = !!args.overwrite;
const pruneSrc = !!args['prune-src'];
const sampleN = Number(args.sample || 10);

if (newKeyId.includes(':')) die('--key-id 不能包含冒号（密文分隔符）');

log(`\n== 主密钥域拆分 ==`);
log(`源域 : ${srcConf.host}:${srcConf.port}/${srcConf.database}  指纹=${fingerprint(srcKey)}`);
log(`目标域: ${dstConf.host}:${dstConf.port}/${dstConf.database}  指纹=${fingerprint(dstKey)}  新 keyId=${newKeyId}`);
if (fingerprint(srcKey) === fingerprint(dstKey)) log('⚠️  两把钥指纹相同：这不是"换域"，只是复制。确认是否真的需要迁移。');
log(`模式 : ${dryRun ? 'DRY-RUN（只读）' : 'APPLY（会写目标库）'}\n`);

let src;
let dst;
try {
  src = await mysql.createConnection(srcConf);
  dst = await mysql.createConnection(dstConf);
} catch (e) {
  die(
    `连接失败：${e.message}（源 ${srcConf.host}:${srcConf.port}/${srcConf.database}；` +
      `目标 ${dstConf.host}:${dstConf.port}/${dstConf.database}）`,
  );
}

try {
  // ---------- 回退分支 ----------
  if (args.rollback) {
    const ts = String(args.rollback);
    const itemBak = `config_items_bak_domainsplit_${ts}`;
    const snapBak = `config_snapshots_bak_domainsplit_${ts}`;
    log(`回退：用 ${itemBak} / ${snapBak} 恢复目标库 ${dstConf.database}`);
    const [[it]] = await dst.query(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=? AND table_name=?`, [dstConf.database, itemBak]);
    const [[st]] = await dst.query(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=? AND table_name=?`, [dstConf.database, snapBak]);
    if (!it.n || !st.n) die(`影子表不存在（${itemBak} / ${snapBak}），无法回退`);
    if (!args.apply) die('回退是破坏性操作，请显式加 --apply');
    await dst.query('SET FOREIGN_KEY_CHECKS=0');
    await dst.query('DELETE FROM config_items');
    await dst.query(`INSERT INTO config_items SELECT * FROM \`${itemBak}\``);
    await dst.query('DELETE FROM config_snapshots');
    await dst.query(`INSERT INTO config_snapshots SELECT * FROM \`${snapBak}\``);
    await dst.query('SET FOREIGN_KEY_CHECKS=1');
    const [[c1]] = await dst.query('SELECT COUNT(*) AS n FROM config_items');
    const [[c2]] = await dst.query('SELECT COUNT(*) AS n FROM config_snapshots');
    log(`✅ 已恢复：config_items=${c1.n} 行，config_snapshots=${c2.n} 行。请重启目标域 console 并跑 verify。`);
    process.exit(0);
  }

  // ---------- 读源域 ----------
  const itemWhere = filterEnv ? 'AND (scope=\'global\' OR env_id=?)' : '';
  const [itemRows] = await src.query(
    `SELECT ${ITEM_COLS} FROM config_items WHERE is_secret=1 ${itemWhere}`,
    filterEnv ? [filterEnv] : [],
  );
  const [snapRows] = await src.query(
    `SELECT id, env_id, module_key, version_tag, payload, created_by, created_at FROM config_snapshots${filterEnv ? ' WHERE env_id=?' : ''}`,
    filterEnv ? [filterEnv] : [],
  );

  // 用源钥逐行试解（解不开 = 源钥不对，绝不猜钥）
  const keyIdDist = new Map();
  const failures = [];
  for (const r of itemRows) {
    const info = inspectPayload(r.value);
    keyIdDist.set(info.legacy ? `(老格式→${info.keyId})` : info.keyId, (keyIdDist.get(info.legacy ? `(老格式→${info.keyId})` : info.keyId) || 0) + 1);
    try {
      decryptWith(srcKey, r.value);
    } catch (e) {
      failures.push(`${r.scope}/${r.env_id}/${r.module_key}/${r.key}（${e.message}）`);
    }
  }
  log(`源域 is_secret=1 行数 : ${itemRows.length}`);
  log(`源域 keyId 分布      : ${[...keyIdDist.entries()].map(([k, v]) => `${k}=${v}`).join(' / ') || '(无)'}`);
  log(`源域快照条数        : ${snapRows.length}`);
  if (failures.length) {
    log(`\n✗ 有 ${failures.length} 行无法用源钥解密，前 5 条：`);
    for (const f of failures.slice(0, 5)) log(`   - ${f}`);
    die('源钥不对，或源域尚未收敛到单把钥（建议先在源域完成轮换）。已中止，未写任何数据。');
  }
  log('源钥试解            : 全部通过 ✓');

  // ---------- 目标库冲突扫描 ----------
  const willInsert = [];
  const conflicts = [];
  for (const r of itemRows) {
    const [hit] = await dst.query(
      'SELECT id FROM config_items WHERE scope=? AND env_id=? AND module_key=? AND `key`=?',
      [r.scope, r.env_id, r.module_key, r.key],
    );
    if (hit.length) conflicts.push(`item ${r.scope}/${r.env_id}/${r.module_key}/${r.key}`);
    else willInsert.push(r);
  }
  const snapInsert = [];
  const snapConflicts = [];
  for (const s of snapRows) {
    const [hit] = await dst.query(
      'SELECT id FROM config_snapshots WHERE env_id=? AND module_key=? AND version_tag=?',
      [s.env_id, s.module_key, s.version_tag],
    );
    if (hit.length) snapConflicts.push(`snapshot ${s.env_id}/${s.module_key}@${s.version_tag}`);
    else snapInsert.push(s);
  }

  log(`\n目标库：新建 ${willInsert.length} 行 / 覆盖候选 ${conflicts.length} 行（${overwrite ? '将覆盖' : '默认跳过'}）`);
  log(`目标库快照：新建 ${snapInsert.length} 条 / 冲突 ${snapConflicts.length} 条（${overwrite ? '将覆盖' : '默认跳过'}）`);
  for (const c of conflicts.slice(0, 5)) log(`   · 冲突 ${c}`);

  if (dryRun) {
    log('\nDRY-RUN 结束：未写任何数据。复核无误后加 --apply 执行。\n');
    process.exit(0);
  }

  // ---------- 备份 + 写入 ----------
  const ts = tsNow();
  const itemBak = `config_items_bak_domainsplit_${ts}`;
  const snapBak = `config_snapshots_bak_domainsplit_${ts}`;
  await dst.query(`CREATE TABLE \`${itemBak}\` AS SELECT * FROM config_items`);
  await dst.query(`CREATE TABLE \`${snapBak}\` AS SELECT * FROM config_snapshots`);
  log(`\n已建影子表：${itemBak} / ${snapBak}（回退：--rollback=${ts} --apply）`);

  let written = 0;
  let skipped = 0;
  for (const r of itemRows) {
    const plain = decryptWith(srcKey, r.value);
    const value = encryptWith(dstKey, plain, newKeyId);
    const [hit] = await dst.query(
      'SELECT id FROM config_items WHERE scope=? AND env_id=? AND module_key=? AND `key`=?',
      [r.scope, r.env_id, r.module_key, r.key],
    );
    if (hit.length) {
      if (!overwrite) {
        skipped += 1;
        continue;
      }
      await dst.query(
        'UPDATE config_items SET `value`=?, is_secret=?, enabled=?, description=?, updated_by=?, updated_at=NOW() WHERE id=?',
        [value, r.is_secret, r.enabled, r.description ?? null, 'domain-split', hit[0].id],
      );
    } else {
      await dst.query(
        `INSERT INTO config_items (id, scope, env_id, module_key, \`key\`, \`value\`, is_secret, enabled, description, updated_by, created_at, updated_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [r.scope, r.env_id, r.module_key, r.key, value, r.is_secret, r.enabled, r.description ?? null, 'domain-split', r.created_at ?? new Date()],
      );
    }
    written += 1;
  }

  let snapWritten = 0;
  for (const s of snapRows) {
    const payload = { ...(s.payload || {}) };
    for (const [k, v] of Object.entries(payload)) {
      if (!v || !v.isSecret || typeof v.value !== 'string') continue;
      const plain = decryptWith(srcKey, v.value);
      payload[k] = { ...v, value: encryptWith(dstKey, plain, newKeyId) };
    }
    const [hit] = await dst.query(
      'SELECT id FROM config_snapshots WHERE env_id=? AND module_key=? AND version_tag=?',
      [s.env_id, s.module_key, s.version_tag],
    );
    if (hit.length) {
      if (!overwrite) continue;
      await dst.query('UPDATE config_snapshots SET payload=? WHERE id=?', [JSON.stringify(payload), hit[0].id]);
    } else {
      await dst.query(
        'INSERT INTO config_snapshots (id, env_id, module_key, version_tag, payload, created_by, created_at) VALUES (UUID(), ?, ?, ?, ?, ?, ?)',
        [s.env_id, s.module_key, s.version_tag, JSON.stringify(payload), s.created_by ?? 'domain-split', s.created_at ?? new Date()],
      );
    }
    snapWritten += 1;
  }

  if (pruneSrc) {
    for (const r of itemRows) {
      await src.query('DELETE FROM config_items WHERE id=?', [r.id]);
    }
    log(`已删除源库密文行 ${itemRows.length} 行（--prune-src）`);
  }

  // ---------- 回读抽样校验 ----------
  const [checkRows] = await dst.query(
    `SELECT scope, env_id, module_key, \`key\`, \`value\` FROM config_items WHERE is_secret=1 LIMIT ?`,
    [sampleN],
  );
  let bad = 0;
  for (const r of checkRows) {
    try {
      decryptWith(dstKey, r.value);
    } catch {
      bad += 1;
    }
  }

  log(`\n写入结果：配置项 ${written} 行（跳过 ${skipped}）、快照 ${snapWritten} 条`);
  log(`回读抽样：${checkRows.length} 条，失败 ${bad} 条`);
  if (bad > 0) die(`抽样校验失败 ${bad} 条，请立即回退：--rollback=${ts} --apply`, 2);
  log('✅ 迁移完成。下一步：目标域机器 provision 新钥 → 启动 console → 跑 verify（见 domain-split-guide.md §3.4/§4）。\n');
} finally {
  await src.end().catch(() => {});
  await dst.end().catch(() => {});
}
