#!/usr/bin/env node
/**
 * p30：把**基座 shell（site-version 应用）**的版本指针补进 NEW 域
 * `deploy_app_env_versions`。
 *
 * 背景（2026-09-28 停用 legacy）：
 *   gateway 的 `IndexHtmlService.resolveShellHtmlFile` 停用 legacy 后，从
 *   `deploy_app_env_versions(app_key='shell', env_id)` 读基座版本
 *   → 目录 `static/modules/shell/<envId>/<version>/index.html`（与产物投递布局一致）。
 *   历史部署只往 `deploy_deployments` 写指针（且 dev 那条还是 `shell-dev/4ea6d64`
 *   这种带前缀的旧格式，与磁盘目录对不上），新表**没有 shell 行** ⇒
 *   直接切过去基座会退回固定路径 `shell/index.html`（能跑，但版本化发布失效）。
 *
 * 本脚本只做一件事：upsert 一行（幂等，可重复执行）。
 * 版本取值优先级：`VERSION` 环境变量 > `AUTO_DISK_ROOT` 下探测的最新目录 > 报错退出。
 *
 * 用法：
 *   DB_HOST=... DB_PORT=3306 DB_USER=root DB_PASSWORD=... DB_NAME=web_system \
 *     APP_KEY=shell ENV_ID=dev VERSION=7a6be04 \
 *     node scripts/migrations/p30-shell-pointer-to-app-env.mjs
 *
 *   DRY_RUN=1              只打印 SQL，不落库
 *   EMIT_SQL=1             只打印 SQL（供本机连不上内网库时 scp 到服务器执行）
 *   AUTO_DISK_ROOT=/data/web_system_static/public/static/modules/shell/dev
 *                          从磁盘目录探测版本（取 mtime 最新的子目录）
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

function loadConsoleEnv() {
  const p = path.join(root, 'servers/deploy-console/.env');
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

const consoleEnv = loadConsoleEnv();
const cfg = {
  host: process.env.DB_HOST || consoleEnv.DB_HOST,
  port: Number(process.env.DB_PORT || consoleEnv.DB_PORT || 3306),
  user: process.env.DB_USER || consoleEnv.DB_USER,
  password: process.env.DB_PASSWORD || consoleEnv.DB_PASSWORD,
  database: process.env.DB_NAME || consoleEnv.DB_NAME,
};

const APP_KEY = process.env.APP_KEY || 'shell';
const ENV_ID = process.env.ENV_ID || 'dev';
const AUTO_DISK_ROOT = process.env.AUTO_DISK_ROOT || '';
const DRY_RUN = !!process.env.DRY_RUN;
const EMIT_SQL = !!process.env.EMIT_SQL;

/** 从磁盘探测：取 mtime 最新的子目录名（版本目录 = git short sha） */
function detectFromDisk() {
  if (!AUTO_DISK_ROOT || !fs.existsSync(AUTO_DISK_ROOT)) return undefined;
  const dirs = fs
    .readdirSync(AUTO_DISK_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, mtime: fs.statSync(path.join(AUTO_DISK_ROOT, d.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return dirs[0]?.name;
}

const version = process.env.VERSION || detectFromDisk();

if (!version) {
  console.error('[p30] 未拿到版本号：请传 VERSION=xxx，或用 AUTO_DISK_ROOT=<目录> 从磁盘探测');
  process.exit(1);
}
if (!EMIT_SQL) {
  for (const [k, v] of Object.entries(cfg)) {
    if (v === undefined || v === '') {
      console.error(`[p30] 缺少配置 ${k}（用 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME 传入）`);
      process.exit(1);
    }
  }
}

const id = randomUUID();
const sql = `INSERT INTO \`deploy_app_env_versions\`
  (\`id\`, \`app_key\`, \`env_id\`, \`current_version\`, \`status\`, \`deployed_at\`, \`deployed_by\`, \`created_at\`)
VALUES ('${id}', '${APP_KEY}', '${ENV_ID}', '${version}', 'deployed', NOW(6), 'p30-migration', NOW(6))
ON DUPLICATE KEY UPDATE
  \`current_version\` = VALUES(\`current_version\`),
  \`status\` = 'deployed',
  \`deployed_at\` = NOW(6),
  \`deployed_by\` = 'p30-migration';`;

const verifySql = `SELECT \`app_key\`, \`env_id\`, \`current_version\`, \`status\` FROM \`deploy_app_env_versions\` WHERE \`app_key\`='${APP_KEY}' AND \`env_id\`='${ENV_ID}';`;

console.log(`[p30] ${APP_KEY}@${ENV_ID} -> ${version}${version && !process.env.VERSION ? ' (磁盘探测)' : ''}`);
console.log(sql);

if (DRY_RUN || EMIT_SQL) process.exit(0);

const mysql = require(path.join(root, 'node_modules/.pnpm/node_modules/mysql2/promise.js'));
const conn = await mysql.createConnection(cfg);
try {
  await conn.query(sql);
  const [rows] = await conn.query(verifySql);
  console.log('[p30] 结果：', rows);
} finally {
  await conn.end();
}
