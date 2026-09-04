#!/usr/bin/env bash
# ============================================================
# publish-ai-agent.sh — ai-agent「传统发布」一键脚本
#
# 背景：ai-agent（端口 6010）依赖 packages/agent-core（软链 require dist），
#       历史多次手动操作踩坑：① 旧孤儿进程抢 6010 → 新进程 EADDRINUSE 崩溃、
#       对外仍是旧实例（如 token 修复不生效）；② agent-core 忘了 build 导致改动不生效。
#       本脚本把正确步骤 + 端口孤儿铁律全部内建（仿 publish-deploy-console.sh 的
#       6200 固化模式，改用 6010），一次授权跑完。
#
# 流程：release 同步分支 → build agent-core → build ai-agent
#       → 孤儿进程清理（6010 一致性）→ pm2 restart → 健康复检
#
# 用法：
#   ./scripts/publish-ai-agent.sh                 # 全流程
#   ./scripts/publish-ai-agent.sh --skip-sync     # 跳过 release 同步（只构建+重启）
#   ./scripts/publish-ai-agent.sh --skip-health   # 跳过健康复检
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

PM2_NAME="web-ai-agent"
PORT="6010"
HEALTH_URL="http://127.0.0.1:${PORT}/agent/models"

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
step()  { echo -e "${GREEN}[ai-agent]${NC} $1"; }
warn()  { echo -e "${YELLOW}[ai-agent][WARN]${NC} $1"; }
err()   { echo -e "${RED}[ai-agent][ERROR]${NC} $1"; exit 1; }
dry()   { if [ "$DRY_RUN" = "1" ]; then echo -e "${YELLOW}[dry-run]${NC} $1"; return 0; fi; return 1; }

BRANCH="$(git -C "$RELEASE_DIR" branch --show-current 2>/dev/null || echo feature/contract-risk-ai)"
step "发布目录: ${RELEASE_DIR}（分支 ${BRANCH}）"

# ---------- 0. 前置检查 ----------
[ -d "$RELEASE_DIR/servers/ai-agent" ] || err "发布目录缺少 ai-agent: $RELEASE_DIR/servers/ai-agent"
[ -d "$RELEASE_DIR/packages/agent-core" ] || err "发布目录缺少 agent-core: $RELEASE_DIR/packages/agent-core"
[ -x "$NODE_BIN/nest" ] || err "发布目录缺少构建工具 node_modules/.bin/nest，先执行依赖安装"

# ---------- 1. 同步发布目录（ff-only，失败则 reset --hard 到 origin） ----------
# 说明：release 是纯发布镜像，常规用 ff-only；若工作区曾 amend/rebase 重写 commit
# hash，本地 HEAD 与 origin 同内容但 hash 不同，ff-only 会失败。此时只要工作树干净
# 就 reset --hard 到 origin（发布镜像语义，无本地改动可丢）。
if [ "$SKIP_SYNC" != "1" ]; then
  step "同步 release → ${BRANCH} ..."
  if dry "git -C ${RELEASE_DIR} fetch origin ${BRANCH} && (git merge --ff-only origin/${BRANCH} || git reset --hard origin/${BRANCH})"; then
    :
  else
    git -C "$RELEASE_DIR" fetch origin "$BRANCH" 2>&1 | tail -2
    if git -C "$RELEASE_DIR" merge --ff-only "origin/$BRANCH" 2>/dev/null; then
      :
    elif [ -z "$(git -C "$RELEASE_DIR" status --porcelain)" ]; then
      warn "ff-only 不可快进（可能 commit hash 被重写），release 工作树干净，reset --hard 到 origin/${BRANCH} ..."
      git -C "$RELEASE_DIR" reset --hard "origin/$BRANCH" 2>&1 | tail -2
    else
      err "ff-only 失败且工作树有未提交改动，请先处理 release 工作树"
    fi
  fi
  NEWHEAD="$(git -C "$RELEASE_DIR" log --oneline -1 | cut -d' ' -f1)"
  step "已同步到 ${NEWHEAD}"
fi

# ---------- 2. 构建 agent-core（ai-agent 软链依赖，必须先 build） ----------
step "构建 agent-core ..."
if ! dry "(cd ${RELEASE_DIR}/packages/agent-core && ${NODE_BIN}/nest build)"; then
  (cd "$RELEASE_DIR/packages/agent-core" && "$NODE_BIN/nest" build) || err "agent-core 构建失败"
fi
step "agent-core 构建完成"

