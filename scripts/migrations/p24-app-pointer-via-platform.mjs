#!/usr/bin/env node
/**
 * p24：env-dir 应用的「激活」改走平台接口（指针格式收敛到平台一处实现）。
 *
 * 设计：`specs/app-artifact-env-dir/design.md` §4.1
 *
 * 动机：p22 让流水线脚本用 heredoc 自己拼 `System.register` 指针文本，而平台里
 * 已有 `apps/entry-pointer.ts#writeEnvEntryPointer`（带单测）。两处实现必然漂移 ——
 * 事实上第一次就是平台侧写法错了（原生 ESM）才导致门户加载失败。
 *
 * 本次变更（**仅 env-dir 应用的 local 投递动作**）：
 *   - 删除脚本里「cat > index.js <<PTR …」自拼指针段（含 css 指针与提示 echo）；
 *   - 改为投递完成后调 `POST $CONSOLE_API/internal/release/pointer`
 *     （`x-internal-key` 鉴权），由平台完成：
 *       ① 校验 `<key>/<envId>/<纯commit>/index.js` 存在（不存在 fail-fast，指针不前进）
 *       ② `writeEnvEntryPointer` 写磁盘入口指针（唯一格式实现）
 *       ③ upsert `deploy_app_env_versions`（current=纯commit，previous=旧值）
 *   - 产物落盘（`cp -R`）仍由脚本负责，路径不变。
 *
 * 幂等：脚本已含 `internal/release/pointer` 则跳过。DRY_RUN=1 只预览。
 * 校验：写库前 `bash -n`。回退：旧脚本 dump 到 /tmp/p24-backup-<ts>.json。
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
const out = (s) => process.stdout.write(s + '\n');

/** 自拼指针段的起点（p22 写入的标记注释） */
const CUT_MARK = '# 方案 A：env 入口指针';
/** 已迁移标记 */
const DONE_MARK = 'internal/release/pointer';

const ACTIVATE_BLOCK = [
  '',
  '# 激活：写入口指针 + 应用环境版本表 —— 走平台接口，指针格式只在平台实现一处',
  "# （apps/entry-pointer.ts#writeEnvEntryPointer；脚本不再自拼 System.register 文本）",
  ': "${CONSOLE_API:?缺少 CONSOLE_API（平台未注入，检查 resolveStageVars）}"',
  ': "${CONSOLE_TOKEN:?缺少 CONSOLE_TOKEN（平台未注入）}"',
  'echo "[release] 激活 env 指针：${MODULE_KEY}@${DEPLOY_ENV} → ${COMMIT_SHORT}"',
  'curl -sf -X POST "${CONSOLE_API}/internal/release/pointer" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "x-internal-key: ${CONSOLE_TOKEN}" \\',
  '  -d "{\\"moduleKey\\":\\"${MODULE_KEY}\\",\\"env\\":\\"${DEPLOY_ENV}\\",\\"versionTag\\":\\"${COMMIT_SHORT}\\",\\"operator\\":\\"pipeline-script\\"}" \\',
  '  >/dev/null \\',
  '  || { echo "[release] 激活失败：${CONSOLE_API}/internal/release/pointer（指针未切换，页面仍是旧版本）" >&2; exit 1; }',
  'echo "[release] 已激活 ${DEPLOY_ENV}/${MODULE_KEY}@${COMMIT_SHORT}"',
].join('\n');

/** 头部注释订正：兼容副本已下线，激活改由平台接口承担 */
const HEADER_OLD =
  '#   COMMIT_ID 形如 <流水线key>/<commit>，本脚本只取纯 commit 段；legacy 直出路径另存兼容副本（文末）。';
const HEADER_NEW = [
  '#   COMMIT_ID 形如 <流水线key>/<commit>，本脚本只取纯 commit 段。',
  '#   产物落盘后调平台接口完成激活（写入口指针 + 版本表），脚本不自拼指针文本。',
].join('\n');

function assertBashOk(script, label) {
  const tmp = path.join('/tmp', `p24-syntax-${Date.now()}.sh`);
  fs.writeFileSync(tmp, script, 'utf-8');
  try {
    execFileSync('bash', ['-n', tmp], { stdio: 'pipe' });
  } catch (e) {
    throw new Error(`[${label}] bash -n 校验失败：${String(e.stderr || e.message).slice(0, 400)}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST || '127.0.0.1',
  port: Number(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.MYSQL_DB,
  connectTimeout: 8000,
});

const [rows] = await conn.query(
  'SELECT p.`key` pk, a.id action_id, a.script' +
    ' FROM deploy_pipelines p' +
    ' JOIN deploy_pipeline_steps s ON s.pipeline_id = p.id' +
    ' JOIN deploy_pipeline_tasks t ON t.step_id = s.id' +
    ' JOIN deploy_pipeline_actions a ON a.task_id = t.id' +
    " WHERE s.name = '发布' AND a.name = '投递产物' AND t.`condition` = 'DEPLOY_ENV == local'" +
    ' ORDER BY p.`key`',
);

const backup = [];
const updates = [];

for (const r of rows) {
  const script = String(r.script || '');
  if (script.includes(DONE_MARK)) {
    out(`- ${r.pk}: 已走平台接口，跳过`);
    continue;
  }
  const idx = script.indexOf(CUT_MARK);
  if (idx < 0) {
    out(`- ${r.pk}: 未找到自拼指针段（${CUT_MARK}），跳过待人工确认`);
    continue;
  }
  const next = script.slice(0, idx).replace(/\s+$/, '') + '\n' + ACTIVATE_BLOCK + '\n';
  const withHeader = next.includes(HEADER_OLD) ? next.replace(HEADER_OLD, HEADER_NEW) : next;
  assertBashOk(withHeader, `${r.pk} / local 投递产物`);
  backup.push({ actionId: r.action_id, pipelineKey: r.pk, script });
  updates.push({ actionId: r.action_id, pk: r.pk, script: withHeader });
  out(`- ${r.pk}: 待更新（删自拼指针段 → 调平台接口；bash -n 通过）`);
}

if (!updates.length) {
  out('\n没有需要变更的动作。');
} else if (DRY_RUN) {
  out(`\nDRY_RUN：将更新 ${updates.length} 条动作，未写库。`);
  out(`\n────── 预览：${updates[0].pk} ──────\n${updates[0].script}`);
} else {
  const backupFile = `/tmp/p24-backup-${Date.now()}.json`;
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf-8');
  for (const u of updates) {
    await conn.query('UPDATE deploy_pipeline_actions SET script = ?, updated_by = ?, updated_at = NOW() WHERE id = ?', [
      u.script,
      'p24',
      u.actionId,
    ]);
  }
  out(`\n已更新 ${updates.length} 条动作。回退备份：${backupFile}`);
}

await conn.end();
process.exit(0);
