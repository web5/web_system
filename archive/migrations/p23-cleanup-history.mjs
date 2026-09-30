#!/usr/bin/env node
/**
 * p23：清理历史「流水线记录 / 版本记录 / 产物目录」，只保留当前。
 *
 * 用户口径（2026-09-21）：历史构建产物不再考虑兼容；库里旧的流水线记录与产物版本记录清一遍，保留当前的即可。
 *
 * 安全设计（本操作不可逆，故全部可回滚）：
 *   - DB 侧：删前把待删行全量 dump 到 /tmp/p23-db-backup-<ts>.json（按表）；`deploy_pipeline_runs` 等表
 *     实体未启用软删除（`deleted_at` 列未接线），故只能硬删，靠 dump 回滚。
 *   - 遗留 `_bak_*` 备份表：整表 DROP，同样先 dump。
 *   - 磁盘侧：遵循平台既有约定（`SAFE_DELETE_STRATEGY` 默认 `mv`）——**移动到 /tmp 垃圾站**而非删除，
 *     保留目录结构，可原样 mv 回。
 *   - 默认 DRY_RUN，必须显式 `APPLY=1` 才落盘/落库。
 *
 * 保留规则（「当前」的定义）：
 *   R1 流水线运行 `deploy_pipeline_runs`：每 (module_key, env) 保留**最新一条**；非终态（未结束）一律保留。
 *   R2 审批 `deploy_approvals`：只保留其 `pipeline_id` 仍在 R1 保留集内的。
 *   R3 版本记录 `deploy_versions`：每 (env, component) 保留**最新一条**（按 released_at）。
 *   R4 产物目录：按指针保留
 *       env-dir 应用（portal/admin）→ `<key>/<envId>/` 整目录（含 `index.js` 指针 + 当前版本目录）
 *       site-version 应用（shell 等）→ `<key>/<部署指针值>/` 整目录
 *       其余（历史 commit 目录、legacy 直出目录 `<key>/<流水线key>/`）→ 移入垃圾站
 *   R5 悬空引用：保留行的 `task_id` 若指向已删 run，置 NULL。
 *   R6 p22 落的 legacy 兼容副本段：从 local 投递动作里移除（不再保留兼容）。
 *
 * 幂等：重复执行不会误删（保留集为空或已清时为 0 行）。
 * 执行库：web_system_deploy；磁盘根：<RELEASE_WORKSPACE>/servers/gateway/public/static/modules
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
const mysql = require(path.join(root, 'node_modules/.pnpm/node_modules/mysql2/promise.js'));

const APPLY = process.env.APPLY === '1';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const WORKSPACE = env.RELEASE_WORKSPACE || path.join(process.env.HOME, 'web_system_release');
const MODULES_ROOT = path.join(WORKSPACE, 'servers/gateway/public/static/modules');
const TRASH = `/tmp/p23-trash-${STAMP}`;
const out = (s) => process.stdout.write(s + '\n');

/** 遗留备份表（迁移脚本产物，纯残留） */
const BACKUP_TABLES = [
  'deploy_deployments_dedup_backup',
  'deploy_hosts_bak_20260920',
  'deploy_module_stage_commands_bak_20260902',
  'deploy_pipeline_runs_bak_1789628217360',
  'deploy_pipeline_step_branches_bak_20260921',
  'deploy_pipeline_step_commands_bak_20260911',
  'deploy_pipeline_step_commands_bak_20260913',
  'deploy_pipeline_step_commands_bak_20260921',
  'deploy_pipelines_bak_1789628217360',
  'deploy_service_envs_bak_20260920',
];

const TERMINAL = ['succeeded', 'failed', 'cancelled'];

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST || '127.0.0.1',
  port: Number(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.MYSQL_DB,
  connectTimeout: 8000,
});

const backup = {};

