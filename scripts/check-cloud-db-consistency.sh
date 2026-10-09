#!/usr/bin/env bash
# ============================================================
# check-cloud-db-consistency.sh — 本地库 vs 云数据库一致性巡检（M5）
#
# 背景：deploy-console 把 prod 数据写云数据库（design.md §4），dev/local 数据留本地库。
#       「写得到」不等于「写得一致」——公网抖动、upsert 未命中、删除未同步都会造成漂移。
#       本脚本就是把漂移**查出来**，而不是等线上读到了才发现。
#
# 比对范围：design §4 的 12 张表（版本指针 + legacy 指针 + 10 张配置表）
#
# **刻意忽略审计字段**（deployed_by / deployed_at / created_at / updated_at）：
#   同值幂等推进时，本地库因 unchanged 跳过写入、云库仍被镜像 → 这两列必然漂移。
#   它们不影响 gateway 读取产出；纳入比对只会制造长期误报。
#
# 用法：
#   ./scripts/check-cloud-db-consistency.sh              # 在部署机（dev）直接跑（读 deploy-console/.env）
#   ./scripts/check-cloud-db-consistency.sh --env dev    # SSH 到 dev 机跑
#   ./scripts/check-cloud-db-consistency.sh --quiet      # 仅输出汇总行（cron 友好）
#   ./scripts/check-cloud-db-consistency.sh --json       # JSON 输出（供其它工具消费）
#
# 退出码：0 = 一致；1 = 存在不一致；2 = 环境错误（连不上 / 配置缺失）
#
# ⚠️ 为什么不做 CI 门禁：GitHub Actions runner 不在云库公网白名单里，连不上。
#    它是**运维巡检工具**（手动 / cron），不是 CI 检查项。
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CD_REL="servers/deploy-console"

ENV_OPT="local"
QUIET=0
JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env)   ENV_OPT="${2:-}"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    --json)  JSON=1; shift ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

# 比对的表（design §4）
TABLES="deploy_app_env_versions deploy_deployments deploy_modules deploy_apps deploy_sites deploy_hosts deploy_envs deploy_endpoints deploy_services deploy_service_envs deploy_service_routes deploy_canary_rules"
# 忽略的审计/时间戳列（见文件头说明）
#   task_id / deployed_by / deployed_at：发布追溯信息。同值幂等推进时本地库会因 unchanged
#   跳过写入、云库仍被镜像更新，这两者天然漂移；gateway 只读版本列，纳入比对只会长期误报。
IGNORE_COLS="'task_id','deployed_by','deployed_at','created_at','updated_at'"

