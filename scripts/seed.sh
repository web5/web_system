#!/usr/bin/env bash
# ============================================================
# seed.sh — 统一数据库种子入口（收敛散落的 *.mjs 种子脚本）
#
# 用法：
#   ./scripts/seed.sh dev admin              # 创建/重置本地 admin 账号
#   ./scripts/seed.sh dev deployment         # 插入前端模块部署种子数据
#   ./scripts/seed.sh dev reset-admin-pwd    # 重置 admin 密码为 deploy2026
#   ./scripts/seed.sh prod admin             # 生产 admin（走 kedou-prod 跳板）
#
# 说明：
#   - dev 直连本地/跳板机本地 MySQL；prod 经 kedou-prod 连内网库
#   - 密码统一从 scripts/.env.deploy 注入环境变量，避免在各 mjs 里硬编码
# ============================================================
set -uo pipefail

TARGET="${1:?用法: $0 <dev|prod> <admin|deployment|reset-admin-pwd>}"
ACTION="${2:?用法: $0 <dev|prod> <admin|deployment|reset-admin-pwd>}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.deploy"
[ -f "$ENV_FILE" ] || { echo "[ERROR] 未找到 $ENV_FILE"; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

case "$TARGET" in
  dev)
    DB_HOST="${DEV_DB_HOST:-127.0.0.1}"; DB_PORT="${DEV_DB_PORT:-3306}"
    DB_USER="${DEV_DB_USER:-root}"; DB_PASS="${DEV_DB_PASS:-}"
    ;;
  prod)
    DB_HOST="${PROD_DB_HOST:-172.16.16.10}"; DB_PORT="${PROD_DB_PORT:-3306}"
    DB_USER="${PROD_DB_USER:-root}"; DB_PASS="${PROD_DB_PASS:-}"
    ;;
  *) echo "目标必须为 dev|prod"; exit 1 ;;
esac

# 把 DB 连接注入环境变量，供各 mjs 脚本读取（避免硬编码）
export DB_HOST DB_PORT DB_USERNAME="$DB_USER" DB_PASSWORD="$DB_PASS"
export DB_DATABASE="${TARGET}_web_system"

echo "===== seed $TARGET / $ACTION ====="
case "$ACTION" in
  admin)
    node "$SCRIPT_DIR/seed-admin.mjs"
    ;;
  deployment)
    node "$SCRIPT_DIR/seed-dev-deployment.mjs"
    ;;
  reset-admin-pwd)
    node "$SCRIPT_DIR/reset-auth-admin-password.mjs"
    ;;
  *)
    echo "未知操作: $ACTION（支持: admin | deployment | reset-admin-pwd）"
    exit 1
    ;;
esac
echo "===== seed 完成 ====="
