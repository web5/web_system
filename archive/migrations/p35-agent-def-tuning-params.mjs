#!/usr/bin/env node
/**
 * p35：给 agent 定义补 **C7 生成参数** 列（`max_tokens` / `top_p` / `thinking`）。
 *
 * 背景（2026-10-10，`docs/api/contracts.md` §7 / §9 D8）：
 *   `ChatOptions` 早就支持 `maxTokens` / `topP` / `thinking`，但
 *   ① `AgentDefinition`（契约面）没有对应字段；② `agent_definitions` 没有对应列；
 *   ③ `AgentEngine` 只透传 `temperature` —— 于是「后台想调最大输出 / 思考预算」无从下手，
 *   只能靠全局 env（`TOKENHUB_THINKING`），改一次要重启且对所有 agent 生效。
 *
 *   本脚本补齐第 ② 环：`agent_definitions`（当前定义）+ `agent_definition_versions`
 *   （历史快照，回滚时不丢参数）。三列**全部 nullable**：不填 = 沿用客户端默认，
 *   因此存量 agent 的行为与本迁移前完全一致（C7-e）。
 *
 * 列名口径（2026-10-28 修订）：走 SnakeNamingStrategy snake_case（`max_tokens` / `top_p`），
 *   与 ai-service 实体映射一致——2026-10-28 dev 实锤驼峰列名（`maxTokens` / `topP`）撞
 *   `ER_BAD_FIELD_ERROR: Unknown column 'AgentDefinitionEntity.max_tokens'`，服务启动即回滚。
 *   `thinking` 单词驼峰/蛇形同形，不受影响。
 *
 * 幂等性：information_schema 守卫加列；无回填步骤（存量一律保持 NULL，不猜默认值）。
 *   可重复执行，重复跑全部跳过。脏环境自愈：若只有驼峰旧列（早期错误版本创建），
 *   走 `ALTER TABLE ... RENAME COLUMN` 改名为 snake_case，而不是重复 ADD。
 *
 * 用法：
 *   DB_HOST=... DB_PORT=3306 DB_USER=root DB_PASSWORD=... DB_NAME=web_system \
 *     node archive/migrations/p35-agent-def-tuning-params.mjs
 *
 *   DRY_RUN=1    只打印将执行的 SQL
 *   EMIT_SQL=1   只打印 SQL（本机连不上内网库时 scp 到服务器执行）
 *
 * 回滚（无破坏需求时不必执行；注意「定义侧」与「代码侧」要一起回）：
 *   ALTER TABLE agent_definitions DROP COLUMN max_tokens, DROP COLUMN top_p, DROP COLUMN thinking;
 *   ALTER TABLE agent_definition_versions DROP COLUMN max_tokens, DROP COLUMN top_p, DROP COLUMN thinking;
 */
import fs from 'node:fs';
import path from 'node:path';
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

const DRY_RUN = process.env.DRY_RUN === '1';
const EMIT_SQL = process.env.EMIT_SQL === '1';

/**
 * name：snake_case 列名（实体映射口径，守卫与 ADD 的目标名）
 * legacyName：早期错误版本的驼峰列名（仅脏环境 RENAME 自愈用）；与 name 同形则无自愈路径
 * add：干净环境的 ADD COLUMN DDL
 */
const COLUMNS = [
  {
    name: 'max_tokens',
    legacyName: 'maxTokens',
    add: "ADD COLUMN `max_tokens` int DEFAULT NULL COMMENT '输出 token 上限'",
  },
  {
    name: 'top_p',
    legacyName: 'topP',
    add: "ADD COLUMN `top_p` float DEFAULT NULL COMMENT '核采样 top_p'",
  },
  {
    name: 'thinking',
    legacyName: 'thinking',
    add: "ADD COLUMN `thinking` json DEFAULT NULL COMMENT '思考开关（enabled/disabled）'",
  },
];

const TABLES = ['agent_definitions', 'agent_definition_versions'];

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [cfg.database, table, column],
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [cfg.database, table],
  );
  return rows.length > 0;
}

async function main() {
  const steps = [];
  for (const table of TABLES) {
    for (const col of COLUMNS) {
      steps.push({
        kind: 'add-column',
        table,
        name: col.name,
        legacyName: col.legacyName,
        sql: `ALTER TABLE \`${table}\` ${col.add}`,
        // 脏环境自愈：早期错误版本建了驼峰旧列时改名而不是重复 ADD
        renameSql:
          col.legacyName !== col.name
            ? `ALTER TABLE \`${table}\` RENAME COLUMN \`${col.legacyName}\` TO \`${col.name}\``
            : null,
      });
    }
  }

  if (EMIT_SQL || DRY_RUN) {
    process.stderr.write(
      `-- p35 agent 定义生成参数：${steps.length} 步（列名 snake_case：max_tokens / top_p / thinking）\n`,
    );
    for (const s of steps) {
      process.stdout.write(`${s.sql};\n`);
      if (s.renameSql) {
        process.stderr.write(`-- 脏环境（已有 \`${s.legacyName}\` 旧列）时改执行：${s.renameSql};\n`);
      }
    }
    if (DRY_RUN) process.stderr.write('-- DRY_RUN：以上 SQL 未执行\n');
    return;
  }

  let mysql2;
  try {
    mysql2 = require('mysql2/promise');
  } catch {
    try {
      mysql2 = require(path.join(root, 'node_modules/mysql2/promise'));
    } catch {
      throw new Error('缺少 mysql2 依赖：请先 npm i mysql2，或用 EMIT_SQL=1 导出 SQL 到服务器执行');
    }
  }

  const conn = await mysql2.createConnection(cfg);
  let executed = 0;
  let skipped = 0;

  for (const step of steps) {
    if (!(await tableExists(conn, step.table))) {
      process.stderr.write(`跳过：表 ${step.table} 不存在\n`);
      skipped++;
      continue;
    }
    if (await columnExists(conn, step.table, step.name)) {
      process.stderr.write(`跳过：${step.table}.${step.name} 已存在\n`);
      skipped++;
      continue;
    }
    // 脏环境自愈：snake 列没有、驼峰旧列在 → RENAME 改名（dev 2026-10-28 的坑就是这种形态）
    if (step.renameSql && (await columnExists(conn, step.table, step.legacyName))) {
      await conn.query(step.renameSql);
      process.stderr.write(`改名：${step.table}.${step.legacyName} → ${step.name}\n`);
      executed++;
      continue;
    }
    await conn.query(step.sql);
    process.stderr.write(`执行：${step.table} ${step.name}\n`);
    executed++;
  }

  await conn.end();
  process.stderr.write(`\np35 完成：执行 ${executed} 步，跳过 ${skipped} 步\n`);
  process.stderr.write(
    '提示：新列上线且代码同步到发布目录之后，才在 admin 里填参数值（C7 纪律第 8 条）\n',
  );
}

main().catch((e) => {
  process.stderr.write(`p35 失败: ${e.message}\n`);
  process.exit(1);
});
