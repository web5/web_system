#!/usr/bin/env node
/**
 * p25：流水线 `restart`（后端）动作接入「配置下发」（`specs/service-config-delivery/design.md` §7 P1）。
 *
 * 背景：P0 把「配置中心 → 服务进程」的下发接在了控制台的部署路径
 * （`DeployService.applyBackendVersion`）。但正式发布走的是流水线 `restart` **DB 脚本**
 * （版本目录 → dist + 依赖校验 + pm2 干净重启），不经过 applyBackendVersion ——
 * 实测 2026-09-22：gateway 走流水线发布成功后，`servers/gateway/.env.generated`
 * 的时间戳仍是上一次手工下发的时间（平台没写过它）。
 *
 * 本迁移在那个脚本的「② 产物守卫 + 落地」之前插入一段「配置下发」：
 *   ① 仅 `DEPLOY_ENV == local` 生效（**首批范围就是本地**，dev/prod 行为不变）；
 *   ② `curl $CONSOLE_API/config/internal/dispatch/<模块>?envId=<环境>`（`x-internal-key: $CONSOLE_TOKEN`）；
 *   ③ 200 → 写 `<SVC_DIR>/.env.generated`（0600，旧版备份留 3 份）；
 *      204 → 配置中心没有该模块的 module 级条目，跳过（保留现状）；
 *      其它 → **fail-fast，不落地不重启**（避免「以为换了配置其实没换」）。
 *
 * 幂等：脚本里已有 `config-dispatch:begin` 标记 → 跳过。
 * 回退：`ROLLBACK=1 node scripts/migrations/p25-restart-config-dispatch.mjs`
 *       （按标记删除插入段，恢复原文；DRY_RUN=1 只打印）
 */
import fs from 'node:fs';
import path from 'node:path';
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

/** 插入段的起止标记（回退按标记删除，不依赖原文逐字比对） */
const BEGIN = '# ══ config-dispatch:begin（p25，由 scripts/migrations/p25 维护）══';
const END = '# ══ config-dispatch:end ══';
/** 插入锚点：原脚本「产物守卫 + 落地」段标题 */
const ANCHOR = '# ── ② 产物守卫 + 落地 ──';

const DISPATCH = [
  BEGIN,
  '# ── 配置下发（仅 local）：把配置中心的结果写到 .env.generated ──',
  '# 为什么必须在这里：服务只在**启动时**读 .env*（ConfigModule.envFilePath，下发文件排在前），',
  '# 所以下发要发生在重启之前；写不成就 fail-fast（不落地、不重启），',
  '# 避免「以为换了配置其实没换」—— 见 specs/service-config-delivery/design.md §4.3 / §7 P1。',
  'if [ "${DEPLOY_ENV:-}" = "local" ] && [ -n "${CONSOLE_API:-}" ] && [ -n "${CONSOLE_TOKEN:-}" ]; then',
  '  GEN="${SVC_DIR}/.env.generated"',
  '  URL="${CONSOLE_API%/}/config/internal/dispatch/${MODULE_KEY}?envId=${DEPLOY_ENV}"',
  '  TMP_GEN="${GEN}.tmp.$$"',
  '  CODE="$(curl -sS -m 15 -o "${TMP_GEN}" -w \'%{http_code}\' -H "x-internal-key: ${CONSOLE_TOKEN}" "${URL}" || echo 000)"',
  '  case "${CODE}" in',
  '    200)',
  '      [ -s "${TMP_GEN}" ] || { rm -f "${TMP_GEN}"; die "配置下发内容为空：${URL}"; }',
  '      chmod 600 "${TMP_GEN}"',
  '      if [ -f "${GEN}" ]; then cp -p "${GEN}" "${GEN}.bak-$(date +%s)"; fi',
  '      ls -1dt "${GEN}".bak-* 2>/dev/null | tail -n +4 | xargs -r rm -f',
  '      mv "${TMP_GEN}" "${GEN}"',
  '      echo "[restart] 配置已下发: ${GEN}"',
  '      ;;',
  '    204) rm -f "${TMP_GEN}"; echo "[restart] 配置中心无 ${MODULE_KEY} 的 module 级条目，跳过下发" ;;',
  '    *) rm -f "${TMP_GEN}"; die "配置下发失败（HTTP ${CODE}）：${URL} —— 不落地、不重启" ;;',
  '  esac',
  'else',
  '  echo "[restart] 跳过配置下发（DEPLOY_ENV=${DEPLOY_ENV:-未设置}；CONSOLE_API/CONSOLE_TOKEN 未同时注入）"',
  'fi',
  '',
  END,
  '',
].join('\n');

