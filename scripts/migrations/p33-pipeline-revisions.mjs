#!/usr/bin/env node
/**
 * p33：流水线**配置**版本化（2026-09-29）。
 *
 * 背景（2026-09-29 实测）：
 *   动作脚本以字符串存在 `deploy_pipeline_actions.script`，改坏了无从追溯、无从恢复。
 *   当天排查发现 13 条流水线的 prod `write-version` 动作脚本被一次坏写入损坏
 *   （续行符丢失 → bash -n 不过），只能人工逐条重写 —— 因为没有历史副本可以对比。
 *
 * 本脚本：
 *   1) 新建 `deploy_pipeline_revisions` 快照表（steps → tasks → actions，含脚本正文）
 *   2) 给 `deploy_pipelines` 加 `rev` 列（当前配置版本号，每次保存 +1）
 *   3) 为**已存在**的每条流水线生成 rev=1 基线快照（source='seed'），
 *      让版本化从第一天就有起点 —— 之后每次保存都由服务端追加新 rev。
 *
 * 只增语义：恢复历史版本 = 从旧快照生成一个新 rev，历史记录永不删除。
 *
 * 幂等性：information_schema 守卫建表/加列；基线只在 `rev = 0` 的流水线上生成一次。
 * 可重复执行，重复跑全部跳过。
 *
 * 用法：
 *   DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASSWORD=... DB_NAME=web_system_deploy \
 *     node scripts/migrations/p33-pipeline-revisions.mjs
 *
 *   DRY_RUN=1    只打印将执行的 SQL（建表/加列部分；基线为行级插入，不在 DRY_RUN 里执行）
 *   EMIT_SQL=1   只打印 SQL（本机连不上内网库时 scp 到服务器执行）
 *
 * 回滚（无破坏需求时不必执行）：
 *   ALTER TABLE deploy_pipelines DROP COLUMN rev;
 *   DROP TABLE deploy_pipeline_revisions;
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
  user: process.env.DB_USER || consoleEnv.DB_USERNAME || consoleEnv.DB_USER,
  password: process.env.DB_PASSWORD || consoleEnv.DB_PASSWORD,
  database: process.env.DB_NAME || consoleEnv.DB_DATABASE || consoleEnv.DB_NAME,
};

const DRY_RUN = process.env.DRY_RUN === '1';
const EMIT_SQL = process.env.EMIT_SQL === '1';

const REVISION_TABLE = 'deploy_pipeline_revisions';
const PIPELINE_TABLE = 'deploy_pipelines';

const CREATE_REVISIONS_SQL = `CREATE TABLE \`${REVISION_TABLE}\` (
  \`id\` varchar(36) NOT NULL,
  \`pipeline_id\` varchar(64) NOT NULL,
  \`rev\` int NOT NULL,
  \`source\` varchar(16) NOT NULL,
  \`summary\` varchar(255) DEFAULT NULL,
  \`snapshot\` json NOT NULL,
  \`restored_from_rev\` int DEFAULT NULL,
  \`created_by\` varchar(64) DEFAULT NULL,
  \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_pipeline_rev\` (\`pipeline_id\`,\`rev\`),
  KEY \`idx_revisions_pipeline\` (\`pipeline_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

const ADD_REV_COLUMN_SQL =
  `ALTER TABLE \`${PIPELINE_TABLE}\` ` +
  `ADD COLUMN \`rev\` int NOT NULL DEFAULT 0 COMMENT '配置版本号（每次保存 +1）'`;

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [cfg.database, table],
  );
  return rows.length > 0;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [cfg.database, table, column],
  );
  return rows.length > 0;
}

/** 读某条流水线的完整编排树，组装成快照 payload */
async function buildSnapshot(conn, pipelineId) {
  const [pipelineRows] = await conn.query(
    `SELECT id, \`key\`, name, module_key, env, description, approval, approvers,
            default_target, enabled, builtin, skip_verify, rollback_on_failure, nodes
       FROM \`${PIPELINE_TABLE}\` WHERE id = ?`,
    [pipelineId],
  );
  const p = pipelineRows[0];
  if (!p) return null;

  const [stepRows] = await conn.query(
    `SELECT id, name, description, sort, enabled FROM deploy_pipeline_steps
      WHERE pipeline_id = ? ORDER BY sort ASC, created_at ASC`,
    [pipelineId],
  );
  const stepIds = stepRows.map((s) => s.id);
  const [taskRows] = stepIds.length
    ? await conn.query(
        `SELECT id, step_id, kind, name, \`condition\`, env, approval, sort, enabled
           FROM deploy_pipeline_tasks WHERE step_id IN (?)
          ORDER BY sort ASC, created_at ASC`,
        [stepIds],
      )
    : [[]];
  const taskIds = taskRows.map((t) => t.id);
  const [actionRows] = taskIds.length
    ? await conn.query(
        `SELECT id, task_id, name, script, managed, sort, enabled
           FROM deploy_pipeline_actions WHERE task_id IN (?)
          ORDER BY sort ASC, created_at ASC`,
        [taskIds],
      )
    : [[]];

  const actionsByTask = new Map();
  for (const a of actionRows) {
    if (!actionsByTask.has(a.task_id)) actionsByTask.set(a.task_id, []);
    actionsByTask.get(a.task_id).push({
      id: a.id,
      name: a.name,
      script: a.script,
      managed: !!a.managed,
      sort: a.sort,
      enabled: !!a.enabled,
    });
  }
  const tasksByStep = new Map();
  for (const t of taskRows) {
    if (!tasksByStep.has(t.step_id)) tasksByStep.set(t.step_id, []);
    tasksByStep.get(t.step_id).push({
      id: t.id,
      kind: t.kind,
      name: t.name,
      condition: t.condition,
      env: t.env,
      approval: t.approval,
      sort: t.sort,
      enabled: !!t.enabled,
      actions: actionsByTask.get(t.id) ?? [],
    });
  }

  // json 列在 mysql2 下可能回传字符串（取决于 typeCast），统一归一到快照口径：
  // approvers → 数组；nodes → JSON 文本（与服务端 PipelineMetaSnapshot 一致）
  const asArray = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      try {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  };
  const asText = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

  return {
    pipeline: {
      id: p.id,
      key: p.key,
      name: p.name,
      moduleKey: p.module_key,
      env: p.env ?? null,
      description: p.description ?? null,
      approval: p.approval,
      approvers: asArray(p.approvers),
      defaultTarget: p.default_target,
      enabled: !!p.enabled,
      builtin: !!p.builtin,
      skipVerify: !!p.skip_verify,
      rollbackOnFailure: p.rollback_on_failure,
      nodes: asText(p.nodes),
    },
    steps: stepRows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      sort: s.sort,
      enabled: !!s.enabled,
      tasks: tasksByStep.get(s.id) ?? [],
    })),
  };
}

