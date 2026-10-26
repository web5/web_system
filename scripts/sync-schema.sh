#!/usr/bin/env bash
# ============================================================
# sync-schema.sh — 幂等同步数据库 schema（加列/建表）
#
# 设计原则：
#   - 所有连接信息从 scripts/.env.deploy 读取，禁止硬编码密码
#   - 密码通过 mysql --defaults-extra-file 注入，不出现在命令行/ps 里
#   - 经 kedou-dev / kedou-prod（由 setup-ssh-key.sh 打通）跳板执行
#
# 用法：
#   ./scripts/sync-schema.sh dev [db_name]      # dev 同步（默认 web_system）
#   ./scripts/sync-schema.sh prod web_system_deploy
#   DRY_RUN=1 ./scripts/sync-schema.sh dev      # 仅打印将要执行的 SQL
#
# 注意：本脚本只负责“加列/改表结构”，建表迁移请用 migrations/*.sql
# ============================================================
set -uo pipefail

TARGET="${1:?用法: $0 <dev|prod> [db_name]}"
DB_NAME="${2:-web_system}"
DRY_RUN="${DRY_RUN:-0}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.deploy"
[ -f "$ENV_FILE" ] || { echo "[ERROR] 未找到 $ENV_FILE"; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

case "$TARGET" in
  dev)
    SSH_ALIAS="kedou-dev"
    DB_HOST="${DEV_DB_HOST:-127.0.0.1}"; DB_PORT="${DEV_DB_PORT:-3306}"
    DB_USER="${DEV_DB_USER:-root}"; DB_PASS="${DEV_DB_PASS:-}"
    ;;
  prod)
    SSH_ALIAS="kedou-prod"
    DB_HOST="${PROD_DB_HOST:?请在 scripts/.env.deploy 配置 PROD_DB_HOST}"; DB_PORT="${PROD_DB_PORT:-3306}"
    DB_USER="${PROD_DB_USER:-root}"; DB_PASS="${PROD_DB_PASS:-}"
    ;;
  *) echo "目标必须为 dev|prod"; exit 1 ;;
esac

# 免密前置检查
ssh -o BatchMode=yes -o ConnectTimeout=8 "$SSH_ALIAS" "echo ok" >/dev/null 2>&1 \
  || { echo "[ERROR] $SSH_ALIAS 未免密，请先跑 ./scripts/setup-ssh-key.sh"; exit 1; }

# 把密码写进跳板机上的临时 cnf，避免命令行暴露
remote_cnf() {
  cat <<EOF
[client]
host=$DB_HOST
port=$DB_PORT
user=$DB_USER
password=$DB_PASS
EOF
}

# 在跳板机上用 mysql 执行；通过 stdin 传 cnf + sql，密码不落命令行
run_sql() {
  local sql="$1"
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] 将执行于 $TARGET/$DB_NAME:"
    echo "$sql" | sed 's/^/    /'
    return
  fi
  ssh -o BatchMode=yes "$SSH_ALIAS" "cat > /tmp/.sync_cnf <<'CNF'
$(remote_cnf)
CNF
mysql --defaults-extra-file=/tmp/.sync_cnf --default-character-set=utf8mb4 $DB_NAME <<'SQL'
$sql
SQL
rm -f /tmp/.sync_cnf"
}

add_col() { # $1=table $2=col $3=type $4=after
  local t="$1" c="$2" ty="$3" aft="${4:-}"
  local sql="ALTER TABLE \`$t\` ADD COLUMN \`$c\` $ty"
  [ -n "$aft" ] && sql="$sql AFTER \`$aft\`"
  sql="$sql;"
  # 已存在则跳过（幂等）
  run_sql "SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='$t' AND column_name='$c' LIMIT 1;" >/dev/null 2>&1
  run_sql "$sql" 2>&1 | grep -v "Duplicate column" || true
  echo "  [ok] add_col $t.$c"
}

ensure_table() { # $1=table $2=create_ddl
  local t="$1" ddl="$2"
  run_sql "CREATE TABLE IF NOT EXISTS \`$t\` ($ddl) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;" 2>&1 | grep -v "already exists" || true
  echo "  [ok] ensure_table $t"
}

echo "===== sync-schema $TARGET / $DB_NAME ====="

# --------- 在此追加幂等的加列/建表定义 ---------
# 例：
# add_col  users          avatar_url  VARCHAR(255) DEFAULT ''  email
# ensure_table sys_audit_log 'id BIGINT PRIMARY KEY AUTO_INCREMENT, ...'

# 2026-10-26 英文内容中文化：条目增加中文标题与原文语种
# title_zh 只在原文标题非中文时写入（中文源不白花一次 LLM 调用），渲染时回落 title
add_col content_items title_zh    "VARCHAR(500) DEFAULT NULL COMMENT '中文标题（原文非中文时）'" title
add_col content_items source_lang "VARCHAR(8) DEFAULT NULL COMMENT '原文语言 zh/en/other'"   title_zh

# 2026-10-26 公众号封面素材模块
# 背景：content_media 原先只是一张「微信永久素材缓存表」（migrations/0003 建表只有
#       media_type/file_url/media_id/url 四列），本次把它升为可管理、可复用、可 AI 生成的素材库。
# 🔴 素材不写盘：file_url 指向 upload-service（/api/uploads/covers/*），本表只存元数据。
add_col content_media kind         "VARCHAR(16) NOT NULL DEFAULT 'cover' COMMENT '用途 cover'"    id
add_col content_media name         "VARCHAR(128) DEFAULT NULL COMMENT '素材名'"                  media_type
add_col content_media account      "VARCHAR(32) NOT NULL DEFAULT 'default' COMMENT '所属微信账号'" media_id
add_col content_media width        "INT DEFAULT NULL COMMENT '宽（px）'"                          url
add_col content_media height       "INT DEFAULT NULL COMMENT '高（px）'"                          width
add_col content_media bytes        "INT DEFAULT NULL COMMENT '文件字节数'"                        height
add_col content_media mime         "VARCHAR(64) DEFAULT NULL COMMENT 'MIME'"                      bytes
add_col content_media tags         "JSON NULL COMMENT '标签数组'"                         mime
add_col content_media source       "VARCHAR(16) NOT NULL DEFAULT 'upload' COMMENT '来源 upload|ai'" mime
add_col content_media prompt       "TEXT NULL COMMENT 'AI 生成提示词'"                    source
add_col content_media last_error   "VARCHAR(255) DEFAULT NULL COMMENT '最近一次失败原因'"         prompt
add_col content_media enabled      "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否可用'"             last_error
add_col content_media use_count    "INT NOT NULL DEFAULT 0 COMMENT '被发布使用次数'"              enabled
add_col content_media last_used_at "DATETIME(6) DEFAULT NULL COMMENT '最近使用时间'"              use_count
# 软删除：TypeORM @DeleteDateColumn，缺这列 delete 会变硬删（素材删了发布快照就断链）
add_col content_media deleted_at   "DATETIME(6) DEFAULT NULL COMMENT '软删除时间'"                last_used_at

# 管线绑默认封面 + 成文记封面快照（存 id 不存 media_id：媒体 id 会失效，存 id 才能重传刷新）
# 不写 AFTER：相邻列（tencent_folder / account_type）在不同环境未必存在，写了反而 ALTER 失败
add_col content_pipelines    default_cover_id "BIGINT DEFAULT NULL COMMENT '默认封面素材 ID（content_media.id）'"
add_col content_publications cover_media_id   "BIGINT DEFAULT NULL COMMENT '发布所用封面素材 ID'"

echo "===== sync-schema 完成 ====="
