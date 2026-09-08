#!/usr/bin/env node
/**
 * super_admin 角色授予 / 撤销脚本
 *
 * 用法：
 *   node scripts/db/grant-super-admin.mjs --list                  # 列出所有用户及其角色
 *   node scripts/db/grant-super-admin.mjs <username>              # 授予 super_admin
 *   node scripts/db/grant-super-admin.mjs <username> --revoke     # 撤销 super_admin
 *
 * 说明：
 *   users.roles 是 JSON 数组（如 ["user","admin"]），本脚本在数组内增删
 *   'super_admin'，不影响用户已有的其它角色。
 *
 *   授予后需让用户重新登录后台 —— JWT 中携带的角色才会刷新。
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

/** 极简 .env 解析（避免为此脚本引入 dotenv 依赖） */
function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const result = {};
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

// system-service 连的就是 web_system 业务库，优先取它的配置
const env = {
  ...loadEnvFile(path.join(ROOT, '.env')),
  ...loadEnvFile(path.join(ROOT, 'servers/system-service/.env')),
};

const require = createRequire(path.join(ROOT, 'servers/system-service/package.json'));
let mysql;
try {
  mysql = require('mysql2/promise');
} catch {
  console.error(
    '未找到 mysql2。请先安装后端依赖：pnpm --filter @web-system/system-service install',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const list = args.includes('--list');
const username = args.find((a) => !a.startsWith('--'));

if (!list && !username) {
  console.error('用法：node scripts/db/grant-super-admin.mjs <username> [--revoke] | --list');
  process.exit(1);
}

const ROLE = 'super_admin';

function parseRoles(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

async function main() {
  const conn = await mysql.createConnection({
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USERNAME || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_DATABASE || 'web_system',
  });

  try {
    if (list) {
      const [rows] = await conn.query(
        'SELECT id, username, nickname, roles, status FROM users ORDER BY id',
      );
      if (!rows.length) {
        console.log('users 表为空');
        return;
      }
      console.log('用户列表（id / username / roles / status）：');
      for (const r of rows) {
        const roles = parseRoles(r.roles);
        const mark = roles.includes(ROLE) ? ' ← super_admin' : '';
        console.log(
          `  ${String(r.id).padStart(6)}  ${(r.username || '').padEnd(22)} ` +
            `${JSON.stringify(roles).padEnd(26)} ${r.status}${mark}`,
        );
      }
      return;
    }

    const [rows] = await conn.query('SELECT id, username, roles FROM users WHERE username = ?', [
      username,
    ]);
    if (!rows.length) {
      console.error(`未找到用户：${username}（可用 --list 查看全部用户）`);
      process.exit(1);
    }

    const user = rows[0];
    const roles = parseRoles(user.roles);

    if (revoke) {
      if (!roles.includes(ROLE)) {
        console.log(`${username} 本就不是 ${ROLE}，无需撤销`);
        return;
      }
      const next = roles.filter((r) => r !== ROLE);
      await conn.query('UPDATE users SET roles = ? WHERE id = ?', [JSON.stringify(next), user.id]);
      console.log(`已撤销：${username}\n  roles = ${JSON.stringify(next)}`);
      return;
    }

    if (roles.includes(ROLE)) {
      console.log(`${username} 已是 ${ROLE}，无需重复授予`);
      return;
    }
    const next = [...roles, ROLE];
    await conn.query('UPDATE users SET roles = ? WHERE id = ?', [JSON.stringify(next), user.id]);
    console.log(`已授予：${username}\n  roles = ${JSON.stringify(next)}`);
    console.log('提示：该用户需重新登录后台，JWT 中的角色才会刷新。');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('执行失败：', err.message);
  process.exit(1);
});
