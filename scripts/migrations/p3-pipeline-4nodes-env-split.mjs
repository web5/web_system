#!/usr/bin/env node
/* =============================================================================
 * P3: 流水线模板 → 4 节点 + 按环境拆 3 条（local / dev / prod）
 *
 * ⚠️ DEPRECATED（2026-09-15）：**已废弃，不要执行**。
 *    本脚本的做法与 `specs/pipeline-node-model/pipeline-configs.md` §5 冲突：
 *      - 它把 version / pointer / verify 等平台节点**直接删掉**，而终态要求把平台能力
 *        降级为 shell 节点里的 `service` action（design §3）；
 *      - 它把本来**必须停用**的远程模板（dev/prod）建成了启用态。
 *    已在库里执行过一次并用 `p4-rollback-p3-restore-templates.mjs` 回滚；
 *    终态迁移改由 **`p5-pipeline-shell-approval-3env.mjs`** 承担。
 *    保留本文件仅为记录这次弯路，勿再运行。
 *
 * 原说明（已失效）↓
 * 流水线模板 → 4 节点 + 按环境拆 3 条（local / dev / prod）
 *
 * 背景（用户 2026-09-15 定）：
 *   1) 节点模型收敛为 4 个：拉取代码 → 构建 → 发布确认 → 发布
 *      （切指针/验证移出流水线，归「模块管理 → 环境部署」，人工点部署才生效）
 *   2) **每个环境拆一条流水线**，因为不同环境的目标机器不同
 *   3) 「发布」节点是无内置语义的普通 shell 节点：脚本 = 上传文件 + 调用写版本接口
 *
 * 做法：
 *   - 为 admin / ai-agent 各建 3 条模板（env=local/dev/prod），nodes 固定 4 个
 *   - 发布脚本：local 用本地投递（cp 到产物目录），dev/prod 用原远程 publish 脚本（打包+scp+解包[+后端远端重启]），
 *     两者末尾统一追加「调用内部写版本接口」（x-internal-key）
 *   - 每个环境各配 PUBLISH_HOST / PUBLISH_PATH（值不同 → 这就是拆 3 条的原因）
 *   - 全局默认模板（moduleKey='*'）nodes 同样收敛为 4 个
 *   - 删除旧的按模块两条模板（tpl-local-* / tpl-publish-*）及其节点命令
 *
 * 用法：node scripts/migrations/p3-pipeline-4nodes-env-split.mjs          # dry-run
 *       APPLY=1 node scripts/migrations/p3-pipeline-4nodes-env-split.mjs  # 落库
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mysql = require('mysql2/promise');

const out = (...a) => process.stdout.write(a.map(String).join(' ') + '\n');
const errOut = (...a) => process.stderr.write(a.map(String).join(' ') + '\n');
const APPLY = process.env.APPLY === '1';
const ROOT = path.resolve(process.cwd());
const ENV_FILE = path.join(ROOT, 'servers/deploy-console/.env');

// .env 手工解析（脚本不依赖服务启动环境）
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const MODULES = [
  {
    key: 'admin',
    type: 'frontend',
    localPath: '~/web_system_release/servers/gateway/public/static/modules/admin',
    remotePath: '/data/web_system/servers/gateway/public/static/modules/admin',
  },
  {
    key: 'ai-agent',
    type: 'backend',
    localPath: '~/web_system_release/servers/ai-agent',
    remotePath: '/data/web_system/servers/ai-agent',
  },
];
const ENVS = [
  { env: 'local', host: null, user: null },
  { env: 'dev', host: '175.27.189.123', user: 'ubuntu' },
  { env: 'prod', host: '175.27.189.123', user: 'ubuntu', warn: '⚠️ 生产机待确认（暂用 dev 机地址，发布前必须改）' },
];

/** 发布节点脚本末尾统一追加：调用内部写版本接口（新模型：写版本由脚本自己完成） */
const WRITE_VERSION_BLOCK = `
# --- 调用平台写版本接口（新模型：发布节点自己落版本记录，不再由平台节点代写）---
VER="\${COMMIT_ID:?COMMIT_ID 为空，无法写版本}"
: "\${WS_PLATFORM_API:?平台地址未注入（WS_PLATFORM_API）}"
: "\${WS_INTERNAL_KEY:?内部密钥未注入（WS_INTERNAL_KEY）}"
echo "[release] 调用写版本接口: $MODULE_KEY/$VER"
HTTP=$(curl -s -o /tmp/ws-write-version.log -w '%{http_code}' -X POST "$WS_PLATFORM_API/internal/release/versions" \\
  -H "Content-Type: application/json" -H "x-internal-key: $WS_INTERNAL_KEY" \\
  -d "{\\"moduleKey\\":\\"$MODULE_KEY\\",\\"env\\":\\"$DEPLOY_ENV\\",\\"versionTag\\":\\"$VER\\",\\"gitCommit\\":\\"$COMMIT_ID\\",\\"gitBranch\\":\\"$BRANCH\\"}")
if [ "$HTTP" != "200" ]; then
  echo "[release] ❌ 写版本失败 HTTP=$HTTP"; cat /tmp/ws-write-version.log || true; exit 1
fi
echo "[release] ✓ 版本记录已写入: $VER"
`;

