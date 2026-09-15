#!/usr/bin/env node
/* =============================================================================
 * P5: 模板迁移到终态（design §3）+ 按环境拆 3 条
 *
 * 终态：
 *   - 节点只有两类：shell / approval（platform 节点取消；git 变成普通 shell 节点）
 *   - 平台能力不是节点，而是 shell 节点里的 `service` action（写版本 / 重启 / 验证…）
 *   - 发布节点 = shell(上传产物) + service(write-version)：脚本来写版本，引擎不代写
 *   - 切指针不在流水线：部署 = 「模块管理 → 环境部署」调用改指针接口（人工动作）
 *
 * 按环境拆 3 条（用户 2026-09-15）：**不同环境机器不同**，机器取自 `deploy_servers`
 *（pipeline-configs.md §3：dev-default=175.27.189.123/ubuntu、prod-default=106.52.176.246/root）
 *
 * 启用策略（pipeline-configs.md §5：**远程版必须停用**）：
 *   - local：enabled=1（本机投递，引擎今天只跑本机）
 *   - dev / prod：enabled=0 —— 远程语义需要「节点 host + 平台 SSH 通道」（design §6 / P1），
 *     落地后把变量填好即可启用（PUBLISH_HOST / PUBLISH_USER / PUBLISH_PATH 已按环境预填）
 *
 * 产出：`tpl-<module>-<env>`（admin / ai-agent / gateway / portal / shell / mcp-gateway × local/dev/prod = 18 条）；
 *       删除旧的 tpl-local-* / tpl-publish-*；
 *       删除全局默认模板（module_key='*'）—— 用户 2026-09-15 决定「先删了，少了再加」：
 *       各模块都按 local/dev/prod 各建一条，不再用「无归属的全局兜底」。
 *       ⚠️ 影响：库里其它模块（auth-service / todo-service / mcp-gateway…）当前没有流水线，
 *          在控制台发起时会提示「无可用流水线」；需要时照本脚本的 MODULES 列表补即可。
 *
 * 用法：node scripts/migrations/p5-pipeline-shell-approval-3env.mjs        # dry-run
 *       APPLY=1 node scripts/migrations/p5-pipeline-shell-approval-3env.mjs
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
const gitScript = () => fs.readFileSync(path.join(SCRIPTS_DIR, 'git-step.sh'), 'utf8');

/**
 * 本机投递根目录（**绝对路径**：用户 2026-09-15 要求 PUBLISH_PATH 一律用绝对路径，
 * 不用 `~` —— 双引号里 `~` 不展开，2026-09-15 事故就是这么把产物投进字面量 `~` 目录的）。
 */
const HOME = process.env.HOME || '/root';

const MODULES = [
  {
    key: 'admin',
    // ⚠️ 不要再拼「产品线段」：投递脚本里 VER=${COMMIT_ID}，而 COMMIT_ID 是**完整版本标签**
    //    `<流水线 key>/<commit>`（= admin-local/d8d7e2c），产物自然落到
    //    .../modules/admin/admin-local/<commit>/ 与 gateway manifest
    //    /static/modules/<key>/<current_version>/ 对齐。PUBLISH_PATH 只到 <key> 一级。
    localPath: `${HOME}/web_system_release/servers/gateway/public/static/modules/admin`,
    // 远端（dev/prod）沿用既有扁平布局（历史 current_version 形如 default/<commit>），
    // 暂不加产品线段 —— 远程通道打通前不动，避免和线上指针不一致
    remotePath: '/data/web_system/servers/gateway/public/static/modules/admin',
  },
  {
    key: 'gateway',
    // 后端服务：本机是「就地发布」（目录本身就是服务目录），不按版本分目录
    localPath: `${HOME}/web_system_release/servers/gateway`,
    remotePath: '/data/web_system/servers/gateway',
  },
  {
    key: 'ai-agent',
    localPath: `${HOME}/web_system_release/servers/ai-agent`,
    remotePath: '/data/web_system/servers/ai-agent',
  },
  // 2026-09-15 追加（用户：补核心模块）
  {
    key: 'portal', // 微前端入口
    localPath: `${HOME}/web_system_release/servers/gateway/public/static/modules/portal`,
    remotePath: '/data/web_system/servers/gateway/public/static/modules/portal',
  },
  {
    key: 'shell', // 前端基座（vite build）
    localPath: `${HOME}/web_system_release/servers/gateway/public/static/modules/shell`,
    remotePath: '/data/web_system/servers/gateway/public/static/modules/shell',
  },
  {
    key: 'mcp-gateway', // 后台服务（tsc，就地发布）
    localPath: `${HOME}/web_system_release/servers/mcp-gateway`,
    remotePath: '/data/web_system/servers/mcp-gateway',
  },
];
/** 环境 → deploy_servers 里的 server_name（local 不走 ssh，同机投递） */
const ENV_SERVER = { local: null, dev: 'dev-default', prod: 'prod-default' };

