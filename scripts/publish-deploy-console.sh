#!/usr/bin/env bash
# ============================================================
# publish-deploy-console.sh — deploy-console 自身「本地研发发布」一键脚本
#
# 定位：deploy-console 是发布工具自身，不能走流水线（restart 会自杀式中断），
#       只能传统发布。本脚本把「工作区构建 → 复制到运行位置 → 重启 → 复检」
#       固化成一条命令，并把历史踩过的坑全部内建。
#
# 默认流程（本地研发改动）：
#   1. 打印源信息（工作区分支 / 未提交数）
#   2. 在**工作区**构建：后端 nest build + 前端 vite build
#   3. dist 复制到发布目录（发布目录只承担运行位置，不再是构建源）
#   4. 重启：干净 env + 孤儿进程铁律（6200 归属一致性）
#   5. pm2 save
#   6. 复检：/console/ 200 + /api/apps 存活 + 崩溃循环检测
#
# 用法：
#   ./scripts/publish-deploy-console.sh                  # 工作区构建 → 复制 → 重启 → 复检
#   ./scripts/publish-deploy-console.sh --skip-build     # 已构建过：只复制 + 重启
#   ./scripts/publish-deploy-console.sh --skip-health    # 跳过复检
#   ./scripts/publish-deploy-console.sh --from-release   # 旧路径：在发布目录同步分支并构建
#   ./scripts/publish-deploy-console.sh --from-release --branch master
#
# 环境变量：
#   RELEASE_DIR  发布目录（运行位置，默认 ~/web_system_release）
#   DRY_RUN=1    只打印不执行
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${RELEASE_DIR:-$HOME/web_system_release}"
PM2_BIN="$(command -v pm2 || echo "$(dirname "$(command -v node)")/pm2")"
DRY_RUN="${DRY_RUN:-0}"

SKIP_BUILD=0
SKIP_HEALTH=0
FROM_RELEASE=0
BRANCH_OPT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build)  SKIP_BUILD=1; shift ;;
    --skip-health) SKIP_HEALTH=1; shift ;;
    --from-release) FROM_RELEASE=1; shift ;;
    --branch)      BRANCH_OPT="${2:-}"; [ -n "$BRANCH_OPT" ] || { echo "--branch 缺少分支名" >&2; exit 2; }; shift 2 ;;
    *) echo "未知参数: ${1}（支持 --skip-build / --skip-health / --from-release / --branch <b>）" >&2; exit 2 ;;
  esac
done

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step() { echo -e "${GREEN}[deploy-console]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy-console][WARN]${NC} $1"; }
err()  { echo -e "${RED}[deploy-console][ERROR]${NC} $1"; exit 1; }
dry()  { if [ "$DRY_RUN" = "1" ]; then echo -e "${YELLOW}[dry-run]${NC} $1"; return 0; fi; return 1; }

WS_BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo '?')"
WS_DIRTY="$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
WS_HEAD="$(git -C "$ROOT" log --oneline -1 2>/dev/null | cut -d' ' -f1)"

# ---------- 0. 前置检查 ----------
[ -d "$RELEASE_DIR/servers/deploy-console" ] || err "发布目录不存在: $RELEASE_DIR"
[ -d "$RELEASE_DIR/apps/deploy-console" ] || err "缺少前端目录: $RELEASE_DIR/apps/deploy-console"

if [ "$FROM_RELEASE" = "1" ]; then
  BRANCH="${BRANCH_OPT:-$(git -C "$RELEASE_DIR" branch --show-current 2>/dev/null || echo master)}"
  step "源 = 发布目录 ${RELEASE_DIR}（分支 ${BRANCH}）"
else
  step "源 = 工作区 ${ROOT}（分支 ${WS_BRANCH} @ ${WS_HEAD}，未提交 ${WS_DIRTY} 项）"
  step "运行位置 = ${RELEASE_DIR}"
  [ "$WS_DIRTY" = "0" ] || warn "工作区有 ${WS_DIRTY} 项未提交改动：产物来自工作区代码，未提交的改动也会进产物"
fi

