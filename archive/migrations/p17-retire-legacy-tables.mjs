#!/usr/bin/env node
/**
 * p17：旧编排链路数据退役（specs/pipeline-step-task/design.md P5）。
 *
 * 前提：p16 已把 16 条流水线迁入新三层表（steps/tasks/actions），
 *       执行引擎按「新表有数据」分派 → 旧表已无读路径（端到端已验证）。
 *
 * 动作：RENAME 旧表为 _bak_20260921（库内备份惯例，可随时 RENAME 回退）：
 *   - deploy_pipeline_step_commands → deploy_pipeline_step_commands_bak_20260921
 *     （env_branches 废弃列随表一起归档）
 *   - deploy_pipeline_step_branches  → deploy_pipeline_step_branches_bak_20260921
 *
 * 不删代码兼容层（PlatformScriptSeedService 会向重建的空表幂等 seed 平台脚本，无害）：
 * 旧执行链路代码（runStageCommand/executeStage）保留至新模型稳定运行一个发布周期后再删。
 *
 * 用法：node scripts/migrations/p17-retire-legacy-tables.mjs   （DRY_RUN=1 预览）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, 'servers/deploy-console/.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const DRY_RUN = !!process.env.DRY_RUN;
const mysql = require(path.join(root, 'node_modules/.pnpm/node_modules/mysql2/promise.js'));
const SUFFIX = 'bak_20260921';

async function main() {
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DB,
  });

  // 前置校验：新表必须有数据（否则退役 = 断粮）
  const [steps] = await conn.query('SELECT COUNT(*) n FROM deploy_pipeline_steps');
  const [tasks] = await conn.query('SELECT COUNT(*) n FROM deploy_pipeline_tasks');
  const [actions] = await conn.query('SELECT COUNT(*) n FROM deploy_pipeline_actions');
  console.log(`新表数据：steps=${steps[0].n} tasks=${tasks[0].n} actions=${actions[0].n}`);
  if (!steps[0].n || !tasks[0].n) {
    console.error('新表无数据（p16 未迁移？）—— 拒绝退役，防止执行断粮');
    process.exit(1);
  }

  for (const table of ['deploy_pipeline_step_commands', 'deploy_pipeline_step_branches']) {
    const bak = `${table}_${SUFFIX}`;
    const [exists] = await conn.query('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [env.MYSQL_DB, table]);
    const [bakExists] = await conn.query('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [env.MYSQL_DB, bak]);
    if (!exists[0].n) {
      console.log(`- ${table}: 不存在（已退役过），跳过`);
      continue;
    }
    if (bakExists[0].n) {
      console.log(`- ${table}: 备份表 ${bak} 已存在，跳过（幂等）`);
      continue;
    }
    const [rows] = await conn.query(`SELECT COUNT(*) n FROM ${table}`);
    if (DRY_RUN) {
      console.log(`[DRY] RENAME TABLE ${table} → ${bak}（${rows[0].n} 行归档）`);
    } else {
      await conn.query(`RENAME TABLE ${table} TO ${bak}`);
      console.log(`- ${table}（${rows[0].n} 行）→ ${bak} ✓`);
    }
  }

  if (!DRY_RUN) {
    console.log(`\n退役完成。回退方式：RENAME TABLE ${'{旧表}'}_${SUFFIX} TO ${'{旧表}'}；`);
    console.log('注意：服务重启时 synchronize 会按实体重建空表（旧链路代码仍在但新引擎不读它）。');
  }
  await conn.end();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