# 远端执行的主体（读下面三个变量，不接位置参数——避免 ssh 双层 shell 的单引号嵌套错位）
RUNNER='set -uo pipefail
cd "$CD_DIR" || exit 2
get() { grep -m1 "^$1=" .env | cut -d= -f2-; }
LH="$(get MYSQL_HOST)"; LP="$(get MYSQL_PORT)"; LU="$(get MYSQL_USER)"; LW="$(get MYSQL_PASSWORD)"; LN="$(get MYSQL_DB)"
CH="$(get DEPLOY_CLOUD_DB_HOST)"; CP="$(get DEPLOY_CLOUD_DB_PORT)"; CU="$(get DEPLOY_CLOUD_DB_USER)"; CW="$(get DEPLOY_CLOUD_DB_PASSWORD)"; CN="$(get DEPLOY_CLOUD_DB_NAME)"
ql() { MYSQL_PWD="$LW" mysql -h "$LH" -P "${LP:-3306}" -u "$LU" "$LN" -N -B "$@" 2>/dev/null; }
qc() { MYSQL_PWD="$CW" mysql -h "$CH" -P "${CP:-3306}" -u "$CU" "$CN" -N -B "$@" 2>/dev/null; }
if [ -z "$CH" ]; then echo "ERR 未配置 DEPLOY_CLOUD_DB_HOST（M4/M5 依赖按环境分流）"; exit 2; fi
# 注意必须带 -e：裸参数会被 mysql 当成表名，导致误判「连不上」
qc -e "SELECT 1" >/dev/null || { echo "ERR 云数据库连不上（公网/白名单）"; exit 2; }
WORK=$(mktemp -d)
# SQL 里的单引号字符（八进制 047）；避免在本 RUNNER 里写字面单引号
SQ=$(printf "\047")
for T in $TABLES; do
  # ⚠️ 全程不得出现单引号：本 RUNNER 自身被单引号字符串包裹，
  #    里面冒出一个单引号就会提前终止外层字符串（2026-10-08 实测踩到两次）。
  mk_cols() {
    printf "SELECT GROUP_CONCAT(CONCAT(CHAR(96), column_name, CHAR(96)) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema=\"%s\" AND table_name=\"%s\" AND column_name NOT IN (%s)" "$1" "$2" "$3"
  }
  # 指针表的 `id` 是本地生成的 uuid：同一业务行在两库天然不同，
  # 纳lektive 比对会 100% 误报（业务键才是可比的那部分）
  # 行范围：指针表**只比 prod 行** —— dev/local 的数据按设计留本地库、不镜像
  # （2026-10-09 修正：此前全行比对，dev 每次部署都会让 M5 误报，掩盖真正的 prod 漂移）
  case "$T" in
    # 单引号必须用 printf "\047" 生成：字面单引号会被本 RUNNER 外层的单引号字符串吞掉
    deploy_app_env_versions|deploy_deployments)
      IGN="${SQ}id${SQ},$IGNORE_COLS"
      FLT="WHERE env_id=\"prod\""
      ;;
    *)
      IGN="$IGNORE_COLS"
      FLT=""
      ;;
  esac
  COLS="$(ql -e "$(mk_cols "$LN" "$T" "$IGN")")"
  if [ -z "$COLS" ] || [ "${COLS:0:3}" = "Err" ]; then echo "SKIP $T 本地库无此表或取列失败"; continue; fi
  ql -e "SELECT $COLS FROM $T $FLT" | sort > "$WORK/local.$T"
  CN_COLS="$(qc -e "$(mk_cols "$CN" "$T" "$IGN")")"
  if [ -z "$CN_COLS" ]; then echo "BAD  $T 云库缺表"; continue; fi
  qc -e "SELECT $CN_COLS FROM $T $FLT" | sort > "$WORK/cloud.$T"
  L=$(wc -l < "$WORK/local.$T" | tr -d " ")
  C=$(wc -l < "$WORK/cloud.$T" | tr -d " ")
  LO=$(comm -23 "$WORK/local.$T" "$WORK/cloud.$T" | wc -l | tr -d " ")
  CO=$(comm -13 "$WORK/local.$T" "$WORK/cloud.$T" | wc -l | tr -d " ")
  if [ "$LO" = "0" ] && [ "$CO" = "0" ]; then
    echo "OK   $T local=$L cloud=$C"
  else
    echo "DIFF $T local=$L cloud=$C local-only=$LO cloud-only=$CO"
    comm -23 "$WORK/local.$T" "$WORK/cloud.$T" | head -3 | sed "s/^/     LOCAL-ONLY  /"
    comm -13 "$WORK/local.$T" "$WORK/cloud.$T" | head -3 | sed "s/^/     CLOUD-ONLY  /"
  fi
done
rm -rf "$WORK"'

# 生成**自包含**脚本：参数直接写进文件，不做 ssh 命令行传参
# （跨一道 ssh 就被远端 shell 二次解析，含单引号的 IGNORE_COLS 会被拆乱 ——2026-10-08 实测）
gen_runner() {
  local cd_dir="$1"
  {
    printf 'CD_DIR=%s\n' "\"$cd_dir\""
    printf 'TABLES=%s\n' "\"$TABLES\""
    # 必须用双引号包裹：值内部的单引号要保留到 SQL 里，
    # 写成 IGNORE_COLS='a','b' 会被远端 bash 当成语法引号吃掉 → NOT IN (a,b) 全表报错
    printf 'IGNORE_COLS=%s\n' "\"$IGNORE_COLS\""
    printf '%s\n' "$RUNNER"
  }
}

