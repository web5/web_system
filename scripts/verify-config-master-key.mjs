#!/usr/bin/env node
/**
 * 主密钥一致性自检（独立于服务进程，可离线跑）
 *
 * 设计：specs/config-master-key-distribution/design.md §5.2 ②
 * 用途：
 *   · 新机器上线时自证"本机密钥能解开本库密文"（K1；
 *   · 排查"改了不生效 / 某次读配置才炸"（先把"密钥 ↔ 库"这一侧排除掉）；
 *   · 轮换 / 格式迁移后的收敛验证（keyId 分布 + 老格式计数）。
 *
 * 用法：
 *   node scripts/verify-config-master-key.mjs
 *   node scripts/verify-config-master-key.mjs --env-file servers/deploy-console/.env --sample 20
 *   node scripts/verify-config-master-key.mjs --key-file /etc/web-system/config-master.key
 *
 * 退出码：0 全绿 ｜ 2 有不可解密的密文 ｜ 3 密钥缺失/不可用/格式非法
 */

import { createDecipheriv, createHash, scryptSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const DERIVE_SALT = 'deploy-console-config';
const DEFAULT_KEY_FILE = '/etc/web-system/config-master.key';

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

function loadEnvFile(file) {
  const o = {};
  if (!existsSync(file)) return o;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) o[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return o;
}

function deriveKey(raw, label) {
  const value = String(raw).trim();
  if (!value) throw new Error(`${label} 为空`);
  let key;
  if (/^[A-Za-z0-9+/]{43}=$/.test(value)) key = Buffer.from(value, 'base64');
  else if (/^[0-9a-fA-F]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
  else key = scryptSync(value, DERIVE_SALT, KEY_LEN);
  if (key.length !== KEY_LEN) throw new Error(`${label} 派生结果须为 ${KEY_LEN} 字节，实际 ${key.length}`);
  return key;
}

function fingerprint(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

/** 解一段密文；3 段 = 老格式（无 keyId），4 段 = `<keyId>:iv:tag:data` */
function decryptWith(key, payload) {
  const parts = String(payload).split(':');
  let ivB64;
  let tagB64;
  let dataB64;
  if (parts.length === 3) [ivB64, tagB64, dataB64] = parts;
  else if (parts.length === 4) [, ivB64, tagB64, dataB64] = parts;
  else throw new Error(`段数非法（${parts.length}）`);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function inspect(payload) {
  const n = String(payload).split(':').length;
  if (n === 3) return { legacy: true, keyId: '(老格式·无 keyId)' };
  if (n === 4) return { legacy: false, keyId: String(payload).split(':')[0] };
  return { legacy: false, keyId: `(非法段数 ${n})` };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`
主密钥一致性自检（只读，不改任何数据）

  --env-file <file>      部署库 env（默认 servers/deploy-console/.env）
  --key-file <file>      主密钥文件（默认 /etc/web-system/config-master.key，或 env CONFIG_MASTER_KEY）
  --sample <n>           快照抽样条数（默认 20）
  --fingerprint-only     只解析密钥并打印来源 + 指纹，不连库（供 provision 脚本复用）

退出码：0 全绿 ｜ 2 有不可解密的密文 ｜ 3 密钥缺失/不可用
`);
  process.exit(0);
}

const envFile = args['env-file'] || path.join(ROOT, 'servers/deploy-console/.env');
const env = loadEnvFile(envFile);

// ---------- ① 解析密钥 ----------
const keyFilePath = args['key-file'] || process.env.CONFIG_MASTER_KEY_FILE || DEFAULT_KEY_FILE;
let key;
let keySource = '';
try {
  const envRaw = process.env.CONFIG_MASTER_KEY?.trim();
  if (envRaw) {
    key = deriveKey(envRaw, 'CONFIG_MASTER_KEY');
    keySource = 'env CONFIG_MASTER_KEY';
    if (existsSync(keyFilePath)) {
      const fromFile = deriveKey(readFileSync(keyFilePath, 'utf8'), 'CONFIG_MASTER_KEY_FILE');
      if (!fromFile.equals(key)) {
        console.error(`✗ CONFIG_MASTER_KEY 与文件 ${keyFilePath} 不是同一把钥（指纹 ${fingerprint(key)} vs ${fingerprint(fromFile)}）`);
        process.exit(3);
      }
      keySource = 'env CONFIG_MASTER_KEY + 文件（指纹一致）';
    }
  } else if (existsSync(keyFilePath)) {
    key = deriveKey(readFileSync(keyFilePath, 'utf8'), 'CONFIG_MASTER_KEY_FILE');
    keySource = `文件 ${keyFilePath}`;
  } else if (env.CONFIG_MASTER_KEY) {
    // 过渡态：密钥还写在部署库 env 文件里（本地研发常见）；上线前应 provision 到 0600 文件
    key = deriveKey(env.CONFIG_MASTER_KEY, 'CONFIG_MASTER_KEY');
    keySource = `env 文件 ${path.relative(ROOT, envFile)} 的 CONFIG_MASTER_KEY（过渡态）`;
  } else {
    console.error(`✗ 未找到主密钥：process.env.CONFIG_MASTER_KEY、文件 ${keyFilePath}、env 文件 ${envFile} 三处都没有`);
    process.exit(3);
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(3);
}

console.log(`密钥来源 : ${keySource}`);
console.log(`密钥指纹 : ${fingerprint(key)}`);

// 只报指纹（provision 脚本用它回显"投递到位的是哪把钥"，不连库、不读数据）
if (args['fingerprint-only']) process.exit(0);

// ---------- ② 连库 ----------
const mysql = (() => {
  try {
    return require(path.join(ROOT, 'node_modules/.pnpm/node_modules/mysql2/promise.js'));
  } catch {
    try {
      return require('mysql2/promise');
    } catch {
      console.error('✗ 未找到 mysql2，请先安装后端依赖（pnpm install）');
      process.exit(3);
    }
  }
})();

const conf = {
  host: process.env.MYSQL_HOST || env.MYSQL_HOST || env.DB_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || env.MYSQL_PORT || env.DB_PORT || 3306),
  user: process.env.MYSQL_USER || env.MYSQL_USER || env.DB_USER || 'root',
  password: process.env.MYSQL_PASSWORD || env.MYSQL_PASSWORD || env.DB_PASSWORD || '',
  database: process.env.MYSQL_DB || env.MYSQL_DB || env.DB_NAME || 'web_system_deploy',
};
console.log(`部署库   : ${conf.host}:${conf.port}/${conf.database}（env 文件 ${path.relative(ROOT, envFile)}）`);

let conn;
try {
  conn = await mysql.createConnection(conf);
} catch (e) {
  console.error(`✗ 连接部署库失败：${e.message}（${conf.host}:${conf.port}/${conf.database}）`);
  process.exit(3);
}

try {
  // ---------- ③ config_items ----------
  const [items] = await conn.query(
    'SELECT scope, env_id, module_key, `key`, `value` FROM config_items WHERE is_secret=1',
  );
  const byKeyId = new Map();
  const itemFailures = [];
  let legacyCount = 0;
  for (const r of items) {
    const info = inspect(r.value);
    if (info.legacy) legacyCount += 1;
    byKeyId.set(info.keyId, (byKeyId.get(info.keyId) || 0) + 1);
    try {
      decryptWith(key, r.value);
    } catch (e) {
      itemFailures.push(`${r.scope}/${r.env_id || '-'}/${r.module_key || '-'}/${r.key}（${e.message}）`);
    }
  }
  console.log(`\nconfig_items（is_secret=1）：${items.length} 行`);
  console.log(`  keyId 分布 : ${[...byKeyId.entries()].map(([k, v]) => `${k}=${v}`).join(' / ') || '(无)'}`);
  console.log(`  老格式(3段): ${legacyCount} ${legacyCount > 0 ? '← P2a 迁移前属正常，迁移后应为 0' : ''}`);
  console.log(`  可解密     : ${items.length - itemFailures.length}/${items.length}`);

  // ---------- ④ config_snapshots 抽样 ----------
  const sample = Number(args.sample || 20);
  const [snaps] = await conn.query(
    'SELECT env_id, module_key, version_tag, payload FROM config_snapshots ORDER BY created_at DESC LIMIT ?',
    [sample],
  );
  let snapSecrets = 0;
  const snapFailures = [];
  for (const s of snaps) {
    let payload = s.payload;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        continue;
      }
    }
    for (const [k, v] of Object.entries(payload || {})) {
      if (!v || !v.isSecret || typeof v.value !== 'string') continue;
      snapSecrets += 1;
      try {
        decryptWith(key, v.value);
      } catch (e) {
        snapFailures.push(`${s.env_id}/${s.module_key}@${s.version_tag}#${k}（${e.message}）`);
      }
    }
  }
  console.log(`\nconfig_snapshots（最近 ${snaps.length} 条）：密钥值 ${snapSecrets} 个`);
  console.log(`  可解密     : ${snapSecrets - snapFailures.length}/${snapSecrets}`);

  const failures = [...itemFailures, ...snapFailures];
  if (failures.length) {
    console.error(`\n✗ 有 ${failures.length} 处密文无法解密，前 10 条：`);
    for (const f of failures.slice(0, 10)) console.error(`   - ${f}`);
    console.error('\n可能原因：密钥与库不同域（换库未换钥）/ 密钥不是加密这批数据的那把 / 数据被篡改。');
    console.error('定位与处置：specs/config-master-key-distribution/domain-split-guide.md');
    process.exit(2);
  }

  if (items.length === 0 && snapSecrets === 0) {
    console.log('\n⚠️  库中暂无密钥项：本次只验证了"密钥可解析"，未验证"密钥可解密"。');
  }
  console.log('\n✅ 全部可解密（密钥 ↔ 库 一致）\n');
} finally {
  await conn.end().catch(() => {});
}
