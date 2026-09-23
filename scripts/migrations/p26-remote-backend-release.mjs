#!/usr/bin/env node
/**
 * p26：后端**远端**（dev/prod）发布补齐「生效 + 验证」两条动作（`specs/remote-backend-release/design.md` B1）。
 *
 * 背景：模板的 `dev` 分支任务只有「发布 + write-version」，没有 `restart` / `verify`
 * （`local` 分支 10 条模板有）。而 2026-09-21 起控制台也移除了独立「部署」入口，
 * 于是 dev 上后端发布**只投递、不生效**：目标机 dist 不换、进程不重启，
 * 版本指针却已前进 → 状态撕裂（实测 2026-09-23，system-service）。
 *
 * 本迁移新增两条**远端变体**动作，并挂到目标模块的 `dev` 分支任务上（B1 = 只挂 system-service）：
 *   1. `restart · 落地并重启（后端，远端）`：ssh 到目标机 → 守卫 → dist.bak → 版本目录→dist
 *      → 解析真实 pm2 名（`web-*` vs 短名）→ 重启；**失败即回滚 dist 并重启旧版本**。
 *   2. `verify · 部署验证（后端，远端）`：远端进程 online **轮询** + 端口 TCP **轮询**
 *      （禁止固定 sleep：dev 上冷启动实测约 14s，固定 7s 会误判失败）。
 * 通过后才由平台推进版本指针；任一步失败 ⇒ 流水线 failed 且指针不前进。
 *
 * 为什么远端版不能照抄 local 版：
 *   - local 版直接操作 `${RELEASE_DIR}/servers/<dir>` 与本地 pm2；远端必须经 ssh；
 *   - local 版用 `pm2 delete + start` 干净重启（规避历史 `--update-env` 污染）；
 *     目标机的 pm2 记录是**手工起始**的（脚本路径/cwd 与仓库声明不完全一致），
 *     删了重建可能改变启动参数、甚至造出重复实例抢端口 → 远端改为
 *     `pm2 restart <解析名>`（不加 `--update-env`，pm2 沿用自身记录，等价干净语义），
 *     仅当进程不存在时才 `pm2 start`。这条差异见 design.md §4.1 / Q3。
 *
 * 幂等：按（任务 + 动作名）判定，已存在则更新正文。
 * 回退：`ROLLBACK=1 node scripts/migrations/p26-remote-backend-release.mjs`（删除本迁移挂的动作用）
 *       `DRY_RUN=1 ...` 只打印不写库（按 Q4：动库前先打印将变更的行）
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

/**
 * 作用模块：默认只挂 system-service（B1/B2 试点）；
 * B3 推广时用 `MODULES=gateway,upload-service,... node scripts/migrations/p26-...mjs` 一次性铺开
 * （各模板都已有 PUBLISH_* 变量）。
 */
const MODULES = (process.env.MODULES || 'system-service')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const SYNC_NAME = 'sync · 目标机代码与依赖（远端）';
const RESTART_NAME = 'restart · 落地并重启（后端，远端）';
const VERIFY_NAME = 'verify · 部署验证（后端，远端）';

/**
 * sync（远端）：目标机仓库对齐发布分支 + workspace 包按指纹重建 + `.env` 必需变量前置校验。
 *
 * 三条都来自 2026-09-23 的真实事故：
 *   ① 流水线 git/build 节点只在**本机发布目录**跑，目标机仓库停在旧提交
 *      → 新产物 require 新的包导出得到 undefined（实例：`SERVICE_URL_DEFAULTS.auth` → TypeError）；
 *   ② 目标机 packages 下各包的 dist 不随发布重建，同样"新产物 + 旧依赖"；
 *   ③ 新产物在 production 下要求 `.env` 显式配置服务地址（`AUTH_SERVICE_URL`），
 *      缺失时启动即退、pm2 崩溃循环 —— 必须在**换 dist 之前** fail-fast。
 */
