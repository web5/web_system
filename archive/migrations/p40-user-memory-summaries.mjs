#!/usr/bin/env node
/**
 * p40：用户记忆摘要表 user_memory_summaries（2026-10-30，台账 #8229 批次1 卡1.1）。
 *
 * 背景：Agent 用户记忆原先是「只写不读」半条链路（user_memories 无任何读回注入路径）。
 *  升级方案是「明细 + 摘要双层」：
 *    - 明细层 user_memories（既有，p26 建）：一用户多条，审计 / 编辑 / 明细查看；
 *    - 摘要层 user_memory_summaries（本迁移新建）：一用户一条，是 Agent loadProfile
 *      注入的唯一来源 → 注入体积恒定（一条摘要，与明细条数无关）。
 *
 * 结构要点：
 *   - UNIQUE (user_id, namespace)：保证「一个用户一条」（namespace 预留扩展，v1 只用 general）；
 *   - source_hash：明细集 sha256 指纹（幂等与重算判据，同一指纹重复 rebuild 不产生新版本）；
 *   - version：摘要版本号，明细集变化并重算生效时 +1；
 *   - last_item_at：最近一条明细时间（datetime(3) nullable，无明细时为空）。
 *
 * ⚠️ 仓库迁移真相源是 `archive/migrations/`（前序 p36/p39），不要写到 `scripts/migrations/`。
 *
 * ── 规范性约束（项目红线） ──────────────────────────────────────────────
 *   · information_schema 幂等守卫，重复执行不报错
 *   · EMIT_SQL=1 可导出 SQL（本机连不上内网库时 scp 到服务器执行）
 *   · 时间列统一 datetime(3)，显式 precision
 *   · **不写 COLLATE**（utf8mb4_0900_ai_ci 仅 MySQL 8，5.7 环境建表会失败）
 *   · 全列 nullable 或有默认（新表纯新增，不触碰任何既有数据）
 *
 * 用法：
 *   # 直连（推荐，走 information_schema 守卫）
 *   DB_HOST=127.0.0.1 DB_DATABASE=web_system DB_USERNAME=root DB_PASSWORD=... \
 *     node archive/migrations/p40-user-memory-summaries.mjs
 *
 *   # 不传参数时退回 servers/user-service/.env（本表属主服务配置）
 *   node archive/migrations/p40-user-memory-summaries.mjs
 *
 *   # 本机连不到目标库 → 导出 SQL 后在目标库执行
 *   EMIT_SQL=1 node archive/migrations/p40-user-memory-summaries.mjs > p40.sql
 *
 *   DRY_RUN=1   只打印将执行的 SQL，不落库
 *
 * 回滚（纯新增表，删除不影响任何既有功能）：
 *   DROP TABLE IF EXISTS `user_memory_summaries`;
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const DRY_RUN = process.env.DRY_RUN === '1';
const EMIT_SQL = process.env.EMIT_SQL === '1';
const OFFLINE = DRY_RUN || EMIT_SQL;

/**
 * 未显式给 env 时，退回 `servers/user-service/.env` —— 本表（user_memory_summaries）
 * 归属 user-service（跟用户走），与 p36 改 ai-service 的表退回 ai-service/.env 同口径。
 * 兼容两套键名：DB_USERNAME/DB_DATABASE 与 DB_USER/DB_NAME。
 */
function loadServiceEnv() {
  const p = path.join(root, 'servers/user-service/.env');
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

const serviceEnv = loadServiceEnv();
const cfg = {
  host: process.env.DB_HOST || serviceEnv.DB_HOST,
  port: Number(process.env.DB_PORT || serviceEnv.DB_PORT || 3306),
  user: process.env.DB_USER || process.env.DB_USERNAME || serviceEnv.DB_USERNAME || serviceEnv.DB_USER,
  password: process.env.DB_PASSWORD ?? serviceEnv.DB_PASSWORD,
  database: process.env.DB_NAME || process.env.DB_DATABASE || serviceEnv.DB_DATABASE || serviceEnv.DB_NAME,
};

/** 直连前的强制守卫（与 p36 同口径）：目标库必须明确 */
if (!OFFLINE && (!cfg.host || !cfg.database || !cfg.user || !cfg.password)) {
  process.stderr.write(
    '✗ 拒绝执行：直连模式未能确定完整目标库，请显式传入连接参数\n' +
      '  示例：DB_HOST=127.0.0.1 DB_DATABASE=web_system DB_USERNAME=root DB_PASSWORD=... \\\n' +
      '        node archive/migrations/p40-user-memory-summaries.mjs\n' +
      `  当前解析：host=${cfg.host || '∅'} database=${cfg.database || '∅'} ` +
      `user=${cfg.user || '∅'} password=${cfg.password ? '已设置' : '∅'}\n`,
  );
  process.exit(1);
}

const TABLE = 'user_memory_summaries';

/** 建表 DDL（幂等：CREATE TABLE IF NOT EXISTS；不写 COLLATE，随服务端默认） */
const CREATE_TABLE_SQL =
  `CREATE TABLE IF NOT EXISTS \`${TABLE}\` (\n` +
  '  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT \'ID\',\n' +
  '  `user_id` VARCHAR(64) NOT NULL COMMENT \'用户 id（与 user_memories.user_id 同口径）\',\n' +
  '  `namespace` VARCHAR(32) NULL DEFAULT \'general\' COMMENT \'摘要域 general / 预留\',\n' +
  '  `summary` TEXT NULL COMMENT \'记忆摘要正文（结构化中文，≤500 字）\',\n' +
  '  `item_count` INT NULL COMMENT \'摘要覆盖的明细条数\',\n' +
  '  `source_hash` VARCHAR(64) NULL COMMENT \'明细集 sha256 指纹（幂等与重算判据）\',\n' +
  '  `version` INT NOT NULL DEFAULT 1 COMMENT \'摘要版本号\',\n' +
  '  `last_item_at` DATETIME(3) NULL COMMENT \'最近一条明细时间\',\n' +
  '  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT \'创建时间\',\n' +
  '  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT \'更新时间\',\n' +
  '  PRIMARY KEY (`id`),\n' +
  '  UNIQUE KEY `idx_user_memory_summaries_user_ns` (`user_id`, `namespace`),\n' +
  '  KEY `idx_user_memory_summaries_user` (`user_id`)\n' +
  ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';

const UNIQUE_INDEX = 'idx_user_memory_summaries_user_ns';

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT 1 FROM `information_schema`.`TABLES` ' +
      'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1',
    [cfg.database, table],
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    'SELECT 1 FROM `information_schema`.`STATISTICS` ' +
      'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [cfg.database, table, indexName],
  );
  return rows.length > 0;
}

