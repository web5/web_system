#!/usr/bin/env node
/**
 * p28：修正**远端（dev/prod）微前端投递脚本**的落盘布局 —— 与本地/控制台口径对齐。
 *
 * 问题（2026-09-23 实测）：远端 dev 任务的「投递产物」把版本目录写成
 *   `<PUBLISH_PATH>/${COMMIT_ID}`，而 COMMIT_ID = `<流水线key>/<commit>`（如 `admin-dev/3d5ce61`）
 *   ⇒ 产物落在 `static/modules/admin/admin-dev/3d5ce61/`，
 * 而控制台的 env-dir 约定（方案 A，见本地任务脚本注释）是
 *   `static/modules/<key>/<envId>/<纯commit>/`（本地实测：`modules/admin/local/20d1380/`，
 *   指针文件 `modules/admin/local/index.js` → `System.register(['./20d1380/index.js'])`）。
 *   控制台 `listEnvVersions/hasEnvVersion/readEnvEntryPointer` 全按 envId 取目录，
 *   于是 dev 的「版本部署」页**列不出**这些产物、也无法切指针（状态撕裂）。
 *
 * 修法：远端投递脚本只改**版本目录的计算**（其余不变）：
 *   COMMIT_SHORT 取 COMMIT_ID 的最后一段（## 去前缀）
 *   VER = "${DEPLOY_ENV}/${COMMIT_SHORT}"
 *   DST = "$PUBLISH_PATH/$VER"  ⇒ `<...>/modules/<key>/<envId>/<commit>/`
 *
 * 幂等：脚本里已含 `COMMIT_SHORT=` 即跳过；`ROLLBACK=1` 还原为原行。
 * `DRY_RUN=1` 只打印。目标范围：MODULES（默认 admin,portal,shell）中存在的 tpl-<mod>-<env>，
 * env 默认 dev（可用 ENVS=dev,prod 扩展）。
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
const ROLLBACK = !!process.env.ROLLBACK;
const mysql = require(path.join(root, 'node_modules/.pnpm/node_modules/mysql2/promise.js'));

const MODULES = (process.env.MODULES || 'admin,portal,shell').split(',').map((s) => s.trim()).filter(Boolean);
const ENVS = (process.env.ENVS || 'dev').split(',').map((s) => s.trim()).filter(Boolean);
/** 分支任务名候选（后端 dev / 前端 dev-1 / prod 侧同形） */
const TASK_NAMES = { dev: ['dev', 'dev-1'], prod: ['prod', 'prod-1'] };

const OLD_LINE_RE = /^VER="\$\{COMMIT_ID:\?COMMIT_ID 为空，无法确定版本目录\}"$/m;
const NEW_BLOCK = `COMMIT_SHORT="\${COMMIT_ID##*/}"
# env-dir 约定（方案 A）：落盘目录 = /static/modules/<key>/<envId>/<纯 commit>/
# COMMIT_ID 形如 <流水线key>/<commit>，只取纯 commit 段（与本地任务、控制台口径一致）
VER="\${DEPLOY_ENV:?缺少 DEPLOY_ENV}/\${COMMIT_SHORT}"`;

async function main() {
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DB,
  });

  console.log(`${ROLLBACK ? '回退' : '应用'} p28（远端微前端投递改 env-dir 布局）`);
  console.log(`模块: ${MODULES.join(', ')}｜环境: ${ENVS.join(', ')}\n`);

  let changed = 0;
  let skipped = 0;

  for (const mod of MODULES) {
    for (const e of ENVS) {
      const tpl = `tpl-${mod}-${e}`;
      const names = TASK_NAMES[e] ?? [e];
      const [actions] = await conn.query(
        'SELECT a.id, a.script, t.name AS task FROM deploy_pipeline_actions a ' +
          'JOIN deploy_pipeline_tasks t ON t.id = a.task_id JOIN deploy_pipeline_steps s ON s.id = t.step_id ' +
          'WHERE s.pipeline_id = ? AND a.name = ? AND t.name IN (?)',
        [tpl, '投递产物', names],
      );
      if (!actions.length) {
        console.log(`- ${tpl}: 无「投递产物」动作（或分支任务名不匹配 ${names.join('/')}），跳过`);
        skipped++;
        continue;
      }
      for (const a of actions) {
        const hasNew = a.script.includes('COMMIT_SHORT=');
        if (ROLLBACK) {
          if (!hasNew) {
            console.log(`- ${tpl} / ${a.task}: 已是旧写法，跳过`);
            skipped++;
            continue;
          }
          const restored = a.script.replace(
            /COMMIT_SHORT="\$\{COMMIT_ID##\*\/\}"\n(?:#[^\n]*\n)*VER="\$\{DEPLOY_ENV:\?缺少 DEPLOY_ENV\}\/\$\{COMMIT_SHORT\}"/,
            'VER="${COMMIT_ID:?COMMIT_ID 为空，无法确定版本目录}"',
          );
          console.log(`- ${tpl} / ${a.task}: 还原旧写法`);
          changed++;
          if (!DRY_RUN) {
            await conn.query('UPDATE deploy_pipeline_actions SET script=?, updated_by=?, updated_at=NOW() WHERE id=?', [
              restored,
              'p28-rollback',
              a.id,
            ]);
          }
          continue;
        }
        if (hasNew) {
          console.log(`- ${tpl} / ${a.task}: 已是 env-dir 写法，跳过`);
          skipped++;
          continue;
        }
        if (!OLD_LINE_RE.test(a.script)) {
          console.log(`- ${tpl} / ${a.task}: ⚠️ 未匹配到预期旧行，**不改**（人工确认）`);
          skipped++;
          continue;
        }
        const updated = a.script.replace(OLD_LINE_RE, NEW_BLOCK);
        console.log(`- ${tpl} / ${a.task}: 版本目录改为 \${DEPLOY_ENV}/\${纯commit}`);
        changed++;
        if (!DRY_RUN) {
          await conn.query('UPDATE deploy_pipeline_actions SET script=?, updated_by=?, updated_at=NOW() WHERE id=?', [
            updated,
            'p28',
            a.id,
          ]);
        }
      }
    }
  }

  if (!DRY_RUN && !ROLLBACK) {
    console.log('\n变更后的相关行（抽样）：');
    const [rows] = await conn.query(
      'SELECT s.pipeline_id, t.name task, a.script FROM deploy_pipeline_actions a ' +
        'JOIN deploy_pipeline_tasks t ON t.id = a.task_id JOIN deploy_pipeline_steps s ON s.id = t.step_id ' +
        "WHERE a.name='投递产物' AND (t.name IN ('dev','dev-1','prod','prod-1')) AND s.pipeline_id LIKE 'tpl-%-dev' " +
        'ORDER BY s.pipeline_id LIMIT 6',
    );
    for (const r of rows) {
      const line = r.script.split('\n').filter((l) => /VER=|COMMIT_SHORT=/.test(l)).join(' ; ');
      console.log(`  ${r.pipeline_id} / ${r.task}: ${line}`);
    }
  }

  console.log(
    DRY_RUN ? `\nDRY_RUN：将改动 ${changed} 条、跳过 ${skipped} 条（未写库）` : `\n完成：改动 ${changed} 条、跳过 ${skipped} 条`,
  );
  await conn.end();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
