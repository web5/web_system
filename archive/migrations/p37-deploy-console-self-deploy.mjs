#!/usr/bin/env node
/**
 * p37：deploy-console 自部署 —— 把「落地并排程重启（自部署专用）」动作挂回流水线。
 *
 * 背景（为什么 deploy-console 被排除在 p26 的 restart/verify 推广之外）：
 *   deploy-console 是发布平台自己。通用 `restart · 落地并重启（后端，远端）` 会在流水线进程内
 *   **同步**执行 `pm2 restart web-deploy-console` —— 那等于把正在跑流水线的进程杀掉，
 *   后续 version/pointer/verify 与 run 状态回写全部丢失（2026-09-29 实测 ECONNRESET）。
 *
 * 因此它需要的是**脱离会话与流水线进程**的自部署重启：`restart-self-deploy-console.sh`
 * （scripts/pipeline/ 下已存在并 dev 实弹验证过）。该脚本拆两段：
 *   ① 同步段：守卫版本目录 → 备份旧 dist → 落地新 dist（失败直接判发布失败，dist 不换）；
 *   ② 异步段：`setsid nohup` 排程「sleep N 后重启」，自带 online 轮询 + 端口探活 + 失败回滚 dist。
 * 流水线到「重启已排程」即 succeeded，N 秒后服务自动切换，无需再点「服务详情 → 部署」。
 *
 * 现状缺口：`tpl-deploy-console-dev` 的 dev/prod 分支任务只有「发布」（打包→scp 远端版本目录）
 *   +「write-version」，`发布` 脚本末尾仍写着「生效请到服务详情→部署」——即**重启仍靠手工**。
 *   本迁移把自部署重启动作挂回 dev + prod 两个分支任务（sort=11，排在发布/写版本之后）。
 *   local 分支不挂：脚本内部对 DEPLOY_ENV=local 直接跳过（本地无需自部署）。
 *
 * 幂等：按（任务 + 动作名）判定，已存在则更新正文。
 * 回退：`ROLLBACK=1 node archive/migrations/p37-deploy-console-self-deploy.mjs`
 * 预演：`DRY_RUN=1 node archive/migrations/p37-deploy-console-self-deploy.mjs`
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
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

const MODULE_KEY = process.env.MODULE_KEY || 'deploy-console';
const TPL = `tpl-${MODULE_KEY}-dev`;
const SELF_RESTART_NAME = 'restart · 落地并排程重启（自部署专用）';
const SELF_RESTART_SORT = 11; // 排在「发布」(0) 与「write-version」(1) 之后

// 真源只有一个：scripts/pipeline/restart-self-deploy-console.sh（不在迁移里复制第二份，避免双真源）
const scriptPath = path.join(root, 'scripts/pipeline/restart-self-deploy-console.sh');
if (!fs.existsSync(scriptPath)) {
  console.error(`找不到自部署脚本：${scriptPath}`);
  process.exit(1);
}
const SELF_RESTART_SCRIPT = fs.readFileSync(scriptPath, 'utf8');

/** 语法自检：坏脚本一次等于该模块发不上去（与流水线编辑器保存时同口径） */
function assertBashSyntax(script, label) {
  const r = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${label} 语法检查未通过：\n${r.stderr || r.stdout}`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DB,
  });

  console.log(`${ROLLBACK ? '回退' : '应用'} p37（deploy-console 自部署重启）`);
  console.log(`目标：${TPL} 的 dev / prod 分支任务\n`);
  if (!DRY_RUN && !ROLLBACK) {
    console.log(`将变更：+ ${SELF_RESTART_NAME}（sort=${SELF_RESTART_SORT}，正文=${scriptPath}）\n`);
  }

  let changed = 0;
  let skipped = 0;

  // 只挂远程分支（dev / prod）；local 由脚本内部跳过
  const [tasks] = await conn.query(
    'SELECT t.id, t.name, t.condition FROM deploy_pipeline_tasks t ' +
      'JOIN deploy_pipeline_steps s ON s.id = t.step_id ' +
      'WHERE s.pipeline_id = ? AND t.name IN (?, ?) ORDER BY t.sort',
    [TPL, 'dev', 'prod'],
  );
  if (!tasks.length) {
    console.log(`- ${TPL}: 找不到 dev/prod 分支任务，跳过（模板结构变化？）`);
    await conn.end();
    process.exit(1);
  }

  for (const task of tasks) {
    const taskId = task.id;

    if (ROLLBACK) {
      const [del] = await conn.query(
        'DELETE FROM deploy_pipeline_actions WHERE task_id = ? AND name = ?',
        [taskId, SELF_RESTART_NAME],
      );
      console.log(`- ${TPL} / ${task.name}: 删除「${SELF_RESTART_NAME}」${del.affectedRows} 条`);
      changed += del.affectedRows;
      continue;
    }

    const [existing] = await conn.query(
      'SELECT id, name, script, sort FROM deploy_pipeline_actions WHERE task_id = ? ORDER BY sort',
      [taskId],
    );

    const [releaseRow] = await conn.query(
      "SELECT name, sort FROM deploy_pipeline_actions WHERE task_id = ? AND (name = '发布' OR name LIKE '发布%') ORDER BY sort LIMIT 1",
      [taskId],
    );

    assertBashSyntax(SELF_RESTART_SCRIPT, `${TPL}/${task.name}/${SELF_RESTART_NAME}`);
    const cur = existing.find((r) => r.name === SELF_RESTART_NAME);
    if (cur) {
      const drift = Number(cur.sort) !== SELF_RESTART_SORT;
      if (cur.script === SELF_RESTART_SCRIPT && !drift) {
        console.log(`- ${TPL} / ${task.name}: 「${SELF_RESTART_NAME}」已是最新，跳过`);
        skipped++;
        continue;
      }
      console.log(`- ${TPL} / ${task.name}: 更新「${SELF_RESTART_NAME}」${drift ? `（sort ${cur.sort} → ${SELF_RESTART_SORT}）` : '正文'}`);
      changed++;
      if (!DRY_RUN) {
        await conn.query(
          'UPDATE deploy_pipeline_actions SET script = ?, sort = ?, updated_by = ?, updated_at = NOW() WHERE id = ?',
          [SELF_RESTART_SCRIPT, SELF_RESTART_SORT, 'p37', cur.id],
        );
      }
    } else {
      console.log(`- ${TPL} / ${task.name}: 新增「${SELF_RESTART_NAME}」（sort=${SELF_RESTART_SORT}）`);
      changed++;
      if (!DRY_RUN) {
        await conn.query(
          'INSERT INTO deploy_pipeline_actions (id, task_id, name, script, managed, sort, enabled, updated_by, created_at, updated_at) ' +
            'VALUES (?, ?, ?, ?, 0, ?, 1, ?, NOW(), NOW())',
          [crypto.randomUUID(), taskId, SELF_RESTART_NAME, SELF_RESTART_SCRIPT, SELF_RESTART_SORT, 'p37'],
        );
      }
    }

    // 顺序自检：restart 必须排在「发布」之后（先 scp 到版本目录，再落地 + 排程重启）
    if (DRY_RUN) continue;
    const [after] = await conn.query('SELECT name, sort FROM deploy_pipeline_actions WHERE task_id = ? ORDER BY sort', [
      taskId,
    ]);
    const sRestart = Number(after.find((r) => r.name === SELF_RESTART_NAME)?.sort ?? NaN);
    const sRelease = releaseRow.length ? Number(releaseRow[0].sort) : NaN;
    if (sRelease !== undefined && !Number.isNaN(sRelease) && sRestart < sRelease) {
      throw new Error(`${TPL}/${task.name}: 自部署重启排在「发布」之前，拒绝`);
    }
  }

  console.log(
    DRY_RUN
      ? `\nDRY_RUN：将改动 ${changed} 条、跳过 ${skipped} 条（未写库）`
      : `\n完成：改动 ${changed} 条、跳过 ${skipped} 条`,
  );
  await conn.end();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
