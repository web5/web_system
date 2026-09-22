#!/usr/bin/env node
/**
 * p22：env-dir 应用（micro-frontend）的「构建 base / 落盘目录 / 入口指针」对齐（方案 A）。
 *
 * 背景与约束推导：`specs/app-artifact-env-dir/design.md`
 *
 * 现状（p20 之后的约定）：构建 `RELEASE_TAG="${COMMIT_ID}"`，其中
 *   COMMIT_ID = `<流水线key>/<纯commit>`（例：`portal-dev/16865ad`）
 *   → 产物 base 与落盘目录都是 `modules/<PUBLIC_PATH>/<流水线key>/<纯commit>/`，
 *     与「legacy 直出路径」逐段一致（网关按指针值 /static/modules/<key>/<版本>/index.js 直出）。
 *
 * 但 env-dir 应用的 manifest 走 `byEnv` → `/static/modules/<key>/<envId>/index.js`（指针），
 * 版本目录只会在 `<key>/<envId>/` 下找 —— 于是「产品线段 ≠ envId」时该路径**结构性无法满足**。
 *
 * 本次变更（**仅 env-dir 应用** = deploy_apps.deploy_mode='env-dir'）：
 *   ① 构建动作：local 用 `RELEASE_TAG=<DEPLOY_ENV>/<纯commit>`；
 *      dev/prod 保持历史 `<流水线key>/<纯commit>`（**不动**，避免牵连远程线）。
 *   ② 发布·local 任务的「投递产物」：
 *      - 落盘目录 → `modules/<PUBLIC_PATH>/<DEPLOY_ENV>/<纯commit>/`（= 产物 base，自洽）
 *      - 改写 env 入口指针 `modules/<PUBLIC_PATH>/<DEPLOY_ENV>/index.js`（System.register，no-cache）
 *      - **legacy 兼容副本**：同时落一份到 `modules/<PUBLIC_PATH>/<COMMIT_ID>/`，
 *        使「未匹配站点」（localhost/IP 直连，manifest 回落旧 modules 字段）不 404。
 *        P4 退役 legacy 读取源时删除该段。
 *
 * 幂等：脚本已含 `方案 A` 标记则跳过。DRY_RUN=1 只预览。
 * 校验：写库前对产物脚本跑 `bash -n`，语法不过即中止。
 * 回退：旧脚本全文备份到 /tmp/p22-backup-<ts>.json（含 action id，可原样 UPDATE 还原）。
 * 执行库：web_system_deploy
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

const DRY_RUN = !!process.env.DRY_RUN;
const MARK = '方案 A';
const out = (s) => process.stdout.write(s + '\n');

/* ── ① 构建动作：RELEASE_TAG 按环境取值（只替换那一行，保留原有注释） ──────────── */
const OLD_TAG_LINE = 'RELEASE_TAG="${COMMIT_ID:-latest}" MF_FORMAT=system';
const NEW_TAG_BLOCK = [
  `# ${MARK}（env-dir 约定）：local 的产品线段 = envId，使产物 base 与落盘目录`,
  '#   /static/modules/<key>/<envId>/<commit>/ 逐段一致；dev/prod 保持 <流水线key>/<commit> 不变。',
  'if [ "${DEPLOY_ENV:-}" = "local" ]; then TAG_ENV="${DEPLOY_ENV}/${COMMIT_ID##*/}"; else TAG_ENV="${COMMIT_ID:-latest}"; fi',
  'echo "[hook:build] RELEASE_TAG=$TAG_ENV"',
  'RELEASE_TAG="$TAG_ENV" MF_FORMAT=system',
].join('\n');

