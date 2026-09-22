#!/usr/bin/env node
/**
 * 一次性数据迁移：给存量 agent_conversations.messages 回填 ts（B6 消息级时间戳）。
 *
 * 背景：B6 前消息不落 ts。StoredMessage.ts 改为必填后，存量消息缺 ts。
 * 存量没有消息级真实时间，只能用会话 createdAt 近似（同一会话内消息 ts 相同，
 * 足以让跨天会话恢复日期线分段；同会话内更细的分钟级精度无法还原）。
 *
 * 运行方式（在发布目录，能连到业务库）：
 *   node scripts/migrate-message-ts.mjs
 * 连接参数从环境变量读取（与 ai-agent 的 DB_* / MYSQL_* 两套键名兼容）。
 * 幂等：已有合法 ts 的消息不动，可重复执行。
 */
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
  password: process.env.DB_PASS || process.env.MYSQL_PASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQL_DB || 'web_system',
});

const [rows] = await conn.query(
  'SELECT id, createdAt, messages FROM agent_conversations',
);

let updated = 0;
for (const row of rows) {
  const msgs = Array.isArray(row.messages) ? row.messages : [];
  const fallback = new Date(row.createdAt).getTime();
  let changed = false;
  for (const m of msgs) {
    if (typeof m.ts !== 'number' || !Number.isFinite(m.ts)) {
      m.ts = fallback;
      changed = true;
    }
  }
  if (changed) {
    await conn.query('UPDATE agent_conversations SET messages = ? WHERE id = ?', [
      JSON.stringify(msgs),
      row.id,
    ]);
    updated++;
  }
}

console.log(`已回填 ${updated} 个会话的消息时间戳`);
await conn.end();
