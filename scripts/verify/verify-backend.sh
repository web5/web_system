#!/usr/bin/env bash
# ============================================================
# verify-backend.sh — 后端服务发布后验收（wrapper）
#
# 真源在 deploy-console 内（随构建产物分发）：
#   servers/deploy-console/src/pipeline/scripts/verify-backend.sh
# 本文件是 wrapper：统一入口 + 参数适配，真源改动请改 console 里的那份。
#
# 为什么单独一层：
#   1. 发布流程统一调用 scripts/verify/ 下的入口（不管真源在哪）
#   2. 真源可能随 console 构建产物分发到远端，本地 wrapper 保证入口稳定
#
# 用法:
#   bash scripts/verify/verify-backend.sh <env> <moduleKey> [versionTag]
#   bash scripts/verify/verify-backend.sh dev user-service
#   bash scripts/verify/verify-backend.sh prod gateway abc12345
#
# 退出码: 0 = verified; 非 0 = failed/unknown
# ============================================================
set -uo pipefail

ENV="${1:-}"; MODULE="${2:-}"; VERSION="${3:-}"
if [ -z "$ENV" ] || [ -z "$MODULE" ]; then
  echo "用法: $0 <env> <moduleKey> [versionTag]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# 优先找真源（deploy-console 内），找不到则提示
CANONICAL=""
for candidate in \
  "$ROOT/servers/deploy-console/src/pipeline/scripts/verify-backend.sh" \
  "$ROOT/servers/deploy-console/dist/pipeline/scripts/verify-backend.sh" \
  "$HOME/web_system_release/servers/deploy-console/dist/pipeline/scripts/verify-backend.sh"; do
  if [ -f "$candidate" ]; then
    CANONICAL="$candidate"
    break
  fi
done

if [ -z "$CANONICAL" ]; then
  echo "⚠ 找不到 verify-backend.sh 真源（应位于 deploy-console 的 pipeline/scripts/）" >&2
  echo "  回退到 health-check.sh 做基础探活（覆盖面较窄）" >&2
  exec bash "$ROOT/scripts/health-check.sh" "$ENV"
fi

echo "使用真源: $CANONICAL"

# 适配参数格式给真源（真源使用环境变量式参数）
export RELEASE_DIR="${RELEASE_DIR:-$HOME/web_system_release}"
export MODULE_KEY="$MODULE"
export MODULE_TYPE="backend"
export ENV="$ENV"
[ -n "$VERSION" ] && export VERSION_TAG="$VERSION"

# 按环境设置端口基址
case "$ENV" in
  local) export PORT_BASE=6000 ;;
  dev)   export PORT_BASE=6000 ;;
  prod)  export PORT_BASE=3000 ;;
esac

exec bash "$CANONICAL"
