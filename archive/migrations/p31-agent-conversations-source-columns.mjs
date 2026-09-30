#!/usr/bin/env node
/**
 * p31：给 `agent_conversations` 补 `source` / `agent_id` 列（含索引）。
 *
 * 背景（2026-09-28 上线核查发现）：
 *   2026-09-23 的「会话来源过滤」（specs/conversation-source-filter）在实体上加了
 *   `source`（默认 'chat'）与 `agent_id` 两列，用于：
 *     - 主对话列表只取 source='chat'
 *     - 工具页（翻译 / 合同）会话各取各的记录
 *   但 PROD 侧 `NODE_ENV=production` ⇒ TypeORM `synchronize: false`，这两列从未落到库里。
 *   结果：`AgentConversationQueryService.listConversations` 稳定报
 *   `Unknown column 'AgentConversation.source' in 'where clause'` → 会话列表 500，
 *   新会话写入同样受影响。
 *
 * 本脚本只做一件事：ADD COLUMN（幂等，可重复执行）。
 *   - 用 `information_schema.COLUMNS` 做守卫：列已存在则跳过该列
 *   - `source` NOT NULL DEFAULT 'chat'（存量行自动归类为主对话，与实体语义一致）
 *   - `agent_id` 可空（未锁定的会话为 NULL）
 *   - 补与实体 @Index 对应的两个单列索引（同样带守卫）
 *
 * 用法：
 *   DB_HOST=... DB_PORT=3306 DB_USER=root DB_PASSWORD=... DB_NAME=web_system \
 *     node scripts/migrations/p31-agent-conversations-source-columns.mjs
 *
 *   DRY_RUN=1   只打印要执行的 SQL，不落库
 *   EMIT_SQL=1  只打印 SQL（本机连不上内网库时，scp 到服务器再执行）
 *
 * 回滚（ADD COLUMN 是加性的，只在确有需要时执行）：
 *   ALTER TABLE `agent_conversations`
 *     DROP INDEX `idx_agent_conversations_source`,
 *     DROP INDEX `idx_agent_conversations_agent_id`,
 *     DROP COLUMN `source`,
 *     DROP COLUMN `agent_id`;
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

function loadEnvFile(p) {
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

// 默认取 ai-agent 的 .env（本表由 ai-agent 读写），可用环境变量覆盖
const agentEnv = loadEnvFile(path.join(root, 'servers/ai-agent/.env'));
const cfg = {
  host: process.env.DB_HOST || agentEnv.DB_HOST,
  port: Number(process.env.DB_PORT || agentEnv.DB_PORT || 3306),
  user: process.env.DB_USER || agentEnv.DB_USERNAME || agentEnv.DB_USER,
  password: process.env.DB_PASSWORD || agentEnv.DB_PASSWORD,
  database: process.env.DB_NAME || agentEnv.DB_DATABASE,
};

const DRY_RUN = !!process.env.DRY_RUN;
const EMIT_SQL = !!process.env.EMIT_SQL;

if (!EMIT_SQL) {
  for (const [k, v] of Object.entries(cfg)) {
    if (v === undefined || v === '' || Number.isNaN(v)) {
      console.error(`[p31] 缺少配置 ${k}（用 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME 传入）`);
      process.exit(1);
    }
  }
}

const hasColSql = (col) =>
  `SELECT COUNT(1) AS c FROM \`information_schema\`.\`COLUMNS\` WHERE \`TABLE_SCHEMA\`=DATABASE() AND \`TABLE_NAME\`='agent_conversations' AND \`COLUMN_NAME\`='${col}';`;
const hasIdxSql = (idx) =>
  `SELECT COUNT(1) AS c FROM \`information_schema\`.\`STATISTICS\` WHERE \`TABLE_SCHEMA\`=DATABASE() AND \`TABLE_NAME\`='agent_conversations' AND \`INDEX_NAME\`='${idx}';`;

const steps = [
  {
    key: 'source',
    probe: hasColSql('source'),
    ddl: "ALTER TABLE `agent_conversations` ADD COLUMN `source` varchar(16) NOT NULL DEFAULT 'chat' COMMENT '会话来源：chat=主对话 / tool=工具页';",
  },
  {
    key: 'agent_id',
    probe: hasColSql('agent_id'),
    ddl: "ALTER TABLE `agent_conversations` ADD COLUMN `agent_id` varchar(64) NULL COMMENT '当前会话锁定的 agentId';",
  },
  {
    key: 'idx source',
    probe: hasIdxSql('idx_agent_conversations_source'),
    ddl: 'ALTER TABLE `agent_conversations` ADD INDEX `idx_agent_conversations_source` (`source`);',
  },
  {
    key: 'idx agent_id',
    probe: hasIdxSql('idx_agent_conversations_agent_id'),
    ddl: 'ALTER TABLE `agent_conversations` ADD INDEX `idx_agent_conversations_agent_id` (`agent_id`);',
  },
];

// EMIT_SQL 模式下 stdout 必须**只有** SQL（可直接 `mysql < out.sql`），进度行走 stderr
const log = EMIT_SQL ? console.error : console.log;
log(`[p31] 目标库: ${cfg.database}@${cfg.host}:${cfg.port}  表: agent_conversations`);

if (EMIT_SQL) {
  // 离线模式：守卫无法在 SQL 里做，改为输出幂等写法（MySQL 8 支持 ADD COLUMN IF NOT EXISTS 之外的写法不稳，
  // 因此统一交给目标机执行时由本脚本判定——这里退化为提示）
  console.error('[p31] EMIT_SQL 不支持 DDL 条件分支；请 scp 本脚本到可连库的目标机直接运行 Node 版本。');
  process.exit(2);
}

const mysql = require(path.join(root, 'node_modules/.pnpm/node_modules/mysql2/promise.js'));
const conn = await mysql.createConnection(cfg);
try {
  for (const s of steps) {
    const [[row]] = await conn.query(s.probe);
    if (Number(row.c) > 0) {
      log(`[p31] 跳过（已存在）: ${s.key}`);
      continue;
    }
    log(`[p31] 执行: ${s.ddl}`);
    if (!DRY_RUN) await conn.query(s.ddl);
  }

  const [[res]] = await conn.query(
    "SELECT COLUMN_NAME, COLUMN_DEFAULT, IS_NULLABLE FROM `information_schema`.`COLUMNS` WHERE `TABLE_SCHEMA`=DATABASE() AND `TABLE_NAME`='agent_conversations' AND `COLUMN_NAME` IN ('source','agent_id') ORDER BY COLUMN_NAME;",
  );
  const [[cnt]] = await conn.query('SELECT COUNT(1) AS c FROM `agent_conversations`;');
  log(`[p31] 结果：`, res ?? [], `行数=${cnt.c}`);
  log('[p31] 完成');
} finally {
  await conn.end();
}
