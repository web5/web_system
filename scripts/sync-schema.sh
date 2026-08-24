#!/usr/bin/env bash
# ============================================================
# sync-schema.sh — 双库 Schema 同步（dev 本机 MySQL / prod 腾讯云 MySQL）
#
# 用法：
#   ./scripts/sync-schema.sh dev    # 同步 dev 库
#   ./scripts/sync-schema.sh prod   # 同步 prod 库
#   DRY_RUN=1 ./scripts/sync-schema.sh dev   # 只看将执行的操作
#
# 幂等：列存在则跳过、表存在则跳过，可重复执行。
# 密码可用环境变量覆盖：DEV_DB_PASSWORD / PROD_DB_PASSWORD
# ============================================================
set -uo pipefail

TARGET="${1:-}"
DRY_RUN="${DRY_RUN:-0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/../migrations"

case "$TARGET" in
  dev)
    DB_HOST="${DEV_DB_HOST:-127.0.0.1}"; DB_USER="root"
    DB_PASS="${DEV_DB_PASSWORD:-web_system_root_2026}"; DB_NAME="web_system" ;;
  prod)
    DB_HOST="${PROD_DB_HOST:-172.16.16.10}"; DB_USER="root"
    DB_PASS="${PROD_DB_PASSWORD:-gn%!CTvZNP0e4%Lc}"; DB_NAME="web_system" ;;
  *)
    echo "用法: $0 <dev|prod>   (可选 DRY_RUN=1 预览)"; exit 1 ;;
esac