if [ "$ENV_OPT" != "local" ]; then
  ENV_FILE="$ROOT/scripts/.env.deploy"
  [ -f "$ENV_FILE" ] || { echo "缺少 $ENV_FILE" >&2; exit 2; }
  set -a; . "$ENV_FILE"; set +a
  ENV_UC="$(echo "$ENV_OPT" | tr '[:lower:]' '[:upper:]')"
  eval "R_SERVER=\"\${${ENV_UC}_SERVER:-}\""
  eval "R_USER=\"\${${ENV_UC}_USER:-}\""
  eval "R_DIR=\"\${${ENV_UC}_REMOTE_DIR:-}\""
  eval "R_KEY=\"\${${ENV_UC}_KEY:-}\""
  [ -n "$R_SERVER" ] && [ -n "$R_USER" ] && [ -n "$R_DIR" ] || { echo "缺 ${ENV_UC}_SERVER/_USER/_REMOTE_DIR" >&2; exit 2; }
  K_OPT=""; [ -z "$R_KEY" ] || K_OPT="-i $R_KEY"
  TMP_LOCAL="$(mktemp)"
  gen_runner "$R_DIR/$CD_REL" > "$TMP_LOCAL"
  # 调试用：KEEP_RUNNER=1 时把投递到远端的脚本留一份在本地，便于排查解析问题
  [ "${KEEP_RUNNER:-0}" = "1" ] && cp "$TMP_LOCAL" /tmp/cc-runner-last.sh
  REMOTE_RUNNER="/tmp/check-cloud-db-consistency-runner.$$.sh"
  scp -q $K_OPT -o BatchMode=yes -o ConnectTimeout=10 "$TMP_LOCAL" "$R_USER@$R_SERVER:$REMOTE_RUNNER" \
    || { echo "ERR scp 失败" >&2; rm -f "$TMP_LOCAL"; exit 2; }
  OUT="$(ssh $K_OPT -o BatchMode=yes -o ConnectTimeout=10 "$R_USER@$R_SERVER" \
    "bash $REMOTE_RUNNER; rm -f $REMOTE_RUNNER" 2>&1)"
else
  [ -d "$ROOT/$CD_REL" ] || { echo "缺 $ROOT/$CD_REL" >&2; exit 2; }
  TMP_LOCAL="$(mktemp)"
  gen_runner "$ROOT/$CD_REL" > "$TMP_LOCAL"
  OUT="$(bash "$TMP_LOCAL" 2>&1)"
fi
rm -f "$TMP_LOCAL"

case "$OUT" in
  ERR*) echo "$OUT" >&2; exit 2 ;;
esac

DIFF_N=$(printf '%s\n' "$OUT" | grep -cE '^(DIFF|BAD) ' || true)
TOTAL_N=$(printf '%s\n' "$OUT" | grep -cE '^(OK|DIFF|BAD|SKIP) ' || true)

if [ "$JSON" = "1" ]; then
  printf '{\n  "checkedAt": "%s",\n  "tables": %s,\n  "inconsistent": %s,\n  "results": [\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TOTAL_N" "$DIFF_N"
  first=1
  while IFS= read -r line; do
    case "$line" in
      OK\ *|DIFF\ *|BAD\ *)
        set -- $line
        st="$1"; t="$2"
        [ "$first" = "1" ] || printf ',\n'
        first=0
        printf '    {"table": "%s", "status": "%s", "detail": "%s"}' "$t" "$st" "${*:3}"
        ;;
    esac
  done <<< "$OUT"
  printf '\n  ]\n}\n'
elif [ "$QUIET" = "1" ]; then
  echo "一致性检查：共 $TOTAL_N 张表，不一致 $DIFF_N 张$( [ "$DIFF_N" = "0" ] && echo ' ✅' || echo ' ⚠️' )"
  [ "$DIFF_N" = "0" ] || printf '%s\n' "$OUT" | grep -E '^(DIFF|BAD) '
else
  printf '%s\n' "$OUT"
  echo "----"
  echo "共 $TOTAL_N 张表，不一致 $DIFF_N 张"
  [ "$DIFF_N" != "0" ] && echo "修复：把本地库的最新内容补到云库（先用 mysqldump 备份云库目标表），或临时关闭 DEPLOY_CLOUD_DB_ENABLED 回退人工同步"
fi

[ "$DIFF_N" = "0" ] || exit 1
exit 0
