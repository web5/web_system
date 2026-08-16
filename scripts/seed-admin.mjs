#!/usr/bin/env node
// 重置/创建本地 admin 登录账号（bcrypt 哈希密码写入 users 表）。
// 依赖从 servers/auth-service/node_modules 解析（bcryptjs + mysql2 都在那里）。
// 用法: node scripts/seed-admin.mjs   （密码默认 admin123，可用 ADMIN_INIT_PASSWORD 覆盖）
import { createRequire } from 'module';

const require = createRequire(new URL('../servers/auth-service/package.json', import.meta.url));
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || 'KedouLocal@2026',
  database: process.env.DB_DATABASE || 'web_system',
};
const USERNAME = process.env.ADMIN_INIT_USERNAME || 'admin';
const PASSWORD = process.env.ADMIN_INIT_PASSWORD || 'admin123';

const conn = await mysql.createConnection(DB);
const hash = await bcrypt.hash(PASSWORD, 10);

// users 表为新规范 snake_case；roles 为 JSON。存在则更新，不存在则插入。
const [rows] = await conn.query('SELECT id FROM users WHERE username = ?', [USERNAME]);
if (rows.length) {
  await conn.query(
    "UPDATE users SET password = ?, roles = JSON_ARRAY('admin'), status = 'active' WHERE username = ?",
    [hash, USERNAME],
  );
  console.log(`[seed] 已更新 ${USERNAME} 密码`);
} else {
  await conn.query(
    "INSERT INTO users (username, password, roles, status, gender) VALUES (?, ?, JSON_ARRAY('admin'), 'active', 'unknown')",
    [USERNAME, hash],
  );
  console.log(`[seed] 已创建 ${USERNAME}`);
}
await conn.end();
console.log(`[seed] 完成: ${USERNAME} / ${PASSWORD}`);