# ---------- 3. 构建 ai-agent（NestJS 后端） ----------
step "构建 ai-agent ..."
if ! dry "(cd ${RELEASE_DIR}/servers/ai-agent && ${NODE_BIN}/nest build)"; then
  (cd "$RELEASE_DIR/servers/ai-agent" && "$NODE_BIN/nest" build) || err "ai-agent 构建失败"
fi
step "ai-agent 构建完成"

# ---------- 4. 重启（干净 env + 孤儿进程铁律） ----------
# 铁律：6010 占用者必须 == pm2 当前 pid；restart 后旧进程未释放会造成新进程
# EADDRINUSE 崩溃、对外仍是旧孤儿。先清残留再重启并做一致性校验。
CLEAN_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$(dirname "$(command -v node)")"
pm2_pid()   { "$PM2_BIN" pid "$PM2_NAME" 2>/dev/null || true; }
pm2_status() {
  "$PM2_BIN" jlist 2>/dev/null | python3 -c "
import json, sys
try:
    d = [p for p in json.load(sys.stdin) if p['name'] == '$PM2_NAME']
    print(d[0]['pm2_env'].get('status', '') if d else 'missing')
except Exception:
    print('missing')"
}
listen_pid() { lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true; }

restart_agent() {
  if ! dry "(cd ${RELEASE_DIR}/servers/ai-agent && env PATH=${CLEAN_PATH} ${PM2_BIN} restart ${PM2_NAME} --update-env)"; then
    (cd "$RELEASE_DIR/servers/ai-agent" && env PATH="$CLEAN_PATH" "$PM2_BIN" restart "$PM2_NAME" --update-env >/dev/null 2>&1) \
      || err "pm2 restart 失败"
  fi
  sleep 4
}

step "处理 ${PORT} 端口一致性（孤儿进程铁律）..."
# 4.1 先 kill 非 pm2 当前 pid 的 6010 占用（历史孤儿）
PRE_PM2="$(pm2_pid)"
for p in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
  if [ -n "$PRE_PM2" ] && [ "$p" != "$PRE_PM2" ]; then
    step "清理孤儿进程 ${p}（占 ${PORT} 且非 pm2 pid ${PRE_PM2}）..."
    dry "kill -9 ${p}" || kill -9 "$p" 2>/dev/null || true
  fi
done

# 4.2 干净环境重启
step "干净 env 重启 ${PM2_NAME} ..."
restart_agent

# 4.3 一致性校验（最多重试一轮）
LISTEN="$(listen_pid)"; STATUS="$(pm2_status)"; CUR_PM2="$(pm2_pid)"
if [ "$LISTEN" != "$CUR_PM2" ] || [ "$STATUS" != "online" ]; then
  warn "首次重启后不一致（listen=${LISTEN} pm2=${CUR_PM2} status=${STATUS}），清理残留并重试..."
  for p in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    if [ "$p" != "$(pm2_pid)" ]; then dry "kill -9 ${p}" || kill -9 "$p" 2>/dev/null || true; fi
  done
  restart_agent
fi

LISTEN="$(listen_pid)"; STATUS="$(pm2_status)"; CUR_PM2="$(pm2_pid)"
[ "$STATUS" = "online" ] || { "$PM2_BIN" logs "$PM2_NAME" --lines 30 --nostream 2>&1 | tail -15; err "${PM2_NAME} 非 online，见上方日志"; }
[ -n "$LISTEN" ] || err "${PORT} 未被监听（服务可能启动失败），见 pm2 logs"
[ "$LISTEN" = "$CUR_PM2" ] || err "${PORT} 占用者 ${LISTEN} ≠ pm2 pid ${CUR_PM2}，仍有孤儿进程，请手动 kill -9 ${LISTEN} 后重跑本脚本"
step "端口一致性 OK（${PORT} == pm2 ${CUR_PM2}, status=${STATUS}）"

# ---------- 5. pm2 save ----------
step "固化 pm2 进程表 ..."
dry "${PM2_BIN} save" || "$PM2_BIN" save >/dev/null 2>&1 || warn "pm2 save 失败（不阻断）"

# ---------- 6. 健康复检 ----------
if [ "$SKIP_HEALTH" != "1" ]; then
  step "健康复检 ..."
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo 000)"
  [ "$CODE" = "200" ] && step "ai-agent /agent/models HTTP 200 ✓" || err "ai-agent 返回 ${CODE}"
fi

step "发布完成 ✓"