/** 本地投递（shell action）：构建产物 → 本机产物目录，不切指针 */
const localUploadScript = (mod) => `#!/usr/bin/env bash
# 本地投递：把构建产物放到本机发布目录（版本目录），不做生效动作（生效=模块管理里部署）
set -euo pipefail
VER="\${COMMIT_ID:?COMMIT_ID 为空，无法确定版本目录}"
SRC="\${BUILD_OUTPUT_DIR:?构建产物目录未注入}"
DST="\${PUBLISH_PATH:?缺少流水线变量 PUBLISH_PATH}"
# ⚠️ PUBLISH_PATH 以 ~ 开头（如 ~/web_system_release/...）：双引号里 ~ 不会被 bash 展开，
# 2026-09-15 事故：产物被拷进字面量目录 apps/admin/~/... → 页面 404。这里显式展开。
DST="\${DST/#\\~/$HOME}"
[ -d "$SRC" ] || { echo "[release] 构建产物不存在: $SRC"; exit 1; }
mkdir -p "$DST/$VER"
rm -rf "$DST/$VER"/* 2>/dev/null || true
cp -R "$SRC/." "$DST/$VER/"
echo "[release] 本地产物已就位: $DST/$VER"
`;

/** 远程投递（shell action，dev/prod 模板用；当前停用，等节点 host + SSH 通道） */
const remoteUploadScript = (mod) => `#!/usr/bin/env bash
# 远程投递：打包 → scp → 目标机解包到 $PUBLISH_PATH/$COMMIT_ID
# 说明：仅"放产物"，生效（切指针 + 后端重启）由「模块管理 → 环境部署」完成
set -euo pipefail
PUBLISH_HOST="\${PUBLISH_HOST:?缺少流水线变量 PUBLISH_HOST}"
PUBLISH_USER="\${PUBLISH_USER:-ubuntu}"
PUBLISH_KEY="\${PUBLISH_KEY:-$HOME/.ssh/id_ed25519_servers}"
PUBLISH_PATH="\${PUBLISH_PATH:?缺少流水线变量 PUBLISH_PATH}"
VER="\${COMMIT_ID:?COMMIT_ID 为空，无法确定版本目录}"
SRC="\${BUILD_OUTPUT_DIR:?构建产物目录未注入}"
[ -d "$SRC" ] || { echo "[release] 构建产物不存在: $SRC"; exit 1; }
SSH="ssh -i $PUBLISH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
SCP="scp -i $PUBLISH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
TGZ="/tmp/${mod.key}-$(echo "$VER" | tr '/' '-').tgz"
echo "[release] 打包 $SRC → $TGZ"
tar czf "$TGZ" -C "$SRC" .
echo "[release] 投递到 $PUBLISH_USER@$PUBLISH_HOST:$PUBLISH_PATH/$VER"
$SSH "$PUBLISH_USER@$PUBLISH_HOST" "mkdir -p '$PUBLISH_PATH/$VER'"
$SCP "$TGZ" "$PUBLISH_USER@$PUBLISH_HOST:/tmp/"
$SSH "$PUBLISH_USER@$PUBLISH_HOST" \\
  "rm -rf '$PUBLISH_PATH/$VER' && mkdir -p '$PUBLISH_PATH/$VER' && tar xzf '/tmp/$(basename "$TGZ")' -C '$PUBLISH_PATH/$VER' && rm -f '/tmp/$(basename "$TGZ")'"
rm -f "$TGZ"
echo "[release] 远端产物已就位: $PUBLISH_PATH/$VER"
`;

/** 终态四节点：拉代码 → 构建 → 审批 → 发布 */
const terminalNodes = () => [
  { kind: 'shell', key: 'git', label: '拉取代码' },
  { kind: 'shell', key: 'build', label: '构建' },
  { kind: 'approval', key: 'gate', label: '发布确认', approvers: ['admin'], onReject: 'abort' },
  { kind: 'shell', key: 'release', label: '发布' },
];

