#!/usr/bin/env node
/**
 * p18：后端服务的「发布」动作改为落本机版本目录（投递目录修正，用户 2026-09-21 反馈）。
 *
 * 根因：p16 从旧脚本迁移的 release 动作按 PUBLISH_* 直投远端机——
 * 但「部署」（deployVersion → applyBackendRemote）期望版本目录在**本机**
 * `web_system_release/servers/<dir>/<versionTag>`（部署时本机打包 → 远端换 dist + 重启）。
 * 两条链路目录约定冲突 → 部署必然「找不到版本目录」。
 *
 * 修正：kind=backend 的流水线，release 动作改为「产物落本机版本目录」
 * （`${RELEASE_DIR}/servers/<MODULE_DIR>/<COMMIT_ID>`，COMMIT_ID 含流水线 key 段，
 *  与 deployVersion 的 src 约定一致）；微前端的远程静态目录投递保持不变。
 *
 * 幂等：动作脚本已是目标内容则跳过。DRY_RUN=1 预览。
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

const BACKEND_RELEASE_SCRIPT = `#!/usr/bin/env bash
# 后端服务发布：产物落**本机版本目录**（不直投远端）。
# 约定（与 deployVersion.applyBackendRemote 一致）：
#   版本目录 = \${RELEASE_DIR}/servers/<模块目录>/<流水线key>/<commit>
# 生效（部署 = 从版本目录落地 dist + 重启 + 探活）是独立动作：
#   服务详情 → 部署 Tab → 选版本 → 部署（specs/pipeline-step-task/design.md；用户 2026-09-21 指针分域）
set -euo pipefail
VER="\${COMMIT_ID:?COMMIT_ID 为空，无法确定版本目录}"
SRC="\${BUILD_OUTPUT_DIR:?构建产物目录未注入}"
MODULE_DIR="\${MODULE_DIR:?模块目录未注入}"
[ -d "$SRC" ] || { echo "[release] 构建产物不存在: $SRC"; exit 1; }
DST="\${RELEASE_DIR}/servers/\${MODULE_DIR}/\${VER}"
rm -rf "$DST"
mkdir -p "$DST"
cp -R "$SRC"/. "$DST"/
echo "[release] 产物已落版本目录: $DST"
echo "[release] 生效请到「服务详情 → 部署」选择该版本执行部署（落 dist + 重启 + 探活）"`;

async function main() {
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DB,
  });

  // backend 模块的流水线 × 发布步骤的 shell 动作
  const [rows] = await conn.query(
    `SELECT p.\`key\` pk, p.module_key, s.id sid, s.name step_name,
            tk.id tid, tk.name task_name, ac.id aid, ac.name aname, ac.script
       FROM deploy_pipeline_steps s
       JOIN deploy_pipeline_tasks tk ON tk.step_id = s.id
       JOIN deploy_pipeline_actions ac ON ac.task_id = tk.id
       JOIN deploy_pipelines p ON p.id = s.pipeline_id
       JOIN deploy_modules dm ON dm.\`key\` = p.module_key
       WHERE s.name = '发布' AND tk.kind = 'script' AND ac.\`enabled\` = 1
        AND dm.type = 'backend'`,
  );

  let changed = 0;
  for (const r of rows) {
    // 只修「远程直投」（PUBLISH_* 直投远端机）的发布动作；write-version 等其他动作不动
    if (!r.script.includes('PUBLISH_HOST')) {
      console.log(`- ${r.pk} / ${r.step_name} / ${r.aname}: 非远程直投，跳过`);
      continue;
    }
    if (r.script.includes('servers/${MODULE_DIR}/${VER}')) {
      console.log(`- ${r.pk} / ${r.step_name} / ${r.aname}: 已是本机版本目录版本，跳过`);
      continue;
    }
    console.log(`- ${r.pk}（${r.module_key}）/ ${r.step_name} / ${r.aname}: 远程直投 → 改为落本机版本目录`);
    changed++;
    if (!DRY_RUN) {
      await conn.query('UPDATE deploy_pipeline_actions SET script = ?, updated_by = ?, updated_at = NOW() WHERE id = ?', [
        BACKEND_RELEASE_SCRIPT,
        'p18',
        r.aid,
      ]);
    }
  }
  if (!changed) console.log('没有需要修正的动作。');
  else console.log(DRY_RUN ? `\nDRY_RUN：将修正 ${changed} 个动作，未写库。` : `\n修正完成：${changed} 个动作。`);
  await conn.end();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