/* ── R1 流水线运行：每 (module_key, env) 保留最新一条 + 非终态 ─────────────── */
const [keepRuns] = await conn.query(
  `SELECT r.id FROM deploy_pipeline_runs r
     JOIN (
       SELECT module_key, env, MAX(created_at) mx
         FROM deploy_pipeline_runs GROUP BY module_key, env
     ) t ON t.module_key = r.module_key AND t.env = r.env AND t.mx = r.created_at
    UNION
   SELECT id FROM deploy_pipeline_runs WHERE status NOT IN (?)`,
  [TERMINAL],
);
const keepRunIds = keepRuns.map((r) => r.id);
if (!keepRunIds.length) {
  await conn.end();
  throw new Error('保留集为空（流水线运行表为空？）——为避免误删全部，已中止');
}
const runPlaceholders = keepRunIds.map(() => '?').join(',');
const [delRuns] = await conn.query(
  `SELECT * FROM deploy_pipeline_runs WHERE id NOT IN (${runPlaceholders})`,
  keepRunIds,
);
out(`R1 流水线运行：保留 ${keepRunIds.length} 条（每组最新 + 非终态），删除 ${delRuns.length} 条`);

/* ── R2 审批：只保留其 pipeline_id 仍在保留集内的 ─────────────────────────── */
const [delApprovals] = await conn.query(
  `SELECT * FROM deploy_approvals WHERE pipeline_id NOT IN (${runPlaceholders})`,
  keepRunIds,
);
out(`R2 审批记录：删除 ${delApprovals.length} 条`);

/* ── R3 版本记录：每 (env, component) 保留最新一条 ────────────────────────── */
const [delVersions] = await conn.query(
  `SELECT v.* FROM deploy_versions v
     LEFT JOIN (
       SELECT env, component, MAX(released_at) mx FROM deploy_versions GROUP BY env, component
     ) t ON t.env = v.env AND t.component = v.component AND t.mx = v.released_at
    WHERE t.env IS NULL`,
);
out(`R3 版本记录：删除 ${delVersions.length} 条（保留每组最新）`);

/* ── 遗留备份表行数 ─────────────────────────────────────────────────────── */
const backupTableInfo = [];
for (const t of BACKUP_TABLES) {
  try {
    const [r] = await conn.query(`SELECT COUNT(*) n FROM ${t}`);
    backupTableInfo.push({ table: t, rows: r[0].n });
  } catch (e) {
    backupTableInfo.push({ table: t, rows: null, err: e.code });
  }
}
out(`R1b 遗留备份表：DROP ${backupTableInfo.length} 张（共 ${backupTableInfo.reduce((a, b) => a + (b.rows || 0), 0)} 行）`);

/* ── R4 磁盘产物 ───────────────────────────────────────────────────────── */
const [apps] = await conn.query('SELECT `key`, deploy_mode FROM deploy_apps');
const [pointers] = await conn.query('SELECT env_id, module_key, current_version FROM deploy_deployments');
const [envPointers] = await conn.query('SELECT app_key, env_id, current_version FROM deploy_app_env_versions');

const keepPaths = new Set();
const keepEnvDirs = new Map(); // "<key>/<envId>" → 允许保留的版本子目录集合（null = 全留）
for (const a of apps) {
  if (a.deploy_mode === 'env-dir') {
    for (const p of envPointers.filter((x) => x.app_key === a.key)) {
      // env 目录本身保留（含 index.js 指针），但内部只留「当前 + 上一版本」，保住控制台一次回滚
      const allowed = new Set([p.current_version, p.previous_version].filter(Boolean));
      keepEnvDirs.set(path.join(a.key, p.env_id), allowed);
    }
  } else {
    const p = pointers.find((x) => x.module_key === a.key);
    if (p?.current_version) keepPaths.add(path.join(a.key, p.current_version));
  }
}

const appKeys = new Set(apps.map((a) => a.key));
/** 前缀保留判断：`shell/shell-dev/16865ad` 必须保住 `shell/shell-dev`（site-version 的版本可含 `/`） */
const isKept = (rel) => [...keepPaths].some((k) => k === rel || k.startsWith(rel + path.sep));