/** 发布节点的 actions：shell 上传 + service 写版本（design §3：平台能力 = action） */
const releaseActions = (uploadScript) => [
  { id: 'a1', type: 'shell', name: '上传产物', code: uploadScript },
  { id: 'a2', type: 'service', name: '写版本记录', tool: 'write-version' },
];

const OLD_TEMPLATES = [
  'tpl-local-admin',
  'tpl-publish-admin',
  'tpl-local-ai-agent',
  'tpl-publish-ai-agent',
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

  const [servers] = await conn.query('SELECT server_name, host, ssh_user FROM deploy_servers');
  const serverOf = (name) => servers.find((s) => s.server_name === name) || null;
  const [moduleBuilds] = await conn.query(
    "SELECT module_key, command FROM deploy_module_stage_commands WHERE stage = 'build'",
  );
  const buildOf = (k) => moduleBuilds.find((r) => r.module_key === k)?.command;

  const plan = { templates: [], commands: [], vars: [] };
  for (const mod of MODULES) {
    for (const [env, serverName] of Object.entries(ENV_SERVER)) {
      const id = `tpl-${mod.key}-${env}`;
      const isLocal = env === 'local';
      const server = serverName ? serverOf(serverName) : null;
      if (!isLocal && !server) {
        errOut(`⚠️ 跳过 ${id}：deploy_servers 里没有 ${serverName}`);
        continue;
      }
      const upload = isLocal ? localUploadScript(mod) : remoteUploadScript(mod);
      plan.templates.push({
        id,
        moduleKey: mod.key,
        name: `${mod.key} ${env} 发布`,
        key: `${mod.key}-${env}`,
        env,
        // 2026-09-15：dev / prod 的 SSH 通道已验证（175.27.189.123 / 106.52.176.246，
        // 目录 /data/web_system 可写）→ 全部启用；若后续要停用，改这里或控制台里点停用。
        enabled: 1,
        nodes: terminalNodes(),
      });
      plan.commands.push({
        templateId: id,
        nodeKey: 'git',
        command: gitScript(),
        locked: 1,
        actions: null,
      });
      if (buildOf(mod.key)) {
        plan.commands.push({ templateId: id, nodeKey: 'build', command: buildOf(mod.key), locked: 0, actions: null });
      }
      plan.commands.push({
        templateId: id,
        nodeKey: 'release',
        command: upload, // 保留正文便于阅读/回退；引擎优先用 actions
        locked: 0,
        actions: releaseActions(upload),
      });
      plan.vars.push({
        pipelineId: id,
        key: 'PUBLISH_PATH',
        value: isLocal ? mod.localPath : mod.remotePath,
        desc: `${mod.key} 在 ${env} 的产物目录`,
      });
      if (!isLocal) {
        plan.vars.push({
          pipelineId: id,
          key: 'PUBLISH_HOST',
          value: server.host,
          desc: `发布目标机（${env} · 来自 deploy_servers/${serverName}）`,
        });
        plan.vars.push({
          pipelineId: id,
          key: 'PUBLISH_USER',
          value: server.ssh_user,
          desc: `SSH 用户（${env} · 来自 deploy_servers/${serverName}）`,
        });
      }
    }
  }

  // 全局默认模板（module_key='*'）：**删除**（用户 2026-09-15：先删了，少了再加）
  const [globals] = await conn.query(
    "SELECT id, name FROM deploy_pipeline_templates WHERE module_key = '*'",
  );
  const globalTpls = globals;

  out(`库: ${process.env.MYSQL_DB}  模式: ${APPLY ? 'APPLY（写入）' : 'DRY-RUN'}`);
  out('\n将创建模板：');
  for (const t of plan.templates) {
    out(`  ${t.id.padEnd(22)} env=${String(t.env).padEnd(6)} enabled=${t.enabled}  nodes=${t.nodes.map((n) => n.key).join('→')}`);
  }
  out('\n节点命令：');
  for (const c of plan.commands) {
    const kind = c.actions ? `actions=[${c.actions.map((a) => a.type + ':' + (a.tool || a.name)).join(', ')}]` : c.locked ? '平台托管脚本' : 'shell 正文';
    out(`  ${c.templateId.padEnd(22)} ${c.nodeKey.padEnd(8)} ${kind}`);
  }
  out('\n流水线变量：');
  for (const v of plan.vars) out(`  ${v.pipelineId.padEnd(22)} ${v.key.padEnd(13)} = ${v.value}`);
  out(`\n删除旧模板：${OLD_TEMPLATES.join(', ')}`);
  if (globalTpls.length) {
    out(`删除全局默认模板：${globalTpls.map((g) => `${g.id}（${g.name}）`).join(', ')}`);
  } else {
    out('全局默认模板：无（已删过）');
  }

  if (!APPLY) {
    out('\nDRY-RUN 结束（APPLY=1 才写库）');
    await conn.end();
    return;
  }

  const now = Date.now();
  await conn.beginTransaction();
  try {
    // 旧模板清理
    const ph = OLD_TEMPLATES.map(() => '?').join(',');
    await conn.query(`DELETE FROM deploy_pipeline_step_commands WHERE template_id IN (${ph})`, OLD_TEMPLATES);
    await conn.query(`DELETE FROM deploy_pipeline_vars WHERE pipeline_id IN (${ph})`, OLD_TEMPLATES);
    await conn.query(`DELETE FROM deploy_pipeline_templates WHERE id IN (${ph})`, OLD_TEMPLATES);

    // 新模板（幂等：先清后建）
    const newIds = plan.templates.map((t) => t.id);
    if (newIds.length) {
      const ph2 = newIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM deploy_pipeline_step_commands WHERE template_id IN (${ph2})`, newIds);
      await conn.query(`DELETE FROM deploy_pipeline_vars WHERE pipeline_id IN (${ph2})`, newIds);
      await conn.query(`DELETE FROM deploy_pipeline_templates WHERE id IN (${ph2})`, newIds);
    }
    for (const t of plan.templates) {
      await conn.query(
        `INSERT INTO deploy_pipeline_templates
          (id, module_key, name, \`key\`, env, description, skip_verify, steps, nodes,
           rollback_on_failure, approval, default_target, enabled, builtin, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,0,NULL,?,?,?,?,?,0,'migration-p5',NOW(6),NOW(6))`,
        [
          t.id, t.moduleKey, t.name, t.key, t.env,
          '终态四节点：拉取代码 → 构建 → 发布确认 → 发布（发布=上传+写版本 action）',
          JSON.stringify(t.nodes), 'none', 'never', 'auto', t.enabled,
        ],
      );
    }
    for (const c of plan.commands) {
      await conn.query(
        `INSERT INTO deploy_pipeline_step_commands
          (id, template_id, node_key, command, actions, enabled, locked, updated_by, created_at, updated_at)
         VALUES (UUID(),?,?,?,?,1,?,?,NOW(6),NOW(6))`,
        [c.templateId, c.nodeKey, c.command, c.actions ? JSON.stringify(c.actions) : null, c.locked, c.locked ? 'system' : 'migration-p5'],
      );
    }
    for (const v of plan.vars) {
      await conn.query(
        'INSERT INTO deploy_pipeline_vars (id, pipeline_id, `key`, value, is_secret, description, enabled, updated_by, created_at, updated_at) VALUES (?,?,?,?,0,?,1,?,?,?)',
        [`pvar-${now}-${Math.random().toString(36).slice(2, 8)}`, v.pipelineId, v.key, v.value, v.desc, 'migration-p5', now, now],
      );
    }

    // 删除全局默认模板（先删了，少了再加）
    if (globalTpls.length) {
      const gIds = globalTpls.map((g) => g.id);
      const gph = gIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM deploy_pipeline_step_commands WHERE template_id IN (${gph})`, gIds);
      await conn.query(`DELETE FROM deploy_pipeline_vars WHERE pipeline_id IN (${gph})`, gIds);
      await conn.query(`DELETE FROM deploy_pipeline_templates WHERE id IN (${gph})`, gIds);
    }
    await conn.commit();
    out('\n✓ 已落库');
  } catch (e) {
    await conn.rollback();
    errOut('✗ 失败已回滚:', e.message);
    process.exitCode = 1;
  }

  const [check] = await conn.query(
    `SELECT t.id, t.module_key, t.env, t.enabled, JSON_LENGTH(t.nodes) AS n,
            (SELECT COUNT(*) FROM deploy_pipeline_step_commands c
              WHERE c.template_id = t.id AND JSON_LENGTH(c.actions) > 0) AS with_actions
       FROM deploy_pipeline_templates t ORDER BY t.module_key, t.env`,
  );
  out('\n校验（模板 → 节点数 / 启用 / 含 actions 的节点数）:');
  for (const r of check) {
    out(`  ${r.id.padEnd(24)} ${String(r.module_key).padEnd(10)} env=${String(r.env ?? '-').padEnd(6)} nodes=${r.n} enabled=${r.enabled} actions节点=${r.with_actions}`);
  }
  await conn.end();
}

main().catch((e) => {
  errOut(e);
  process.exit(1);
});