/* ── ② 发布·local 投递动作：落 env-dir 目录 + 写指针 + legacy 兼容副本 ────────── */
/** 整行匹配（含行尾历史注释，如 `# 例：portal-dev/65c00a9`） */
const OLD_VER_LINE_RE = /^VER="\$\{COMMIT_ID:\?[^\n]*$/m;
const NEW_VER_BLOCK = [
  'COMMIT_SHORT="${COMMIT_ID##*/}"',
  `# ${MARK}：落盘目录 = /static/modules/<key>/<envId>/<commit>/（与产物 base 一致）`,
  'VER="${DEPLOY_ENV:?缺少 DEPLOY_ENV}/${COMMIT_SHORT}"',
].join('\n');

/** 头部注释订正（旧注释描述的是 legacy 直出约定，已不适用） */
const HEADER_OLD = [
  '# 关键约定：落盘路径必须 == 版本指针值 —— 网关按 /static/modules/<key>/<currentVersion>/index.js 直出，',
  '#          COMMIT_ID 形如 <流水线key>/<commit>，展开为两级目录，正好与指针值逐段一致。',
].join('\n');
const HEADER_NEW = [
  '# env-dir 约定（方案 A）：落盘目录 == 产物 base == /static/modules/<key>/<envId>/<纯commit>/，',
  '#   入口指针 <key>/<envId>/index.js → ./<纯commit>/index.js（切换版本只改指针、不重建）。',
  '#   COMMIT_ID 形如 <流水线key>/<commit>，本脚本只取纯 commit 段；legacy 直出路径另存兼容副本（文末）。',
].join('\n');

/** 追加在 `cp -R "$SRC"/. "$DST"/` 之后 */
const APPEND_BLOCK = [
  '',
  `# ${MARK}：env 入口指针（no-cache）—— 切换版本只改此文件。`,
  '# 必须 System.register：产物是 MF_FORMAT=system，原生 ESM 会在 SystemJS 解析阶段报错。',
  'ENVDIR="${RELEASE_DIR}/servers/gateway/public/static/modules/${PUBLIC_PATH}/${DEPLOY_ENV}"',
  'mkdir -p "$ENVDIR"',
  'cat > "$ENVDIR/index.js" <<PTR',
  "System.register(['./${COMMIT_SHORT}/index.js'], function (_export) {",
  "  'use strict';",
  '  return {',
  '    setters: [function (m) { _export(m); }],',
  '    execute: function () {}',
  '  };',
  '});',
  'PTR',
  'if [ -f "$DST/index.css" ]; then',
  '  printf "@import url(\'./%s/index.css\');\\n" "$COMMIT_SHORT" > "$ENVDIR/index.css"',
  'fi',
  'echo "[release] env 指针已切到 ${DEPLOY_ENV}/${COMMIT_SHORT}"',
  '',
  `# ${MARK}：legacy 兼容副本（未匹配站点时 manifest 回落旧 modules 字段 → <流水线key>/<纯commit>）`,
  '# 产物 base 仍指 <envId>/<纯commit>：自身分包为相对引用、public 资源为绝对引用，均可解析。',
  'LEGACY_DST="${RELEASE_DIR}/servers/gateway/public/static/modules/${PUBLIC_PATH}/${COMMIT_ID}"',
  'if [ "$LEGACY_DST" != "$DST" ]; then',
  '  mkdir -p "$LEGACY_DST"',
  '  cp -R "$SRC"/. "$LEGACY_DST"/',
  '  echo "[release] legacy 兼容副本: $LEGACY_DST"',
  'fi',
].join('\n');

const COPY_LINE = 'cp -R "$SRC"/. "$DST"/';

