#!/usr/bin/env bash
# ============================================================
# apply-migrations.sh — 按序应用 migrations/*.sql（幂等）
#
# 背景：服务在 NODE_ENV=production 时 TypeORM synchronize 关闭，新表不会自动创建；
#       此前只能手工补 DDL（dev/prod 都踩过：QueryFailedError: Table 'x' doesn't exist）。
#       本脚本把 migrations/ 纳入发布流程：发布（或升级）前跑一次即可。
#
# 特性：
#   - 顺序应用 migrations/*.sql（按文件名排序）
#   - 幂等：已应用记录在 schema_migrations 表，二次执行自动跳过；
#     迁移文件本身也多为 CREATE TABLE IF NOT EXISTS（双保险）
#   - 目标库：迁移文件头 `-- @database <db>` 注解优先，否则用默认库（web_system）
#   - 多环境：local（本机 socket）/ dev（SSH，地址取 scripts/.env.deploy 的 DEV_SERVER）/ prod（同 PROD_SERVER）
#     dev/prod 复用目标机远端目录 .env 的 DB_* 凭据（密码不进命令行）
#   - DRY_RUN=1 只打印将要执行的文件
#
# 用法：
#   ./scripts/apply-migrations.sh local
#   ./scripts/apply-migrations.sh dev
#   ./scripts/apply-migrations.sh prod
#   ./scripts/apply-migrations.sh dev --db web_system      # 覆盖默认库
#   DRY_RUN=1 ./scripts/apply-migrations.sh dev
#
# 存量库首次接入（重要）：
#   0001 等 ALTER 型历史迁移无法幂等重跑，存量库请先基线记账、再正常应用：
#   ./scripts/apply-migrations.sh dev --baseline-through 0006_dict_tables.sql
#
# 纳入发布：发布（升级）前执行一次对应环境命令即可；
#   幂等，重复执行只会跳过已应用项。
#
# 依赖：本机需有 mysql 客户端（local 用 socket；dev/prod 走目标机的 mysql）。
#   local 目标库 root 如有密码：MYSQL_PWD=<密码> ./scripts/apply-migrations.sh local
#   （mysql 客户端自动读 MYSQL_PWD，密码不进命令行）
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1090
[ -f "$SCRIPTS_DIR/.env.deploy" ] && source "$SCRIPTS_DIR/.env.deploy"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"
TARGET="${1:-}"
shift || true

OVERRIDE_DB=""
BASELINE_THROUGH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --db) OVERRIDE_DB="${2:-}"; shift 2 ;;
    --baseline-through) BASELINE_THROUGH="${2:-}"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

DRY_RUN="${DRY_RUN:-0}"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[migrate]${NC} $1"; }
warn() { echo -e "${YELLOW}[migrate][WARN]${NC} $1"; }
err()  { echo -e "${RED}[migrate][ERROR]${NC} $1" >&2; exit 1; }

[ -d "$MIGRATIONS_DIR" ] || err "找不到 migrations 目录: $MIGRATIONS_DIR"

# ---------- 目标环境 ----------
case "$TARGET" in
  local) SSH_TARGET=""; REMOTE_DIR=""; DEFAULT_DB="web_system" ;;
  dev)   SSH_TARGET="${DEV_SERVER:-}";  REMOTE_DIR="${DEV_REMOTE_DIR:-/data/web_system}";  DEFAULT_DB="web_system" ;;
  prod)  SSH_TARGET="${PROD_SERVER:-}"; REMOTE_DIR="${PROD_REMOTE_DIR:-/data/web_system}"; DEFAULT_DB="web_system" ;;
  *)     err "用法: $0 <local|dev|prod> [--db <dbname>]" ;;
esac

# 远端目标必须显式配置（脚本内不再内置任何真实服务器地址）
case "$TARGET" in
  dev)  [ -n "$SSH_TARGET" ] || err "未在 scripts/.env.deploy 配置 DEV_SERVER（参考 .env.deploy.example）" ;;
  prod) [ -n "$SSH_TARGET" ] || err "未在 scripts/.env.deploy 配置 PROD_SERVER（参考 .env.deploy.example）" ;;
esac

find_local_mysql() {
  if command -v mysql >/dev/null 2>&1; then echo "mysql"; return; fi
  for p in "$HOME"/local/mysql-*/bin/mysql "$HOME"/local/mysql/bin/mysql; do
    [ -x "$p" ] && { echo "$p"; return; }
  done
  echo ""
}

migration_db() { # 头部注解优先
  local f="$1" db
  db="$(grep -m1 -E '^--[[:space:]]*@database[[:space:]]+' "$f" 2>/dev/null | awk '{print $3}')"
  [ -n "$db" ] && echo "$db" || echo "${OVERRIDE_DB:-$DEFAULT_DB}"
}

# ---------- 远端：上传 SQL 文件后用目标机凭据执行 ----------
remote_apply() { # $1=db  $2=远端 SQL 文件路径
  local db="$1" rfile="$2"
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$SSH_TARGET" "bash -s" <<REMOTE
set -euo pipefail
cd "$REMOTE_DIR"
[ -f .env ] || { echo "远端缺少 .env: $REMOTE_DIR/.env" >&2; exit 1; }
H="\$(grep -m1 '^DB_HOST=' .env | cut -d= -f2-)"
P="\$(grep -m1 '^DB_PORT=' .env | cut -d= -f2-)"
U="\$(grep -m1 '^DB_USERNAME=' .env | cut -d= -f2-)"
W="\$(grep -m1 '^DB_PASSWORD=' .env | cut -d= -f2-)"
CNF="\$(mktemp)"; trap 'rm -f "\$CNF"' EXIT
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' "\$H" "\${P:-3306}" "\$U" "\$W" > "\$CNF"
chmod 600 "\$CNF"
mysql --defaults-extra-file="\$CNF" --default-character-set=utf8mb4 "$db" < "$rfile"
REMOTE
}