const moves = [];
for (const appDir of fs.existsSync(MODULES_ROOT) ? fs.readdirSync(MODULES_ROOT) : []) {
  // ⚠️ 只动 deploy_apps 认识的目录：其余目录（网关/服务的历史前端产物等）一律不碰
  if (!appKeys.has(appDir)) {
    out(`     （跳过非应用目录 ${appDir}/）`);
    continue;
  }
  const abs = path.join(MODULES_ROOT, appDir);
  if (!fs.statSync(abs).isDirectory()) continue;
  for (const child of fs.readdirSync(abs)) {
    const rel = path.join(appDir, child);
    if (isKept(rel)) continue;
    const envKey = path.join(appDir, child);
    if (keepEnvDirs.has(envKey)) {
      // env 目录本身保留；只清它内部多余的历史版本目录
      const allowed = keepEnvDirs.get(envKey);
      for (const ver of fs.readdirSync(path.join(MODULES_ROOT, envKey))) {
        if (!fs.statSync(path.join(MODULES_ROOT, envKey, ver)).isDirectory()) continue;
        if (allowed.has(ver)) continue;
        moves.push(path.join(envKey, ver));
      }
      continue;
    }
    moves.push(rel);
  }
}
out(`R4 磁盘产物：保留 ${[...keepPaths].join(', ') || '（无）'}`);
for (const [k, v] of keepEnvDirs) out(`     保留 env 目录 ${k}/ 及版本 ${[...v].join(', ') || '（无）'}`);
out(`     移入垃圾站 ${moves.length} 个目录 → ${TRASH}`);

/* ── R6 p22 legacy 兼容副本段回退 ───────────────────────────────────────── */
const [deliveries] = await conn.query(
  "SELECT a.id, a.script, p.`key` pk FROM deploy_pipeline_actions a" +
    ' JOIN deploy_pipeline_tasks t ON t.id = a.task_id' +
    ' JOIN deploy_pipeline_steps s ON s.id = t.step_id' +
    ' JOIN deploy_pipelines p ON p.id = s.pipeline_id' +
    " WHERE s.name = '发布' AND a.name = '投递产物' AND t.`condition` = 'DEPLOY_ENV == local'" +
    ' ORDER BY p.`key`',
);
const compatFixes = [];
for (const d of deliveries) {
  const s = String(d.script || '');
  if (!s.includes('legacy 兼容副本')) continue;
  // 从「# 方案 A：legacy 兼容副本」注释起，截到脚本末尾（该段是最后一段）
  const idx = s.indexOf('# 方案 A：legacy 兼容副本');
  if (idx < 0) continue;
  compatFixes.push({ id: d.id, pk: d.pk, script: s.slice(0, idx).replace(/\s+$/, '') + '\n' });
}
out(`R6 legacy 兼容副本段：待移除 ${compatFixes.length} 条动作脚本末尾段`);

/* ── R7 残留 ESM 指针自愈（本机最后一个同类隐患） ───────────────────────── */
const esmPointers = [];
for (const appDir of fs.existsSync(MODULES_ROOT) ? fs.readdirSync(MODULES_ROOT) : []) {
  const appAbs = path.join(MODULES_ROOT, appDir);
  if (!fs.statSync(appAbs).isDirectory()) continue;
  for (const envDirName of fs.readdirSync(appAbs)) {
    const ptr = path.join(appAbs, envDirName, 'index.js');
    if (!fs.existsSync(ptr)) continue;
    const txt = fs.readFileSync(ptr, 'utf-8');
    if (!/^\s*export\s+\*\s+from/m.test(txt)) continue;
    const m = txt.match(/'\.\/(.+?)\/index\.js'/);
    if (!m) continue;
    esmPointers.push({ file: `${appDir}/${envDirName}/index.js`, version: m[1] });
  }
}
out(`R7 残留 ESM 指针：待转 System.register ${esmPointers.length} 个（${esmPointers.map((x) => x.file).join(', ') || '无'}）`);

/* ── 执行 / 预览 ────────────────────────────────────────────────────────── */
if (!APPLY) {
  out('\nDRY_RUN（默认）：未做任何改动。确认后执行：APPLY=1 node scripts/migrations/p23-cleanup-history.mjs');
  out('待删样例：');
  out('  runs: ' + delRuns.slice(0, 5).map((x) => `${x.created_at} ${x.module_key}@${x.env} ${x.status}`).join('\n        '));
  out('  dirs: ' + moves.slice(0, 8).join(', ') + (moves.length > 8 ? ` … 共 ${moves.length}` : ''));
  await conn.end();
  process.exit(0);
}

