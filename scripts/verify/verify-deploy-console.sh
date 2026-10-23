#!/usr/bin/env bash
# ============================================================
# verify-deploy-console.sh — deploy-console 发布后固定验收
#
# 职责：发布完成后跑一份**固定、不靠人记**的验收清单。
# 退出码：0 = 全部通过；非 0 = 有失败项（发布方据此判红）。
#
# 用法:
#   bash scripts/verify/verify-deploy-console.sh                # 本机 6200
#   bash scripts/verify/verify-deploy-console.sh --port 6200
#   bash scripts/verify/verify-deploy-console.sh --host dev     # SSH 到 dev 机验收
#   bash scripts/verify/verify-deploy-console.sh --quick        # 跳过 pm2/crash 循环检测
#
# 检查项（按序）:
#   1. 端口 6200 监听
#   2. GET /console/ 200（前端静态页）
#   3. GET /api/apps 200|401（后端 API 存活）
#   4. pm2 进程 online + 无崩溃循环（restarts 不在飙）
#   5. 前端入口产物存在（index-*.js）
# ============================================================
set -uo pipefail

PORT=6200
HOST_MODE="local"
QUICK=0

while [ $# -gt 0 ]; do
  case "$1" in
    --port)  PORT="${2:-6200}"; shift 2 ;;
    --host)  HOST_MODE="${2:-local}"; shift 2 ;;
    --quick) QUICK=1; shift ;;
    *) echo "未知参数: $1（支持 --port N / --host local|dev|prod / --quick）" >&2; exit 2 ;;
  esac
done

G='\033[0;32m'; R='\033[0;31m'; N='\033[0m'
PASS=0; FAIL=0
ok()   { echo -e "  ${G}✓${N} $1"; PASS=$((PASS+1)); }
bad()  { echo -e "  ${R}✗${N} $1"; FAIL=$((FAIL+1)); }

# SSH 包装：local 直接跑，其它环境走 ssh
if [ "$HOST_MODE" = "local" ]; then
  RUN="eval"
  SSH_HOST=""
else
  case "$HOST_MODE" in
    dev)  SSH_HOST="kedou-dev" ;;
    prod) SSH_HOST="kedou-prod" ;;
    *)    SSH_HOST="$HOST_MODE" ;;
  esac
  RUN="ssh -o ConnectTimeout=10 -o BatchMode=yes $SSH_HOST"
fi

echo "=========================================="
echo " deploy-console 发布验收（${HOST_MODE} :${PORT}）"
echo "=========================================="

# ---- 1. 端口监听 ----
if [ "$HOST_MODE" = "local" ]; then
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    ok "端口 ${PORT} 监听中"
  else
    bad "端口 ${PORT} 未监听"
  fi
else
  if $RUN "ss -tln 2>/dev/null | grep -q ':${PORT} '" 2>/dev/null; then
    ok "端口 ${PORT} 监听中"
  else
    bad "端口 ${PORT} 未监听"
  fi
fi

# ---- 2. /console/ 200 ----
CODE="$($RUN "curl -s -o /dev/null -w '%{http_code}' -m 6 http://127.0.0.1:${PORT}/console/" 2>/dev/null || echo 000 | tr -d '\r')"
if [ "$CODE" = "200" ]; then
  ok "/console/ 200（前端静态页）"
else
  bad "/console/ 返回 ${CODE}（期望 200）"
fi

# ---- 3. /api/apps 存活 ----
API="$($RUN "curl -s -o /dev/null -w '%{http_code}' -m 6 http://127.0.0.1:${PORT}/api/apps" 2>/dev/null || echo 000 | tr -d '\r')"
case "$API" in
  200|401) ok "/api/apps ${API}（后端 API 存活）" ;;
  *)       bad "/api/apps 返回 ${API}（期望 200/401）" ;;
esac

# ---- 4. pm2 状态（--quick 跳过）----
if [ "$QUICK" != "1" ]; then
  PM2_OUT="$($RUN "pm2 jlist 2>/dev/null" 2>/dev/null || echo '[]')"
  # 找 deploy-console 进程（web-deploy-console 或 deploy-console）
  PM2_STATUS="$(echo "$PM2_OUT" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try {
        const list=JSON.parse(s||"[]");
        const p=list.find(x=>/deploy-console/.test(x.name||""));
        if(!p){console.log("not-found");return;}
        const st=p.pm2_env?.status||"?";
        const rs=p.pm2_env?.restart_time??0;
        console.log(st+" "+rs);
      } catch { console.log("parse-fail"); }
    });' 2>/dev/null || echo 'parse-fail')"
  PM2_STATE="${PM2_STATUS%% *}"
  PM2_RESTARTS="${PM2_STATUS##* }"
  if [ "$PM2_STATE" = "online" ]; then
    # 崩溃循环检测：重启次数异常高
    if [ "${PM2_RESTARTS:-0}" -gt 50 ] 2>/dev/null; then
      bad "pm2 online 但重启 ${PM2_RESTARTS} 次（疑似崩溃循环）"
    else
      ok "pm2 online（重启 ${PM2_RESTARTS:-0} 次）"
    fi
  elif [ "$PM2_STATE" = "not-found" ]; then
    bad "pm2 中找不到 deploy-console 进程"
  else
    bad "pm2 状态 ${PM2_STATE:-?}（期望 online）"
  fi
fi

# ---- 5. 前端入口产物 ----
if [ "$HOST_MODE" = "local" ]; then
  RELEASE_DIR="${RELEASE_DIR:-$HOME/web_system_release}"
  if ls "$RELEASE_DIR/apps/deploy-console/dist/index-"*.js >/dev/null 2>&1; then
    ok "前端入口产物存在"
  else
    bad "前端入口产物缺失（$RELEASE_DIR/apps/deploy-console/dist/index-*.js）"
  fi
fi

echo ""
echo "=========================================="
echo -e " 验收结果: ${G}${PASS} passed${N} / ${R}${FAIL} failed${N}"
echo "=========================================="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
