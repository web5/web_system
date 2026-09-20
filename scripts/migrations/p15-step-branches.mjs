#!/usr/bin/env node
/**
 * p15：把「admin 发布」release 步骤的环境分支配置（旧 env_branches）
 *      迁移为**步骤任务**实体（deploy_pipeline_step_branches）。
 *
 * 走 console API 保存（与页面同一条校验链路：bash -n + 条件表达式校验）。
 *
 * 映射：
 *   local → 条件任务（DEPLOY_ENV == local），脚本 = 本机 cp
 *   dev   → **默认任务**（condition=null），脚本 = 远程 scp（承接原「其他一律 scp」的兜底语义）
 *
 * 设计：specs/pipeline-step-branch/design.md §6
 *
 * 用法：
 *   DRY_RUN=1 node scripts/migrations/p15-step-branches.mjs
 *   node scripts/migrations/p15-step-branches.mjs
 */
import fs from 'fs';

const BASE = process.env.CONSOLE_BASE || 'http://localhost:6200';
const TPL = process.env.TPL_ID || 'tpl-admin-dev';
const NODE = process.env.NODE_KEY || 'release';
const DRY_RUN = process.env.DRY_RUN === '1';
const out = (s) => process.stdout.write(s + '\n');

const LOCAL_SCRIPT = `#!/usr/bin/env bash
# local：本机投递 → <RELEASE_DIR>/servers/gateway/public/static/modules/<key>/<env>/<commit>
set -euo pipefail
VER="\${COMMIT_ID##*/}"
[ -n "$VER" ] || { echo "[release] COMMIT_ID 为空，无法确定版本目录" >&2; exit 1; }
SRC="\${BUILD_OUTPUT_DIR:?缺少 BUILD_OUTPUT_DIR（构建产物目录）}"
[ -d "$SRC" ] || { echo "[release] 构建产物不存在: $SRC" >&2; exit 1; }
ENV_ID="\${DEPLOY_ENV:-local}"
DST="\${RELEASE_DIR}/servers/gateway/public/static/modules/\${MODULE_KEY}/\${ENV_ID}/\${VER}"
echo "[release] local delivery: $SRC -> $DST"
mkdir -p "$DST"
if [ -n "$(ls -A "$DST" 2>/dev/null)" ]; then
  mv "$DST" "/tmp/trash-\${MODULE_KEY}-\${VER}-\$(date +%s)" || true
  mkdir -p "$DST"
fi
cp -R "$SRC"/. "$DST"/
echo "[release] artifact ready at \${DST}"
`;

const DEV_SCRIPT = `#!/usr/bin/env bash
# dev（默认任务）：打包 → scp → 目标机解包到 PUBLISH_PATH/COMMIT_ID
set -euo pipefail
PUBLISH_HOST="\${PUBLISH_HOST:?缺少流水线变量 PUBLISH_HOST}"
PUBLISH_USER="\${PUBLISH_USER:-ubuntu}"
PUBLISH_KEY="\${PUBLISH_KEY:-\$HOME/.ssh/id_ed25519_servers}"
PUBLISH_PATH="\${PUBLISH_PATH:?缺少流水线变量 PUBLISH_PATH}"
VER="\${COMMIT_ID:?COMMIT_ID 为空，无法确定版本目录}"
SRC="\${BUILD_OUTPUT_DIR:?构建产物目录未注入}"
[ -d "$SRC" ] || { echo "[release] 构建产物不存在: $SRC" >&2; exit 1; }
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
`;

const BRANCHES = [
  { name: 'local', label: '本机投递', condition: 'DEPLOY_ENV == local', script: LOCAL_SCRIPT, sort: 0 },
  { name: 'dev', label: '远程投递（默认）', condition: null, script: DEV_SCRIPT, sort: 99 },
];

async function getToken() {
  if (fs.existsSync('/tmp/console-token.txt')) {
    const t = fs.readFileSync('/tmp/console-token.txt', 'utf8').trim();
    if (t) return t;
  }
  throw new Error('缺少 /tmp/console-token.txt（先登录 console 取 token）');
}
const token = await getToken();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const stepUrl = `${BASE}/api/pipeline-templates/${TPL}/steps/${NODE}`;
const brUrl = `${stepUrl}/branches`;

const beforeStep = await (await fetch(stepUrl, { headers: H })).json();
const beforeBranches = await (await fetch(brUrl, { headers: H })).json();
out(`迁移前：任务 ${beforeBranches.length} 条；envBranches=${beforeStep?.envBranches ? '有' : '无'}`);

if (DRY_RUN) {
  out(`DRY_RUN：将写入任务 ${BRANCHES.map((b) => b.name + (b.condition ? `(${b.condition})` : '(默认)')).join('、')}`);
  process.exit(0);
}

const res = await fetch(brUrl, { method: 'PUT', headers: H, body: JSON.stringify({ branches: BRANCHES }) });
const body = await res.text();
if (!res.ok) {
  out(`写入任务失败 ${res.status}: ${body.slice(0, 400)}`);
  process.exit(1);
}
const saved = JSON.parse(body);
out(`已写入任务：${saved.map((b) => `${b.name}${b.condition ? `(${b.condition})` : '(默认)'}`).join('、')}`);

// 清空旧的环境分支配置（已被任务实体取代），保留 actions 中的 write-version
const cl = await fetch(stepUrl, { method: 'PUT', headers: H, body: JSON.stringify({ envBranches: null }) });
out(`清空旧 env_branches: ${cl.status}`);

const after = await (await fetch(stepUrl, { headers: H })).json();
const acts = after?.actions ?? [];
out(`回读：actions=${acts.map((a) => a.type + (a.tool ? `(${a.tool})` : '')).join('、') || '（无）'}`);
out(`       envBranches=${after?.envBranches ? '仍有（异常）' : '已清空'}`);

fs.writeFileSync(
  `/tmp/p15-backup-${Date.now()}.json`,
  JSON.stringify({ tpl: TPL, node: NODE, beforeStep, beforeBranches }, null, 2),
  'utf-8',
);
out('迁移前状态已备份到 /tmp/p15-backup-*.json');