async function main() {
  if (!cfg.database) {
    throw new Error('缺少 DB_NAME（或 servers/deploy-console/.env 的 DB_DATABASE）');
  }

  const ddlSteps = [
    { kind: 'create-table', name: REVISION_TABLE, sql: CREATE_REVISIONS_SQL },
    { kind: 'add-column', table: PIPELINE_TABLE, name: 'rev', sql: ADD_REV_COLUMN_SQL },
  ];

  if (EMIT_SQL || DRY_RUN) {
    process.stderr.write(`-- p33 流水线配置版本化：DDL ${ddlSteps.length} 步\n`);
    for (const s of ddlSteps) process.stdout.write(`${s.sql};\n`);
    if (DRY_RUN) process.stderr.write('-- DRY_RUN：以上 SQL 未执行（基线快照需要读库，跳过）\n');
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

  // 1) 建快照表
  if (await tableExists(conn, REVISION_TABLE)) {
    process.stderr.write(`跳过：表 ${REVISION_TABLE} 已存在\n`);
    skipped++;
  } else {
    await conn.query(CREATE_REVISIONS_SQL);
    process.stderr.write(`执行：建表 ${REVISION_TABLE}\n`);
    executed++;
  }

  // 2) 加 rev 列
  if (await columnExists(conn, PIPELINE_TABLE, 'rev')) {
    process.stderr.write(`跳过：${PIPELINE_TABLE}.rev 已存在\n`);
    skipped++;
  } else {
    await conn.query(ADD_REV_COLUMN_SQL);
    process.stderr.write(`执行：${PIPELINE_TABLE} 加列 rev\n`);
    executed++;
  }

  // 3) 基线快照：仅对 rev = 0 的流水线生成一次
  const [pipelines] = await conn.query(
    `SELECT id, name FROM \`${PIPELINE_TABLE}\` WHERE rev = 0 ORDER BY module_key, env`,
  );
  let seeded = 0;
  for (const p of pipelines) {
    const snapshot = await buildSnapshot(conn, p.id);
    if (!snapshot) continue;
    await conn.query(
      `INSERT INTO \`${REVISION_TABLE}\`
         (id, pipeline_id, rev, source, summary, snapshot, created_by)
       VALUES (?, ?, 1, 'seed', '基线：迁移时点的流水线配置', ?, 'migration-p33')`,
      [randomUUID(), p.id, JSON.stringify(snapshot)],
    );
    await conn.query(`UPDATE \`${PIPELINE_TABLE}\` SET rev = 1 WHERE id = ?`, [p.id]);
    process.stderr.write(
      `基线：${p.name}（${p.id}）rev=1，步骤 ${snapshot.steps.length} 个\n`,
    );
    seeded++;
  }

  await conn.end();
  process.stderr.write(
    `\np33 完成：执行 ${executed} 步，跳过 ${skipped} 步，基线快照 ${seeded} 条\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`p33 失败: ${e.message}\n`);
  process.exit(1);
});
