#!/usr/bin/env bash
#
# 同步权限点与内置角色权限（以 packages/types 的代码声明为准，幂等）
#
# 为什么需要它：权限点是 user-service 启动时 seed 到 DB 的，而
#   - 后端各服务鉴权读【代码常量】
#   - 前端菜单读【DB】（/api/permissions/my）
# 只重启后端服务不改 DB，就会出现"接口调得通但菜单不出现"。发布后跑一次本脚本即可。
#
# 用法：
#   bash scripts/sync-permissions.sh                 # 默认 127.0.0.1:6002
#   USER_SERVICE_URL=http://host:6002 bash scripts/sync-permissions.sh
#   INTERNAL_API_KEY=xxx bash scripts/sync-permissions.sh
#
# ⚠️ 会全量覆盖内置角色（admin / editor / viewer）的权限；自定义角色不受影响。
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

USER_SERVICE_URL="${USER_SERVICE_URL:-http://127.0.0.1:6002}"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/servers/user-service/.env}"

KEY="${INTERNAL_API_KEY:-}"
if [ -z "$KEY" ] && [ -f "$ENV_FILE" ]; then
  KEY=$(grep -E '^INTERNAL_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)
fi
if [ -z "$KEY" ]; then
  echo "✗ 未找到 INTERNAL_API_KEY：请用环境变量注入，或确认 $ENV_FILE 中存在该配置" >&2
  exit 1
fi

URL="${USER_SERVICE_URL%/}/internal/permissions/sync"
echo "→ 同步权限点：$URL"

RESP=$(curl -s -m 20 -X POST "$URL" -H "x-internal-key: $KEY" || true)
echo "$RESP"

case "$RESP" in
  *'"code":0'*)
    echo "✓ 权限同步完成（前端菜单下次刷新即生效）"
    ;;
  *)
    echo "✗ 权限同步失败：请确认 user-service 已启动、INTERNAL_API_KEY 与调用方一致" >&2
    exit 1
    ;;
esac
