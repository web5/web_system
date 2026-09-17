#!/usr/bin/env node
/* =============================================================================
 * P4: 回滚 P3，恢复被误删的流水线模板（止血）
 *
 * 背景：P3 迁移把 tpl-local-* / tpl-publish-* 四条模板**直接删除**并改写成四节点，
 *       但 `specs/pipeline-node-model/pipeline-configs.md` §5 明确：
 *         - tpl-local-admin / tpl-local-ai-agent 是**启用中**的本地流水线
 *         - 本地版只需配 build，upload / restart / verify 由平台内置 + 平台托管脚本播种
 *         - 远程（publish）两条 **必须停用**（远程语义属 design §6 / P1）
 *       本次把库恢复到 P3 之前的状态，作为「design §3 终态」重做前的干净基线。
 *
 * 恢复内容（按 pipeline-configs.md §2/§5 的原始形态）：
 *   tpl-local-admin      : git → build → gate → upload → version → pointer → verify   （启用）
 *   tpl-local-ai-agent   : git → build → gate → restart → version → verify            （启用）
 *   tpl-publish-admin    : git → build → gate → publish → version → pointer → verify  （停用）
 *   tpl-publish-ai-agent : git → build → gate → publish → version → verify            （停用）
 * 命令来源：
 *   - git / restart / verify：平台托管脚本（读 src/pipeline/scripts/*.sh，locked=1，与播种服务一致）
 *   - build：deploy_module_stage_commands 中该模块的 build 命令
 *   - publish：远程发布脚本原文（P3 前库中内容，已保存）
 *   - upload：本地投递脚本（R6 迁移生成：BUILD_OUTPUT_DIR → ARTIFACT_DIR）
 * 同时删除 P3 新建的 6 条模板及其节点命令/变量，并把全局模板 nodes 还原为 9 个。
 *   （全局模板的显示名保留 P3 改过的「默认流水线」，仅名称变化、无功能影响）
 *
 * 用法：node scripts/migrations/p4-rollback-p3-restore-templates.mjs        # dry-run
 *       APPLY=1 node scripts/migrations/p4-rollback-p3-restore-templates.mjs
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');

const out = (...a) => process.stdout.write(a.map(String).join(' ') + '\n');
const errOut = (...a) => process.stderr.write(a.map(String).join(' ') + '\n');
const APPLY = process.env.APPLY === '1';

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, 'servers/deploy-console/.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const SCRIPTS_DIR = path.join(ROOT, 'servers/deploy-console/src/pipeline/scripts');
const readScript = (f) => fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8');

/** 本地投递（R6 迁移生成的 upload 命令，P3 前形态） */
const UPLOAD_LOCAL = `#!/usr/bin/env bash
# R6 流水线级 upload：平台下发 BUILD_OUTPUT_DIR（构建产物）/ ARTIFACT_DIR（投递目标，含 <key>/<版本>）
set -euo pipefail
SRC="\${BUILD_OUTPUT_DIR:?构建产物目录未注入}"
DST="\${ARTIFACT_DIR:?投递目标未注入}"
mkdir -p "$DST"
rm -rf "$DST"/* 2>/dev/null || true
cp -R "$SRC/." "$DST/"
echo "[upload] 产物已投递: $DST"
`;