run_sql() { mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "$1" 2>/dev/null; }
run_sql_file() { mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$1" 2>/dev/null; }

log() { echo "[sync] $*"; }
say() {
  if [ "$DRY_RUN" = "1" ]; then echo "  [dry-run] $*"; else "$@"; fi
}

col_exists() { # $1=table $2=column
  local c
  c=$(run_sql "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='$1' AND COLUMN_NAME='$2'" | tail -1)
  [ "${c:-0}" = "1" ]
}

add_col() { # $1=table $2=column $3=def
  if col_exists "$1" "$2"; then
    echo "  [skip] $1.$2 已存在"
  else
    echo "  [add ] $1.$2 $3"
    [ "$DRY_RUN" = "1" ] || run_sql "ALTER TABLE \`$1\` ADD COLUMN \`$2\` $3"
  fi
}

ensure_table() { # $1=table $2=create_sql
  if run_sql "SHOW TABLES LIKE '$1'" | grep -q "$1"; then
    echo "  [skip] 表 $1 已存在"
  else
    echo "  [create] $1"
    [ "$DRY_RUN" = "1" ] || run_sql "$2"
  fi
}

echo "===== Schema 同步：$TARGET ($DB_HOST/$DB_NAME) ====="

# ---------- users ----------
echo "--- users ---"
add_col users gender "VARCHAR(10) NOT NULL DEFAULT 'unknown' COMMENT '性别 male/female/unknown'"
add_col users mp_openid "VARCHAR(100) NULL COMMENT '微信小程序 openid'"
add_col users oa_openid "VARCHAR(100) NULL COMMENT '微信公众号 openid'"
add_col users daily_transform_limit "INT NULL COMMENT '每日变身次数上限'"
add_col users created_at "DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间'"
add_col users updated_at "DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间'"
add_col users deleted_at "DATETIME(6) NULL COMMENT '软删除时间'"

# ---------- mcp_api_keys ----------
echo "--- mcp_api_keys ---"
add_col mcp_api_keys owner_id "BIGINT UNSIGNED NULL COMMENT '绑定用户ID，null=邮箱自助'"
add_col mcp_api_keys source "VARCHAR(16) NULL DEFAULT 'apply' COMMENT '来源 apply/admin'"
add_col mcp_api_keys updated_at "DATETIME(6) NULL"
add_col mcp_api_keys deleted_at "DATETIME(6) NULL"

# ---------- mcp_key_codes ----------
echo "--- mcp_key_codes ---"
add_col mcp_key_codes updated_at "DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)"
add_col mcp_key_codes deleted_at "DATETIME(6) NULL"

# ---------- mcp_modules / mcp_tools ----------
echo "--- mcp_modules / mcp_tools ---"
for t in mcp_modules mcp_tools; do
  add_col "$t" created_at "DATETIME(6) NULL"
  add_col "$t" updated_at "DATETIME(6) NULL"
  add_col "$t" deleted_at "DATETIME(6) NULL"
done

# ---------- conversations（ai-service）----------
echo "--- conversations ---"
add_col conversations user_id "BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '用户 ID'"
add_col conversations created_at "DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)"
add_col conversations updated_at "DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)"
add_col conversations deleted_at "DATETIME(6) NULL"
# 旧 camelCase 列放宽（新实体用 snake 列，旧列保留避免 INSERT 报错）
if col_exists conversations userId; then
  echo "  [modify] conversations.userId 放宽为 NULL"
  [ "$DRY_RUN" = "1" ] || run_sql "ALTER TABLE conversations MODIFY userId VARCHAR(255) NULL"
fi
if col_exists conversations createdAt; then
  echo "  [modify] conversations.createdAt 放宽为 NULL"
  [ "$DRY_RUN" = "1" ] || run_sql "ALTER TABLE conversations MODIFY createdAt DATETIME(6) NULL"
fi
if col_exists conversations updatedAt; then
  echo "  [modify] conversations.updatedAt 放宽为 NULL"
  [ "$DRY_RUN" = "1" ] || run_sql "ALTER TABLE conversations MODIFY updatedAt DATETIME(6) NULL"
fi

# ---------- 建表：todo_tasks ----------
echo "--- todo_tasks ---"
ensure_table todo_tasks "CREATE TABLE IF NOT EXISTS todo_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '任务 ID',
  title VARCHAR(255) NOT NULL COMMENT '标题',
  description TEXT NULL COMMENT '描述',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/in_progress/completed/overdue/cancelled',
  priority VARCHAR(20) NOT NULL DEFAULT 'medium' COMMENT 'low/medium/high',
  category JSON NULL COMMENT '分类列表',
  due_date DATETIME NULL COMMENT '截止时间',
  completed_at DATETIME NULL COMMENT '完成时间',
  user_id BIGINT UNSIGNED NOT NULL COMMENT '用户 ID',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  INDEX idx_todo_user (user_id),
  INDEX idx_todo_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务表'"

# ---------- 建表：content_*（0003 迁移）----------
echo "--- content_* （0003 迁移）---"
if [ -f "$MIGRATIONS_DIR/0003_content_hub.sql" ]; then
  if run_sql "SHOW TABLES LIKE 'content_publications'" | grep -q content_publications; then
    echo "  [skip] content_* 已存在"
  else
    echo "  [run ] migrations/0003_content_hub.sql"
    [ "$DRY_RUN" = "1" ] || run_sql_file "$MIGRATIONS_DIR/0003_content_hub.sql"
  fi
else
  echo "  [warn] 未找到 migrations/0003_content_hub.sql"
fi

# ---------- 建表：deploy_* ----------
echo "--- deploy_* ---"
ensure_table deploy_modules "CREATE TABLE IF NOT EXISTS deploy_modules (
  id VARCHAR(36) NOT NULL,
  \`key\` VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(32) NOT NULL,
  dir VARCHAR(64) NULL,
  public_path VARCHAR(128) NULL,
  entry VARCHAR(128) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_deploy_modules_key (\`key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
ensure_table deploy_deployments "CREATE TABLE IF NOT EXISTS deploy_deployments (
  id VARCHAR(36) NOT NULL,
  env_id VARCHAR(32) NOT NULL,
  module_key VARCHAR(64) NOT NULL,
  current_version VARCHAR(128) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'deployed',
  deployed_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  KEY idx_deploy_env_module (env_id, module_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
ensure_table deploy_canary_rules "CREATE TABLE IF NOT EXISTS deploy_canary_rules (
  id VARCHAR(36) NOT NULL,
  env_id VARCHAR(32) NOT NULL,
  module_key VARCHAR(64) NOT NULL,
  canary_version VARCHAR(64) NOT NULL,
  rule JSON NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"

echo "===== 同步完成 ====="
