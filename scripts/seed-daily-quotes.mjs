#!/usr/bin/env node
/**
 * seed-daily-quotes · NCE 每日美句冻结池入库（s27，幂等）
 *
 * 内容真源只有仓库内 servers/content-hub/data/daily-quotes.json：
 *   - 文件 sha256 必须等于 DAILY_QUOTES_ASSET_SHA256（6f5fe566…）；
 *   - version=1、count=136、items.length=136，逐条形状与身份键校验；
 *   - 任一不符直接非零退出，不写库、不编造、不调 LLM。
 *
 * 幂等：事务内按 (pool_version, ordinal) upsert 136 行，清理非冻结版本/越界 ordinal；
 * 写后回读逐字比对资产，不一致 rollback。重复执行不重复插、不漂移。
 *
 * 用法：
 *   node scripts/seed-daily-quotes.mjs --dry-run              # 只校验资产，不连库
 *   DB_HOST=… DB_PORT=3306 DB_USERNAME=… DB_PASSWORD=… \
 *     DB_DATABASE=web_system node scripts/seed-daily-quotes.mjs
 *   node scripts/seed-daily-quotes.mjs --env-file /path/to/.env   # 从 env 文件读 DB_*
 *
 * 🔴 安全守卫：DB_DATABASE 只允许 web_system（与 nce_lessons 同库）。
 *    2026-10-26 曾误连 deploy/shadow 建空壳表；此处 fail-fast，不接受覆盖。
 *    凭据只走 DB_* 环境变量/env 文件，本脚本不打印密码、不落中间文件。
 *    本轮不执行 dev/prod 写操作；上线时按方案文档 §7 顺序执行。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const ASSET_URL = new URL('../servers/content-hub/data/daily-quotes.json', import.meta.url);
const CH_PKG_URL = new URL('../servers/content-hub/package.json', import.meta.url);
const ASSET_SHA256 = '6f5fe566dc9191d0dfae0d0211f8132b9492681b514ee4d7f58a9d2676fd0756';
const FROZEN_VERSION = 1;
const FROZEN_COUNT = 136;
const ALLOWED_DB = 'web_system';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const envFileIndex = argv.indexOf('--env-file');
const envFile = envFileIndex >= 0 ? argv[envFileIndex + 1] : '';

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function readEnv(file) {
  const out = {};
  if (!existsSync(file)) die(`env 文件不存在：${file}`);
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function loadFrozenAsset() {
  const buf = readFileSync(ASSET_URL);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== ASSET_SHA256) die(`资产 sha256 不符：${sha}（期望 ${ASSET_SHA256}）`);
  const asset = JSON.parse(buf.toString('utf8'));
  if (asset.version !== FROZEN_VERSION) die(`资产 version=${asset.version}，期望 ${FROZEN_VERSION}`);
  if (asset.count !== FROZEN_COUNT) die(`资产 count=${asset.count}，期望 ${FROZEN_COUNT}`);
  if (!Array.isArray(asset.items) || asset.items.length !== FROZEN_COUNT) {
    die(`资产 items.length=${Array.isArray(asset.items) ? asset.items.length : 'n/a'}，期望 ${FROZEN_COUNT}`);
  }
  const keys = new Set();
  asset.items.forEach((q, i) => {
    const s = q?.source;
    const ok = q && typeof q.cn === 'string' && q.cn.length > 0
      && typeof q.en === 'string' && q.en.length > 0
      && s && s.book === 'NCE2' && Number.isInteger(s.lessonId) && s.lessonId >= 1 && s.lessonId <= 96
      && typeof s.title === 'string' && s.title.length > 0
      && Number.isInteger(s.lineIndex) && s.lineIndex >= 0;
    if (!ok) die(`资产第 ${i + 1} 条形状非法`);
    const key = `${s.lessonId}:${s.lineIndex}`;
    if (keys.has(key)) die(`资产第 ${i + 1} 条身份键重复：${key}`);
    keys.add(key);
  });
  return asset.items;
}

const items = loadFrozenAsset();
if (dryRun) {
  console.log(`✅ 冻结资产校验通过：sha256=${ASSET_SHA256.slice(0, 12)}… version=${FROZEN_VERSION} count=${items.length}`);
  console.log(`   dry-run：未连库、未写入。正式执行将按 (pool_version, ordinal) upsert ${FROZEN_COUNT} 行到 ${ALLOWED_DB}.daily_quotes`);
  process.exit(0);
}

const env = { ...(envFile ? readEnv(envFile) : {}), ...process.env };
const database = env.DB_DATABASE || ALLOWED_DB;
if (database !== ALLOWED_DB) die(`DB_DATABASE=${database} 不在白名单（只允许 ${ALLOWED_DB}，防误连 deploy/shadow）`);

const require = createRequire(CH_PKG_URL);
let mysql;
try {
  mysql = require('mysql2/promise');
} catch {
  die('找不到 mysql2：请在仓库根执行本脚本（content-hub 依赖已安装）');
}

const canonical = items.map((q, i) => ({
  ordinal: i + 1,
  cn: q.cn,
  en: q.en,
  source_book: q.source.book,
  source_lesson_id: q.source.lessonId,
  source_title: q.source.title,
  source_line_index: q.source.lineIndex,
}));

const conn = await mysql.createConnection({
  host: env.DB_HOST || 'localhost',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USERNAME || 'root',
  password: env.DB_PASSWORD || '',
  database,
  charset: 'utf8mb4',
});

const UPSERT = `
  INSERT INTO daily_quotes
    (pool_version, ordinal, cn, en, source_book, source_lesson_id, source_title, source_line_index)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    cn = VALUES(cn), en = VALUES(en),
    source_book = VALUES(source_book), source_lesson_id = VALUES(source_lesson_id),
    source_title = VALUES(source_title), source_line_index = VALUES(source_line_index)
`;

try {
  await conn.beginTransaction();
  // 清理非冻结版本与越界行：防止历史误写造成"多插/漂移"。
  await conn.execute(
    'DELETE FROM daily_quotes WHERE pool_version <> ? OR ordinal > ?',
    [FROZEN_VERSION, FROZEN_COUNT],
  );
  for (const row of canonical) {
    await conn.execute(UPSERT, [
      FROZEN_VERSION, row.ordinal, row.cn, row.en,
      row.source_book, row.source_lesson_id, row.source_title, row.source_line_index,
    ]);
  }
  const [rows] = await conn.execute(
    `SELECT ordinal, cn, en, source_book, source_lesson_id, source_title, source_line_index
       FROM daily_quotes WHERE pool_version = ? ORDER BY ordinal ASC`,
    [FROZEN_VERSION],
  );
  const actual = rows.map((r) => ({
    ordinal: Number(r.ordinal), cn: r.cn, en: r.en,
    source_book: r.source_book, source_lesson_id: Number(r.source_lesson_id),
    source_title: r.source_title, source_line_index: Number(r.source_line_index),
  }));
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
    throw new Error(`回读校验失败：期望 ${canonical.length} 行逐字一致，实得 ${actual.length} 行`);
  }
  await conn.commit();
  console.log(`✅ seed 完成且幂等：${database}.daily_quotes pool_version=${FROZEN_VERSION} count=${actual.length}`);
  console.log(`   资产 sha256=${ASSET_SHA256}`);
} catch (err) {
  await conn.rollback();
  die(`seed 失败已回滚：${err instanceof Error ? err.message : String(err)}`);
} finally {
  await conn.end();
}