# ---------- 1. 构建 ----------
if [ "$SKIP_BUILD" != "1" ]; then
  if [ "$FROM_RELEASE" = "1" ]; then
    # 1A. 旧路径：同步发布目录分支 + 在发布目录构建
    step "同步 release → ${BRANCH} ..."
    if dry "git -C ${RELEASE_DIR} fetch origin ${BRANCH} && git merge --ff-only origin/${BRANCH}"; then
      :
    elif git -C "$RELEASE_DIR" fetch origin "$BRANCH" 2>&1 | tail -2 \
      && git -C "$RELEASE_DIR" merge --ff-only "origin/$BRANCH" 2>&1 | tail -3; then
      :
    else
      err "ff-only 快进失败：发布目录与 origin/${BRANCH} 分叉或有本地改动。
  处理：
    git -C ${RELEASE_DIR} status --porcelain | head    # 看本地改动
    git -C ${RELEASE_DIR} log --oneline -1             # 看当前 HEAD
    git -C ${RELEASE_DIR} checkout -- . && git -C ${RELEASE_DIR} merge --ff-only origin/${BRANCH}
    或加 --skip-build 跳过同步（沿用发布目录现有代码）"
    fi
    NODE_BIN="${RELEASE_DIR}/node_modules/.bin"
    [ -x "$NODE_BIN/nest" ] || err "发布目录缺少 node_modules/.bin/nest，先安装依赖"
    step "构建后端（发布目录 nest build）..."
    dry "(cd ${RELEASE_DIR}/servers/deploy-console && ${NODE_BIN}/nest build)" \
      || { (cd "$RELEASE_DIR/servers/deploy-console" && "$NODE_BIN/nest" build) || err "后端构建失败（旧产物保留）"; }
    step "构建前端（发布目录 vite build）..."
    dry "(cd ${RELEASE_DIR}/apps/deploy-console && ${NODE_BIN}/vite build)" \
      || { (cd "$RELEASE_DIR/apps/deploy-console" && "$NODE_BIN/vite" build >/tmp/dc-fe-build.log 2>&1) || { tail -20 /tmp/dc-fe-build.log; err "前端构建失败"; }; }
  else
    # 1B. 默认：在工作区构建
    step "构建后端（工作区 npm run build）..."
    dry "(cd ${ROOT}/servers/deploy-console && npm run build)" \
      || { (cd "$ROOT/servers/deploy-console" && npm run build >/tmp/dc-be-build.log 2>&1) || { tail -25 /tmp/dc-be-build.log; err "后端构建失败，见上方日志"; }; }
    step "构建前端（工作区 npm run build）..."
    dry "(cd ${ROOT}/apps/deploy-console && npm run build)" \
      || { (cd "$ROOT/apps/deploy-console" && npm run build >/tmp/dc-fe-build.log 2>&1) || { tail -25 /tmp/dc-fe-build.log; err "前端构建失败，见上方日志"; }; }
  fi
else
  step "跳过构建（--skip-build）"
fi

# ---------- 2. 复制 dist 到运行位置 ----------
# 默认路径：工作区 dist → 发布目录（发布目录只是运行位置）
# --from-release 时构建已在发布目录就地完成，无需复制。
if [ "$FROM_RELEASE" != "1" ]; then
  step "复制 dist → 运行位置 ..."
  [ -f "$ROOT/servers/deploy-console/dist/main.js" ] || err "工作区缺 servers/deploy-console/dist/main.js（构建产物不完整）"
  [ -f "$ROOT/apps/deploy-console/dist/index.html" ] || err "工作区缺 apps/deploy-console/dist/index.html（前端产物不完整）"
  if ! dry "cp 后端/前端 dist → ${RELEASE_DIR}"; then
    mkdir -p "$RELEASE_DIR/servers/deploy-console/dist" "$RELEASE_DIR/apps/deploy-console/dist"
    cp -R "$ROOT/servers/deploy-console/dist/." "$RELEASE_DIR/servers/deploy-console/dist/" || err "后端 dist 复制失败"
    cp -R "$ROOT/apps/deploy-console/dist/."    "$RELEASE_DIR/apps/deploy-console/dist/"    || err "前端 dist 复制失败"
  fi
fi
NEW_INDEX="$(grep -oE 'index-[^"]*\.js' "$RELEASE_DIR/apps/deploy-console/dist/index.html" 2>/dev/null | head -1)"
step "产物就位 → 前端入口 ${NEW_INDEX:-（未取到）}"

# ---------- 3. 重启（干净 env + 孤儿进程铁律） ----------
# 铁律：6200 占用者必须 == pm2 当前 pid。console 只 app.listen()、没有优雅退出，
# restart 后旧进程不释放端口 → 新进程 EADDRINUSE 反复崩溃，对外仍是旧孤儿。
# 故用确定性重建：先放掉端口 → delete → start。
CLEAN_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$(dirname "$(command -v node)")"
pm2_pid() { "$PM2_BIN" pid web-deploy-console 2>/dev/null || true; }
pm2_field() {
  "$PM2_BIN" jlist 2>/dev/null | python3 -c "
import json, sys
field = '$1'
try:
    d = [p for p in json.load(sys.stdin) if p['name'] == 'web-deploy-console']
    print(d[0]['pm2_env'].get(field, '') if d else '')
except Exception:
    print('')"
}
listen_pid() { lsof -tiTCP:6200 -sTCP:LISTEN 2>/dev/null | head -1 || true; }
pm2_logs()   { "$PM2_BIN" logs web-deploy-console --lines "${1:-30}" --nostream 2>&1 | tail -"${1:-30}"; }

