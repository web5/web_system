#!/usr/bin/env bash
# ============================================================
# health-check.sh — 服务健康巡检（兼容 bash 3.2）
# 用法：./scripts/health-check.sh <dev|prod>
# 检查：进程端口 / 健康接口 / DB 连接 / MCP 端点
# ============================================================
set -uo pipefail

TARGET="${1:-dev}"
case "$TARGET" in
  dev)  SSH="ssh -o ConnectTimeout=10 -o BatchMode=yes kedou-dev";  PORT_BASE=6000 ;;
  prod) SSH="ssh -o ConnectTimeout=10 -o BatchMode=yes kedou-prod"; PORT_BASE=3000 ;;
  *) echo "用法: $0 <dev|prod>"; exit 1 ;;
esac

port_of() { # $1=service_name -> port
  case "$1" in
    gateway) echo $((PORT_BASE+0)) ;;
    auth)    echo $((PORT_BASE+1)) ;;
    user)    echo $((PORT_BASE+2)) ;;
    ai)      echo $((PORT_BASE+3)) ;;
    system)  echo $((PORT_BASE+4)) ;;
    todo)    echo $((PORT_BASE+5)) ;;
    mcp-gateway) echo 6006 ;;
    content-hub) echo 6007 ;;
  esac
}

SERVICES="gateway auth user ai system todo mcp-gateway content-hub"

echo "===== 健康巡检：$TARGET ====="
echo "--- 端口监听 ---"
for name in $SERVICES; do
  port=$(port_of "$name")
  if $SSH "ss -tln 2>/dev/null | grep -q ':$port '" 2>/dev/null; then
    echo "  [OK] $name :$port"
  else
    echo "  [FAIL] $name :$port 未监听"
  fi
done

GATEWAY_P=$PORT_BASE
echo "--- gateway 关键接口 ---"
$SSH "curl -s -o /dev/null -w 'gateway /: HTTP %{http_code}\n' --max-time 5 http://127.0.0.1:$GATEWAY_P/ 2>/dev/null" 2>/dev/null
$SSH "curl -s -o /dev/null -w 'portal/: HTTP %{http_code}\n' --max-time 5 http://127.0.0.1:$GATEWAY_P/portal/ 2>/dev/null" 2>/dev/null

echo "--- MCP 端点（initialize）---"
KEY=$($SSH 'PID=$(pm2 pid mcp-gateway 2>/dev/null); tr "\0" "\n" < /proc/$PID/environ 2>/dev/null | grep "^MCP_CLIENT_KEY=" | cut -d= -f2-')
if [ -n "$KEY" ]; then
  for mod in wechat_mp finnews; do
    R=$($SSH "curl -s --max-time 8 -X POST http://127.0.0.1:6006/mcp/$mod -H \"Authorization: Bearer $KEY\" -H \"Accept: application/json, text/event-stream\" -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"health\",\"version\":\"1\"}}}' | head -c 80" 2>/dev/null)
    if echo "$R" | grep -q "serverInfo\|protocolVersion"; then
      echo "  [OK] MCP $mod initialize"
    else
      echo "  [FAIL] MCP $mod initialize: ${R:0:60}"
    fi
  done
else
  echo "  [warn] 未获取到 MCP_CLIENT_KEY，跳过 MCP 检查"
fi

echo "--- 进程健康（pm2 状态异常探测）---"
$SSH "pm2 list 2>/dev/null | grep -E 'errored|stopped' | head -5 || echo '  全部正常'" 2>/dev/null

echo "===== 巡检完成 ====="
