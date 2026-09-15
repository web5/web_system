#!/usr/bin/env bash
# ⚠️ DEPRECATED（2026-09-14）：**流水线不再使用本文件**。
#    发布流水线的 verify 阶段改由 deploy-console 自带的副本执行
#    （servers/deploy-console/src/pipeline/scripts/verify-backend.sh，随 console 构建产物分发）。
#    本文件现仅供 `scripts/bootstrap.sh` 与人工运维在目标机本地使用；
#    改动它**不会影响流水线**，改流水线行为请改 console 里的那份。
# ============================================================
# 发布流水线 · verify 阶段（backend）
#
# 为什么单独成脚本：历史事故里"发布成功"出现过两类**假健康**：
#   ① 进程 online 但端口没监听（生产 synchronize=false 漏跑迁移；
#      或端口被孤儿进程占着，新进程 EADDRINUSE 后 pm2 反复重启）；
#   ② 端口通、业务链断：ai-agent 未注册 MCP 工具（缺 MCP_GATEWAY_URL），
#      或跨服务密钥不一致（网关 401 / 知识服务 4010）—— 端口探活完全看不出来。
#
# 本脚本按序检查：pm2 online → 端口 TCP → （MCP 相关服务）AI 链路端到端。
# 任一项失败即退出非 0，由流水线/watchdog 决定回滚。
#
# 平台下发变量：RELEASE_DIR / MODULE_KEY / MODULE_DIR / MODULE_TYPE / PM2_NAME / PORT
# 本地调试：DRY_RUN=1 只打印将执行的检查
# ============================================================
set -uo pipefail

DRY_RUN="${DRY_RUN:-0}"
ONLINE_WAIT_TRIES="${ONLINE_WAIT_TRIES:-12}"   # 12 × 2s = 24s
AI_CHAIN_TRIES="${AI_CHAIN_TRIES:-3}"
MCP_PORT="${MCP_PORT:-6006}"

log() { echo "[pipeline:verify] $*"; }
die() { echo "[pipeline:verify] $*" >&2; exit 1; }

case "${MODULE_TYPE:-}" in
  backend) ;;
  *) log "MODULE_TYPE=${MODULE_TYPE:-未设置} 非后端模块，跳过探活"; exit 0 ;;
esac

: "${RELEASE_DIR:?RELEASE_DIR 未设置}"
: "${MODULE_KEY:?MODULE_KEY 未设置}"

MODULE_DIR_NAME="${MODULE_DIR:-${MODULE_KEY}}"
SVC_DIR="${RELEASE_DIR}/servers/${MODULE_DIR_NAME}"
PM2="${PM2_BIN:-$(command -v pm2 || echo "${RELEASE_DIR}/node_modules/.bin/pm2")}"

# ── 解析 pm2 进程名（与 restart-backend.sh 同源语义）──
resolve_name() {
  MK="$MODULE_KEY" PM2N="${PM2_NAME:-}" "$PM2" jlist 2>/dev/null \
    | MK="$MODULE_KEY" PM2N="${PM2_NAME:-}" python3 -c '
import sys, json, os
mk = os.environ.get("MK", "")
base = mk[:-8] if mk.endswith("-service") else mk
cands = [os.environ.get("PM2N", ""), "web-" + mk, "web-" + base, mk, base]
try:
    procs = {p["name"] for p in json.load(sys.stdin)}
except Exception:
    sys.exit(0)
for c in cands:
    if c and c in procs:
        print(c)
        break
'
}

NAME="$(resolve_name)"
[ -n "$NAME" ] || die "pm2 中未找到服务：${MODULE_KEY}（候选 ${PM2_NAME:-未设置} / web-${MODULE_KEY} / ${MODULE_KEY}）"

IS_MCP_RELATED=0
case "$MODULE_KEY" in
  ai-agent|mcp-gateway|knowledge-service) IS_MCP_RELATED=1 ;;
esac

