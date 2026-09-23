#!/usr/bin/env node
/**
 * p27：远端发布的**版本记录 / 指针写入远端库**（B6，`specs/remote-backend-release/design.md` §12）。
 *
 * 问题（2026-09-23 实测）：流水线的 `write-version` 调的是**编排者（本机）控制台**
 * （`CONSOLE_API` = `http://127.0.0.1:<consolePort>/api`），于是发到 dev 的版本记录写进了
 * **本机库**；dev 云库里 admin 仍停在 `default/f05e12e` → 远端控制台的「版本部署」页
 * 看不到新版本，微前端无法在远端手动部署（状态撕裂）。
 *
 * 口径（用户 2026-09-23 定）：
 *   - 远端（dev/prod）：**版本记录/指针都写远端库** —— 按 env 解析 baseURL，指向该环境的控制台；
 *   - 微前端（admin/portal/shell/mini-contract）：流水线**只写远端库的版本记录**，
 *     **指针切换走远端控制台的「版本部署」页手动部署**（不自动切）；
 *   - 后端：`verify` 探活通过后由 `pointer（远端）` 调远端控制台切指针（探活不过 ⇒ 两库都不动）。
 *
 * 实现要点：
 *   - baseURL 按 env 映射（域名，用户选定）：dev = `https://dev.kedouai.com/console/api`；
 *     prod 用 `CONSOLE_API_PROD` 覆盖；local 仍用平台注入的 `CONSOLE_API`。
 *   - 密钥**不假设跨环境同值**（实测本机 `6e587f…` ≠ dev `435802…`）：经 ssh 从目标机
 *     控制台 `.env` 读 `INTERNAL_API_KEY`；可用 `CONSOLE_TOKEN_DEV` / `CONSOLE_TOKEN_PROD` 覆盖。
 *   - 远端分支上把原来的 `write-version · 写版本记录`（写本机库）**停用**，避免双写与本机库污染；
 *     local 分支不受影响。
 *
 * 幂等：按（任务 + 动作名）更新正文；`enabled` 同步纠正。
 * 回退：`ROLLBACK=1 node scripts/migrations/p27-remote-release-remote-db.mjs`
 *       （删除本迁移新增的动作，并恢复被停用的 write-version）
 *       `DRY_RUN=1` 只打印（动库前先打印将变更的行）。
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

/** 后端模块（会挂 pointer） */
const BACKENDS = (process.env.BACKENDS || 'system-service,upload-service,gateway')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
/** 微前端模块（只写版本记录，指针手动） */
const FRONTENDS = (process.env.FRONTENDS || 'admin')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const WV_NAME = 'write-version · 写版本记录（远端）';
const PT_NAME = 'pointer · 切版本指针（远端）';
/** 远端分支上要停用的「写本机库」动作名（精确匹配平台现有行） */
const LOCAL_WV_NAME = 'write-version · 写版本记录';

const header = (label) => `#!/usr/bin/env bash
# 发布流水线 · ${label}（远端）：把结果写进**该环境的控制台库**（B6）。
#
# 为什么必须远端写：流水线跑在编排者（本机）上，平台注入的 CONSOLE_API 指向**本机**控制台，
# 于是 dev 的版本记录/指针写进了本机库 → 远端「版本部署」页看不到新版本（2026-09-23 实测）。
#
# 平台注入变量：MODULE_KEY / MODULE_TYPE / COMMIT_ID / DEPLOY_ENV / BRANCH /
#               CONSOLE_API / CONSOLE_TOKEN / PUBLISH_HOST / PUBLISH_USER / PUBLISH_KEY / PUBLISH_PATH
# 可选覆盖：CONSOLE_API_DEV / CONSOLE_API_PROD（基址）、CONSOLE_TOKEN_DEV / _PROD（密钥）
set -uo pipefail
[ "\${MODULE_TYPE:-}" = "backend" ] || [ "\${MODULE_TYPE:-}" = "micro-frontend" ] || [ "\${MODULE_TYPE:-}" = "frontend" ] || {
  echo "[remote-db] MODULE_TYPE=\${MODULE_TYPE:-未设置}，跳过"; exit 0; }
: "\${MODULE_KEY:?缺少 MODULE_KEY}" "\${COMMIT_ID:?缺少 COMMIT_ID}" "\${DEPLOY_ENV:?缺少 DEPLOY_ENV}"

RUSER="\${PUBLISH_USER:-ubuntu}"
RKEY="\${PUBLISH_KEY:-\$HOME/.ssh/id_ed25519_servers}"
RROOT="\$(dirname "\$(dirname "\${PUBLISH_PATH:-/data/web_system/servers/x}")")"
rssh() { ssh -i "\${RKEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes "\$@"; }

# ── 按 env 解析 baseURL（远端=域名）与密钥 ──
case "\${DEPLOY_ENV}" in
  local)
    BASE="\${CONSOLE_API:-}"; TOKEN="\${CONSOLE_TOKEN:-}" ;;
  dev)
    BASE="\${CONSOLE_API_DEV:-https://dev.kedouai.com/console/api}"; TOKEN="\${CONSOLE_TOKEN_DEV:-}" ;;
  *)
    BASE="\${CONSOLE_API_PROD:-}"; TOKEN="\${CONSOLE_TOKEN_PROD:-}" ;;
esac
if [ "\${DEPLOY_ENV}" != "local" ] && [ -z "\${TOKEN}" ]; then
  # 不假设跨环境密钥同值（实测本机 ≠ dev）：从目标机控制台 .env 取
  TOKEN="\$(rssh "\${RUSER}@\${PUBLISH_HOST}" "grep -m1 '^INTERNAL_API_KEY=' \${RROOT}/servers/deploy-console/.env | cut -d= -f2-" 2>/dev/null | tr -d '\r\n')"
fi
[ -n "\${BASE}" ] || { echo "[remote-db] ❌ 未解析出 \${DEPLOY_ENV} 的控制台基址（CONSOLE_API_*）" >&2; exit 1; }
[ -n "\${TOKEN}" ] || { echo "[remote-db] ❌ 未取到 \${DEPLOY_ENV} 控制台密钥（CONSOLE_TOKEN_* 或目标机 .env）" >&2; exit 1; }
BASE="\${BASE%/}"
`;