async function runOnline() {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection(cfg);

  process.stderr.write(`-- p40 用户记忆摘要表（库：${cfg.database}）\n`);

  let created = 0;
  let skipped = 0;

  // 1) 建表（information_schema 守卫 + CREATE TABLE IF NOT EXISTS 双保险）
  if (await tableExists(conn, TABLE)) {
    process.stderr.write(`- 跳过建表 ${TABLE}（已存在）\n`);
    skipped += 1;
  } else {
    await conn.query(CREATE_TABLE_SQL);
    process.stderr.write(`+ 新建表 ${TABLE} —— 用户记忆摘要（一用户一条，Agent 注入源）\n`);
    created += 1;
  }

  // 2) 校验：唯一索引（user_id, namespace）必须在 —— 它是「一用户一条」的机器保证
  if (await indexExists(conn, TABLE, UNIQUE_INDEX)) {
    process.stderr.write(`✓ 唯一索引 ${UNIQUE_INDEX}（user_id, namespace）在位\n`);
  } else {
    process.stderr.write(
      `✗ 校验失败：${TABLE} 缺唯一索引 ${UNIQUE_INDEX}，「一用户一条」无保障，请人工核查\n`,
    );
    await conn.end();
    process.exit(1);
  }

  // 3) 校验：关键列类型与可空性
  process.stderr.write('\n-- 校验：user_memory_summaries 列清单 --\n');
  const [cols] = await conn.query(
    'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM `information_schema`.`COLUMNS` ' +
      'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    [cfg.database, TABLE],
  );
  for (const c of cols) {
    process.stderr.write(`${c.COLUMN_NAME}\t${c.COLUMN_TYPE}\tnullable=${c.IS_NULLABLE}\n`);
  }
  const colNames = new Set(cols.map((c) => c.COLUMN_NAME));
  for (const must of ['user_id', 'namespace', 'summary', 'item_count', 'source_hash', 'version', 'last_item_at']) {
    if (!colNames.has(must)) {
      process.stderr.write(`✗ 校验失败：缺列 ${must}\n`);
      await conn.end();
      process.exit(1);
    }
  }

  await conn.end();
  process.stderr.write(`\np40 完成：新增 ${created} 项，跳过 ${skipped} 项\n`);
}

function runOffline() {
  process.stderr.write('-- p40 用户记忆摘要表（目标库请在执行端显式指定）\n');
  // CREATE TABLE IF NOT EXISTS 本身幂等，导出路径无需 PREPARE 守卫包装
  process.stdout.write(CREATE_TABLE_SQL + ';\n');
  process.stderr.write(
    '-- 步骤：新建 user_memory_summaries（UNIQUE(user_id, namespace) 保证一用户一条）\n' +
      '-- 校验：SHOW INDEX FROM user_memory_summaries WHERE Key_name = \'idx_user_memory_summaries_user_ns\';\n' +
      '-- 校验：SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS\n' +
      '--       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = \'user_memory_summaries\';\n' +
      '-- 注意：时间列统一 datetime(3)；不写 COLLATE（随服务端默认，兼容 5.7/8.0）。\n',
  );
  process.stderr.write('-- 回滚：DROP TABLE IF EXISTS user_memory_summaries;\n');
  if (DRY_RUN) process.stderr.write('-- DRY_RUN：以上 SQL 未执行\n');
}

if (OFFLINE) runOffline();
else
  runOnline().catch((e) => {
    process.stderr.write(`p40 失败: ${e.message}\n`);
    process.exit(1);
  });
