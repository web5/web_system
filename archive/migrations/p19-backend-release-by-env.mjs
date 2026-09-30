#!/usr/bin/env node
/**
 * p19：后端服务「发布」按环境分支（用户 2026-09-21：应该按环境来给流程，类似 admin）。
 *
 * p18 的教训：把发布统一改「落本机版本目录」不分环境——但产物应跟着环境走：
 *   - local → 落本机版本目录（local 部署：本机 cp dist + 重启）
 *   - dev（远程）→ 投远端版本目录（$PUBLISH_PATH/$COMMIT_ID = /data/web_system/servers/<dir>/<versionTag>，
 *     与 applyBackendRemote 的远端版本目录约定一致；dev 部署：远端就地换 dist + 重启）
 *
 * 动作：
 *   backend 流水线「发布」步骤的 script 任务 → 拆为两个互斥条件任务：
 *     local（DEPLOY_ENV == local）：本机版本目录脚本（p18 的）
 *     dev  （DEPLOY_ENV != local）：远程投递脚本（scp 到 PUBLISH_PATH/$VER）
 *   两任务各带一份 write-version（从库里现有动作复制）。
 *
 * 幂等：已是双任务（存在 condition 为 DEPLOY_ENV == local 的 local 任务）则跳过。
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
# 后端服务发布（local）：产物落**本机版本目录**。
# 约定（与 deployVersion 本机分支一致）：版本目录 = \${RELEASE_DIR}/servers/<模块目录>/<流水线key>/<commit>
# 生效（部署 = 版本目录落地 dist + 重启 + 探活）是独立动作：服务详情 → 部署。
set -euo pipefail
VER="\${COMMIT_ID:?COMMIT_ID 为空，无法确定版本目录}"
SRC="\${BUILD_OUTPUT_DIR:?构建产物目录未注入}"
MODULE_DIR="\${MODULE_DIR:?模块目录未注入}"
[ -d "$SRC" ] || { echo "[release] 构建产物不存在: $SRC"; exit 1; }
DST="\${RELEASE_DIR}/servers/\${MODULE_DIR}/\${VER}"
rm -rf "$DST"
mkdir -p "$DST"
cp -R "$SRC"/. "$DST"/
echo "[release] 产物已落本机版本目录: $DST"
echo "[release] 生效请到「服务详情 → 部署」选择该版本执行部署（落 dist + 重启 + 探活）"`;

const DEV_SCRIPT = `#!/usr/bin/env bash
# 后端服务发布（dev/prod 远程）：打包 → scp → **远端版本目录**（$PUBLISH_PATH/$VER）。
# 远端版本目录与部署动作（applyBackendRemote）的约定一致：
#   /data/web_system/servers/<模块目录>/<流水线key>/<commit>
# 生效（远端换 dist + 重启）由「服务详情 → 部署」完成（远端就地部署，不回传本机）。
set -euo pipefail
PUBLISH_HOST="\${PUBLISH_HOST:?缺少流水线变量 PUBLISH_HOST}"
PUBLISH_USER="\${PUBLISH_USER:-ubuntu}"
PUBLISH_KEY="\${PUBLISH_KEY:-\$HOME/.ssh/id_ed25519_servers}"
PUBLISH_PATH="\${PUBLISH_PATH:?缺少流水线变量 PUBLISH_PATH}"
VER="\${COMMIT_ID:?COMMIT_ID 为空，无法确定版本目录}"
SRC="\${BUILD_OUTPUT_DIR:?构建产物目录未注入}"
[ -d "$SRC" ] || { echo "[release] 构建产物不存在: $SRC"; exit 1; }
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
echo "[release] 远端版本目录已就位: \$PUBLISH_PATH/\$VER"
echo "[release] 生效请到「服务详情 → 部署」选择该版本执行部署（远端换 dist + 重启）"`;

async function main() {
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DB,
    multipleStatements: false,
  });

  const [rows] = await conn.query(
    `SELECT p.\`key\` pk, p.module_key, s.id sid, s.name step_name, s.sort
       FROM deploy_pipeline_steps s
       JOIN deploy_pipelines p ON p.id = s.pipeline_id
       JOIN deploy_modules dm ON dm.\`key\` = p.module_key
      WHERE s.name = '发布' AND dm.type = 'backend'`,
  );

  let changed = 0;
  for (const r of rows) {
    const [tasks] = await conn.query('SELECT id, name, kind FROM deploy_pipeline_tasks WHERE step_id = ?', [r.sid]);
    const hasLocal = tasks.some((t) => t.name === 'local');
    if (hasLocal) {
      console.log(`- ${r.pk}（${r.module_key}）: 已按环境分支，跳过`);
      continue;
    }
    // 取现有任务的 write-version 动作脚本（复用）
    const [wv] = await conn.query(
      "SELECT script FROM deploy_pipeline_actions WHERE task_id IN (?) AND name = 'write-version · 写版本记录' LIMIT 1",
      [tasks.map((t) => t.id)],
    );
    const wvScript = wv[0]?.script ?? null;
    console.log(`- ${r.pk}（${r.module_key}）: 发布单任务 → 拆 local/dev 双任务${wvScript ? '（write-version 各带一份）' : '（无 write-version，跳过它）'}`);
    changed++;
    if (DRY_RUN) continue;

    // 清旧任务（含动作），建双任务
    await conn.query('DELETE FROM deploy_pipeline_actions WHERE task_id IN (?)', [tasks.map((t) => t.id)]);
    await conn.query('DELETE FROM deploy_pipeline_tasks WHERE step_id = ?', [r.sid]);
    for (const [name, cond, script, sort] of [
      ['local', 'DEPLOY_ENV == local', LOCAL_SCRIPT, 0],
      ['dev', 'DEPLOY_ENV != local', DEV_SCRIPT, 1],
    ]) {
      const tid = crypto.randomUUID();
      await conn.query(
        'INSERT INTO deploy_pipeline_tasks (id, step_id, kind, name, `condition`, env, approval, sort, enabled, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,NULL,NULL,?,1,?,NOW(),NOW())',
        [tid, r.sid, 'script', name, cond, sort, 'p19'],
      );
      await conn.query(
        'INSERT INTO deploy_pipeline_actions (id, task_id, name, script, managed, sort, enabled, updated_by, created_at, updated_at) VALUES (?,?,?,?,0,0,1,?,NOW(),NOW())',
        [crypto.randomUUID(), tid, '发布', script, 'p19'],
      );
      if (wvScript) {
        await conn.query(
          'INSERT INTO deploy_pipeline_actions (id, task_id, name, script, managed, sort, enabled, updated_by, created_at, updated_at) VALUES (?,?,?,?,0,1,1,?,NOW(),NOW())',
          [crypto.randomUUID(), tid, 'write-version · 写版本记录', wvScript, 'p19'],
        );
      }
    }
  }
  if (!changed) console.log('没有需要改造的步骤。');
  else console.log(DRY_RUN ? `\nDRY_RUN：将改造 ${changed} 条流水线，未写库。` : `\n改造完成：${changed} 条流水线。`);
  await conn.end();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
