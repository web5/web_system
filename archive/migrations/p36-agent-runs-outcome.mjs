#!/usr/bin/env node
/**
 * p36：agent_runs 结果归因（2026-10-20）。
 *
 * 背景：`agent_runs` 有成本归因（cost / totalTokens / durationMs），**没有结果归因** ——
 *  只能回答「这次花了多少钱」，回答不了「这次到底成没成、败在哪一步」。
 *  这是 `docs/architecture/ai-flow-technical-design.md` §7 的 **P0**，
 *  也是多 Agent 编排（Agent-as-Tool）的前置：多层委派失败时，
 *  没有 outcome/fail_stage 就只能看到「run 失败」，看不到是哪一层的哪个阶段失败。
 *
 * 本迁移只做**加列 + 加索引**，纯新增、可空，不删不改任何既有数据：
 *
 *   1) `outcome`     varchar(16)  success / partial / fail / unknown
 *   2) `fail_stage`  varchar(24)  model / tool / network / auth / upstream / max_steps / permission / other
 *   3) `graded_by`   varchar(16)  rule（服务端规则）/ human / auto_llm_judge（离线评测）
 *   4) `graded_at`   datetime(3)  判定时间
 *   5) KEY `idx_agent_runs_outcome` (agent_id, outcome) —— 观测台按 agent 看结果分布
 *
 * ⚠️ **历史数据不回填**（刻意）：存量行拿不到错误码，推断出来的归因就是伪造。
 *    存量行 outcome 保持 NULL = 「未判定」，新 run 由 AgentLogService.deriveAttribution
 *    落 rule 判定。回填要等有据可依的离线评测（B4），不在本迁移范围内。
 *
 * ⚠️ 仓库迁移真相源是 `archive/migrations/`（前序 p35），不要写到 `scripts/migrations/`。
 *
 * ── 规范性约束（项目红线） ──────────────────────────────────────────────
 *   · information_schema 幂等守卫，重复执行不报错
 *   · EMIT_SQL=1 可导出 SQL（本机连不上内网库时 scp 到服务器执行）
 *   · 时间列统一 datetime(3)，显式 precision，避免 TypeORM 高精度冲突
 *   · **不写 COLLATE**（utf8mb4_0900_ai_ci 仅 MySQL 8，5.7 环境建表会失败）
 *   · 全部新列 nullable，不触碰既有数据
 *
 * 用法：
 *   # 直连（推荐，走 information_schema 守卫）
 *   DB_HOST=127.0.0.1 DB_NAME=web_system DB_USER=root DB_PASSWORD=... \
 *     node archive/migrations/p36-agent-runs-outcome.mjs
 *
 *   # 本机连不到目标库 → 导出 SQL 后在目标库执行
 *   EMIT_SQL=1 node archive/migrations/p36-agent-runs-outcome.mjs > p36.sql
 *
 *   DRY_RUN=1   只打印将执行的 SQL，不落库
 *
 * 回滚（DDL 不支持事务，须逐条执行；均为纯新增，删除不影响任何既有功能）：
 *   ALTER TABLE `agent_runs`
 *     DROP INDEX `idx_agent_runs_outcome`,
 *     DROP COLUMN `outcome`, DROP COLUMN `fail_stage`,
 *     DROP COLUMN `graded_by`, DROP COLUMN `graded_at`;
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const DRY_RUN = process.env.DRY_RUN === '1';
const EMIT_SQL = process.env.EMIT_SQL === '1';
const OFFLINE = DRY_RUN || EMIT_SQL;

/** 未显式给 env 时，退回 servers/deploy-console/.env（与 p28/p29/p34/p35 同口径） */
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

const TABLE = 'agent_runs';

/** 待新增的列：列名 → DDL 片段 */
const COLUMNS = {
  outcome: {
    ddl: "varchar(16) NULL COMMENT '结果归因 success/partial/fail/unknown'",
    desc: '结果归因；NULL = 未判定（历史数据不回填）',
  },
  fail_stage: {
    ddl: "varchar(24) NULL COMMENT '失败阶段 model/tool/network/auth/upstream/max_steps/permission/other'",
    desc: '失败阶段，仅 fail / partial 时有值',
  },
  graded_by: {
    ddl: "varchar(16) NULL COMMENT '判定来源 rule/human/auto_llm_judge'",
    desc: '判定来源；B0 阶段只产出 rule',
  },
  graded_at: {
    ddl: "datetime(3) NULL COMMENT '判定时间'",
    desc: '判定时间',
  },
};

