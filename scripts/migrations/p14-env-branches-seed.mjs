#!/usr/bin/env node
/**
 * p14：给「admin 发布」（admin-dev）的 release 节点启用**环境分支**。
 *
 * 走 console API 保存（与页面编辑器同一条链路：bash -n 校验 → 拼装执行体 →
 * 同时写 command 与 actions[shell].code），因此本脚本同时是接口验收。
 *
 * 分支：local = 本机 cp；dev = 远程 scp（保持 `PUBLISH_PATH/<引用>` 布局，零破坏）
 *
 * 设计：specs/pipeline-env-branch/design.md
 *
 * 用法：
 *   DRY_RUN=1 node scripts/migrations/p14-env-branches-seed.mjs   # 只打印计划
 *   node scripts/migrations/p14-env-branches-seed.mjs
 *   # 鉴权：优先复用 /tmp/console-token.txt，否则用 CONSOLE_USER / CONSOLE_PASS 登录
 */
import fs from 'fs';

const BASE = process.env.CONSOLE_BASE || 'http://localhost:6200';
const TPL_ID = process.env.TPL_ID || 'tpl-admin-dev';
const NODE_KEY = process.env.NODE_KEY || 'release';
const DRY_RUN = process.env.DRY_RUN === '1';
const out = (s) => process.stdout.write(s + '\n');

/* ── 分支脚本：local（本机投递）── */
const LOCAL_BRANCH = `#!/usr/bin/env bash
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

/* ── 分支脚本：dev（远程投递，保持既有布局 PUBLISH_PATH/<引用>）── */
const DEV_BRANCH = `#!/usr/bin/env bash
# dev：打包 → scp → 目标机解包到 PUBLISH_PATH/COMMIT_ID
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

const BRANCHES = { local: LOCAL_BRANCH, dev: DEV_BRANCH };

async function getToken() {
  if (fs.existsSync('/tmp/console-token.txt')) {
    const t = fs.readFileSync('/tmp/console-token.txt', 'utf8').trim();
    if (t) return t;
  }
  const user = process.env.CONSOLE_USER;
  const pass = process.env.CONSOLE_PASS;
  if (!user || !pass) throw new Error('缺少鉴权：提供 /tmp/console-token.txt 或 CONSOLE_USER / CONSOLE_PASS');
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const j = await r.json();
  const token = j.access_token || j.token;
  if (!token) throw new Error('登录失败: ' + JSON.stringify(j).slice(0, 200));
  return token;
}

const token = await getToken();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const url = `${BASE}/api/pipeline-templates/${TPL_ID}/steps/${NODE_KEY}`;

const before = await (await fetch(url, { headers: H })).json();
out(`当前状态：envBranches=${before?.envBranches ? Object.keys(before.envBranches).join('、') : '未启用'}`);

if (DRY_RUN) {
  out(`DRY_RUN：将写入环境分支 ${Object.keys(BRANCHES).join('、')}（未执行）`);
  process.exit(0);
}

const res = await fetch(url, {
  method: 'PUT',
  headers: H,
  body: JSON.stringify({ envBranches: BRANCHES }),
});
const body = await res.text();
if (!res.ok) {
  out(`保存失败 ${res.status}: ${body.slice(0, 400)}`);
  process.exit(1);
}
const saved = JSON.parse(body);
const cmd = saved?.command || '';
const shellOp = (saved?.actions ?? []).find((a) => a?.type === 'shell');
out(`保存成功：envBranches=${Object.keys(saved?.envBranches ?? {}).join('、')}`);
out(`  command 列含拼装标记 : ${cmd.includes('__branch_')}`);
out(`  actions[shell].code  : ${!!shellOp && String(shellOp.code || '').includes('__branch_')}`);
out(`  其余操作保留         : ${(saved?.actions ?? []).filter((a) => a?.type !== 'shell').map((a) => a.tool || a.name).join('、') || '（无）'}`);
out(`  未配环境 fail-fast   : ${cmd.includes('未配置发布脚本') && cmd.includes('exit 1')}`);

fs.writeFileSync(
  `/tmp/p14-backup-${Date.now()}.json`,
  JSON.stringify({ tplId: TPL_ID, nodeKey: NODE_KEY, before }, null, 2),
  'utf-8',
);
out('改写前状态已备份到 /tmp/p14-backup-*.json');