if [ "$DRY_RUN" = "1" ]; then
  log "[DRY_RUN] 服务=${NAME}｜将检查：pm2 online（最多 ${ONLINE_WAIT_TRIES}×2s）→ 端口 ${PORT:-未设置} TCP 探活"
  if [ "$IS_MCP_RELATED" = "1" ]; then
    log "[DRY_RUN] 额外检查：AI 链路 /mcp/tools/call knowledge_list（端口 ${MCP_PORT}）"
  fi
  exit 0
fi

# ── ① 进程在线 ──
ONLINE=""
for _ in $(seq 1 "$ONLINE_WAIT_TRIES"); do
  ONLINE="$(MK="$MODULE_KEY" PM2N="$NAME" "$PM2" jlist 2>/dev/null | MK="$MODULE_KEY" PM2N="$NAME" python3 -c '
import sys, json, os
name = os.environ.get("PM2N", "")
try:
    procs = {p["name"]: (p.get("pm2_env") or {}).get("status") for p in json.load(sys.stdin)}
except Exception:
    sys.exit(0)
if procs.get(name) == "online":
    print(name)
' 2>/dev/null)"
  [ -n "$ONLINE" ] && break
  log "等待服务上线: $NAME"
  sleep 2
done
[ -n "$ONLINE" ] || die "服务重启后未在线：$NAME（排查：pm2 logs $NAME）"
log "服务在线: $ONLINE"

# ── ② 端口 TCP 探活 ──
if [ -n "${PORT:-}" ]; then
  port_ok=0
  for _ in 1 2 3; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then port_ok=1; break; fi
    sleep 2
  done
  [ "$port_ok" = "1" ] || die "端口探活失败：$MODULE_KEY 进程 online 但 127.0.0.1:$PORT 无响应（排查：lsof -tiTCP:$PORT -sTCP:LISTEN）"
  log "端口探活 $PORT: 健康"
else
  log "PORT 未解析，降级为进程状态探活"
fi

# ── ③ AI 链路端到端（仅 MCP 相关服务）──
check_ai_chain() {
  local gw_env="${RELEASE_DIR}/servers/mcp-gateway/.env"
  local key=""
  if [ -f "$gw_env" ]; then
    key="$(grep -m1 '^MCP_CLIENT_KEY=' "$gw_env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)"
  fi
  if [ -z "$key" ]; then
    log "[WARN] 未取到 mcp-gateway 的 MCP_CLIENT_KEY，跳过 AI 链路探活"
    return 0
  fi
  local resp="" i
  for i in $(seq 1 "$AI_CHAIN_TRIES"); do
    resp="$(curl -s --max-time 10 -X POST "http://127.0.0.1:${MCP_PORT}/mcp/tools/call" \
      -H "Authorization: Bearer ${key}" -H 'Content-Type: application/json' \
      -d '{"module":"knowledge","tool":"knowledge_list","args":{}}' 2>/dev/null || true)"
    [ -n "$resp" ] && break
    log "AI 链路探活重试 ${i}/${AI_CHAIN_TRIES}（等待 mcp-gateway/knowledge-service 就绪）"
    sleep 2
  done
  case "$resp" in
    "") die "AI 链路探活无响应：http://127.0.0.1:${MCP_PORT}/mcp/tools/call（mcp-gateway 或 knowledge-service 未就绪）" ;;
    *"内部调用密钥无效"*|*4010*)
      die "AI 链路内部鉴权失败：mcp-gateway.KNOWLEDGE_SERVICE_AUTH_CONFIG.token ≠ knowledge-service.INTERNAL_API_KEY
      （改其中一处的 .env 后重启，或让 KNOWLEDGE_SERVICE_AUTH_CONFIG 引用同一密钥）" ;;
    *Unauthorized*)
      die "AI 链路网关鉴权失败：调用方 MCP_CLIENT_KEY ≠ mcp-gateway.MCP_CLIENT_KEY（401）" ;;
    *)
      log "AI 链路探活: knowledge_list OK" ;;
  esac
}

if [ "$IS_MCP_RELATED" = "1" ]; then
  check_ai_chain
fi

log "验证通过: $MODULE_KEY"