/** 待新增的索引 */
const INDEXES = {
  idx_agent_runs_outcome: {
    ddl: 'ALTER TABLE `agent_runs` ADD KEY `idx_agent_runs_outcome` (`agent_id`, `outcome`)',
    desc: '按 agent 看结果分布（观测台 / 质量复盘）',
  },
};

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT 1 FROM `information_schema`.`COLUMNS` ' +
      'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [cfg.database, table, column],
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

  process.stderr.write(`-- p36 agent_runs 结果归因（库：${cfg.database}）\n`);

  let created = 0;
  let skipped = 0;

  // 1) 逐列加列 —— MySQL 的 ALTER 没有 IF NOT EXISTS，必须逐列守卫，
  //    否则只要有一列已存在就整条报 duplicate column，脚本就没法重复执行。
  for (const [col, spec] of Object.entries(COLUMNS)) {
    if (await columnExists(conn, TABLE, col)) {
      process.stderr.write(`- 跳过 ${TABLE}.${col}（已存在）\n`);
      skipped += 1;
      continue;
    }
    await conn.query(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`${col}\` ${spec.ddl}`);
    process.stderr.write(`+ 新增 ${TABLE}.${col} —— ${spec.desc}\n`);
    created += 1;
  }

  // 2) 加索引（同样守卫：已存在则跳过）
  for (const [name, spec] of Object.entries(INDEXES)) {
    if (await indexExists(conn, TABLE, name)) {
      process.stderr.write(`- 跳过索引 ${name}（已存在）\n`);
      skipped += 1;
      continue;
    }
    await conn.query(spec.ddl);
    process.stderr.write(`+ 新增索引 ${name} —— ${spec.desc}\n`);
    created += 1;
  }

  // 3) 校验：四列都在，且历史行确实是 NULL（没被回填）
  process.stderr.write('\n-- 校验：agent_runs 归因列 --\n');
  const [cols] = await conn.query(
    "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM `information_schema`.`COLUMNS` " +
      "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? " +
      "AND COLUMN_NAME IN ('outcome','fail_stage','graded_by','graded_at')",
    [cfg.database, TABLE],
  );
  for (const c of cols) {
    process.stderr.write(`${c.COLUMN_NAME}\t${c.COLUMN_TYPE}\tnullable=${c.IS_NULLABLE}\n`);
  }
  if (cols.length !== Object.keys(COLUMNS).length) {
    process.stderr.write(
      `✗ 校验失败：应有 ${Object.keys(COLUMNS).length} 列，实有 ${cols.length} 列\n`,
    );
    await conn.end();
    process.exit(1);
  }

  process.stderr.write('\n-- 校验：历史行未被回填（应全部为 NULL） --\n');
  const [backfilled] = await conn.query(
    `SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE \`outcome\` IS NOT NULL AND \`graded_by\` IS NULL`,
  );
  const orphan = Number(backfilled[0]?.n ?? 0);
  process.stderr.write(
    orphan === 0
      ? '✓ 无「有 outcome 但无判定来源」的脏行\n'
      : `⚠️ 存在 ${orphan} 行 outcome 有值但 graded_by 为空，需人工核对来源\n`,
  );

  const [dist] = await conn.query(
    `SELECT \`outcome\` AS outcome, COUNT(*) AS n FROM \`${TABLE}\` GROUP BY \`outcome\``,
  );
  for (const d of dist) {
    process.stderr.write(`outcome=${d.outcome ?? 'NULL(未判定)'}\t${d.n} 行\n`);
  }

  await conn.end();
  process.stderr.write(`\np36 完成：新增 ${created} 项，跳过 ${skipped} 项\n`);
}

function runOffline() {
  process.stderr.write('-- p36 agent_runs 结果归因（目标库请在执行端显式指定）\n');

  // 逐列加列 —— 在线模式本来就逐列守卫，导出路径用 PREPARE 补齐同样的语义，
  // 保证导出的 SQL 也能重复执行（否则第二次执行会报 duplicate column）。
  for (const [col, spec] of Object.entries(COLUMNS)) {
    const addSql = `ALTER TABLE \`${TABLE}\` ADD COLUMN \`${col}\` ${spec.ddl}`.replace(/'/g, "''");
    process.stdout.write(
      `SET @p36_ddl := (SELECT IF(\n` +
        `  EXISTS(\n` +
        `    SELECT 1 FROM information_schema.COLUMNS\n` +
        `    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}' AND COLUMN_NAME = '${col}'\n` +
        `  ),\n` +
        `  'SELECT ''skip ${TABLE}.${col}（已存在）'' AS p36',\n` +
        `  '${addSql}'\n` +
        `));\n` +
        `PREPARE p36_stmt FROM @p36_ddl; EXECUTE p36_stmt; DEALLOCATE PREPARE p36_stmt;\n`,
    );
  }
  process.stderr.write(
    `-- 步骤：${TABLE} 加 ${Object.keys(COLUMNS).length} 个归因列（逐列守卫，可重复执行）\n`,
  );

  for (const [name, spec] of Object.entries(INDEXES)) {
    const addSql = spec.ddl.replace(/'/g, "''");
    process.stdout.write(
      `SET @p36_ddl := (SELECT IF(\n` +
        `  EXISTS(\n` +
        `    SELECT 1 FROM information_schema.STATISTICS\n` +
        `    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}' AND INDEX_NAME = '${name}'\n` +
        `  ),\n` +
        `  'SELECT ''skip index ${name}（已存在）'' AS p36',\n` +
        `  '${addSql}'\n` +
        `));\n` +
        `PREPARE p36_stmt FROM @p36_ddl; EXECUTE p36_stmt; DEALLOCATE PREPARE p36_stmt;\n`,
    );
  }
  process.stderr.write('-- 步骤：加索引 idx_agent_runs_outcome（守卫后执行，可重复执行）\n');

  process.stderr.write(
    '-- 校验：SELECT outcome, graded_by, COUNT(*) FROM agent_runs GROUP BY 1,2;\n' +
      '-- 校验：SHOW INDEX FROM agent_runs WHERE Key_name = \'idx_agent_runs_outcome\';\n' +
      '-- 注意：历史行 outcome 应保持 NULL（未判定），本迁移不回填。\n',
  );
  process.stderr.write(
    '-- 回滚：ALTER TABLE agent_runs DROP INDEX idx_agent_runs_outcome,\n' +
      '--        DROP COLUMN outcome, DROP COLUMN fail_stage,\n' +
      '--        DROP COLUMN graded_by, DROP COLUMN graded_at;\n',
  );
  if (DRY_RUN) process.stderr.write('-- DRY_RUN：以上 SQL 未执行\n');
}

if (OFFLINE) runOffline();
else
  runOnline().catch((e) => {
    process.stderr.write(`p36 失败: ${e.message}\n`);
    process.exit(1);
  });
