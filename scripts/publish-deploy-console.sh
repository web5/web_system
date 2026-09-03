#!/usr/bin/env bash
# ============================================================
# publish-deploy-console.sh — deploy-console 自身「传统发布」一键脚本
#
# 背景：deploy-console 是发布工具自身，不能走流水线（stageRestart 会 restart
#       执行者自杀式中断），只能传统发布。历史多次手动操作踩坑（孤儿进程抢 6200、
#       pm2 --update-env 传播 PORT 污染、前端 dist 被旧代码覆盖），本脚本把
#       runbook（docs/development/local-release-runbook.md §2.1/§4.3/§4.4）
#       记录的正确步骤 + 铁律全部内建，一次授权跑完。
#
# 流程：release 目录同步分支 → 后端 nest build → 前端 vite build
#       → 干净 env 重启 + 孤儿进程处理（6200 一致性）→ pm2 save → 健康复检
#
# 用法：
#   ./scripts/publish-deploy-console.sh                 # 全流程
#   ./scripts/publish-deploy-console.sh --skip-sync     # 跳过 release 同步（只构建+重启）
#   ./scripts/publish-deploy-console.sh --skip-health   # 跳过健康复检
#
# 前置：工作区改动已 commit & push（脚本只同步发布目录，不碰工作区 git/不自动 push）。
#
# 环境变量：
#   RELEASE_DIR  发布目录（默认 ~/web_system_release）
#   DRY_RUN=1    只打印不执行
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${RELEASE_DIR:-$HOME/web_system_release}"
NODE_BIN="${RELEASE_DIR}/node_modules/.bin"
PM2_BIN="$(command -v pm2 || echo "$(dirname "$(command -v node)")/pm2")"
DRY_RUN="${DRY_RUN:-0}"

SKIP_SYNC=0
SKIP_HEALTH=0
for a in "$@"; do
  case "$a" in
    --skip-sync) SKIP_SYNC=1 ;;
    --skip-health) SKIP_HEALTH=1 ;;
    *) echo "未知参数: $a（支持 --skip-sync / --skip-health）" >&2; exit 2 ;;
  esac
done

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step()  { echo -e "${GREEN}[deploy-console]${NC} $1"; }
warn()  { echo -e "${YELLOW}[deploy-console][WARN]${NC} $1"; }
err()   { echo -e "${RED}[deploy-console][ERROR]${NC} $1"; exit 1; }
dry()   { if [ "$DRY_RUN" = "1" ]; then echo -e "${YELLOW}[dry-run]${NC} $1"; return 0; fi; return 1; }

BRANCH="$(git -C "$RELEASE_DIR" branch --show-current 2>/dev/null || echo feature/contract-risk-ai)"
step "发布目录: ${RELEASE_DIR}（分支 ${BRANCH}）"

# ---------- 0. 前置检查 ----------
[ -d "$RELEASE_DIR/servers/deploy-console" ] || err "发布目录不存在: $RELEASE_DIR"
[ -x "$NODE_BIN/nest" ] || err "发布目录缺少构建工具 node_modules/.bin/nest，先执行依赖安装"
[ -d "$RELEASE_DIR/apps/deploy-console" ] || err "缺少前端目录: $RELEASE_DIR/apps/deploy-console"

# ---------- 1. 同步发布目录（ff-only，避免 reset --hard 误伤） ----------
if [ "$SKIP_SYNC" != "1" ]; then
  step "同步 release → ${BRANCH} ..."
  if dry "git -C ${RELEASE_DIR} fetch origin ${BRANCH} && git merge --ff-only origin/${BRANCH}"; then
    :
  elif git -C "$RELEASE_DIR" fetch origin "$BRANCH" 2>&1 | tail -2 \
    && git -C "$RELEASE_DIR" merge --ff-only "origin/$BRANCH" 2>&1 | tail -3; then
    :
  else
    err "ff-only 快进失败（本地 release 有分叉？先手动处理）"
  fi
  NEWHEAD="$(git -C "$RELEASE_DIR" log --oneline -1 | cut -d' ' -f1)"
  step "已同步到 ${NEWHEAD}"
fi

# ---------- 2. 后端构建 ----------
step "构建后端（nest build）..."
if ! dry "(cd ${RELEASE_DIR}/servers/deploy-console && ${NODE_BIN}/nest build)"; then
  (cd "$RELEASE_DIR/servers/deploy-console" && "$NODE_BIN/nest" build) || err "后端构建失败（旧产物保留）"
fi
step "后端构建完成"

# ---------- 3. 前端构建 ----------
step "构建前端（vite build）..."
if ! dry "(cd ${RELEASE_DIR}/apps/deploy-console && ${NODE_BIN}/vite build)"; then
  if ! (cd "$RELEASE_DIR/apps/deploy-console" && "$NODE_BIN/vite" build >/tmp/dc-fe-build.log 2>&1); then
    tail -20 /tmp/dc-fe-build.log
    err "前端构建失败"
  fi