/**
 * 语法自检：改完的脚本必须先过 `bash -n`。
 *
 * 这段脚本是所有后端服务 restart 的执行体 —— 语法错一次，等于**所有后端都发不上去**，
 * 所以宁可迁移失败，也不把坏脚本写进库（与流水线编辑器保存时的校验口径一致）。
 */
function assertBashSyntax(script, label) {
  const r = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`${label} 语法检查未通过：\n${r.stderr || r.stdout}`);
  }
}

/** 插入下发段（已插过返回 null） */
function applyDispatch(script) {
  if (script.includes(BEGIN)) return null;
  const i = script.indexOf(ANCHOR);
  if (i < 0) throw new Error(`脚本里找不到插入锚点「${ANCHOR}」，拒绝盲改`);
  return script.slice(0, i) + DISPATCH + script.slice(i);
}

/** 按标记删除下发段（没有标记返回 null） */
function revertDispatch(script) {
  const lines = script.split('\n');
  const b = lines.findIndex((l) => l.includes(BEGIN));
  const e = lines.findIndex((l) => l.includes(END));
  if (b < 0 || e < b) return null;
  lines.splice(b, e - b + 1);
  while (lines[b] === '' && lines[b - 1] === '') lines.splice(b, 1);
  return lines.join('\n');
}

async function main() {
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DB,
  });

  // 只挑「后端 restart」动作（脚本头带该标识），避免误伤其它动作
  const [rows] = await conn.query(
    "SELECT a.id, a.script, t.name task_name, t.`condition` cond, s.pipeline_id tpl FROM deploy_pipeline_actions a " +
      'JOIN deploy_pipeline_tasks t ON t.id = a.task_id ' +
      'JOIN deploy_pipeline_steps s ON s.id = t.step_id ' +
      'WHERE a.script LIKE "%restart（后端）%" ORDER BY s.pipeline_id',
  );
  console.log(`扫描到 ${rows.length} 个后端 restart 动作${ROLLBACK ? '（回退模式）' : ''}`);

  let changed = 0;
  let skipped = 0;
  for (const r of rows) {
    const next = ROLLBACK ? revertDispatch(r.script) : applyDispatch(r.script);
    if (next === null) {
      skipped++;
      console.log(`- ${r.tpl} / ${r.task_name}: ${ROLLBACK ? '无下发段，跳过' : '已接入，跳过'}`);
      continue;
    }
    console.log(`- ${r.tpl} / ${r.task_name}: ${ROLLBACK ? '移除' : '插入'}配置下发段`);
    assertBashSyntax(next, `${r.tpl}/${r.task_name}`);
    changed++;
    if (DRY_RUN) continue;
    await conn.query('UPDATE deploy_pipeline_actions SET script = ?, updated_by = ?, updated_at = NOW() WHERE id = ?', [
      next,
      ROLLBACK ? 'p25-rollback' : 'p25',
      r.id,
    ]);
  }

  console.log(
    DRY_RUN
      ? `\nDRY_RUN：将改动 ${changed} 条，跳过 ${skipped} 条（未写库）`
      : `\n完成：改动 ${changed} 条，跳过 ${skipped} 条`,
  );
  await conn.end();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
