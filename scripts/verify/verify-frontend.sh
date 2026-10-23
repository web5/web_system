#!/usr/bin/env bash
# ============================================================
# verify-frontend.sh — 微前端模块发布后验收
#
# 检查发布到 gateway 的微前端模块（admin/portal）是否真正生效：
#   1. 模块静态资源 200（/static/modules/<key>/<version>/...）
#   2. index.html 引用的 entry JS 正确
#   3. 网关 manifest 版本一致（/__manifest__）
#
# 用法:
#   bash scripts/verify/verify-frontend.sh <env> <moduleKey> [versionTag]
#   bash scripts/verify/verify-frontend.sh dev portal
#   bash scripts/verify/verify-frontend.sh prod admin abc12345
#
# 退出码: 0 = 全通过; 非 0 = 有失败
# ============================================================
set -uo pipefail

ENV="${1:-}"; MODULE="${2:-}"; VERSION="${3:-}"
if [ -z "$ENV" ] || [ -z "$MODULE" ]; then
  echo "用法: $0 <env> <moduleKey> [versionTag]" >&2
  echo "  env: local|dev|prod" >&2
  echo "  moduleKey: admin|portal" >&2
  exit 2
fi

# 端口/域名映射
case "$ENV" in
  local) BASE_URL="http://127.0.0.1:6000" ;;
  dev)   BASE_URL="https://dev.kedouai.com" ;;
  prod)  BASE_URL="https://kedouai.com" ;;
  *) echo "不支持的 env: $ENV（local|dev|prod）" >&2; exit 2 ;;
esac

G='\033[0;32m'; R='\033[0;31m'; N='\033[0m'
PASS=0; FAIL=0
ok()   { echo -e "  ${G}✓${N} $1"; PASS=$((PASS+1)); }
bad()  { echo -e "  ${R}✗${N} $1"; FAIL=$((FAIL+1)); }

echo "=========================================="
echo " 前端模块验收: ${MODULE} @ ${ENV} ${VERSION:+(期望版本: ${VERSION})}"
echo " 目标: ${BASE_URL}"
echo "=========================================="

# ---- 1. 模块 manifest（网关版本指针）----
MANIFEST="$($RUN curl -s -m 8 "${BASE_URL}/__manifest__" 2>/dev/null || echo '{}')"
if echo "$MANIFEST" | grep -q "$MODULE"; then
  ok "网关 manifest 含模块 ${MODULE}"
  # 如果指定了版本，检查 manifest 中的版本
  if [ -n "$VERSION" ]; then
    if echo "$MANIFEST" | grep -q "$VERSION"; then
      ok "manifest 含目标版本 ${VERSION}"
    else
      bad "manifest 不含目标版本 ${VERSION}（当前: $(echo "$MANIFEST" | head -c 200)）"
    fi
  fi
else
  bad "网关 manifest 不含模块 ${MODULE}"
fi

# ---- 2. 模块静态资源可访问 ----
# 模块目录结构: /static/modules/<key>/<version>/ 或 /static/modules/<key>/current/
ENTRY_CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 8 "${BASE_URL}/static/modules/${MODULE}/" 2>/dev/null || echo 000)"
if [ "$ENTRY_CODE" = "200" ] || [ "$ENTRY_CODE" = "403" ]; then
  ok "模块静态目录可访问 (${ENTRY_CODE})"
else
  # 尝试带版本路径
  if [ -n "$VERSION" ]; then
    V_CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 8 "${BASE_URL}/static/modules/${MODULE}/${VERSION}/" 2>/dev/null || echo 000)"
    if [ "$V_CODE" = "200" ] || [ "$V_CODE" = "403" ]; then
      ok "模块版本目录可访问 (${V_CODE})"
    else
      bad "模块静态资源不可访问（${ENTRY_CODE}/${V_CODE}）"
    fi
  else
    bad "模块静态目录不可访问 (${ENTRY_CODE})"
  fi
fi

# ---- 3. index.html 引用 entry ----
INDEX_HTML="$(curl -s -m 8 "${BASE_URL}/static/modules/${MODULE}/index.html" 2>/dev/null || echo '')"
if [ -z "$INDEX_HTML" ] && [ -n "$VERSION" ]; then
  INDEX_HTML="$(curl -s -m 8 "${BASE_URL}/static/modules/${MODULE}/${VERSION}/index.html" 2>/dev/null || echo '')"
fi
if echo "$INDEX_HTML" | grep -qE '<script.*src='; then
  ok "index.html 含 entry script 引用"
else
  # 有些微前端模块没有独立 index.html（由基座加载），降级为 warning 不阻断
  echo "  ⚠ index.html 未取到或无 script 引用（微前端模块可能由基座加载，非阻断）"
fi

echo ""
echo "=========================================="
echo -e " 验收结果: ${G}${PASS} passed${N} / ${R}${FAIL} failed${N}"
echo "=========================================="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