fi
NEW_INDEX="$(grep -oE 'index-[^"]*\.js' "$RELEASE_DIR/apps/deploy-console/dist/index.html" | head -1)"
step "前端构建完成 → ${NEW_INDEX}"

# ---------- 4. 重启（干净 env + 孤儿进程铁律） ----------
# 铁律：6200 占用者必须 == pm2 当前 pid；restart 后旧进程未释放会造成新进程
# EADDRINUSE 崩溃、对外仍是旧孤儿。先清残留再重启并做一致性校验。
CLEAN_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$(dirname "$(command -v node)")"
pm2_pid()   { "$PM2_BIN" pid web-deploy-console 2>/dev/null || true; }
pm2_status() {
  "$PM2_BIN" jlist 2>/dev/null | python3 -c "
import json, sys
try:
    d = [p for p in json.load(sys.stdin) if p['name'] == 'web-deploy-console']
    print(d[0]['pm2_env'].get('status', '') if d else 'missing')
except Exception:
    print('missing')"
}
listen_pid() { lsof -tiTCP:6200 -sTCP:LISTEN 2>/dev/null | head -1 || true; }

restart_console() {
  if ! dry "(cd ${RELEASE_DIR}/servers/deploy-console && env PATH=${CLEAN_PATH} ${PM2_BIN} restart web-deploy-console --update-env)"; then
    (cd "$RELEASE_DIR/servers/deploy-console" && env PATH="$CLEAN_PATH" "$PM2_BIN" restart web-deploy-console --update-env >/dev/null 2>&1) \
      || err "pm2 restart 失败"
  fi
  sleep 4
}

step "处理 6200 端口一致性（孤儿进程铁律）..."
# 4.1 先 kill 非 pm2 当前 pid 的 6200 占用（历史孤儿）
PRE_PM2="$(pm2_pid)"
for p in $(lsof -tiTCP:6200 -sTCP:LISTEN 2>/dev/null || true); do
  if [ -n "$PRE_PM2" ] && [ "$p" != "$PRE_PM2" ]; then
    step "清理孤儿进程 ${p}（占 6200 且非 pm2 pid ${PRE_PM2}）..."
    dry "kill -9 ${p}" || kill -9 "$p" 2>/dev/null || true
  fi
done

# 4.2 干净环境重启
step "干净 env 重启 web-deploy-console ..."
restart_console

# 4.3 一致性校验（最多重试一轮）
LISTEN="$(listen_pid)"; STATUS="$(pm2_status)"; CUR_PM2="$(pm2_pid)"
if [ "$LISTEN" != "$CUR_PM2" ] || [ "$STATUS" != "online" ]; then
  warn "首次重启后不一致（listen=${LISTEN} pm2=${CUR_PM2} status=${STATUS}），清理残留并重试..."
  for p in $(lsof -tiTCP:6200 -sTCP:LISTEN 2>/dev/null || true); do
    if [ "$p" != "$(pm2_pid)" ]; then dry "kill -9 ${p}" || kill -9 "$p" 2>/dev/null || true; fi
  done
  restart_console
fi

LISTEN="$(listen_pid)"; STATUS="$(pm2_status)"; CUR_PM2="$(pm2_pid)"
[ "$STATUS" = "online" ] || { "$PM2_BIN" logs web-deploy-console --lines 30 --nostream 2>&1 | tail -15; err "web-deploy-console 非 online，见上方日志"; }
[ -n "$LISTEN" ] || err "6200 未被监听（服务可能启动失败），见 pm2 logs"
[ "$LISTEN" = "$CUR_PM2" ] || err "6200 占用者 ${LISTEN} ≠ pm2 pid ${CUR_PM2}，仍有孤儿进程，请手动 kill -9 ${LISTEN} 后重跑本脚本"
step "端口一致性 OK（6200 == pm2 ${CUR_PM2}, status=${STATUS}）"

# ---------- 5. pm2 save ----------
step "固化 pm2 进程表 ..."
dry "${PM2_BIN} save" || "$PM2_BIN" save >/dev/null 2>&1 || warn "pm2 save 失败（不阻断）"

# ---------- 6. 健康复检 ----------
if [ "$SKIP_HEALTH" != "1" ]; then
  step "健康复检 ..."
  CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6200/console/ 2>/dev/null || echo 000)"
  [ "$CODE" = "200" ] && step "console HTTP 200 ✓" || err "console 返回 ${CODE}"
fi

step "发布完成 ✓（${NEW_INDEX}）"
echo "提示：浏览器访问 https://local.kedouai.com/console/ 建议硬刷新（Cmd/Ctrl+Shift+R）"
