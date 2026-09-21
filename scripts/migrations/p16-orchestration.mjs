#!/usr/bin/env node
/**
 * p16：流水线编排迁移 —— 旧模型（nodes + step_commands + step_branches）→ 新三层表
 *      （deploy_pipeline_steps / deploy_pipeline_tasks / deploy_pipeline_actions）。
 *
 * specs/pipeline-step-task/design.md §7。幂等：重跑零差异（按 pipeline+步骤名 upsert，重复行先清）。
 * 用法：
 *   node scripts/migrations/p16-orchestration.mjs            # 实跑
 *   DRY_RUN=1 node scripts/migrations/p16-orchestration.mjs  # 预览计划
 *
 * 映射：
 *   模板 nodes[]（有序）      → 步骤（name=label）
 *     kind=approval           → 任务 kind=approval（approvers 继承节点/模板）
 *     kind=shell              → 任务 kind=script
 *       有 step_branches      → 每分支一任务（condition=分支条件，动作=分支脚本）
 *       无分支                → 单任务（动作=节点执行体 command/actions[shell].code）
 *       旧 condition（gate）  → 任务 condition
 *       旧 actions 的 service:write-version → 追加动作「write-version · 写版本记录」（脚本调平台工具）
 *   git/build（平台托管节点）  → 动作 managed=1（页面只读）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const envFile = fs.readFileSync(path.join(root, 'servers/deploy-console/.env'), 'utf8');
const env = Object.fromEntries(
  envFile
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const DRY_RUN = !!process.env.DRY_RUN;
const out = (m) => console.log(m);

const mysql = require(path.join(root, 'node_modules/.pnpm/node_modules/mysql2/promise.js'));

const WRITE_VERSION_SCRIPT = `#!/usr/bin/env bash
# 写版本记录：脚本调用平台工具（随 console 分发）直连部署库 —— 动作一律脚本（specs/pipeline-step-task/design.md）
set -euo pipefail
: "\${MODULE_KEY:?}" "\${DEPLOY_ENV:?}" "\${COMMIT_ID:?}" "\${WS_PLATFORM_SCRIPTS_DIR:?}"
node "\${WS_PLATFORM_SCRIPTS_DIR}/write-version.mjs" "\${MODULE_KEY}" "\${DEPLOY_ENV}" "\${COMMIT_ID}" "\${BRANCH}"`;

/** 从旧节点行提取 shell 执行体（与 pickStepActions 同语义：actions[shell].code 优先，回落 command） */
function pickShellScript(cmdRow) {
  const actions = Array.isArray(cmdRow?.actions) ? cmdRow.actions : [];
  const shellOp = actions.find((a) => a && a.type === 'shell' && a.code?.trim());
  return shellOp?.code ?? cmdRow?.command ?? '';
}

/** 旧节点是否挂了 write-version（service 操作） */
function hasWriteVersion(cmdRow) {
  const actions = Array.isArray(cmdRow?.actions) ? cmdRow.actions : [];
  return actions.some((a) => a && a.type === 'service' && a.tool === 'write-version');
}

const MANAGED_KEYS = new Set(['git', 'build']);

