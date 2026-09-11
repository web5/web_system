// 把 auth-service web_system.users 表里 admin 用户的密码重置为 ADMIN_INIT_PASSWORD（默认 admin123）
// 用法: LOCAL_DB_PASSWORD=xxx node scripts/reset-auth-admin-password.mjs
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${REPO}/servers/deploy-console/package.json`);
const mysql = require('mysql2/promise');
const bcrypt = require(`${REPO}/servers/auth-service/node_modules/bcryptjs`);

const PASSWORD = process.env.ADMIN_INIT_PASSWORD || 'admin123';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'web_system',
});
const hash = bcrypt.hashSync(PASSWORD, 10);
const [r] = await conn.execute('UPDATE users SET password=? WHERE username=?', [hash, 'admin']);
console.log(`affected: ${r.affectedRows}`);
const [rows] = await conn.execute('SELECT id, username FROM users WHERE username=?', ['admin']);
console.log('admin:', rows);
await conn.end();