const SYNC_SCRIPT = `#!/usr/bin/env bash
# 发布流水线 · sync（后端，远端）：目标机代码对齐 + 依赖重建（指纹短路）+ .env 前置校验。
# 排在「发布」之后、「restart」之前：先让目标机环境与服务产物同源，再换 dist。
#
# 平台注入变量：MODULE_KEY / MODULE_DIR / MODULE_TYPE / BRANCH / COMMIT_ID / DEPLOY_ENV /
#               PUBLISH_HOST / PUBLISH_USER / PUBLISH_KEY / PUBLISH_PATH
# 可选：REMOTE_DEPS_PACKAGES（默认 "shared types mcp-core agent-core agent-message"）
set -uo pipefail
[ "\${MODULE_TYPE:-}" = "backend" ] || { echo "[sync-remote] 非后端模块，跳过"; exit 0; }
if [ "\${DEPLOY_ENV:-}" = "local" ]; then
  echo "[sync-remote] DEPLOY_ENV=local：local 分支不需要目标机同步，跳过"
  exit 0
fi
: "\${PUBLISH_HOST:?缺少 PUBLISH_HOST}" "\${PUBLISH_PATH:?缺少 PUBLISH_PATH}" "\${BRANCH:?缺少 BRANCH}"

RUSER="\${PUBLISH_USER:-ubuntu}"
RKEY="\${PUBLISH_KEY:-\$HOME/.ssh/id_ed25519_servers}"
# 目标机仓库根 = PUBLISH_PATH（.../servers/<dir>）向上两级
RROOT="\$(dirname "\$(dirname "\${PUBLISH_PATH}")")"
DIR="\${MODULE_DIR:-\${MODULE_KEY}}"
PKGS="\${REMOTE_DEPS_PACKAGES:-shared types mcp-core agent-core agent-message}"
# 生产必需变量（与 packages/shared/src/services.ts 的 REQUIRED_SERVICE_URLS_IN_PROD 对齐）
REQ="\${REMOTE_REQUIRED_PROD_ENV:-AUTH_SERVICE_URL}"
rssh() { ssh -i "\${RKEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes "\$@"; }

FETCHTO="\${SYNC_FETCH_TIMEOUT:-300}"
if rssh "\${RUSER}@\${PUBLISH_HOST}" "RROOT='\${RROOT}' BRANCH='\${BRANCH}' DIR='\${DIR}' PKGS='\${PKGS}' REQ='\${REQ}' FETCHTO='\${FETCHTO}' bash -s" <<'EOS'
set -uo pipefail
sdie() { echo "[sync-remote] \$*" >&2; exit 1; }
cd "\$RROOT" || sdie "目标机仓库根不存在：\$RROOT"

# ── ① 目标机代码对齐发布分支（不 clean：版本目录等未跟踪文件必须保留）──
echo "[sync-remote] 目标机原状态：\$(git rev-parse --short HEAD 2>/dev/null) @ \$(git branch --show-current 2>/dev/null)"
# git 远端加固（2026-09-23 实测：不加这几项会"看起来卡住"）：
#   - GIT_TERMINAL_PROMPT=0：绝不交互提问 —— heredoc 已占用 stdin，一旦提问就是静默挂死
#   - GIT_SSH_COMMAND：BatchMode + ConnectTimeout，宁可快失败也不要干等
#   - timeout + --progress：给明确死线，并**保留进度输出**（否则日志长时间空着，误判为卡死）
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10"
T0=\$(date +%s)
if ! timeout "\$FETCHTO" git fetch --prune --progress origin; then
  sdie "git fetch 失败或超时（\${FETCHTO}s）—— 检查目标机 github 凭据与网络"
fi
echo "[sync-remote] fetch 完成（耗时 \$(( \$(date +%s) - T0 ))s）"
git checkout -B "\$BRANCH" "origin/\$BRANCH" >/dev/null 2>&1 || sdie "git checkout -B \$BRANCH 失败"
git reset --hard "origin/\$BRANCH" >/dev/null 2>&1 || sdie "git reset --hard 失败"
echo "[sync-remote] 目标机代码已对齐：\$(git rev-parse --short HEAD) @ \$BRANCH（未 clean）"

# ── ② .env 必需变量前置校验（production 才校验）──
ENVF="\$RROOT/servers/\$DIR/.env"
if [ -f "\$ENVF" ]; then
  NENV="\$(sed -n 's/^NODE_ENV=//p' "\$ENVF" | head -1 | tr -d '\r')"
  if [ "\$NENV" = "production" ]; then
    for k in \$REQ; do
      # 注意：这里必须写成 \${k}（JS 模板里是 \\\${k}），写成 \\\$k 会被 bash 当字面 \$ 而
      # sed 永远匹配不到 → 假阴性（2026-09-23 实际踩到：明明配了却报"缺少必需变量"）
      v="\$(grep -m1 "^\${k}=" "\$ENVF" | cut -d= -f2- | tr -d '\r')"
      [ -n "\$v" ] || sdie "\$DIR/.env 缺少生产必需变量 \$k —— 新产物会启动即退（fail-fast）；请在目标机 .env 显式配置后重发（本次不换 dist、不重启）"
    done
    echo "[sync-remote] .env 必需变量校验通过：\$REQ"
  else
    echo "[sync-remote] NODE_ENV=\${NENV:-未设置}，跳过必需变量校验"
  fi
else
  echo "[sync-remote] [WARN] 未找到 \$ENVF，跳过必需变量校验"
fi

# ── ③ workspace 包按指纹重建（指纹未变则跳过；服务运行时 require 这些包）──
# 指纹口径 = lock + 各包 **src 与 package.json**。
# 刻意不含 dist/、tsbuildinfo：它们是构建产物，算进去会导致"构建→指纹变→再构建"的自我触发
#（2026-09-23 实际踩到：整目录 tar 让第二次运行仍判定变化）。
FP_FILE="\$RROOT/.deps-fingerprint"
SRC_PATHS=""
for p in \$PKGS; do
  [ -d "\$RROOT/packages/\$p/src" ] && SRC_PATHS="\$SRC_PATHS \$p/src"
  [ -f "\$RROOT/packages/\$p/package.json" ] && SRC_PATHS="\$SRC_PATHS \$p/package.json"
done
FP="\$( { cat "\$RROOT/pnpm-lock.yaml" 2>/dev/null; tar -cf - -C "\$RROOT/packages" \$SRC_PATHS 2>/dev/null; } | md5sum | awk '{print \$1}' )"
OLD="\$(cat "\$FP_FILE" 2>/dev/null || echo none)"
if [ "\$FP" = "\$OLD" ]; then
  echo "[sync-remote] 依赖指纹未变（\$FP），跳过包重建"
else
  echo "[sync-remote] 依赖指纹变化（\$OLD → \$FP），重建 workspace 包：\$PKGS"
  for p in \$PKGS; do
    [ -d "\$RROOT/packages/\$p" ] || { echo "[sync-remote] 跳过不存在的包：\$p"; continue; }
    echo "[sync-remote] pnpm --filter ./packages/\$p build"
    if ! pnpm --filter "./packages/\$p" build >"/tmp/deps-\$p.log" 2>&1; then
      echo "[sync-remote] --- \$p 构建日志尾部 ---"
      tail -15 "/tmp/deps-\$p.log" >&2 || true
      sdie "workspace 包重建失败：\$p（未换 dist、未重启）"
    fi
  done
  echo "\$FP" > "\$FP_FILE"
  echo "[sync-remote] 包重建完成，指纹已写入 \$FP_FILE"
fi
EOS
then
  echo "[sync-remote] 目标机代码与依赖同步完成"
  exit 0
fi

# 必须检查 ssh 退出码：早期版本忘了检查，远端 fail-fast 却仍打印"同步完成"
# → 后面的 restart 会在「旧依赖 + 新产物」上撞车（2026-09-23 同类 bug 在 verify 上也出现过）。
echo "[sync-remote] 失败：目标机代码/依赖同步未通过（见上方 [sync-remote] 输出）—— 本次不换 dist、不重启" >&2
exit 1
`;