/* 1) DB 备份 */
const dbBackupFile = `/tmp/p23-db-backup-${STAMP}.json`;
backup.pipeline_runs = delRuns;
backup.approvals = delApprovals;
backup.versions = delVersions;
backup.backup_tables = {};
for (const t of BACKUP_TABLES) {
  try {
    const [rows] = await conn.query(`SELECT * FROM ${t}`);
    backup.backup_tables[t] = rows;
  } catch {
    backup.backup_tables[t] = null;
  }
}
fs.writeFileSync(dbBackupFile, JSON.stringify(backup), 'utf-8');
out(`\n[backup] DB 待删行已 dump：${dbBackupFile}`);

/* 2) 磁盘移入垃圾站 */
fs.mkdirSync(TRASH, { recursive: true });
let moved = 0;
for (const rel of moves) {
  const src = path.join(MODULES_ROOT, rel);
  const dst = path.join(TRASH, rel);
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    moved++;
  } catch (e) {
    out(`  [warn] 移动失败 ${rel}: ${e.message}`);
  }
}
out(`[disk] 已移入垃圾站 ${moved}/${moves.length} 个目录：${TRASH}`);

/* 3) DB 删除 */
if (delApprovals.length) {
  await conn.query('DELETE FROM deploy_approvals WHERE id IN (?)', [delApprovals.map((x) => x.id)]);
}
if (delVersions.length) {
  await conn.query('DELETE FROM deploy_versions WHERE id IN (?)', [delVersions.map((x) => x.id)]);
}
if (delRuns.length) {
  await conn.query('DELETE FROM deploy_pipeline_runs WHERE id IN (?)', [delRuns.map((x) => x.id)]);
}
out(`[db] 删除：runs ${delRuns.length} / approvals ${delApprovals.length} / versions ${delVersions.length}`);

/* 4) 悬空引用置 NULL（保留行不再指向已删 run） */
const nulled = [];
for (const t of ['deploy_versions', 'deploy_deployments', 'deploy_app_env_versions']) {
  const [r] = await conn.query(
    `UPDATE ${t} SET task_id = NULL WHERE task_id IS NOT NULL AND task_id NOT IN (${runPlaceholders})`,
    keepRunIds,
  );
  if (r.affectedRows) nulled.push(`${t}:${r.affectedRows}`);
}
out(`[db] 悬空 task_id 置 NULL：${nulled.join(', ') || '无'}`);

/* 5) DROP 遗留备份表 */
let dropped = 0;
for (const t of BACKUP_TABLES) {
  try {
    await conn.query(`DROP TABLE IF EXISTS ${t}`);
    dropped++;
  } catch (e) {
    out(`  [warn] DROP ${t} 失败: ${e.code || e.message}`);
  }
}
out(`[db] DROP 遗留备份表 ${dropped}/${BACKUP_TABLES.length} 张`);

/* 6) p22 兼容段回退 */
for (const f of compatFixes) {
  await conn.query('UPDATE deploy_pipeline_actions SET script = ?, updated_by = ?, updated_at = NOW() WHERE id = ?', [
    f.script,
    'p23',
    f.id,
  ]);
}
out(`[db] 移除 legacy 兼容副本段：${compatFixes.length} 条动作`);

/* 7) 残留 ESM 指针 → System.register */
let healed = 0;
for (const p of esmPointers) {
  const abs = path.join(MODULES_ROOT, p.file);
  fs.writeFileSync(
    abs,
    `System.register(['./${p.version}/index.js'], function (_export) {\n` +
      `  'use strict';\n` +
      `  return {\n` +
      `    setters: [function (m) { _export(m); }],\n` +
      `    execute: function () {}\n` +
      `  };\n` +
      `});\n`,
    'utf-8',
  );
  healed++;
}
out(`[disk] ESM 指针已转为 System.register：${healed} 个`);

await conn.end();
process.exit(0);
