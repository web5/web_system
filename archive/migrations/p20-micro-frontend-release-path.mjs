#!/usr/bin/env node
/**
 * p20：微前端/前端发布按环境分支 + 落盘路径对齐版本指针值（用户 2026-09-21：门户加载失败）。
 *
 * 事故链：
 *   网关按**指针值**直出模块：/static/modules/<key>/<currentVersion>/index.js
 *   （version.controller：base = /static/modules/<moduleKey>/<version>/）
 *   而 release 脚本落盘路径与指针值不一致：
 *     - portal/shell/mini-contract/finnews：无条件「远程直投」——local 发布也投到远程机，
 *       本机 gateway 目录没有产物 → 指针切了、页面 404（portal@portal-dev/65c00a9 加载失败）
 *     - admin：local 任务落 modules/<key>/<ENV_ID>/<commit>（`local/<commit>`），
 *       而指针值是 `<流水线key>/<commit>`（`admin-dev/<commit>`）→ 同样对不上
 *
 * 修正（按环境分支，产物路径 == 指针值）：
 *   local（DEPLOY_ENV == local）：落本机 ${RELEASE_DIR}/servers/gateway/public/static/modules/<PUBLIC_PATH>/<COMMIT_ID>
 *   dev  （DEPLOY_ENV != local）：scp 远端 $PUBLISH_PATH/<COMMIT_ID>（远端 gateway 静态目录，保持原状）
 *   COMMIT_ID 形如 `<流水线key>/<commit>` → 展开为两级目录，与网关直出路径一致
 *
 * 幂等：local 任务脚本已含 `modules/${PUBLIC_PATH}/${VER}` 则跳过。DRY_RUN=1 预览。
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

const LOCAL_SCRIPT = `#!/usr/bin/env bash
# 微前端/前端发布（local）：落**本机 gateway 静态目录**。
# 关键约定：落盘路径必须 == 版本指针值 —— 网关按 /static/modules/<key>/<currentVersion>/index.js 直出，
#          COMMIT_ID 形如 <流水线key>/<commit>，展开为两级目录，正好与指针值逐段一致。
set -euo pipefail
VER="\${COMMIT_ID:?COMMIT_ID 为空，无法确定版本目录}"   # 例：portal-dev/65c00a9
PUBLIC_PATH="\${PUBLIC_PATH:?缺少 PUBLIC_PATH（模块 public 子路径）}"
SRC="\${BUILD_OUTPUT_DIR:?缺少 BUILD_OUTPUT_DIR（构建产物目录）}"
[ -d "$SRC" ] || { echo "[release] 构建产物不存在: $SRC" >&2; exit 1; }
DST="\${RELEASE_DIR}/servers/gateway/public/static/modules/\${PUBLIC_PATH}/\${VER}"
echo "[release] local delivery: $SRC -> $DST"
mkdir -p "$DST"
if [ -n "$(ls -A "$DST" 2>/dev/null)" ]; then
  mv "$DST" "/tmp/trash-\${PUBLIC_PATH}-\$(date +%s)" || true
  mkdir -p "$DST"
fi
cp -R "$SRC"/. "$DST"/
echo "[release] artifact ready at \${DST}（指针值需为 \${VER}，网关按此路径直出）"`;

const DEV_SCRIPT = `#!/usr/bin/env bash
# 微前端/前端发布（dev/prod 远程）：打包 → scp → 远端 gateway 静态目录 $PUBLISH_PATH/<COMMIT_ID>
# 远端落盘路径同样 == 指针值（/static/modules/<key>/<currentVersion>/index.js）
set -euo pipefail
PUBLISH_HOST="\${PUBLISH_HOST:?缺少流水线变量 PUBLISH_HOST}"
PUBLISH_USER="\${PUBLISH_USER:-ubuntu}"
PUBLISH_KEY="\${PUBLISH_KEY:-\$HOME/.ssh/id_ed25519_servers}"
PUBLISH_PATH="\${PUBLISH_PATH:?缺少流水线变量 PUBLISH_PATH}"
VER="\${COMMIT_ID:?COMMIT_ID 为空，无法确定版本目录}"
SRC="\${BUILD_OUTPUT_DIR:?构建产物目录未注入}"
[ -d "$SRC" ] || { echo "[release] 构建产物不存在: $SRC" >&2; exit 1; }
SSH="ssh -i \$PUBLISH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
SCP="scp -i \$PUBLISH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
TGZ="/tmp/\${MODULE_KEY}-\$(echo "\$VER" | tr '/' '-').tgz"
echo "[release] 打包 \$SRC → \$TGZ"
tar czf "\$TGZ" -C "\$SRC" .
echo "[release] 投递到 \$PUBLISH_USER@\$PUBLISH_HOST:\$PUBLISH_PATH/\$VER"
\$SSH "\$PUBLISH_USER@\$PUBLISH_HOST" "mkdir -p '\$PUBLISH_PATH/\$VER'"
\$SCP "\$TGZ" "\$PUBLISH_USER@\$PUBLISH_HOST:/tmp/"
\$SSH "\$PUBLISH_USER@\$PUBLISH_HOST" \\
  "rm -rf '\$PUBLISH_PATH/\$VER' && mkdir -p '\$PUBLISH_PATH/\$VER' && tar xzf '/tmp/\$(basename "\$TGZ")' -C '\$PUBLISH_PATH/\$VER' && rm -f '/tmp/\$(basename "\$TGZ")'"
rm -f "\$TGZ"
echo "[release] 远端产物已就位: \$PUBLISH_PATH/\$VER"`;

async function main() {
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DB,
  });

  // 微前端 / 前端的流水线
  const [rows] = await conn.query(
    `SELECT p.\`key\` pk, p.module_key, s.id sid
       FROM deploy_pipeline_steps s
       JOIN deploy_pipelines p ON p.id = s.pipeline_id
       JOIN deploy_modules dm ON dm.\`key\` = p.module_key
      WHERE s.name = '发布' AND dm.type IN ('micro-frontend','frontend')`,
  );

  let changed = 0;
  for (const r of rows) {
    const [tasks] = await conn.query(
      'SELECT id, name, `condition` cond FROM deploy_pipeline_tasks WHERE step_id = ? ORDER BY sort',
      [r.sid],
    );
    const localTask = tasks.find((t) => t.name === 'local' || t.name === 'local-1');
    const [acts] = await conn.query(
      'SELECT id, task_id, name, script FROM deploy_pipeline_actions WHERE task_id IN (?) ORDER BY sort',
      [tasks.map((t) => t.id)],
    );
    const wvScript = acts.find((a) => a.name.startsWith('write-version'))?.script ?? null;

    if (localTask) {
      // admin 型：已有双任务 → 只修 local 任务「投递产物」脚本的落盘路径
      const deliver = acts.find((a) => a.task_id === localTask.id && !a.name.startsWith('write-version'));
      if (!deliver) {
        console.log(`- ${r.pk}: local 任务无投递动作，跳过`);
        continue;
      }
      if (deliver.script.includes('modules/${PUBLIC_PATH}/${VER}')) {
        console.log(`- ${r.pk}: local 落盘路径已是 <PUBLIC_PATH>/<版本指针值>，跳过`);
        continue;
      }
      console.log(`- ${r.pk}（${r.module_key}）: 修正 local 投递落盘路径（ENV_ID 前缀 → 版本指针值全路径）`);
      changed++;
      if (!DRY_RUN) {
        await conn.query('UPDATE deploy_pipeline_actions SET script = ?, updated_by = ?, updated_at = NOW() WHERE id = ?', [LOCAL_SCRIPT, 'p20', deliver.id]);
      }
      continue;
    }

    // 单任务型：拆 local / dev 双任务
    console.log(`- ${r.pk}（${r.module_key}）: 单任务 → 拆 local/dev 双任务（local 落本机静态目录，dev 远程）`);
    changed++;
    if (DRY_RUN) continue;

    await conn.query('DELETE FROM deploy_pipeline_actions WHERE task_id IN (?)', [tasks.map((t) => t.id)]);
    await conn.query('DELETE FROM deploy_pipeline_tasks WHERE step_id = ?', [r.sid]);
    for (const [name, cond, script, sort] of [
      ['local', 'DEPLOY_ENV == local', LOCAL_SCRIPT, 0],
      ['dev', 'DEPLOY_ENV != local', DEV_SCRIPT, 1],
    ]) {
      const tid = crypto.randomUUID();
      await conn.query(
        'INSERT INTO deploy_pipeline_tasks (id, step_id, kind, name, `condition`, env, approval, sort, enabled, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,NULL,NULL,?,1,?,NOW(),NOW())',
        [tid, r.sid, 'script', name, cond, sort, 'p20'],
      );
      await conn.query(
        'INSERT INTO deploy_pipeline_actions (id, task_id, name, script, managed, sort, enabled, updated_by, created_at, updated_at) VALUES (?,?,?,?,0,0,1,?,NOW(),NOW())',
        [crypto.randomUUID(), tid, '投递产物', script, 'p20'],
      );
      if (wvScript) {
        await conn.query(
          'INSERT INTO deploy_pipeline_actions (id, task_id, name, script, managed, sort, enabled, updated_by, created_at, updated_at) VALUES (?,?,?,?,0,1,1,?,NOW(),NOW())',
          [crypto.randomUUID(), tid, 'write-version · 写版本记录', wvScript, 'p20'],
        );
      }
    }
  }
  if (!changed) console.log('没有需要修正的步骤。');
  else console.log(DRY_RUN ? `\nDRY_RUN：将修正 ${changed} 条流水线，未写库。` : `\n修正完成：${changed} 条流水线。`);
  await conn.end();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
