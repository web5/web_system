#!/usr/bin/env node
/**
 * p13：流水线配置完善（幂等，可重跑）
 *
 * ① 配置中心 global 写入 `REPO_URL`（git 代码来源显式化）
 * ② 所有流水线的 git 节点脚本追加「origin 与 REPO_URL 一致性校验 + 回显」
 * ③ admin 两条线合并：release 脚本改为按 `$DEPLOY_ENV` 分支（local=本机 cp / 其他=scp），
 *    删除 `admin-local` 模板及其 step_commands / vars
 *
 * 设计：`specs/pipeline-release-config/design.md`
 * 回退：`/tmp/p13-backup-<ts>.json` 含全部改写前正文与被删模板数据
 *
 * 用法：
 *   DRY_RUN=1 node scripts/migrations/p13-pipeline-release-config.mjs   # 只看计划
 *   node scripts/migrations/p13-pipeline-release-config.mjs
 *   # 默认本机库（127.0.0.1 / root / web_system_deploy）；同步云库时用 MYSQL_* 覆盖
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import { execFileSync } from 'child_process';

const out = (s) => process.stdout.write(s + '\n');
const DRY_RUN = process.env.DRY_RUN === '1';
const REPO_URL = process.env.REPO_URL || 'git@github.com:web5/web_system.git';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'KedouLocal@2026',
  database: process.env.MYSQL_DATABASE || 'web_system_deploy',
  connectTimeout: 10000,
});

/* ── 新增片段 1：git 节点的「代码来源自证」────────────────────────── */
const GIT_INSERT = [
  '',
  'ORIGIN_URL="$(git remote get-url origin)"',
  'echo "[git] origin=$ORIGIN_URL"',
  '',
  '# ①-2 代码来源自证：配置中心 REPO_URL（global）非空时，origin 必须与之完全一致',
  '#      存在意义：历史高危场景 = 发布目录 origin 被改错后照常构建，代码来源在流水线里不可见',
  'if [ -n "${REPO_URL:-}" ] && [ "$ORIGIN_URL" != "$REPO_URL" ]; then',
  '  echo "[git] 代码来源不符: 期望 $REPO_URL 实际 $ORIGIN_URL" >&2',
  '  echo "[git] 处置：核对配置中心 REPO_URL，或修正发布目录的 origin" >&2',
  '  exit 1',
  'fi',
];

/** 在「① 必须有 origin」块之后插入 GIT_INSERT；已插入过则原样返回 */
function patchGitScript(cmd) {
  if (cmd.includes('REPO_URL')) return { cmd, changed: false };
  const eol = cmd.includes('\r\n') ? '\r\n' : '\n';
  const lines = cmd.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes('# ① 必须有 origin'));
  if (start < 0) return { cmd, changed: false, reason: '未找到 origin 校验锚点' };
  let end = start;
  while (end < lines.length && !/^\}\s*$/.test(lines[end])) end++;
  if (end >= lines.length) return { cmd, changed: false, reason: 'origin 校验块不完整' };
  lines.splice(end + 1, 0, ...GIT_INSERT);
  return { cmd: lines.join(eol), changed: true };
}

