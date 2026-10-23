#!/usr/bin/env node
/**
 * seed 自媒体账号到 content_accounts（幂等）
 *
 * 设计约束（别改坏）：
 *  1. 凭据**只在服务器内流转**：从服务端 env 文件读，加密后直接写库，
 *     不落任何中间文件、不打印明文、不进 git。
 *  2. 解密钥来自 0600 文件（ACCOUNT_CRED_KEY_FILE），不进环境变量。
 *  3. 幂等：按 (platform, code) 唯一键 upsert，重复跑只更新不重复插入。
 *
 * 用法（在部署机 runtime 目录执行）：
 *   node scripts/seed-content-accounts.mjs --keygen            # 生成 0600 解密钥文件
 *   node scripts/seed-content-accounts.mjs --dry-run           # 只算不写
 *   node scripts/seed-content-accounts.mjs                     # 写库
 *
 * 选项：
 *   --env-file <path>   默认 /data/web_system/.env.production
 *   --key-file <path>   默认 $ACCOUNT_CRED_KEY_FILE 或 /data/web_system/keys/account-cred.key
 *   --platform <key>    默认 wechat_mp
 *   --code <code>       默认 default
 *   --name <显示名>     默认「大橙子社区」
 *   --type <personal|enterprise>  账号主体类型，默认 personal
 *
 * 主体类型为什么重要：个人主体（未认证订阅号）没有 freepublish 权限，草稿就是终点；
 * 企业主体才走「待发布 → 已发布」。类型写错，界面上的状态流转就是错的。
 */
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { randomBytes, createCipheriv } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const ENV_FILE = opt('env-file', '/data/web_system/.env.production');
const KEY_FILE = opt('key-file', process.env.ACCOUNT_CRED_KEY_FILE || '/data/web_system/keys/account-cred.key');
const PLATFORM = opt('platform', 'wechat_mp');
const CODE = opt('code', 'default');
const NAME = opt('name', '大橙子社区');
const TYPE = opt('type', 'personal');

if (TYPE !== 'personal' && TYPE !== 'enterprise') {
  console.error(`❌ --type 只能是 personal 或 enterprise，收到：${TYPE}`);
  process.exit(1);
}

// content-hub 的 node_modules 里取 mysql2（脚本不在服务目录下也能跑）
const require = createRequire('/data/web_system/servers/content-hub/package.json');
let mysql;
try {
  mysql = require('mysql2/promise');
} catch {
  console.error('❌ 找不到 mysql2：请在 content-hub 部署机上执行本脚本');
  process.exit(1);
}

/** 极简 env 解析（只要 KEY=VALUE，不处理引用与转义） */
function readEnv(file) {
  if (!existsSync(file)) throw new Error(`env 文件不存在：${file}`);
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function loadKey() {
  if (!existsSync(KEY_FILE)) {
    throw new Error(
      `解密钥文件不存在：${KEY_FILE}\n  先跑：node ${process.argv[1]} --keygen`,
    );
  }
  const raw = readFileSync(KEY_FILE, 'utf8').trim();
  return /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
}

function encrypt(plainObj, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(plainObj), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function mask(s) {
  if (!s) return '';
  return s.length <= 6 ? `${s.slice(0, 1)}********` : `${s.slice(0, 2)}********${s.slice(-4)}`;
}

// ── --keygen：生成解密钥文件 ──
if (flag('keygen')) {
  mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  writeFileSync(KEY_FILE, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  chmodSync(KEY_FILE, 0o600);
  console.log(`✅ 已生成解密钥文件：${KEY_FILE}（权限 0600）`);
  console.log(`   把下面这行写进 ${ENV_FILE} 后重启 content-hub：`);
  console.log(`   ACCOUNT_CRED_KEY_FILE=${KEY_FILE}`);
  process.exit(0);
}

const env = readEnv(ENV_FILE);
const appId = env.OFFICIAL_ACCOUNT_APP_ID;
const appSecret = env.OFFICIAL_ACCOUNT_SECRET;
if (!appId || !appSecret) {
  console.error(`❌ ${ENV_FILE} 缺 OFFICIAL_ACCOUNT_APP_ID / OFFICIAL_ACCOUNT_SECRET`);
  process.exit(1);
}

const key = loadKey();
if (key.length !== 32) {
  console.error(`❌ 解密钥长度非法（期望 32 字节，实际 ${key.length}）`);
  process.exit(1);
}

const enc = encrypt({ app_id: appId, app_secret: appSecret }, key);
const maskText = mask(appSecret);

const row = {
  platform: PLATFORM,
  code: CODE,
  name: NAME,
  account_type: TYPE,
  credentials_enc: enc,
  credentials_mask: maskText,
  enabled: 1,
};

console.log('将写入（凭据只显示掩码）：');
console.log(`  platform=${row.platform} code=${row.code} name=${row.name} type=${row.account_type}`);
console.log(`  app_id=${appId.slice(0, 4)}****${appId.slice(-4)}`);
console.log(`  app_secret=${maskText}`);
console.log(`  credentials_enc 长度=${enc.length}（base64）`);

if (flag('dry-run')) {
  console.log('\n--dry-run：未写库');
  process.exit(0);
}

const conn = await mysql.createConnection({
  host: env.DB_HOST || '127.0.0.1',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USERNAME || 'root',
  password: env.DB_PASSWORD || '',
  database: env.DB_DATABASE || 'web_system',
});

try {
  const [res] = await conn.execute(
    `INSERT INTO content_accounts
       (platform, code, name, account_type, credentials_enc, credentials_mask, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(6), NOW(6))
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       account_type = VALUES(account_type),
       credentials_enc = VALUES(credentials_enc),
       credentials_mask = VALUES(credentials_mask),
       updated_at = NOW(6)`,
    [
      row.platform,
      row.code,
      row.name,
      row.account_type,
      row.credentials_enc,
      row.credentials_mask,
      row.enabled,
    ],
  );
  console.log(`\n✅ 已写入：affectedRows=${res.affectedRows} insertId=${res.insertId}`);

  const [rows] = await conn.execute(
    `SELECT id, platform, code, name, account_type, identity, credentials_mask, last_check_status, enabled
     FROM content_accounts WHERE deleted_at IS NULL ORDER BY platform, code`,
  );
  console.log('当前账号表：');
  for (const r of rows) {
    console.log(
      `  #${r.id} ${r.platform}/${r.code} name=${r.name} type=${r.account_type ?? '-'} mask=${r.credentials_mask ?? '-'} status=${r.last_check_status ?? '未检测'} enabled=${r.enabled}`,
    );
  }
} finally {
  await conn.end();
}
