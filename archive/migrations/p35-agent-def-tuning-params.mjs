#!/usr/bin/env node
/**
 * p35：给 agent 定义补 **C7 生成参数** 列（`maxTokens` / `topP` / `thinking`）。
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
 * 幂等性：information_schema 守卫加列；无回填步骤（存量一律保持 NULL，不猜默认值）。
 * 可重复执行，重复跑全部跳过。
 *
 * 用法：
 *   DB_HOST=... DB_PORT=3306 DB_USER=root DB_PASSWORD=... DB_NAME=web_system \
 *     node archive/migrations/p35-agent-def-tuning-params.mjs
 *
 *   DRY_RUN=1    只打印将执行的 SQL
 *   EMIT_SQL=1   只打印 SQL（本机连不上内网库时 scp 到服务器执行）
 *
 * 回滚（无破坏需求时不必执行；注意「定义侧」与「代码侧」要一起回）：
 *   ALTER TABLE agent_definitions DROP COLUMN maxTokens, DROP COLUMN topP, DROP COLUMN thinking;
 *   ALTER TABLE agent_definition_versions DROP COLUMN maxTokens, DROP COLUMN topP, DROP COLUMN thinking;
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

const COLUMNS = [
  { name: 'maxTokens', ddl: "ADD COLUMN `maxTokens` int DEFAULT NULL COMMENT '输出 token 上限'" },
  { name: 'topP', ddl: "ADD COLUMN `topP` float DEFAULT NULL COMMENT '核采样 top_p'" },
  { name: 'thinking', ddl: "ADD COLUMN `thinking` json DEFAULT NULL COMMENT '思考预算覆盖'" },
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
        sql: `ALTER TABLE \`${table}\` ${col.ddl}`,
      });
    }
  }

  if (EMIT_SQL || DRY_RUN) {
    process.stderr.write(`-- p35 agent 定义生成参数：${steps.length} 步\n`);
    for (const s of steps) process.stdout.write(`${s.sql};\n`);
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
    if (step.kind === 'add-column') {
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