const WV_SCRIPT = `${header('write-version')}
# ── 写版本记录（该环境的库）──
# 版本 ref 口径与产物目录一致：微前端/env-dir 用**纯 commit**（控制台按 modules/<key>/<envId>/<ref> 列版本），
# 后端沿用平台既有 <流水线key>/<commit> 形态。
case "\${MODULE_TYPE:-}" in
  micro-frontend|frontend) TAG="\${COMMIT_ID##*/}" ;;
  *) TAG="\${COMMIT_ID}" ;;
esac
BODY="\$(printf '{"moduleKey":"%s","versionTag":"%s","env":"%s","gitCommit":"%s","gitBranch":"%s","operator":"pipeline-script"}' \\
  "\${MODULE_KEY}" "\${TAG}" "\${DEPLOY_ENV}" "\${COMMIT_ID##*/}" "\${BRANCH:-}")"
RESP="\$(curl -sS -m 20 -X POST "\${BASE}/internal/release/versions" \\
  -H 'content-type: application/json' -H "x-internal-key: \${TOKEN}" -d "\${BODY}" -w '\\n%{http_code}' 2>&1)" || true
CODE="\$(printf '%s' "\${RESP}" | tail -1)"
echo "[remote-db] POST \${BASE}/internal/release/versions → HTTP \${CODE}"
printf '%s' "\${RESP}" | sed '\$d' | head -c 300; echo
case "\${CODE}" in
  2*) echo "[remote-db] 版本记录已写入 \${DEPLOY_ENV} 库：\${MODULE_KEY}@\${COMMIT_ID}"; exit 0 ;;
  *) echo "[remote-db] ❌ 写远端版本记录失败（HTTP \${CODE}）—— 检查基址/密钥与远端控制台是否可达" >&2; exit 1 ;;
esac
`;

