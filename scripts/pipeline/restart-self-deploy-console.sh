#!/usr/bin/env bash
# 发布流水线 · restart（**自部署专用，异步排程**）：落地 dist → 排程重启 → 立即返回 0。
#
# 为什么不能复用通用 restart 动作：console 自己发布自己时，通用动作会在流水线进程内
# 同步执行 `pm2 restart deploy-console` —— 那等于把正在跑流水线的主进程 kill 掉，
# 后续动作与 run 状态回写全部丢失（2026-09-29 实测：手动点部署返回 ECONNRESET）。
#
# 解法：拆成两段。
#   ① 同步段（本动作内完成，进程还活着）：守卫版本目录 → 备份旧 dist → 落地新 dist。
#      这段失败可以直接判定发布失败（dist 没换，线上服务不受影响）。
#   ② 异步段（脱离 ssh 会话与流水线进程）：`setsid nohup` 排程「sleep N 后重启」，
#      自带 online 检查 + 端口探活 + 失败回滚 dist 并重启旧版本，结果写日志文件。
# 于是流水线能正常 succeeded，N 秒后服务自动生效。
#
# 平台注入变量：MODULE_KEY / MODULE_TYPE / COMMIT_ID / DEPLOY_ENV / PM2_NAME /
#               PM2_SCRIPT / PORT / PUBLISH_HOST / PUBLISH_USER / PUBLISH_KEY / PUBLISH_PATH
# 可调：RESTART_DELAY_SEC（默认 5）、SELF_RESTART_LOG（自检日志路径）
set -uo pipefail
[ "${MODULE_TYPE:-}" = "backend" ] || { echo "[restart-self] MODULE_TYPE=${MODULE_TYPE:-未设置}，非后端模块，跳过"; exit 0; }
if [ "${DEPLOY_ENV:-}" = "local" ]; then
  echo "[restart-self] DEPLOY_ENV=local：local 分支不需要本动作，跳过"
  exit 0
fi
: "${PUBLISH_HOST:?缺少 PUBLISH_HOST}" \
  "${PUBLISH_PATH:?缺少 PUBLISH_PATH}" \
  "${COMMIT_ID:?缺少 COMMIT_ID}" \
  "${MODULE_KEY:?缺少 MODULE_KEY}"