/** 远程发布脚本（P3 前库中原文，admin / ai-agent 各一份） */
const PUBLISH_ADMIN = `#!/usr/bin/env bash
# 发布：把构建产物投递到远程机器并让其生效
#
# ┌─ 发布参数（可修改）─────────────────────────────────────┐
PUBLISH_HOST="\${PUBLISH_HOST:-175.27.189.123}"   # 目标机（dev-default）
PUBLISH_USER="\${PUBLISH_USER:-ubuntu}"           # SSH 用户
PUBLISH_KEY="\${PUBLISH_KEY:-$HOME/.ssh/id_ed25519_servers}"
PUBLISH_PATH="\${PUBLISH_PATH:-/data/web_system/servers/gateway/public/static/modules/admin}"   # 发布路径
# └─┘
set -euo pipefail
VER="\${COMMIT_ID:?COMMIT_ID 为空，无法确定版本目录}"
SRC="\${BUILD_OUTPUT_DIR:?构建产物目录未注入}"
[ -d "$SRC" ] || { echo "[publish] 构建产物不存在: $SRC"; exit 1; }
SSH="ssh -i $PUBLISH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
SCP="scp -i $PUBLISH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
TGZ="/tmp/admin-$(echo "$VER" | tr '/' '-').tgz"
echo "[publish] 打包 $SRC → $TGZ"
tar czf "$TGZ" -C "$SRC" .
echo "[publish] 投递到 $PUBLISH_USER@$PUBLISH_HOST:$PUBLISH_PATH/$VER"
$SSH "$PUBLISH_USER@$PUBLISH_HOST" "mkdir -p '$PUBLISH_PATH/$VER'"
$SCP "$TGZ" "$PUBLISH_USER@$PUBLISH_HOST:/tmp/"
$SSH "$PUBLISH_USER@$PUBLISH_HOST" \\
  "rm -rf '$PUBLISH_PATH/$VER' && mkdir -p '$PUBLISH_PATH/$VER' && tar xzf '/tmp/$(basename "$TGZ")' -C '$PUBLISH_PATH/$VER' && rm -f '/tmp/$(basename "$TGZ")'"
rm -f "$TGZ"
echo "[publish] 静态产物已就位（指针切换由平台 pointer 节点完成）"
`;

const PUBLISH_AI_AGENT = `#!/usr/bin/env bash
# 发布：把构建产物投递到远程机器并让其生效
#
# ┌─ 发布参数（可修改）─────────────────────────────────────┐
PUBLISH_HOST="\${PUBLISH_HOST:-175.27.189.123}"   # 目标机（dev-default）
PUBLISH_USER="\${PUBLISH_USER:-ubuntu}"           # SSH 用户
PUBLISH_KEY="\${PUBLISH_KEY:-$HOME/.ssh/id_ed25519_servers}"
PUBLISH_PATH="\${PUBLISH_PATH:-/data/web_system/servers/ai-agent}"   # 发布路径
# └─┘
set -euo pipefail
VER="\${COMMIT_ID:?COMMIT_ID 为空，无法确定版本目录}"
SRC="\${BUILD_OUTPUT_DIR:?构建产物目录未注入}"
[ -d "$SRC" ] || { echo "[publish] 构建产物不存在: $SRC"; exit 1; }
SSH="ssh -i $PUBLISH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
SCP="scp -i $PUBLISH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
TGZ="/tmp/ai-agent-$(echo "$VER" | tr '/' '-').tgz"
echo "[publish] 打包 $SRC → $TGZ"
tar czf "$TGZ" -C "$SRC" .
echo "[publish] 投递到 $PUBLISH_USER@$PUBLISH_HOST:$PUBLISH_PATH/$VER"
$SSH "$PUBLISH_USER@$PUBLISH_HOST" "mkdir -p '$PUBLISH_PATH/$VER'"
$SCP "$TGZ" "$PUBLISH_USER@$PUBLISH_HOST:/tmp/"
$SSH "$PUBLISH_USER@$PUBLISH_HOST" \\
  "rm -rf '$PUBLISH_PATH/$VER' && mkdir -p '$PUBLISH_PATH/$VER' && tar xzf '/tmp/$(basename "$TGZ")' -C '$PUBLISH_PATH/$VER' && rm -f '/tmp/$(basename "$TGZ")'"
rm -f "$TGZ"
# 后端：远端是完整 clone，重启脚本随代码走（依赖校验 + 干净 pm2 重建）
echo "[publish] 远端重启 $MODULE_KEY"
$SSH "$PUBLISH_USER@$PUBLISH_HOST" \\
  "RELEASE_DIR=/data/web_system MODULE_KEY=$MODULE_KEY MODULE_DIR=$MODULE_DIR MODULE_TYPE=backend PM2_NAME=$PM2_NAME PORT=$PORT \\
   bash /data/web_system/scripts/pipeline/restart-backend.sh"
`;

const P3_TEMPLATES = [
  'tpl-admin-local', 'tpl-admin-dev', 'tpl-admin-prod',
  'tpl-ai-agent-local', 'tpl-ai-agent-dev', 'tpl-ai-agent-prod',
];
const GLOBAL_NODES_ORIGINAL = [
  'git', 'check', 'build', 'upload', 'restart', 'version', 'pointer', 'verify', 'cleanup',
];