/* ── 新增片段 2：release 节点按环境分支 ──────────────────────────── */
const RELEASE_SCRIPT = `#!/usr/bin/env bash
# 阶段：release（投递产物 —— 按环境分支，新增环境在 case 里加一段即可，无需新建流水线）
#   local → 本机 cp：<RELEASE_DIR>/servers/gateway/public/static/modules/<key>/<env>/<commit>
#   其他  → 打包 scp 到 PUBLISH_HOST（PUBLISH_USER/KEY/PATH 来自流水线变量）
#           保持远程既有布局 <PUBLISH_PATH>/<commit>（不加 env 子目录，零破坏）
# 职责边界：只"放产物"；生效（切指针 / 后端重启）由后续节点与「环境部署」完成。
# NOTE: never put a multi-byte char right after $VAR (bash single-byte locale).
set -euo pipefail

VER="\${COMMIT_ID##*/}"
[ -n "$VER" ] || { echo "[release] COMMIT_ID 为空，无法确定版本目录" >&2; exit 1; }
SRC="\${BUILD_OUTPUT_DIR:?缺少 BUILD_OUTPUT_DIR（构建产物目录）}"
[ -d "$SRC" ] || { echo "[release] 构建产物不存在: $SRC" >&2; exit 1; }
ENV_ID="\${DEPLOY_ENV:-local}"

case "$ENV_ID" in
  local)
    DST="\${RELEASE_DIR}/servers/gateway/public/static/modules/\${MODULE_KEY}/\${ENV_ID}/\${VER}"
    echo "[release] local delivery: $SRC -> $DST"
    mkdir -p "$DST"
    if [ -n "$(ls -A "$DST" 2>/dev/null)" ]; then
      mv "$DST" "/tmp/trash-\${MODULE_KEY}-\${VER}-\$(date +%s)" || true
      mkdir -p "$DST"
    fi
    cp -R "$SRC"/. "$DST"/
    echo "[release] artifact ready at \${DST}"
    ;;
  *)
    PUBLISH_HOST="\${PUBLISH_HOST:?缺少流水线变量 PUBLISH_HOST（环境 $ENV_ID 的投递目标机）}"
    PUBLISH_USER="\${PUBLISH_USER:-ubuntu}"
    PUBLISH_KEY="\${PUBLISH_KEY:-\$HOME/.ssh/id_ed25519_servers}"
    PUBLISH_PATH="\${PUBLISH_PATH:?缺少流水线变量 PUBLISH_PATH（远端产物根目录）}"
    SSH="ssh -i $PUBLISH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
    SCP="scp -i $PUBLISH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
    TGZ="/tmp/\${MODULE_KEY}-\$(echo "$VER" | tr '/' '-').tgz"
    echo "[release] 打包 $SRC → $TGZ"
    tar czf "$TGZ" -C "$SRC" .
    echo "[release] 投递到 $PUBLISH_USER@$PUBLISH_HOST:$PUBLISH_PATH/$VER"
    $SSH "$PUBLISH_USER@$PUBLISH_HOST" "mkdir -p '$PUBLISH_PATH/$VER'"
    $SCP "$TGZ" "$PUBLISH_USER@$PUBLISH_HOST:/tmp/"
    $SSH "$PUBLISH_USER@$PUBLISH_HOST" \\
      "rm -rf '$PUBLISH_PATH/$VER' && mkdir -p '$PUBLISH_PATH/$VER' && tar xzf '/tmp/\$(basename "$TGZ")' -C '$PUBLISH_PATH/$VER' && rm -f '/tmp/\$(basename "$TGZ")'"
    rm -f "$TGZ"
    echo "[release] 远端产物已就位: $PUBLISH_PATH/$VER"
    ;;
esac
`;