const RESTART_SCRIPT = `#!/usr/bin/env bash
# 发布流水线 · restart（后端，远端）：目标机 版本目录 → dist + pm2 重启；失败回滚 dist。
#
# 平台注入变量：MODULE_KEY / MODULE_DIR / MODULE_TYPE / COMMIT_ID / DEPLOY_ENV / PM2_NAME /
#               PM2_SCRIPT / PORT / PUBLISH_HOST / PUBLISH_USER / PUBLISH_KEY / PUBLISH_PATH
# （PUBLISH_PATH = 目标机上的**服务目录**，如 /data/web_system/servers/system-service；
#   COMMIT_ID 形如 system-service-dev/3d5ce61，故版本目录 = \$PUBLISH_PATH/\$COMMIT_ID）
set -uo pipefail
[ "\${MODULE_TYPE:-}" = "backend" ] || { echo "[restart-remote] MODULE_TYPE=\${MODULE_TYPE:-未设置}，非后端模块，跳过"; exit 0; }
if [ "\${DEPLOY_ENV:-}" = "local" ]; then
  echo "[restart-remote] DEPLOY_ENV=local：local 分支有专用动作，本动作跳过"
  exit 0
fi
: "\${PUBLISH_HOST:?缺少 PUBLISH_HOST（流水线变量）}" \\
  "\${PUBLISH_PATH:?缺少 PUBLISH_PATH}" \\
  "\${COMMIT_ID:?缺少 COMMIT_ID}" \\
  "\${MODULE_KEY:?缺少 MODULE_KEY}"

RUSER="\${PUBLISH_USER:-ubuntu}"
RKEY="\${PUBLISH_KEY:-\$HOME/.ssh/id_ed25519_servers}"
SVC="\${PUBLISH_PATH}"
VER="\${PUBLISH_PATH}/\${COMMIT_ID}"
NAME="\${PM2_NAME:-web-\${MODULE_KEY}}"
FB="\${MODULE_KEY}"
SCRIPT="\${PM2_SCRIPT:-dist/main.js}"
# 注意：必须是**函数**而不是变量 —— 写成 SSH="ssh -i ..." 再 "\\$SSH" host 的话，
# bash 会把整串当一个命令名，报 "No such file or directory"（2026-09-23 实际踩到）。
rssh() { ssh -i "\${RKEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes "\$@"; }
die() { echo "[restart-remote] \$*" >&2; exit 1; }

# ── 远端：守卫 → 备份 → 落地 → 解析进程名 → 重启 ──
if rssh "\${RUSER}@\${PUBLISH_HOST}" "NAME='\${NAME}' FB='\${FB}' SVC='\${SVC}' VER='\${VER}' SCRIPT='\${SCRIPT}' bash -s" <<'EOS'
set -uo pipefail
rdie() { echo "[restart-remote] \$*" >&2; exit 1; }
[ -d "\$VER" ] || rdie "远端版本目录不存在：\$VER（投递节点是否成功）"
[ -n "\$(ls -A "\$VER" | grep -v '\\.tsbuildinfo\$' || true)" ] || rdie "远端版本目录没有有效产物：\$VER"
cd "\$SVC" || rdie "远端服务目录不存在：\$SVC"
STAMP=\$(date +%s)
if [ -d dist ]; then mv dist "dist.bak-\$STAMP" || rdie "备份 dist 失败"; echo "[restart-remote] dist → dist.bak-\$STAMP"; fi
mkdir -p dist && cp -a "\$VER"/. dist/ || rdie "落地 dist 失败"
ls -1dt dist.bak-* 2>/dev/null | tail -n +4 | xargs -r rm -rf   # 只留最近 3 份
# 解析目标机上真实存在的进程名：候选 \$NAME（web-*）→ \$FB（短名）
RESOLVED=""
for cand in "\$NAME" "\$FB"; do
  if pm2 describe "\$cand" >/dev/null 2>&1; then RESOLVED="\$cand"; break; fi
done
if [ -n "\$RESOLVED" ]; then
  pm2 restart "\$RESOLVED" >/dev/null 2>&1 || rdie "pm2 restart \${RESOLVED} 失败"
  echo "[restart-remote] 已重启（in-place，未加 --update-env）：\$RESOLVED"
else
  pm2 start "\$SCRIPT" --name "\$NAME" --cwd "\$SVC" >/dev/null 2>&1 || rdie "pm2 start 失败（进程不存在：候选 \$NAME / \$FB）"
  echo "[restart-remote] 目标机原先无该进程，已新建：\$NAME"
fi
pm2 save >/dev/null 2>&1 || true
EOS
then
  echo "[restart-remote] 落地并重启完成：\${MODULE_KEY}@\${COMMIT_ID}"
  exit 0
fi

echo "[restart-remote] 远端失败 → 回滚 dist 并重启旧版本" >&2
# 回滚要点（2026-09-23 实测教训，两条都踩过）：
#   ① 只「pm2 restart」不够：目标机出现过 restart 后仍不监听，必须能退回**干净启动**
#      （delete + start，用 pm2 记录里的 script/cwd）；
#   ② 必须打印远端 pm2 错误日志尾部，否则排查很费时（本次真因：新产物在 production
#      下要求 .env 显式配 AUTH_SERVICE_URL —— fail-fast 设计如此，是 .env 缺配置）。
rssh "\${RUSER}@\${PUBLISH_HOST}" "NAME='\${NAME}' FB='\${FB}' SVC='\${SVC}' SCRIPT='\${SCRIPT}' bash -s" <<'EOS' || true
set -uo pipefail
cd "\$SVC" || exit 1
LAST="\$(ls -1dt dist.bak-* 2>/dev/null | head -1)"
if [ -n "\$LAST" ]; then rm -rf dist && mv "\$LAST" dist && echo "[restart-remote] 已回滚 dist ← \$LAST"; fi
RESOLVED=""
for cand in "\$NAME" "\$FB"; do pm2 describe "\$cand" >/dev/null 2>&1 && { RESOLVED="\$cand"; break; }; done
RESOLVED="\${RESOLVED:-\$NAME}"
pm2 delete "\$RESOLVED" >/dev/null 2>&1 || true
pm2 start "\$SCRIPT" --name "\$RESOLVED" --cwd "\$SVC" >/dev/null 2>&1 || echo "[restart-remote] [WARN] pm2 start 失败：\$RESOLVED" >&2
pm2 save >/dev/null 2>&1 || true
st=""
for _ in \$(seq 1 10); do
  st="\$(pm2 jlist 2>/dev/null | RESOLVED="\$RESOLVED" python3 -c '
import sys, json, os
try:
    procs = {p["name"]: (p.get("pm2_env") or {}).get("status") for p in json.load(sys.stdin)}
except Exception:
    sys.exit(0)
print(procs.get(os.environ["RESOLVED"], ""))
' 2>/dev/null)"
  [ "\$st" = "online" ] && break
  sleep 2
done
echo "[restart-remote] 回滚后进程状态：\${RESOLVED} = \${st:-未知}"
echo "[restart-remote] --- 远端 pm2 错误日志尾部（排查用）---"
tail -15 "\$HOME/.pm2/logs/\${RESOLVED}-error.log" 2>/dev/null || true
EOS
die "远端落地/重启失败：\${MODULE_KEY}@\${COMMIT_ID}（已回滚 dist，见上方远端状态与日志）"
`;