# ---------- 统一入口：stdin=SQL，按目标环境执行 ----------
run_sql() { # $1=db   ← SQL on stdin
  local db="$1" tmp rc
  tmp="$(mktemp)"; cat > "$tmp"
  if [ "$TARGET" = "local" ]; then
    local MYSQL_BIN MYSQL_SOCKET LOCAL_ENV
    MYSQL_BIN="$(find_local_mysql)"
    [ -n "$MYSQL_BIN" ] || { rm -f "$tmp"; err "本机找不到 mysql 客户端"; }
    # 本机有仓库根 .env（如 dev 服务器上由 console 调用）→ 用其 DB_* 凭据；
    # 否则回落 socket + root（本地开发机）
    LOCAL_ENV="$SCRIPT_DIR/.env"
    if [ -f "$LOCAL_ENV" ] && grep -q '^DB_USERNAME=' "$LOCAL_ENV" 2>/dev/null; then
      local H P U W
      H="$(grep -m1 '^DB_HOST=' "$LOCAL_ENV" | cut -d= -f2-)"
      P="$(grep -m1 '^DB_PORT=' "$LOCAL_ENV" | cut -d= -f2-)"
      U="$(grep -m1 '^DB_USERNAME=' "$LOCAL_ENV" | cut -d= -f2-)"
      W="$(grep -m1 '^DB_PASSWORD=' "$LOCAL_ENV" | cut -d= -f2-)"
      MYSQL_PWD="$W" "$MYSQL_BIN" -h "${H:-127.0.0.1}" -P "${P:-3306}" -u "$U" \
        --default-character-set=utf8mb4 "$db" < "$tmp"
    else
      MYSQL_SOCKET="${MYSQL_SOCKET:-$HOME/local/mysql-data/mysql.sock}"
      if [ -S "$MYSQL_SOCKET" ]; then
        "$MYSQL_BIN" --socket="$MYSQL_SOCKET" -uroot --default-character-set=utf8mb4 "$db" < "$tmp"
      else
        "$MYSQL_BIN" -h 127.0.0.1 -uroot --default-character-set=utf8mb4 "$db" < "$tmp"
      fi
    fi
    rc=$?
  else
    scp -q -o BatchMode=yes -o ConnectTimeout=15 "$tmp" "$SSH_TARGET:/tmp/_ws_mig.sql" || { rm -f "$tmp"; return 1; }
    remote_apply "$db" /tmp/_ws_mig.sql; rc=$?
    ssh -o BatchMode=yes "$SSH_TARGET" 'rm -f /tmp/_ws_mig.sql' >/dev/null 2>&1 || true
  fi
  rm -f "$tmp"
  return $rc
}

# ---------- 主流程 ----------
log "目标环境: $TARGET${SSH_TARGET:+（${SSH_TARGET}）}  默认库: ${OVERRIDE_DB:-$DEFAULT_DB}"
[ "$DRY_RUN" = "1" ] && warn "DRY_RUN=1（只打印，不落库）"

applied=0; skipped=0; failed=0; baselined=0
for f in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  db="$(migration_db "$f")"

  if [ "$DRY_RUN" = "1" ]; then
    if [ -n "$BASELINE_THROUGH" ] && [ "$name" \< "$BASELINE_THROUGH" -o "$name" = "$BASELINE_THROUGH" ]; then
      log "[dry-run] 基线（只记账不执行）: $name → $db"
    else
      log "[dry-run] 将应用 $name → 库 $db"
    fi
    continue
  fi

  # 基线：存量库已含该迁移的变更，只记账不执行（0001 等 ALTER 型迁移无法幂等重跑）
  if [ -n "$BASELINE_THROUGH" ] && { [ "$name" \< "$BASELINE_THROUGH" ] || [ "$name" = "$BASELINE_THROUGH" ]; }; then
    printf "CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);\nINSERT INTO schema_migrations(name) VALUES ('%s') ON DUPLICATE KEY UPDATE applied_at=applied_at;\n" "$name" | run_sql "$db" >/dev/null 2>&1 \
      && { baselined=$((baselined+1)); log "基线记账（未执行）: $name → $db"; } \
      || { failed=$((failed+1)); warn "基线记账失败: $name → $db"; }
    continue
  fi

  # 已应用则跳过（schema_migrations 记账）
  already="$(printf "CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);\nSELECT COUNT(*) FROM schema_migrations WHERE name='%s';\n" "$name" | run_sql "$db" 2>/dev/null | tail -1)"
  if [ "${already:-0}" = "1" ]; then
    skipped=$((skipped+1)); log "跳过（已应用）: $name → $db"
    continue
  fi

  if { cat "$f"; printf "\nINSERT INTO schema_migrations(name) VALUES ('%s') ON DUPLICATE KEY UPDATE applied_at=NOW();\n" "$name"; } | run_sql "$db" >/tmp/migrate-out.txt 2>&1; then
    applied=$((applied+1)); log "已应用: $name → $db"
  else
    failed=$((failed+1)); warn "应用失败: $name → $db"; tail -5 /tmp/migrate-out.txt | sed 's/^/    /'
  fi
done

log "完成：应用 $applied 个 / 基线记账 $baselined 个 / 跳过 $skipped 个 / 失败 $failed 个"
[ "$failed" -gt 0 ] && exit 1
exit 0