restart_console() {
  local lp
  for lp in $(lsof -tiTCP:6200 -sTCP:LISTEN 2>/dev/null || true); do
    dry "kill -9 ${lp}（释放 6200）" || kill -9 "$lp" 2>/dev/null || true
  done
  for lp in $(pgrep -f 'deploy-console/dist/main.js' 2>/dev/null || true); do
    [ "$lp" = "$(pm2_pid)" ] && continue
    dry "kill -9 ${lp}（残留 main.js）" || kill -9 "$lp" 2>/dev/null || true
  done
  sleep 1

  dry "(cd ${RELEASE_DIR}/servers/deploy-console && env PATH=${CLEAN_PATH} ${PM2_BIN} delete web-deploy-console)" \
    || (cd "$RELEASE_DIR/servers/deploy-console" && env PATH="$CLEAN_PATH" "$PM2_BIN" delete web-deploy-console >/dev/null 2>&1) || true
  dry "(cd ${RELEASE_DIR}/servers/deploy-console && env PATH=${CLEAN_PATH} ${PM2_BIN} start dist/main.js --name web-deploy-console --cwd ${RELEASE_DIR}/servers/deploy-console)" \
    || { (cd "$RELEASE_DIR/servers/deploy-console" && env PATH="$CLEAN_PATH" "$PM2_BIN" start dist/main.js --name web-deploy-console --cwd "$RELEASE_DIR/servers/deploy-console" >/dev/null 2>&1) || err "pm2 start 失败"; }
  sleep 6
}

step "处理 6200 端口一致性（孤儿进程铁律）..."
PRE_PM2="$(pm2_pid)"
for p in $(lsof -tiTCP:6200 -sTCP:LISTEN 2>/dev/null || true); do
  if [ -n "$PRE_PM2" ] && [ "$p" != "$PRE_PM2" ]; then
    step "清理孤儿进程 ${p}（占 6200 且非 pm2 pid ${PRE_PM2}）..."
    dry "kill -9 ${p}" || kill -9 "$p" 2>/dev/null || true
  fi
done

step "干净 env 重启 web-deploy-console ..."
restart_console

LISTEN="$(listen_pid)"; STATUS="$(pm2_field status)"; CUR_PM2="$(pm2_pid)"
if [ "$LISTEN" != "$CUR_PM2" ] || [ "$STATUS" != "online" ]; then
  warn "首次重启后不一致（listen=${LISTEN} pm2=${CUR_PM2} status=${STATUS}），清理残留并重试..."
  for p in $(lsof -tiTCP:6200 -sTCP:LISTEN 2>/dev/null || true); do
    if [ "$p" != "$(pm2_pid)" ]; then dry "kill -9 ${p}" || kill -9 "$p" 2>/dev/null || true; fi
  done
  restart_console
fi

LISTEN="$(listen_pid)"; STATUS="$(pm2_field status)"; CUR_PM2="$(pm2_pid)"
[ "$STATUS" = "online" ] || { pm2_logs 30; err "web-deploy-console 非 online（status=${STATUS}），见上方日志"; }
[ -n "$LISTEN" ] || { pm2_logs 30; err "6200 未被监听（服务启动失败），见上方日志"; }
[ "$LISTEN" = "$CUR_PM2" ] || err "6200 占用者 ${LISTEN} ≠ pm2 pid ${CUR_PM2}，仍有孤儿进程，请手动 kill -9 ${LISTEN} 后重跑本脚本"
step "端口一致性 OK（6200 == pm2 ${CUR_PM2}, status=${STATUS}）"

# ---------- 4. 崩溃循环检测 ----------
# 端口在、pm2 online，但进程其实在秒级重启（DI 缺注册 / 配置错误 / 启动即抛）——
# 这类"进程在但服务废了"只能靠 restarts 增长发现。
R1="$(pm2_field restart_time)"; sleep 5; R2="$(pm2_field restart_time)"
if [ -n "${R2}" ] && [ "$R1" != "$R2" ]; then
  pm2_logs 40
  err "进程在 5s 内重启 ${R1}→${R2} 次（启动即崩，多为 DI 缺注册或配置错误），见上方日志"
fi
step "无崩溃循环（restarts 稳定于 ${R2:-0}）"

# ---------- 5. pm2 save ----------
step "固化 pm2 进程表 ..."
dry "${PM2_BIN} save" || "$PM2_BIN" save >/dev/null 2>&1 || warn "pm2 save 失败（不阻断）"

# ---------- 6. 健康复检 ----------
if [ "$SKIP_HEALTH" != "1" ]; then
  step "健康复检 ..."
  CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6200/console/ 2>/dev/null || echo 000)"
  [ "$CODE" = "200" ] && step "静态页 /console/ 200 ✓" || err "静态页 /console/ 返回 ${CODE}"
  # 后端 API：200=已鉴权/无鉴权放行，401=存活待鉴权；000=后端没起来
  API="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6200/api/apps 2>/dev/null || echo 000)"
  case "$API" in
    200|401) step "后端 API /api/apps ${API} ✓" ;;
    *) pm2_logs 30; err "后端 API 无响应（/api/apps=${API}），后端可能启动失败，见上方日志" ;;
  esac
fi

step "发布完成 ✓（前端入口 ${NEW_INDEX:-未知}，源 ${WS_BRANCH} @ ${WS_HEAD}）"
echo "提示：浏览器访问 https://local.kedouai.com/console/ 建议硬刷新（Cmd/Ctrl+Shift+R）"