/** local 环境：本机投递（cp 到产物目录），不做远端 ssh */
function localReleaseScript(mod) {
  return `#!/usr/bin/env bash
# 发布（local）：本机投递 + 调写版本接口
set -euo pipefail
VER="\${COMMIT_ID:?COMMIT_ID 为空}"
SRC="\${BUILD_OUTPUT_DIR:?构建产物目录未注入}"
DST="\${PUBLISH_PATH:?缺少流水线变量 PUBLISH_PATH}"
[ -d "$SRC" ] || { echo "[release] 构建产物不存在: $SRC"; exit 1; }
mkdir -p "$DST/$VER"
rm -rf "$DST/$VER"/* 2>/dev/null || true
cp -R "$SRC/." "$DST/$VER/"
echo "[release] 本地产物已就位: $DST/$VER"
${WRITE_VERSION_BLOCK}`;
}

function nodes() {
  return [
    { kind: 'platform', key: 'git' },
    { kind: 'script', key: 'build', label: '构建' },
    { kind: 'approval', key: 'gate', label: '发布确认' },
    { kind: 'script', key: 'release', label: '发布' },
  ];
}

async function main() {
  const db = process.env.MYSQL_DB || 'web_system_deploy';
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: db,
    multipleStatements: true,
  });

  // ---- 取现有素材 ----
  const [tpls] = await conn.query('SELECT * FROM deploy_pipeline_templates');
  const [cmds] = await conn.query(
    'SELECT template_id, node_key, command, enabled, timeout_sec FROM deploy_pipeline_step_commands',
  );
  const cmdOf = (tplId, key) =>
    cmds.find((c) => c.template_id === tplId && c.node_key === key)?.command || null;

  const globalTpl = tpls.find((t) => t.module_key === '*');
  const gitCmd =
    cmds.find((c) => c.node_key === 'git')?.command || '# git 由平台内置执行（未配置自定义脚本）';
  const globalBuild = globalTpl ? cmdOf(globalTpl.id, 'build') : null;

  const plan = { templates: [], commands: [], vars: [], deleteTemplates: [] };

  for (const mod of MODULES) {
    const oldPublishTpl = tpls.find((t) => t.id === `tpl-publish-${mod.key}`);
    const oldLocalTpl = tpls.find((t) => t.id === `tpl-local-${mod.key}`);
    const remotePublish =
      (oldPublishTpl && cmdOf(oldPublishTpl.id, 'publish')) ||
      (oldLocalTpl && cmdOf(oldLocalTpl.id, 'upload')) ||
      null;
    const buildCmd =
      (oldPublishTpl && cmdOf(oldPublishTpl.id, 'build')) ||
      (oldLocalTpl && cmdOf(oldLocalTpl.id, 'build')) ||
      globalBuild;

    for (const e of ENVS) {
      const id = `tpl-${mod.key}-${e.env}`;
      plan.templates.push({
        id,
        moduleKey: mod.key,
        name: `${mod.key} ${e.env} 发布`,
        key: `${mod.key}-${e.env}`,
        env: e.env,
        nodes: nodes(),
      });
      plan.commands.push({ templateId: id, nodeKey: 'git', command: gitCmd });
      if (buildCmd) plan.commands.push({ templateId: id, nodeKey: 'build', command: buildCmd });
      // 发布节点：local 本地投递；dev/prod 远端投递（原 publish 脚本 + 写版本）
      const release =
        e.env === 'local'
          ? localReleaseScript(mod)
          : remotePublish
            ? `${remotePublish.replace(/\s*$/, '\n')}${WRITE_VERSION_BLOCK}`
            : `#!/usr/bin/env bash\nset -euo pipefail\necho "[release] 未配置远程发布脚本，请在本节点补充上传逻辑"\n${WRITE_VERSION_BLOCK}`;
      plan.commands.push({ templateId: id, nodeKey: 'release', command: release });

      const pathValue = e.env === 'local' ? mod.localPath : mod.remotePath;
      plan.vars.push({
        pipelineId: id,
        key: 'PUBLISH_PATH',
        value: pathValue,
        desc: `${mod.key} 在 ${e.env} 的发布路径`,
      });
      if (e.host) {
        plan.vars.push({
          pipelineId: id,
          key: 'PUBLISH_HOST',
          value: e.host,
          desc: `发布目标机（${e.env}）${e.warn ? ' ' + e.warn : ''}`,
        });
        plan.vars.push({
          pipelineId: id,
          key: 'PUBLISH_USER',
          value: e.user,
          desc: `SSH 用户（${e.env}）`,
        });
      }
    }
    if (oldPublishTpl) plan.deleteTemplates.push(oldPublishTpl.id);
    if (oldLocalTpl) plan.deleteTemplates.push(oldLocalTpl.id);
  }

  // 全局默认模板：nodes 收敛为 4 个（保留原节点命令，避免影响未专用模板的模块）
  if (globalTpl) {
    plan.templates.push({
      id: globalTpl.id,
      moduleKey: '*',
      // 原名是 e2e 残留（v5-e2e-xxx），顺手改成可读名
      name: /^v5-e2e-|^e2e-/.test(globalTpl.name) ? '默认流水线' : globalTpl.name,
      key: globalTpl.key,
      env: null,
      nodes: nodes(),
      updateOnly: true,
    });
  }

  // ---- 输出计划 ----
  out(`库: ${db}  模式: ${APPLY ? 'APPLY（写入）' : 'DRY-RUN'}`);
  out(`\n新建/更新模板 ${plan.templates.length} 条：`);
  for (const t of plan.templates) {
    const envTag = t.env ? `env=${t.env}` : 'env=NULL(全局)';
    out(`  ${t.updateOnly ? '[更新]' : '[新建]'} ${t.id.padEnd(24)} ${t.name}  ${envTag}  nodes=${t.nodes.map((n) => n.key).join('→')}`);
  }
  out(`\n节点命令 ${plan.commands.length} 条；流水线变量 ${plan.vars.length} 条：`);
  for (const v of plan.vars) out(`  ${v.pipelineId.padEnd(24)} ${v.key} = ${v.value}`);
  out(`\n删除旧模板 ${plan.deleteTemplates.length} 条：${plan.deleteTemplates.join(', ')}`);

  if (!APPLY) {
    out('\nDRY-RUN 结束（APPLY=1 才写库）');
    await conn.end();
    return;
  }

  // ---- 落库（事务）----
  const now = Date.now();
  await conn.beginTransaction();
  try {
    for (const id of plan.deleteTemplates) {
      await conn.query('DELETE FROM deploy_pipeline_step_commands WHERE template_id = ?', [id]);
      await conn.query('DELETE FROM deploy_pipeline_vars WHERE pipeline_id = ?', [id]);
      await conn.query('DELETE FROM deploy_pipeline_templates WHERE id = ?', [id]);
    }
    // 幂等：先清掉本脚本会创建的那些模板（含节点命令与变量），可重复执行
    const newIds = plan.templates.filter((t) => !t.updateOnly).map((t) => t.id);
    if (newIds.length) {
      const ph = newIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM deploy_pipeline_step_commands WHERE template_id IN (${ph})`, newIds);
      await conn.query(`DELETE FROM deploy_pipeline_vars WHERE pipeline_id IN (${ph})`, newIds);
      await conn.query(`DELETE FROM deploy_pipeline_templates WHERE id IN (${ph})`, newIds);
    }
    for (const t of plan.templates) {
      if (t.updateOnly) {
        await conn.query('UPDATE deploy_pipeline_templates SET nodes = ?, name = ? WHERE id = ?', [
          JSON.stringify(t.nodes),
          t.name,
          t.id,
        ]);
        continue;
      }
      await conn.query(
        `INSERT INTO deploy_pipeline_templates
          (id, module_key, name, \`key\`, env, description, skip_verify, steps, nodes,
           rollback_on_failure, approval, default_target, enabled, builtin, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,0,NULL,?,?,?,?,1,0,?,NOW(6),NOW(6))`,
        [
          t.id,
          t.moduleKey,
          t.name,
          t.key,
          t.env,
          '四节点模型：拉取代码 → 构建 → 发布确认 → 发布',
          JSON.stringify(t.nodes),
          'none',
          'never',
          'auto',
          'migration-p3',
        ],
      );
    }
    for (const c of plan.commands) {
      await conn.query(
        `INSERT INTO deploy_pipeline_step_commands
          (id, template_id, node_key, command, enabled, updated_by, created_at, updated_at)
         VALUES (UUID(),?,?,?,1,'migration-p3',NOW(6),NOW(6))`,
        [c.templateId, c.nodeKey, c.command],
      );
    }
    for (const v of plan.vars) {
      await conn.query(
        'INSERT INTO deploy_pipeline_vars (id, pipeline_id, `key`, value, is_secret, description, enabled, updated_by, created_at, updated_at) VALUES (?,?,?,?,0,?,1,?,?,?)',
        [`pvar-${now}-${Math.random().toString(36).slice(2, 8)}`, v.pipelineId, v.key, v.value, v.desc, 'migration-p3', now, now],
      );
    }
    await conn.commit();
    out('\n✓ 已落库');
  } catch (e) {
    await conn.rollback();
    errOut('✗ 失败已回滚:', e.message);
    process.exitCode = 1;
  }

  // ---- 校验 ----
  const [check] = await conn.query(
    'SELECT id, module_key, env, JSON_LENGTH(nodes) AS n FROM deploy_pipeline_templates ORDER BY module_key, env',
  );
  out('\n校验（模板 → 节点数）:');
  for (const r of check) out(`  ${r.id.padEnd(24)} ${r.module_key.padEnd(10)} ${String(r.env ?? '-').padEnd(6)} nodes=${r.n}`);
  await conn.end();
}

main().catch((e) => {
  errOut(e);
  process.exit(1);
});
