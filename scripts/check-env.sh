#!/usr/bin/env bash
# ============================================================
# check-env.sh — 环境配置巡检
# 用法：
#   ./scripts/check-env.sh            # 对比本机（当前目录）与 .env.example
#   ./scripts/check-env.sh dev        # 对比 dev 服务器（175.27.189.123）
#   ./scripts/check-env.sh prod       # 对比 prod 服务器（106.52.176.246）
# 输出：缺失变量 / 空值变量 / 与模板差异
# ============================================================
set -uo pipefail

DEV_HOST="ubuntu@175.27.189.123"
PROD_HOST="root@106.52.176.246"
REMOTE_PATH="/data/web_system/.env.production"
TEMPLATE="$(cd "$(dirname "$0")/.." && pwd)/.env.example"

usage() { echo "用法: $0 [dev|prod]"; exit 1; }

declare -a KEYS
while IFS='=' read -r line; do
  case "$line" in
    ''|\#*) continue ;;
  esac
  KEY="${line%%=*}"
  [[ "$KEY" =~ ^[A-Z_]+$ ]] && KEYS+=("$KEY")
done < "$TEMPLATE"

ENV_CONTENT=""
if [ $# -eq 0 ]; then
  ENV_CONTENT="$(cat .env.production 2>/dev/null || echo '')"
elif [ "$1" = "dev" ]; then
  ENV_CONTENT="$(ssh -o ConnectTimeout=10 -o BatchMode=yes "$DEV_HOST" "cat $REMOTE_PATH" 2>/dev/null || echo '')"
elif [ "$1" = "prod" ]; then
  ENV_CONTENT="$(ssh -o ConnectTimeout=10 -o BatchMode=yes "$PROD_HOST" "cat $REMOTE_PATH" 2>/dev/null || echo '')"
else
  usage
fi

echo "===== 巡检：${1:-本机} ====="
echo "--- 缺失变量（模板有、环境没有）---"
MISSING=0
for k in "${KEYS[@]}"; do
  if ! grep -qE "^${k}=" <<<"$ENV_CONTENT"; then
    echo "  [缺失] $k"
    MISSING=1
  fi
done
[ "$MISSING" = "0" ] && echo "  （无）"

echo "--- 空值变量 ---"
EMPTY=0
while IFS='=' read -r line; do
  case "$line" in ''|\#*) continue ;; esac
  k="${line%%=*}"
  v="${line#*=}"
  if [[ "$k" =~ ^[A-Z_]+$ ]] && [ -z "$v" ]; then
    echo "  [空值] $k"
    EMPTY=1
  fi
done <<<"$ENV_CONTENT"
[ "$EMPTY" = "0" ] && echo "  （无）"

echo "--- 占位符检测（REPLACE_ME / xxx / your-）---"
PLACEHOLDER=0
while IFS='=' read -r line; do
  case "$line" in ''|\#*) continue ;; esac
  k="${line%%=*}"; v="${line#*=}"
  if [[ "$k" =~ ^[A-Z_]+$ ]] && [[ "$v" =~ (REPLACE_ME|xxx|your-) ]]; then
    echo "  [占位符] $k=$v"
    PLACEHOLDER=1
  fi
done <<<"$ENV_CONTENT"
[ "$PLACEHOLDER" = "0" ] && echo "  （无）"

echo "--- 常见端口/变量一致性提醒 ---"
for pair in "AUTH_SERVICE_URL:3001:6001" "USER_SERVICE_URL:3002:6002" "CONTENT_HUB_SERVICE_URL:6007:6007"; do
  IFS=':' read -r k prod_port dev_port <<<"$pair"
  v=$(grep -E "^${k}=" <<<"$ENV_CONTENT" | head -1 | cut -d= -f2-)
  [ -n "$v" ] && echo "  $k=$v"
done
echo "===== 巡检完成 ====="
