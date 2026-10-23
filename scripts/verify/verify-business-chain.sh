#!/usr/bin/env bash
# ============================================================
# verify-business-chain.sh — 跨服务业务链路验收
#
# 检查关键业务链路是否端到端可用（不只是端口通）：
#   1. gateway /health 200（入口存活）
#   2. auth 登录接口可达（/api/auth/login 200|400|401，非 000/500）
#   3. user-service 通过网关可达（/api/user/profile 200|401）
#   4. （可选）AI 链路：/api/ai/models 200|401
#
# 为什么需要：历史事故里"端口通、业务链断" —— 端口探活完全看不出来
#   （auth 未注册 / 网关 401 / 跨服务密钥不一致）。
#
# 用法:
#   bash scripts/verify/verify-business-chain.sh <env>
#   bash scripts/verify/verify-business-chain.sh dev
#   bash scripts/verify/verify-business-chain.sh local
#
# 退出码: 0 = 全通过; 非 0 = 有失败
# ============================================================
set -uo pipefail

ENV="${1:-local}"

case "$ENV" in
  local) BASE="http://127.0.0.1:6000" ;;
  dev)   BASE="https://dev.kedouai.com" ;;
  prod)  BASE="https://kedouai.com" ;;
  *) echo "用法: $0 <local|dev|prod>" >&2; exit 2 ;;
esac

G='\033[0;32m'; R='\033[0;31m'; N='\033[0m'
PASS=0; FAIL=0
ok()   { echo -e "  ${G}✓${N} $1"; PASS=$((PASS+1)); }
bad()  { echo -e "  ${R}✗${N} $1"; FAIL=$((FAIL+1)); }

# 判断 HTTP 状态是否"服务存活"（不同接口有不同合法状态码）
alive() {
  local code="$1"; shift
  for expect in "$@"; do
    [ "$code" = "$expect" ] && return 0
  done
  return 1
}

echo "=========================================="
echo " 业务链路验收: ${ENV} (${BASE})"
echo "=========================================="

# ---- 1. gateway /health ----
CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 8 "${BASE}/health" 2>/dev/null || echo 000)"
if alive "$CODE" 200; then
  ok "gateway /health = ${CODE}"
else
  bad "gateway /health = ${CODE}（期望 200）"
fi

# ---- 2. auth 登录接口可达（不要求真登录，只验接口在）----
CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 8 -X POST "${BASE}/api/auth/login" \
  -H 'Content-Type: application/json' -d '{}' 2>/dev/null || echo 000)"
if alive "$CODE" 200 400 401 422; then
  ok "auth /api/auth/login 可达 = ${CODE}（400/401/422 = 参数错但服务在）"
else
  bad "auth /api/auth/login = ${CODE}（期望 200/400/401/422，000=不可达）"
fi

# ---- 3. user-service 通过网关可达 ----
CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 8 "${BASE}/api/user/profile" 2>/dev/null || echo 000)"
if alive "$CODE" 200 401 403; then
  ok "user /api/user/profile = ${CODE}（401/403 = 需鉴权但服务在）"
else
  bad "user /api/user/profile = ${CODE}（期望 200/401/403）"
fi

# ---- 4. AI 链路（可选，不阻断主判据）----
CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 8 "${BASE}/api/ai/models" 2>/dev/null || echo 000)"
if alive "$CODE" 200 401; then
  ok "ai /api/ai/models = ${CODE}"
else
  echo "  ⚠ ai /api/ai/models = ${CODE}（非核心项，不阻断）"
fi

echo ""
echo "=========================================="
echo -e " 验收结果: ${G}${PASS} passed${N} / ${R}${FAIL} failed${N}"
echo "=========================================="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