const RESTORE = [
  {
    id: 'tpl-local-admin', moduleKey: 'admin', name: 'admin 本地发布', key: 'local-admin',
    enabled: 1,
    nodes: [
      { kind: 'platform', key: 'git' },
      { kind: 'script', key: 'build', label: '构建' },
      { kind: 'approval', key: 'gate', label: '发布确认', approvers: ['admin'], onReject: 'abort' },
      { kind: 'script', key: 'upload', label: '投递产物' },
      { kind: 'platform', key: 'version' },
      { kind: 'platform', key: 'pointer' },
      { kind: 'script', key: 'verify', label: '验证', watchdog: true },
    ],
    commands: [
      { key: 'git', file: 'git-step.sh', locked: 1 },
      { key: 'build', fromModuleBuild: 'admin' },
      { key: 'upload', raw: UPLOAD_LOCAL },
      { key: 'verify', file: 'verify-step.sh', locked: 1 },
    ],
  },
  {
    id: 'tpl-publish-admin', moduleKey: 'admin', name: 'admin 远程发布', key: 'publish-admin',
    enabled: 0,
    nodes: [
      { kind: 'platform', key: 'git' },
      { kind: 'script', key: 'build', label: '构建' },
      { kind: 'approval', key: 'gate', label: '发布确认', approvers: ['admin'], onReject: 'abort' },
      { kind: 'script', key: 'publish', label: '发布' },
      { kind: 'platform', key: 'version' },
      { kind: 'platform', key: 'pointer' },
      { kind: 'script', key: 'verify', label: '验证', watchdog: true },
    ],
    commands: [
      { key: 'git', file: 'git-step.sh', locked: 1 },
      { key: 'build', fromModuleBuild: 'admin' },
      { key: 'publish', raw: PUBLISH_ADMIN },
      { key: 'verify', file: 'verify-step.sh', locked: 1 },
    ],
  },
  {
    id: 'tpl-local-ai-agent', moduleKey: 'ai-agent', name: 'ai-agent 本地发布', key: 'local-ai-agent',
    enabled: 1,
    nodes: [
      { kind: 'platform', key: 'git' },
      { kind: 'script', key: 'build', label: '构建' },
      { kind: 'approval', key: 'gate', label: '发布确认', approvers: ['admin'], onReject: 'abort' },
      { kind: 'script', key: 'restart', label: '重启' },
      { kind: 'platform', key: 'version' },
      { kind: 'script', key: 'verify', label: '验证', watchdog: true },
    ],
    commands: [
      { key: 'git', file: 'git-step.sh', locked: 1 },
      { key: 'build', fromModuleBuild: 'ai-agent' },
      { key: 'restart', file: 'restart-step.sh', locked: 1 },
      { key: 'verify', file: 'verify-step.sh', locked: 1 },
    ],
  },
  {
    id: 'tpl-publish-ai-agent', moduleKey: 'ai-agent', name: 'ai-agent 远程发布', key: 'publish-ai-agent',
    enabled: 0,
    nodes: [
      { kind: 'platform', key: 'git' },
      { kind: 'script', key: 'build', label: '构建' },
      { kind: 'approval', key: 'gate', label: '发布确认', approvers: ['admin'], onReject: 'abort' },
      { kind: 'script', key: 'publish', label: '发布' },
      { kind: 'platform', key: 'version' },
      { kind: 'script', key: 'verify', label: '验证', watchdog: true },
    ],
    commands: [
      { key: 'git', file: 'git-step.sh', locked: 1 },
      { key: 'build', fromModuleBuild: 'ai-agent' },
      { key: 'publish', raw: PUBLISH_AI_AGENT },
      { key: 'verify', file: 'verify-step.sh', locked: 1 },
    ],
  },
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DB || 'web_system_deploy',
    multipleStatements: true,
  });

  const [moduleBuilds] = await conn.query(
    "SELECT module_key, command FROM deploy_module_stage_commands WHERE stage = 'build'",
  );
  const buildOf = (k) => moduleBuilds.find((r) => r.module_key === k)?.command;

  out(`库: ${process.env.MYSQL_DB}  模式: ${APPLY ? 'APPLY（写入）' : 'DRY-RUN'}`);
  out(`\n将删除 P3 新建模板 ${P3_TEMPLATES.length} 条：${P3_TEMPLATES.join(', ')}`);
  out('\n将恢复模板：');
  for (const t of RESTORE) {
    out(`  ${t.id.padEnd(22)} enabled=${t.enabled} nodes=${t.nodes.map((n) => n.key).join('→')}`);
    for (const c of t.commands) {
      const src = c.file ? `平台脚本 ${c.file}` : c.fromModuleBuild ? `模块 build 命令（${c.fromModuleBuild}）` : '原文还原';
      const len = c.raw ? c.raw.length : c.file ? readScript(c.file).length : (buildOf(c.fromModuleBuild) || '').length;
      out(`      - ${c.key.padEnd(8)} ${src}（${len} 字节）`);
    }
  }
  const globalTpl = (await conn.query("SELECT id FROM deploy_pipeline_templates WHERE module_key = '*'"))[0][0];
  if (globalTpl) out(`\n全局模板 ${globalTpl.id} nodes 还原为：${GLOBAL_NODES_ORIGINAL.join('→')}`);

  if (!APPLY) {
    out('\nDRY-RUN 结束（APPLY=1 才写库）');
    await conn.end();
    return;
  }

  await conn.beginTransaction();
  try {
    // 1) 删掉 P3 新建的 6 条
    const ph = P3_TEMPLATES.map(() => '?').join(',');
    await conn.query(`DELETE FROM deploy_pipeline_step_commands WHERE template_id IN (${ph})`, P3_TEMPLATES);
    await conn.query(`DELETE FROM deploy_pipeline_vars WHERE pipeline_id IN (${ph})`, P3_TEMPLATES);
    await conn.query(`DELETE FROM deploy_pipeline_templates WHERE id IN (${ph})`, P3_TEMPLATES);

    // 2) 恢复 4 条原模板
    for (const t of RESTORE) {
      await conn.query(`DELETE FROM deploy_pipeline_step_commands WHERE template_id = ?`, [t.id]);
      await conn.query(`DELETE FROM deploy_pipeline_templates WHERE id = ?`, [t.id]);
      await conn.query(
        `INSERT INTO deploy_pipeline_templates
          (id, module_key, name, \`key\`, env, description, skip_verify, steps, nodes,
           rollback_on_failure, approval, default_target, enabled, builtin, created_by, created_at, updated_at)
         VALUES (?,?,?,?,NULL,?,0,NULL,?,?,?,?,?,0,'p4-restore',NOW(6),NOW(6))`,
        [
          t.id, t.moduleKey, t.name, t.key,
          '四节点前的原始形态（pipeline-configs.md §5 基线）',
          JSON.stringify(t.nodes),
          'none', 'never', 'auto', t.enabled,
        ],
      );
      for (const c of t.commands) {
        const command = c.raw ?? (c.file ? readScript(c.file) : buildOf(c.fromModuleBuild) || '');
        if (!command) {
          errOut(`  ⚠️ ${t.id}/${c.key} 无内容，跳过`);
          continue;
        }
        await conn.query(
          `INSERT INTO deploy_pipeline_step_commands
            (id, template_id, node_key, command, enabled, locked, updated_by, created_at, updated_at)
           VALUES (UUID(),?,?,?,1,?,?,NOW(6),NOW(6))`,
          [t.id, c.key, command, c.locked ? 1 : 0, c.locked ? 'system' : 'p4-restore'],
        );
      }
    }

    // 3) 全局模板 nodes 还原
    if (globalTpl) {
      await conn.query('UPDATE deploy_pipeline_templates SET nodes = ? WHERE id = ?', [
        JSON.stringify(GLOBAL_NODES_ORIGINAL.map((k) => ({ kind: k, key: k }))),
        globalTpl.id,
      ]);
    }
    await conn.commit();
    out('\n✓ 已回滚并恢复');
  } catch (e) {
    await conn.rollback();
    errOut('✗ 失败已回滚:', e.message);
    process.exitCode = 1;
  }

  const [check] = await conn.query(
    'SELECT id, module_key, env, enabled, JSON_LENGTH(nodes) AS n FROM deploy_pipeline_templates ORDER BY id',
  );
  out('\n校验（模板 → 节点数 / 启用）:');
  for (const r of check) {
    out(`  ${r.id.padEnd(24)} ${r.module_key.padEnd(10)} env=${String(r.env ?? '-').padEnd(6)} nodes=${r.n} enabled=${r.enabled}`);
  }
  await conn.end();
}

main().catch((e) => {
  errOut(e);
  process.exit(1);
});