const VERIFY_SCRIPT = `#!/usr/bin/env bash
# 发布流水线 · verify（后端，远端）：远端进程 online → 端口 TCP（**轮询 + 超时**）。
# 为什么必须轮询：dev 上 Nest 冷启动实测约 14s，固定 sleep 会误判失败。
# 通过后由平台推进版本指针；不通过 ⇒ 退出非 0 ⇒ 指针不前进（旧版本继续服务）。
#
# 平台注入变量：MODULE_KEY / MODULE_TYPE / COMMIT_ID / DEPLOY_ENV / PM2_NAME / PORT /
#               PUBLISH_HOST / PUBLISH_USER / PUBLISH_KEY / PUBLISH_PATH / REMOTE_ONLINE_WAIT_TRIES
set -uo pipefail
[ "\${MODULE_TYPE:-}" = "backend" ] || { echo "[verify-remote] 非后端模块，跳过"; exit 0; }
if [ "\${DEPLOY_ENV:-}" = "local" ]; then
  echo "[verify-remote] DEPLOY_ENV=local：local 分支有专用动作，本动作跳过"
  exit 0
fi
: "\${PUBLISH_HOST:?缺少 PUBLISH_HOST}" "\${PUBLISH_PATH:?缺少 PUBLISH_PATH}" "\${MODULE_KEY:?缺少 MODULE_KEY}"

RUSER="\${PUBLISH_USER:-ubuntu}"
RKEY="\${PUBLISH_KEY:-\$HOME/.ssh/id_ed25519_servers}"
SVC="\${PUBLISH_PATH}"
NAME="\${PM2_NAME:-web-\${MODULE_KEY}}"
FB="\${MODULE_KEY}"
SCRIPT="\${PM2_SCRIPT:-dist/main.js}"
PORT="\${PORT:-}"
TRIES="\${REMOTE_ONLINE_WAIT_TRIES:-15}"   # 15 × 2s = 30s
# 同 restart：ssh 必须走函数，不能用带引号的变量拼接
rssh() { ssh -i "\${RKEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes "\$@"; }

if rssh "\${RUSER}@\${PUBLISH_HOST}" "NAME='\${NAME}' FB='\${FB}' PORT='\${PORT}' TRIES='\${TRIES}' bash -s" <<'EOS'
set -uo pipefail
vdie() { echo "[verify-remote] \$*" >&2; exit 1; }
RESOLVED=""
for cand in "\$NAME" "\$FB"; do
  if pm2 describe "\$cand" >/dev/null 2>&1; then RESOLVED="\$cand"; break; fi
done
[ -n "\$RESOLVED" ] || vdie "目标机上找不到进程（候选：\$NAME / \$FB）"
ST=""
i=0
while [ "\$i" -lt "\$TRIES" ]; do
  ST="\$(pm2 jlist 2>/dev/null | RESOLVED="\$RESOLVED" python3 -c '
import sys, json, os
try:
    procs = {p["name"]: (p.get("pm2_env") or {}).get("status") for p in json.load(sys.stdin)}
except Exception:
    sys.exit(0)
print(procs.get(os.environ["RESOLVED"], ""))
' 2>/dev/null)"
  [ "\$ST" = "online" ] && break
  i=\$((i + 1)); sleep 2
done
[ "\$ST" = "online" ] || vdie "进程未 online：\${RESOLVED}（status=\${ST:-未知}，已等 \$((TRIES*2))s）"
echo "[verify-remote] 进程在线：\$RESOLVED"
if [ -n "\$PORT" ]; then
  ok=0
  for _ in \$(seq 1 15); do
    if (exec 3<>"/dev/tcp/127.0.0.1/\${PORT}") 2>/dev/null; then ok=1; break; fi
    sleep 2
  done
  [ "\$ok" = "1" ] || vdie "端口探活失败：127.0.0.1:\${PORT}（进程 online 但端口不响应，排查：lsof -tiTCP:\${PORT} -sTCP:LISTEN）"
  echo "[verify-remote] 端口探活 \${PORT} 通过"
else
  echo "[verify-remote] [WARN] PORT 未解析，降级为进程状态验证"
fi
EOS
then
  echo "[verify-remote] 验证通过：\${MODULE_KEY}@\${COMMIT_ID}"
  exit 0
fi

# 验证失败 = 新产物不可用：**必须回滚 dist 并重启旧版本**，否则目标机会停在崩溃循环上
# （2026-09-23 实测：verify 若不回滚，服务会一直 crash-loop、端口无监听）。
# 注意：这里必须检查 ssh 的退出码 —— 早期版本忘了检查，端口探活失败却打印"验证通过"。
echo "[verify-remote] 验证未通过 → 回滚 dist 并重启旧版本" >&2
rssh "\${RUSER}@\${PUBLISH_HOST}" "NAME='\${NAME}' FB='\${FB}' SVC='\${SVC}' SCRIPT='\${SCRIPT}' bash -s" <<'EOS' || true
set -uo pipefail
cd "\$SVC" || exit 1
LAST="\$(ls -1dt dist.bak-* 2>/dev/null | head -1)"
if [ -n "\$LAST" ]; then rm -rf dist && mv "\$LAST" dist && echo "[verify-remote] 已回滚 dist ← \$LAST"; fi
RESOLVED=""
for cand in "\$NAME" "\$FB"; do pm2 describe "\$cand" >/dev/null 2>&1 && { RESOLVED="\$cand"; break; }; done
RESOLVED="\${RESOLVED:-\$NAME}"
pm2 delete "\$RESOLVED" >/dev/null 2>&1 || true
pm2 start "\$SCRIPT" --name "\$RESOLVED" --cwd "\$SVC" >/dev/null 2>&1 || echo "[verify-remote] [WARN] pm2 start 失败：\$RESOLVED" >&2
pm2 save >/dev/null 2>&1 || true
st=""
for _ in \$(seq 1 10); do
  st="\$(pm2 jlist 2>/dev/null | RESOLVED="\$RESOLVED" python3 -c '
import sys, json, os
try:
    procs = {p["name"]: (p.get("pm2_env") or {}).get("status") for p in json.load(sys.stdin)}
except Exception:
    sys.exit(0)
print(procs.get(os.environ["RESOLVED"], ""))
' 2>/dev/null)"
  [ "\$st" = "online" ] && break
  sleep 2
done
echo "[verify-remote] 回滚后进程状态：\${RESOLVED} = \${st:-未知}"
echo "[verify-remote] --- 远端 pm2 错误日志尾部（排查用）---"
tail -15 "\$HOME/.pm2/logs/\${RESOLVED}-error.log" 2>/dev/null || true
EOS
echo "[verify-remote] 失败：\${MODULE_KEY}@\${COMMIT_ID}（已回滚 dist，版本指针不前进）" >&2
exit 1
`;

