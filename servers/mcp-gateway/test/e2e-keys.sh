#!/bin/bash
# ===========================================================
# mcp-gateway 端到端测试脚本（带环境标注）
#
# 【环境说明 —— 重要】
#   测试前必须明确当前测的是哪套环境，测试输出会带 [DEV]/[PROD] 前缀，
#   涉及发邮件的用例会在响应里标注「验证码邮件由 XX 环境发出」。
#
#   DEV  (175.27.189.123)  : 开发环境，mcp-gateway 直接跑 dist，finnews 同机
#   PROD (106.52.176.246)  : 生产环境，mcp-gateway 6006；finnews 数据
#                            经公网调 DEV 的 finnews 服务
#
#   公网入口（SSL 层 42.194.200.69）：
#     https://kedouai.com/mcp/finnews      → MCP 协议端点（现网域名）
#     https://kedouai.com/api/mcp/keys/*   → key 申请/管理接口
#
# 用法:
#   ./test/e2e-keys.sh dev              # 测 DEV 环境
#   ./test/e2e-keys.sh prod             # 测 PROD 环境
#   ./test/e2e-keys.sh dev --public     # 走公网正式域名测（不区分环境，走 SSL 层）
#
# 依赖的环境变量（发真实邮件/MCP 调用时需要）:
#   MCP_TEST_CLIENT_KEY   旧的共享 MCP_CLIENT_KEY（兼容性用例）
#   MCP_TEST_ADMIN_KEY    管理端 X-Admin-Key（list/revoke 用例）
# ===========================================================
set -u

ENV_ARG="${1:-}"
PUBLIC="${2:-}"

# ---- 环境配置表 ----
declare -A HOSTS=(
  [dev]="http://175.27.189.123:6006"
  [prod]="http://106.52.176.246:6006"
)
declare -A LABELS=(
  [dev]="DEV"
  [prod]="PROD"
)
PUBLIC_BASE="https://kedouai.com"

if [ -z "$ENV_ARG" ] || [ -z "${HOSTS[$ENV_ARG]:-}" ]; then
  echo "用法: $0 [dev|prod] [--public]"
  echo "  dev  = DEV  环境 (175.27.189.123:6006)"
  echo "  prod = PROD 环境 (106.52.176.246:6006)"
  echo "  追加 --public 则走公网正式域名 kedouai.com（经 SSL 层，不区分环境）"
  exit 1
fi

BASE="${HOSTS[$ENV_ARG]}"
LABEL="${LABELS[$ENV_ARG]}"
if [ "$PUBLIC" = "--public" ]; then
  BASE="$PUBLIC_BASE"
  LABEL="PUBLIC(SSL层)"
fi

PASS=0; FAIL=0
section() { echo; echo "===== $1 ====="; }
check() { # $1=描述 $2=期望http $3=实际http
  if [ "$2" = "$3" ]; then echo "  ✅ [$LABEL] $1 (HTTP $3)"; PASS=$((PASS+1));
  else echo "  ❌ [$LABEL] $1 期望 $2 实际 $3"; FAIL=$((FAIL+1)); fi
}

echo "=============================================="
echo " mcp-gateway E2E 测试"
echo " 环境: $LABEL"
echo " 端点: $BASE"
[ "$PUBLIC" = "--public" ] && echo " (公网模式: MCP 端点=/mcp/finnews, key 接口=/api/mcp/keys/*)"
echo " 提示: 涉及邮件的用例, 验证码邮件由【$LABEL 环境】发出"
echo "=============================================="

section "1. 服务健康"
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$BASE/api/keys" )
if [ "$code" = "401" ] || [ "$code" = "403" ]; then
  echo "  ✅ [$LABEL] 服务在线（/api/keys 未带管理key 返回 $code, 符合预期）"; PASS=$((PASS+1))
else
  echo "  ❌ [$LABEL] 服务异常, /api/keys 返回 $code"; FAIL=$((FAIL+1))
fi

section "2. apply 申请验证码（会发真实邮件！）"
read -r -p "  输入接收验证码的真实邮箱（直接回车跳过此用例）: " EMAIL
if [ -n "$EMAIL" ]; then
  echo "  ⚠️  即将从【$LABEL 环境】向 $EMAIL 发送验证码邮件"
  if [ "$PUBLIC" = "--public" ]; then
    resp=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/mcp/keys/apply" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"name\":\"e2e-$LABEL\"}")
  else
    resp=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/keys/apply" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"name\":\"e2e-$LABEL\"}")
  fi
  code=$(echo "$resp" | tail -1)
  echo "  响应: $(echo "$resp" | head -1)"
  check "apply 发送验证码（邮件来源: $LABEL）" "201" "$code"
else
  echo "  ⏭️  跳过"
fi

section "3. MCP 协议端点鉴权（无 key 应 401）"
if [ "$PUBLIC" = "--public" ]; then MCP_PATH="$BASE/mcp/finnews"; else MCP_PATH="$BASE/mcp/finnews"; fi
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 -X POST "$MCP_PATH" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e","version":"1.0"}}}')
check "initialize 无 key 401" "401" "$code"

section "4. MCP 协议端点（共享 MCP_CLIENT_KEY 兼容）"
if [ -n "${MCP_TEST_CLIENT_KEY:-}" ]; then
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 -X POST "$MCP_PATH" \
    -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer $MCP_TEST_CLIENT_KEY" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e","version":"1.0"}}}')
  check "initialize 旧共享 key 200" "200" "$code"
else
  echo "  ⏭️  未设置 MCP_TEST_CLIENT_KEY, 跳过"
fi

section "5. 管理接口 list（X-Admin-Key）"
if [ -n "${MCP_TEST_ADMIN_KEY:-}" ]; then
  if [ "$PUBLIC" = "--public" ]; then ADMIN_URL="$BASE/api/mcp/keys"; else ADMIN_URL="$BASE/api/keys"; fi
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$ADMIN_URL" -H "X-Admin-Key: $MCP_TEST_ADMIN_KEY")
  check "admin list keys 200" "200" "$code"
else
  echo "  ⏭️  未设置 MCP_TEST_ADMIN_KEY, 跳过"
fi

echo
echo "=============================================="
echo " 结果: $PASS 通过 / $FAIL 失败 （环境: $LABEL）"
echo "=============================================="
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