/** bash -n 语法校验（落库前的最后一道闸） */
function bashCheck(name, script) {
  const file = `/tmp/p13-check-${name}-${Date.now()}.sh`;
  fs.writeFileSync(file, script, 'utf-8');
  try {
    execFileSync('bash', ['-n', file], { stdio: 'pipe' });
    return true;
  } catch (e) {
    out(`  [语法错误] ${name}: ${String(e.stderr || e.message).slice(0, 300)}`);
    return false;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const stats = { config: 0, gitPatched: 0, gitSkipped: 0, release: 0, deleted: 0 };
const backup = { at: new Date().toISOString(), config: null, gitScripts: [], release: null, adminLocal: null };

try {
  /* ① REPO_URL（global） */
  const [cfgRows] = await conn.query(
    `SELECT id, \`value\`, enabled FROM config_items WHERE scope='global' AND env_id='' AND module_key='' AND \`key\`='REPO_URL'`,
  );
  backup.config = cfgRows[0] ?? null;
  const needConfig = !cfgRows[0] || cfgRows[0].value !== REPO_URL || !cfgRows[0].enabled;
  if (needConfig) {
    if (!DRY_RUN) {
      await conn.query(
        `INSERT INTO config_items (id, scope, env_id, module_key, \`key\`, \`value\`, is_secret, description, enabled, updated_by, created_at, updated_at)
         VALUES (UUID(), 'global', '', '', 'REPO_URL', ?, 0, 'git 代码来源（发布目录 origin 必须与之完全一致）', 1, 'p13', NOW(), NOW())
         ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), enabled = 1, updated_by = 'p13', updated_at = NOW()`,
        [REPO_URL],
      );
    }
    stats.config = 1;
    out(`① REPO_URL：${cfgRows[0] ? '更新' : '新增'} → ${REPO_URL}`);
  } else {
    out('① REPO_URL：已合规，跳过');
  }

  /* ② git 节点脚本 */
  const [gitRows] = await conn.query(
    `SELECT s.id, p.\`key\` AS pk, s.command FROM deploy_pipeline_step_commands s
       JOIN deploy_pipelines p ON p.id = s.template_id
      WHERE s.node_key = 'git' ORDER BY p.\`key\``,
  );
  const patched = [];
  for (const r of gitRows) {
    const res = patchGitScript(r.command);
    if (!res.changed) {
      stats.gitSkipped++;
      continue;
    }
    if (!bashCheck(`git-${r.pk}`, res.cmd)) continue;
    patched.push({ id: r.id, pk: r.pk, before: r.command, after: res.cmd });
  }
  backup.gitScripts = patched.map((p) => ({ id: p.id, pk: p.pk, before: p.before }));
  if (!DRY_RUN) {
    for (const p of patched) {
      await conn.query(
        `UPDATE deploy_pipeline_step_commands SET command = ?, updated_by = 'p13', updated_at = NOW() WHERE id = ?`,
        [p.after, p.id],
      );
    }
  }
  stats.gitPatched = patched.length;
  out(`② git 脚本：待改 ${patched.length} / 跳过 ${stats.gitSkipped}`);

  /* ③ admin 两条线合并 */
  const [adminRows] = await conn.query(
    `SELECT id, \`key\`, name FROM deploy_pipelines WHERE \`key\` IN ('admin-dev','admin-local')`,
  );
  const dev = adminRows.find((r) => r.key === 'admin-dev');
  const local = adminRows.find((r) => r.key === 'admin-local');
  if (!dev) {
    out('③ 未找到 admin-dev，跳过合并');
  } else {
    const [relRows] = await conn.query(
      `SELECT id, command, actions FROM deploy_pipeline_step_commands WHERE template_id = ? AND node_key = 'release'`,
      [dev.id],
    );
    const rel = relRows[0];
    backup.release = rel
      ? { id: rel.id, command: rel.command, actions: relRows[0].actions }
      : null;
    // 执行体优先级（pickStepActions）：actions 非空 → 用 actions[0].code；否则才用 command 列。
    // 故两处都要改：command 列（页面展示 / 无 actions 时的回退）+ actions 里 shell 操作的 code（真正执行体）。
    const acts = Array.isArray(rel?.actions) ? rel.actions : null;
    const shellOp = acts?.find((a) => a && a.type === 'shell') ?? null;
    const needRelease =
      !rel ||
      !rel.command.includes('case "$ENV_ID"') ||
      (shellOp && !String(shellOp.code || '').includes('case "$ENV_ID"'));
    if (needRelease) {
      if (!bashCheck('release-admin-dev', RELEASE_SCRIPT)) {
        out('③ release 脚本语法校验未通过，已中止该步');
      } else if (!DRY_RUN) {
        if (rel) {
          const nextActions = acts
            ? acts.map((a) => (a && a.type === 'shell' ? { ...a, code: RELEASE_SCRIPT } : a))
            : null;
          await conn.query(
            `UPDATE deploy_pipeline_step_commands SET command = ?, actions = ?, updated_by = 'p13', updated_at = NOW() WHERE id = ?`,
            [RELEASE_SCRIPT, nextActions ? JSON.stringify(nextActions) : null, rel.id],
          );
          out(
            `③ release 执行体：${shellOp ? 'actions[shell].code 已同步（保留其余操作）' : '无 actions，写 command 列'}`,
          );
        } else {
          await conn.query(
            `INSERT INTO deploy_pipeline_step_commands (template_id, node_key, command, actions, enabled, timeout_sec, updated_by, created_at, updated_at, locked)
             VALUES (?, 'release', ?, NULL, 1, 600, 'p13', NOW(), NOW(), 0)`,
            [dev.id, RELEASE_SCRIPT],
          );
        }
      }
      stats.release = 1;
      out(`③ release 脚本：${rel ? '改写为按环境分支' : '新增'}（admin-dev）`);
    } else {
      out('③ release 脚本：已按环境分支，跳过');
    }

    if (local) {
      const [lc] = await conn.query(
        `SELECT id, node_key, command FROM deploy_pipeline_step_commands WHERE template_id = ?`,
        [local.id],
      );
      const [lv] = await conn.query(`SELECT * FROM deploy_pipeline_vars WHERE pipeline_id = ?`, [
        local.id,
      ]);
      backup.adminLocal = { pipeline: local, commands: lc, vars: lv };
      if (!DRY_RUN) {
        await conn.query(`DELETE FROM deploy_pipeline_step_commands WHERE template_id = ?`, [local.id]);
        await conn.query(`DELETE FROM deploy_pipeline_vars WHERE pipeline_id = ?`, [local.id]);
        await conn.query(`DELETE FROM deploy_pipelines WHERE id = ?`, [local.id]);
      }
      stats.deleted = 1;
      out(`③ 删除冗余模板 ${local.id}（${local.name}）：节点命令 ${lc.length} 行 / 变量 ${lv.length} 行`);
    } else {
      out('③ admin-local 不存在（已合并），跳过');
    }
  }

  /* 备份 */
  if (!DRY_RUN) {
    const file = `/tmp/p13-backup-${Date.now()}.json`;
    fs.writeFileSync(file, JSON.stringify(backup, null, 2), 'utf-8');
    out(`备份：${file}`);
  }
  out(
    `p13 完成${DRY_RUN ? '（DRY_RUN，未落库）' : ''}：配置 ${stats.config} / git 脚本 ${stats.gitPatched} / release ${stats.release} / 删除模板 ${stats.deleted}`,
  );
} finally {
  await conn.end();
}