/** 语法自检：坏脚本一次等于该模块发不上去（与流水线编辑器保存时同口径） */
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

  console.log(`${ROLLBACK ? '回退' : '应用'} p26（远端后端发布：restart/verify）`);
  console.log(`范围：${MODULES.join(', ')} 的 dev 分支任务\n`);
  if (!DRY_RUN && !ROLLBACK) {
    console.log('将变更的行（按 Q4：动库前先打印）：');
    for (const m of MODULES) {
      console.log(`  + ${m}: 新增/更新动作「${SYNC_NAME}」「${RESTART_NAME}」「${VERIFY_NAME}」`);
    }
    console.log('');
  }

  let changed = 0;
  let skipped = 0;

  for (const mod of MODULES) {
    const tpl = `tpl-${mod}-dev`;
    const [tasks] = await conn.query(
      'SELECT t.id, t.name, t.sort FROM deploy_pipeline_tasks t ' +
        'JOIN deploy_pipeline_steps s ON s.id = t.step_id ' +
        'WHERE s.pipeline_id = ? AND t.name = ? ORDER BY t.sort LIMIT 1',
      [tpl, 'dev'],
    );
    if (!tasks.length) {
      console.log(`- ${tpl}: 找不到名为 dev 的分支任务，跳过（模板结构变化？）`);
      skipped++;
      continue;
    }
    const taskId = tasks[0].id;

    if (ROLLBACK) {
      const [del] = await conn.query(
        'DELETE FROM deploy_pipeline_actions WHERE task_id = ? AND name IN (?, ?)',
        [taskId, RESTART_NAME, VERIFY_NAME],
      );
      console.log(`- ${tpl} / dev: 删除动作 ${del.affectedRows} 条`);
      changed += del.affectedRows;
      continue;
    }

    const [existing] = await conn.query('SELECT id, name, script, sort FROM deploy_pipeline_actions WHERE task_id = ?', [
      taskId,
    ]);

    // 顺序固定：发布(0) → write-version(1) → sync(5) → restart(11) → verify(21)。
    // sync 必须在 restart **之前**（先让目标机代码/依赖与服务产物同源，再换 dist）；
    // 已存在的行若 sort 漂移也一并纠正，保证顺序语义不靠人工维护。
    for (const [name, script, sort] of [
      [SYNC_NAME, SYNC_SCRIPT, 5],
      [RESTART_NAME, RESTART_SCRIPT, 11],
      [VERIFY_NAME, VERIFY_SCRIPT, 21],
    ]) {
      assertBashSyntax(script, `${tpl}/${name}`);
      const cur = existing.find((r) => r.name === name);
      if (cur) {
        const drift = Number(cur.sort) !== sort;
        if (cur.script === script && !drift) {
          console.log(`- ${tpl} / dev: 「${name}」已是最新，跳过`);
          skipped++;
          continue;
        }
        console.log(`- ${tpl} / dev: 更新「${name}」${drift ? `（sort ${cur.sort} → ${sort}）` : '正文'}`);
        changed++;
        if (!DRY_RUN) {
          await conn.query(
            'UPDATE deploy_pipeline_actions SET script = ?, sort = ?, updated_by = ?, updated_at = NOW() WHERE id = ?',
            [script, sort, 'p26', cur.id],
          );
        }
      } else {
        console.log(`- ${tpl} / dev: 新增「${name}」（sort=${sort}）`);
        changed++;
        if (!DRY_RUN) {
          await conn.query(
            'INSERT INTO deploy_pipeline_actions (id, task_id, name, script, managed, sort, enabled, updated_by, created_at, updated_at) ' +
              'VALUES (?, ?, ?, ?, 0, ?, 1, ?, NOW(), NOW())',
            [crypto.randomUUID(), taskId, name, script, sort, 'p26'],
          );
        }
      }
    }

    // 顺序自检：发布 → sync → restart → verify（顺序错了会「先换 dist 再对齐依赖」，等于没修）
    // DRY_RUN 下没写库，跳过该校验（否则会误报 sync=NaN）
    if (DRY_RUN) continue;
    const [after] = await conn.query('SELECT name, sort FROM deploy_pipeline_actions WHERE task_id = ? ORDER BY sort', [
      taskId,
    ]);
    const sortOf = (n) => Number(after.find((r) => r.name === n)?.sort ?? NaN);
    const release = after.find((r) => r.name === '发布' || r.name.startsWith('发布'));
    const sSync = sortOf(SYNC_NAME);
    const sRestart = sortOf(RESTART_NAME);
    const sVerify = sortOf(VERIFY_NAME);
    if (release && sRestart < Number(release.sort)) {
      throw new Error(`${tpl}: restart 排在「发布」之前，拒绝`);
    }
    if (!(sSync < sRestart && sRestart < sVerify)) {
      throw new Error(`${tpl}: 动作顺序不合法（sync=${sSync} restart=${sRestart} verify=${sVerify}），拒绝`);
    }
  }

  console.log(
    DRY_RUN
      ? `\nDRY_RUN：将改动 ${changed} 条、跳过 ${skipped} 条（未写库）`
      : `\n完成：改动 ${changed} 条、跳过 ${skipped} 条`,
  );
  await conn.end();
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