const PT_SCRIPT = `${header('pointer')}
# ── 切当前版本指针（仅后端；微前端走远端控制台「版本部署」手动切）──
if [ "\${MODULE_TYPE:-}" != "backend" ]; then
  echo "[remote-db] \${MODULE_TYPE}：指针由远端控制台「版本部署」手动切换，本动作跳过"
  exit 0
fi
BODY="\$(printf '{"moduleKey":"%s","env":"%s","versionTag":"%s","operator":"pipeline-script"}' \\
  "\${MODULE_KEY}" "\${DEPLOY_ENV}" "\${COMMIT_ID}")"
RESP="\$(curl -sS -m 20 -X POST "\${BASE}/internal/release/pointer" \\
  -H 'content-type: application/json' -H "x-internal-key: \${TOKEN}" -d "\${BODY}" -w '\\n%{http_code}' 2>&1)" || true
CODE="\$(printf '%s' "\${RESP}" | tail -1)"
echo "[remote-db] POST \${BASE}/internal/release/pointer → HTTP \${CODE}"
printf '%s' "\${RESP}" | sed '\$d' | head -c 300; echo
case "\${CODE}" in
  2*) echo "[remote-db] 指针已指向 \${COMMIT_ID}（写入 \${DEPLOY_ENV} 库）"; exit 0 ;;
  *) echo "[remote-db] ❌ 切远端指针失败（HTTP \${CODE}）—— 注意：探活已通过但指针未前进" >&2; exit 1 ;;
esac
`;

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

  console.log(`${ROLLBACK ? '回退' : '应用'} p27（远端发布写远端库）`);
  console.log(`后端（挂 write-version + pointer）：${BACKENDS.join(', ')}`);
  console.log(`微前端（只挂 write-version）：${FRONTENDS.join(', ')}\n`);

  let changed = 0;
  let skipped = 0;

  for (const [mods, withPointer] of [
    [BACKENDS, true],
    [FRONTENDS, false],
  ]) {
    for (const mod of mods) {
      const tpl = `tpl-${mod}-dev`;
      // 分支任务名：后端模板是 `dev`，前端模板是 `dev-1`（2026-09-23 实测），两种都接受
      const [tasks] = await conn.query(
        'SELECT t.id FROM deploy_pipeline_tasks t JOIN deploy_pipeline_steps s ON s.id = t.step_id ' +
          "WHERE s.pipeline_id = ? AND t.name IN ('dev','dev-1') ORDER BY FIELD(t.name,'dev','dev-1'), t.sort LIMIT 1",
        [tpl],
      );
      if (!tasks.length) {
        console.log(`- ${tpl}: 找不到 dev 分支任务，跳过`);
        skipped++;
        continue;
      }
      const taskId = tasks[0].id;

      if (ROLLBACK) {
        const [del] = await conn.query('DELETE FROM deploy_pipeline_actions WHERE task_id = ? AND name IN (?, ?)', [
          taskId,
          WV_NAME,
          PT_NAME,
        ]);
        const [re] = await conn.query(
          'UPDATE deploy_pipeline_actions SET enabled = 1, updated_by = ?, updated_at = NOW() WHERE task_id = ? AND name = ?',
          ['p27-rollback', taskId, LOCAL_WV_NAME],
        );
        console.log(`- ${tpl}: 删除 ${del.affectedRows} 条、恢复启用 ${re.affectedRows} 条`);
        changed += del.affectedRows + re.affectedRows;
        continue;
      }

      const [existing] = await conn.query('SELECT id, name, script, sort, enabled FROM deploy_pipeline_actions WHERE task_id = ?', [taskId]);

      // ① 远端分支停用「写本机库」的 write-version（本机库不再被 dev/prod 污染）
      const localWv = existing.find((r) => r.name === LOCAL_WV_NAME);
      if (localWv && Number(localWv.enabled) === 1) {
        console.log(`- ${tpl} / dev: 停用「${LOCAL_WV_NAME}」（改由远端写库）`);
        changed++;
        if (!DRY_RUN) {
          await conn.query('UPDATE deploy_pipeline_actions SET enabled = 0, updated_by = ?, updated_at = NOW() WHERE id = ?', ['p27', localWv.id]);
        }
      }

      // ② 新增/更新远端写版本记录（sort=2：紧跟「发布」，先写记录再生效）
      //    ③ 后端再加 pointer（sort=31：排在 verify(21) 之后，「探活不过就不切指针」）
      const wanted = [[WV_NAME, WV_SCRIPT, 2]];
      if (withPointer) wanted.push([PT_NAME, PT_SCRIPT, 31]);

      for (const [name, script, sort] of wanted) {
        assertBashSyntax(script, `${tpl}/${name}`);
        const cur = existing.find((r) => r.name === name);
        if (cur && cur.script === script && Number(cur.sort) === sort && Number(cur.enabled) === 1) {
          console.log(`- ${tpl} / dev: 「${name}」已是最新，跳过`);
          skipped++;
          continue;
        }
        if (cur) {
          console.log(`- ${tpl} / dev: 更新「${name}」（sort=${sort}）`);
          changed++;
          if (!DRY_RUN) {
            await conn.query(
              'UPDATE deploy_pipeline_actions SET script = ?, sort = ?, enabled = 1, updated_by = ?, updated_at = NOW() WHERE id = ?',
              [script, sort, 'p27', cur.id],
            );
          }
        } else {
          console.log(`- ${tpl} / dev: 新增「${name}」（sort=${sort}）`);
          changed++;
          if (!DRY_RUN) {
            await conn.query(
              'INSERT INTO deploy_pipeline_actions (id, task_id, name, script, managed, sort, enabled, updated_by, created_at, updated_at) ' +
                'VALUES (?, ?, ?, ?, 0, ?, 1, ?, NOW(), NOW())',
              [crypto.randomUUID(), taskId, name, script, sort, 'p27'],
            );
          }
        }
      }
    }
  }

  if (!DRY_RUN && !ROLLBACK) {
    console.log('\n变更后的 dev 分支链（抽样）：');
    for (const mod of [...BACKENDS, ...FRONTENDS]) {
      const [rows] = await conn.query(
        'SELECT a.name, a.sort, a.enabled FROM deploy_pipeline_actions a JOIN deploy_pipeline_tasks t ON t.id = a.task_id ' +
          "JOIN deploy_pipeline_steps s ON s.id = t.step_id WHERE s.pipeline_id = ? AND t.name IN ('dev','dev-1') ORDER BY a.sort",
        [`tpl-${mod}-dev`],
      );
      const shown = rows.filter((r, i, arr) => arr.findIndex((x) => x.name === r.name) === i);
      console.log(`  ${mod}: ${shown.map((r) => `${r.name}${Number(r.enabled) ? '' : '(停用)'}`).join(' → ')}`);
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
