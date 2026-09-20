#!/usr/bin/env bash
# ============================================================
# health-check.sh — 服务健康巡检（兼容 bash 3.2）
# 用法：./scripts/health-check.sh <local|dev|prod>
#   local = 本机（不走 SSH；端口以仓库根 ecosystem.config.cjs 为准，auth=6101）
#   dev   = 远程 dev（/data/web_system，6000 系列，auth=6001）
#   prod  = 远程 prod（/data/web_system，3000 系列，auth=3001）
# 检查：进程端口 / 健康接口 / MCP 端点 / AI 链路探活
#
# ⚠️ 端口双轨：auth 本机 6101（本机 6001 被其它项目占用），服务器 6001/3001。
#    改端口前先确认目标环境，别把服务器的 6001 当成笔误。
# ============================================================
set -uo pipefail

TARGET="${1:-dev}"
case "$TARGET" in
  local) SSH="eval"; SERVER_ROOT="${HOME}/web_system_release/servers"; PORT_BASE=6000; AUTH_PORT=6101 ;;
  dev)   SSH="ssh -o ConnectTimeout=10 -o BatchMode=yes kedou-dev";  SERVER_ROOT="/data/web_system/servers"; PORT_BASE=6000; AUTH_PORT=$((PORT_BASE+1)) ;;
  prod)  SSH="ssh -o ConnectTimeout=10 -o BatchMode=yes kedou-prod"; SERVER_ROOT="/data/web_system/servers"; PORT_BASE=3000; AUTH_PORT=$((PORT_BASE+1)) ;;
  *) echo "用法: $0 <local|dev|prod>"; exit 1 ;;
esac

port_of() { # $1=service_name -> port
  case "$1" in
    gateway) echo $((PORT_BASE+0)) ;;
    auth)    echo "$AUTH_PORT" ;;
    user)    echo $((PORT_BASE+2)) ;;
    ai)      echo $((PORT_BASE+3)) ;;
    system)  echo $((PORT_BASE+4)) ;;
    todo)    echo $((PORT_BASE+5)) ;;
    mcp-gateway) echo 6006 ;;
    content-hub) echo 6007 ;;
    knowledge) echo 6011 ;;
    # 以下三项端口与 PORT_BASE 无关（本机与 dev 一致，均为固定值）
    ai-agent) echo 6010 ;;
    upload) echo 6008 ;;
    deploy-console) echo 6200 ;;
  esac
}

port_up() { # $1=port → 0=监听中；远程用 ss，本机用 lsof（macOS 无 ss）
  local p="$1"
  if [ "$SSH" = "eval" ]; then
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
  else
    $SSH "ss -tln 2>/dev/null | grep -q ':$p '" 2>/dev/null
  fi
}

SERVICES="gateway auth user ai system todo mcp-gateway content-hub knowledge"
# ai-agent / upload / deploy-console：prod 端口规划未确认，只在 local|dev 巡检
[ "$TARGET" != "prod" ] && SERVICES="$SERVICES ai-agent upload deploy-console"

echo "===== 健康巡检：$TARGET ====="
echo "--- 端口监听 ---"
for name in $SERVICES; do
  port=$(port_of "$name")
  if port_up "$port"; then
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
# key 优先取 mcp-gateway 自身 .env（配置单源后的真相源）；回退 pm2 进程环境（兼容未迁移的环境）
# 注：pm2 pid 在部分环境返回空/失效 pid，直接用它会拿不到 key 而静默跳过整段探活
KEY=$($SSH "grep -m1 '^MCP_CLIENT_KEY=' $SERVER_ROOT/mcp-gateway/.env 2>/dev/null | cut -d= -f2-" 2>/dev/null)
if [ -z "$KEY" ]; then
  KEY=$($SSH 'PID=$(pm2 pid mcp-gateway 2>/dev/null); [ -n "$PID" ] && tr "\0" "\n" < /proc/$PID/environ 2>/dev/null | grep "^MCP_CLIENT_KEY=" | cut -d= -f2-')
fi
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

# AI 链路端到端探活：ai-agent → mcp-gateway → knowledge-service 的鉴权链
# （真实事故：网关侧 401 = ai-agent/gateway 的 MCP_CLIENT_KEY 不一致；
#           4010 = mcp-gateway 的 KNOWLEDGE_SERVICE_AUTH_CONFIG.token 与 knowledge-service INTERNAL_API_KEY 不一致）
echo "--- AI 链路工具调用探活（knowledge_list）---"
if [ -n "$KEY" ]; then
  R=$($SSH "curl -s --max-time 10 -X POST http://127.0.0.1:6006/mcp/tools/call -H \"Authorization: Bearer $KEY\" -H 'Content-Type: application/json' -d '{\"module\":\"knowledge\",\"tool\":\"knowledge_list\",\"args\":{}}' | head -c 200" 2>/dev/null)
  case "$R" in
    "")
      echo "  [FAIL] knowledge_list 无响应（mcp-gateway / knowledge-service 可能未启动）" ;;
    *"内部调用密钥无效"*|*4010*)
      echo "  [FAIL] knowledge_list 内部鉴权失败：mcp-gateway.KNOWLEDGE_SERVICE_AUTH_CONFIG.token ≠ knowledge-service.INTERNAL_API_KEY" ;;
    *Unauthorized*|*401*)
      echo "  [FAIL] knowledge_list 网关鉴权失败：ai-agent.MCP_CLIENT_KEY ≠ mcp-gateway.MCP_CLIENT_KEY" ;;
    *)
      echo "  [OK] knowledge_list: ${R:0:60}" ;;
  esac
  # ai-agent 侧是否配置了 MCP 网关（缺失 → MCP 工具不会注册，运行时才报「工具未注册」）
  AGENT_MCP_URL=$($SSH "grep -m1 '^MCP_GATEWAY_URL=' $SERVER_ROOT/ai-agent/.env 2>/dev/null | cut -d= -f2-" 2>/dev/null)
  if [ -n "$AGENT_MCP_URL" ]; then
    echo "  [OK] ai-agent MCP_GATEWAY_URL=$AGENT_MCP_URL"
  else
    echo "  [FAIL] ai-agent 未配置 MCP_GATEWAY_URL（所有 MCP 能力不会注册）"
  fi
else
  echo "  [warn] 未获取到 MCP_CLIENT_KEY，跳过 AI 链路探活"
fi

echo "--- 进程健康（pm2 状态异常探测）---"
$SSH "pm2 list 2>/dev/null | grep -E 'errored|stopped' | head -5 || echo '  全部正常'" 2>/dev/null

echo "===== 巡检完成 ====="