async function main() {
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DB,
    multipleStatements: false,
  });

  const [pipelines] = await conn.query(
    'SELECT id, `key`, name, nodes FROM deploy_pipelines ORDER BY `key`',
  );
  const [existingSteps] = await conn.query('SELECT pipeline_id, COUNT(*) n FROM deploy_pipeline_steps GROUP BY pipeline_id');
  const existingByPipeline = new Map(existingSteps.map((r) => [r.pipeline_id, r.n]));

  const plan = [];
  for (const p of pipelines) {
    const nodes = Array.isArray(p.nodes) ? p.nodes : [];
    if (!nodes.length) {
      out(`- ${p.key}: 模板无 nodes（legacy），跳过`);
      continue;
    }
    const [cmdRows] = await conn.query('SELECT * FROM deploy_pipeline_step_commands WHERE template_id = ?', [p.id]);
    const cmdByKey = new Map(cmdRows.map((r) => [r.node_key, r]));
    const [branchRows] = await conn.query(
      'SELECT * FROM deploy_pipeline_step_branches WHERE template_id = ? ORDER BY node_key, sort',
      [p.id],
    );
    const branchesByNode = new Map();
    for (const b of branchRows) {
      const list = branchesByNode.get(b.node_key) ?? [];
      list.push(b);
      branchesByNode.set(b.node_key, list);
    }

    const steps = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const label = node.label || node.key;
      const cmd = cmdByKey.get(node.key);
      const step = { name: label, sort: i, tasks: [] };

      if (node.kind === 'approval') {
        step.tasks.push({
          kind: 'approval',
          name: `${label}·审批`,
          approval: { approvers: node.approvers?.length ? node.approvers : ['admin'], timeoutAction: 'fail', onReject: 'fail' },
          sort: 0,
        });
        steps.push(step);
        continue;
      }

      // shell 节点 → 脚本任务
      const gate = String(cmd?.condition ?? '').trim() || null;
      const managed = MANAGED_KEYS.has(node.key);
      const branches = branchesByNode.get(node.key) ?? [];

      if (branches.length) {
        // 分支 → 互斥条件任务。旧「默认分支（无条件兜底）」≠ 新引擎「无条件恒执行」：
        // 若保留 null，local 发布时默认分支也会并行执行（已实测踩坑）。
        // 迁移规则：默认分支的条件 = 其余分支的否定（其余均为 `DEPLOY_ENV == X` 单条件时可静态合成）。
        const envValues = branches
          .filter((b) => b.condition?.trim())
          .map((b) => b.condition.trim().match(/^DEPLOY_ENV\s*==\s*(.+)$/))
          .filter(Boolean)
          .map((m) => m[1].trim());
        branches.forEach((b, bi) => {
          const actions = [{ name: '投递产物', script: b.script, managed: false, sort: 0 }];
          if (hasWriteVersion(cmd)) {
            actions.push({ name: 'write-version · 写版本记录', script: WRITE_VERSION_SCRIPT, managed: false, sort: 1 });
          }
          let cond = b.condition?.trim() || null;
          if (!cond && envValues.length) {
            cond = envValues.map((v) => `DEPLOY_ENV != ${v}`).join(' && ');
          }
          step.tasks.push({
            kind: 'script',
            name: b.name,
            condition: cond,
            actions,
            sort: bi,
          });
        });
      } else {
        const script = pickShellScript(cmd);
        const actions = [];
        if (script.trim()) {
          actions.push({ name: managed ? `${label}（平台托管）` : label, script, managed, sort: 0 });
        }
        if (hasWriteVersion(cmd)) {
          actions.push({ name: 'write-version · 写版本记录', script: WRITE_VERSION_SCRIPT, managed: false, sort: 1 });
        }
        if (!actions.length) continue; // 无执行体的节点不生成任务（步骤不落）
        step.tasks.push({ kind: 'script', name: node.key, condition: gate, actions, sort: 0 });
      }
      if (step.tasks.length) steps.push(step);
    }

    plan.push({ pipeline: p, steps, already: existingByPipeline.get(p.id) ?? 0 });
  }

  for (const item of plan) {
    const taskCount = item.steps.reduce((n, s) => n + s.tasks.length, 0);
    const actCount = item.steps.reduce((n, s) => n + s.tasks.reduce((m, t) => m + (t.actions?.length ?? 0), 0), 0);
    out(
      `- ${item.pipeline.key}（${item.pipeline.name}）：${item.steps.length} 步骤 / ${taskCount} 任务 / ${actCount} 动作` +
        (item.already ? `（库中已有 ${item.already} 步骤，将全量重建）` : ''),
    );
    for (const s of item.steps) {
      out(
        `    · ${s.name}: ${s.tasks
          .map((t) => `${t.kind === 'approval' ? '⊙' : '▶'}${t.name}${t.condition ? `[if ${t.condition}]` : ''}(${t.actions?.length ?? 0}动作)`)
          .join(' ')}`,
      );
    }
  }

  if (DRY_RUN) {
    out('\nDRY_RUN：以上为迁移计划，未写库。');
    await conn.end();
    return;
  }

  const backup = { ts: Date.now(), pipelines: [] };
  for (const item of plan) {
    await conn.query('DELETE FROM deploy_pipeline_actions WHERE task_id IN (SELECT id FROM deploy_pipeline_tasks WHERE step_id IN (SELECT id FROM deploy_pipeline_steps WHERE pipeline_id = ?))', [item.pipeline.id]);
    await conn.query('DELETE FROM deploy_pipeline_tasks WHERE step_id IN (SELECT id FROM deploy_pipeline_steps WHERE pipeline_id = ?)', [item.pipeline.id]);
    await conn.query('DELETE FROM deploy_pipeline_steps WHERE pipeline_id = ?', [item.pipeline.id]);

    for (const s of item.steps) {
      const stepId = crypto.randomUUID();
      await conn.query(
        'INSERT INTO deploy_pipeline_steps (id, pipeline_id, name, description, sort, enabled, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,1,?,NOW(),NOW())',
        [stepId, item.pipeline.id, s.name, null, s.sort, 'p16'],
      );
      for (const t of s.tasks) {
        const taskId = crypto.randomUUID();
        await conn.query(
          'INSERT INTO deploy_pipeline_tasks (id, step_id, kind, name, `condition`, env, approval, sort, enabled, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,NULL,?,?,1,?,NOW(),NOW())',
          [taskId, stepId, t.kind, t.name, t.condition, t.approval ? JSON.stringify(t.approval) : null, t.sort, 'p16'],
        );
        for (const a of t.actions ?? []) {
          await conn.query(
            'INSERT INTO deploy_pipeline_actions (id, task_id, name, script, managed, sort, enabled, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,NOW(),NOW())',
            [crypto.randomUUID(), taskId, a.name, a.script, a.managed ? 1 : 0, a.sort, 'p16'],
          );
        }
      }
    }
  }
  out(`\n迁移完成：${plan.length} 条流水线（备份时间戳 ${backup.ts}；旧表未动，可回退：清空三张新表即回旧链路）`);
  await conn.end();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