/** 语法校验：不通过则不写库 */
function assertBashOk(script, label) {
  const tmp = path.join('/tmp', `p22-syntax-${Date.now()}.sh`);
  fs.writeFileSync(tmp, script, 'utf-8');
  try {
    execFileSync('bash', ['-n', tmp], { stdio: 'pipe' });
  } catch (e) {
    throw new Error(`[${label}] bash -n 校验失败：${String(e.stderr || e.message).slice(0, 400)}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function main() {
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DB,
  });

  const [apps] = await conn.query(
    "SELECT `key` FROM deploy_apps WHERE deploy_mode = 'env-dir' AND deleted_at IS NULL",
  );
  if (!apps.length) {
    out('没有 env-dir 应用，退出');
    await conn.end();
    return;
  }
  const keys = apps.map((a) => a.key);

  // 一次取回目标动作（构建 + 发布·local 投递）
  const [rows] = await conn.query(
    'SELECT p.`key` pk, s.name step_name, t.name task_name, t.`condition` task_cond,' +
      ' a.id action_id, a.name action_name, a.script' +
      ' FROM deploy_pipelines p' +
      ' JOIN deploy_pipeline_steps s ON s.pipeline_id = p.id' +
      ' JOIN deploy_pipeline_tasks t ON t.step_id = s.id' +
      ' JOIN deploy_pipeline_actions a ON a.task_id = t.id' +
      " WHERE p.module_key IN (?) AND (a.name LIKE '构建%' OR (s.name = '发布' AND a.name = '投递产物'))" +
      ' ORDER BY p.`key`, s.sort, t.sort',
    [keys],
  );

  const backup = [];
  const updates = [];

  for (const r of rows) {
    const isBuild = String(r.action_name).startsWith('构建');
    // ⚠️ 必须是「等于 local」：dev 任务的 cond 是 `DEPLOY_ENV != local`，用 includes('local') 会误伤
    const isLocalDeliver = /^DEPLOY_ENV\s*==\s*local$/.test(String(r.task_cond || '').trim());
    if (!isBuild && !isLocalDeliver) {
      if (!isBuild) out(`- ${r.pk} / ${r.task_name}: 非 local 任务（cond=${r.task_cond}），不动`);
      continue;
    }

    const script = String(r.script || '');
    if (script.includes(MARK)) {
      out(`- ${r.pk} / ${r.action_name}: 已是方案 A，跳过`);
      continue;
    }

    let next = script;
    let label = '';
    if (isBuild) {
      label = `${r.pk} / 构建`;
      if (!script.includes(OLD_TAG_LINE)) {
        out(`- ${label}: 未命中 RELEASE_TAG 行，跳过（需人工确认）`);
        continue;
      }
      next = script.replace(OLD_TAG_LINE, NEW_TAG_BLOCK);
    } else {
      label = `${r.pk} / 发布·local·投递产物`;
      if (!OLD_VER_LINE_RE.test(script) || !script.includes(COPY_LINE)) {
        out(`- ${label}: 脚本结构与预期不符，跳过（需人工确认）`);
        continue;
      }
      next = script
        .replace(OLD_VER_LINE_RE, NEW_VER_BLOCK)
        .replace(COPY_LINE, `${COPY_LINE}\n${APPEND_BLOCK}`)
        .replace(HEADER_OLD, HEADER_NEW);
    }

    assertBashOk(next, label);
    backup.push({ actionId: r.action_id, pipelineKey: r.pk, actionName: r.action_name, script });
    updates.push({ actionId: r.action_id, label, script: next });
    out(`- ${label}: 待更新（bash -n 通过）`);
  }

  if (!updates.length) {
    out('\n没有需要变更的动作。');
    await conn.end();
    return;
  }

  if (DRY_RUN) {
    out(`\nDRY_RUN：将更新 ${updates.length} 条动作，未写库。`);
    for (const u of updates) {
      out(`\n────── 预览：${u.label} ──────\n${u.script}`);
    }
    await conn.end();
    return;
  }

  const backupFile = `/tmp/p22-backup-${Date.now()}.json`;
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf-8');
  for (const u of updates) {
    await conn.query(
      'UPDATE deploy_pipeline_actions SET script = ?, updated_by = ?, updated_at = NOW() WHERE id = ?',
      [u.script, 'p22', u.actionId],
    );
  }
  out(`\n已更新 ${updates.length} 条动作。回退备份：${backupFile}`);
  await conn.end();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