RUSER="${PUBLISH_USER:-ubuntu}"
RKEY="${PUBLISH_KEY:-$HOME/.ssh/id_ed25519_servers}"
SVC="${PUBLISH_PATH}"
VER="${PUBLISH_PATH}/${COMMIT_ID}"
NAME="${PM2_NAME:-web-${MODULE_KEY}}"
FB="${MODULE_KEY}"
SCRIPT="${PM2_SCRIPT:-dist/main.js}"
PORT="${PORT:-}"
DELAY="${RESTART_DELAY_SEC:-5}"
LOG="${SELF_RESTART_LOG:-/tmp/restart-self-${MODULE_KEY}.log}"
RS="/tmp/.restart-self-${MODULE_KEY}.sh"
# ssh 必须走函数：写成 SSH="ssh -i ..." 再 "$SSH" 会被当成单个命令名（2026-09-23 踩过）
rssh() { ssh -i "${RKEY}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o BatchMode=yes "$@"; }
die() { echo "[restart-self] $*" >&2; exit 1; }

# ── ① 同步段：守卫 → 备份 → 落地（失败可直接判发布失败）──
if rssh "${RUSER}@${PUBLISH_HOST}" "SVC='${SVC}' VER='${VER}' bash -s" <<'EOS'
set -uo pipefail
rdie() { echo "[restart-self] $*" >&2; exit 1; }
[ -d "$VER" ] || rdie "远端版本目录不存在：$VER（投递节点是否成功）"
[ -n "$(ls -A "$VER" | grep -v '\.tsbuildinfo$' || true)" ] || rdie "远端版本目录没有有效产物：$VER"
cd "$SVC" || rdie "远端服务目录不存在：$SVC"
STAMP=$(date +%s)
if [ -d dist ]; then mv dist "dist.bak-$STAMP" || rdie "备份 dist 失败"; echo "[restart-self] dist → dist.bak-$STAMP"; fi
mkdir -p dist && cp -a "$VER"/. dist/ || rdie "落地 dist 失败"
ls -1dt dist.bak-* 2>/dev/null | tail -n +4 | xargs -r rm -rf
echo "[restart-self] 产物已落地：$VER → $SVC/dist"
EOS
then
  echo "[restart-self] 落地完成：${MODULE_KEY}@${COMMIT_ID}"
else
  die "远端落地失败：${MODULE_KEY}@${COMMIT_ID}（dist 未换，线上服务不受影响）"
fi

# ── ② 异步段：先把排程脚本写到目标机，再脱离会话后台执行 ──
# 分两步而不是「ssh bash -s &」：后台进程与 ssh 共享 stdin，ssh 退出可能截断脚本正文。
# 先落文件、再执行文件，语义确定。
# 脚本正文用引号 heredoc（<<'EOS2'）避免本地展开 —— 变量走下一步的 env 注入。
if ! rssh "${RUSER}@${PUBLISH_HOST}" "cat > '${RS}'" <<'EOS2'
#!/usr/bin/env bash
# 自部署排程重启（异步执行，父进程可能已被流水线重启掉，故必须自包含）
set -uo pipefail
exec >>"${LOG:?}" 2>&1
echo "──────── $(date '+%F %T') 排程启动（延迟 ${DELAY}s）────────"
sleep "${DELAY}"
cd "${SVC}" || { echo "[restart-self] 服务目录不存在：$SVC"; exit 1; }

RESOLVED=""
for cand in "${NAME}" "${FB}"; do
  if pm2 describe "$cand" >/dev/null 2>&1; then RESOLVED="$cand"; break; fi
done
if [ -z "$RESOLVED" ]; then
  RESOLVED="$NAME"
  pm2 start "${SCRIPT}" --name "$RESOLVED" --cwd "${SVC}" >/dev/null 2>&1 \
    || echo "[restart-self] pm2 start 失败：$RESOLVED"
  echo "[restart-self] 目标机原无进程，已新建：$RESOLVED"
else
  pm2 restart "$RESOLVED" >/dev/null 2>&1 \
    || { echo "[restart-self] restart 失败，转 delete + start"; \
         pm2 delete "$RESOLVED" >/dev/null 2>&1; \
         pm2 start "${SCRIPT}" --name "$RESOLVED" --cwd "${SVC}" >/dev/null 2>&1; }
  echo "[restart-self] 已重启：$RESOLVED"
fi
pm2 save >/dev/null 2>&1 || true

# 自检：进程 online → 端口 TCP（都带轮询，Nest 冷启动实测约 14s）
ST=""
i=0
while [ "$i" -lt 20 ]; do
  ST="$(pm2 jlist 2>/dev/null | RESOLVED="$RESOLVED" python3 -c '
import sys, json, os
try:
    procs = {p["name"]: (p.get("pm2_env") or {}).get("status") for p in json.load(sys.stdin)}
except Exception:
    sys.exit(0)
print(procs.get(os.environ["RESOLVED"], ""))
' 2>/dev/null)"
  [ "$ST" = "online" ] && break
  i=$((i + 1)); sleep 2
done
echo "[restart-self] 进程状态：$RESOLVED = ${ST:-未知}"
OK=1
[ "$ST" = "online" ] || OK=0
if [ "$OK" = "1" ] && [ -n "$PORT" ]; then
  ok=0
  for _ in $(seq 1 10); do
    if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then ok=1; break; fi
    sleep 2
  done
  [ "$ok" = "1" ] || OK=0
  echo "[restart-self] 端口探活 ${PORT}：$( [ "$ok" = "1" ] && echo 通过 || echo 失败 )"
fi

if [ "$OK" = "1" ]; then
  echo "[restart-self] ✅ 生效验证通过：$RESOLVED @ ${SVC}/dist"
  exit 0
fi

# 验证失败 = 新产物不可用：回滚 dist + 干净启动旧版本，否则会停在崩溃循环上
echo "[restart-self] ❌ 验证未通过 → 回滚 dist 并重启旧版本"
LAST="$(ls -1dt dist.bak-* 2>/dev/null | head -1)"
if [ -n "$LAST" ]; then rm -rf dist && mv "$LAST" dist && echo "[restart-self] 已回滚 dist ← $LAST"; fi
pm2 delete "$RESOLVED" >/dev/null 2>&1 || true
pm2 start "${SCRIPT}" --name "$RESOLVED" --cwd "${SVC}" >/dev/null 2>&1 \
  || echo "[restart-self] [WARN] 回滚重启失败：$RESOLVED"
pm2 save >/dev/null 2>&1 || true
echo "[restart-self] --- pm2 错误日志尾部（排查用）---"
tail -20 "$HOME/.pm2/logs/${RESOLVED}-error.log" 2>/dev/null || true
exit 1
EOS2
then
  die "排程脚本写入目标机失败：$RS"
fi

if ! rssh "${RUSER}@${PUBLISH_HOST}" \
  "NAME='${NAME}' FB='${FB}' SVC='${SVC}' SCRIPT='${SCRIPT}' PORT='${PORT}' DELAY='${DELAY}' LOG='${LOG}' \
   setsid nohup bash '${RS}' >>'${LOG}' 2>&1 </dev/null & disown; sleep 1; echo scheduled"; then
  die "排程启动失败：${MODULE_KEY}（dist 已落地但未排程重启，请到目标机手工执行 pm2 restart）"
fi

echo "[restart-self] 重启已排程：${DELAY}s 后生效（自检日志 ${LOG}，失败会自动回滚 dist）"
echo "[restart-self] 提示：流水线到此即 succeeded，服务稍后自动切换，无需再点「服务详情 → 部署」"
exit 0
