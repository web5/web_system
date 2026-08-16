// 把 auth-service web_system.users 表里 admin 用户的密码重置为 <CONSOLE_ADMIN_PASSWORD>
// 用法: node scripts/reset-auth-admin-password.mjs
import { createRequire } from 'module';
const REPO = '/Users/geekwen/workspace/web_system';
const require = createRequire(`${REPO}/servers/deploy-console/package.json`);
const mysql = require('mysql2/promise');
const bcrypt = require(`${REPO}/servers/auth-service/node_modules/bcryptjs`);

const conn = await mysql.createConnection({
  host: '127.0.0.1', port: 3306, user: 'root', password: '<LOCAL_MYSQL_PASSWORD>', database: 'web_system',
});
const hash = bcrypt.hashSync('<CONSOLE_ADMIN_PASSWORD>', 10);
const [r] = await conn.execute('UPDATE users SET password=? WHERE username=?', [hash, 'admin']);
console.log(`affected: ${r.affectedRows}`);
const [rows] = await conn.execute('SELECT id, username FROM users WHERE username=?', ['admin']);
console.log('admin:', rows);
await conn.end();