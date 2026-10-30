#!/usr/bin/env bash
# ============================================================
# shadow.sh — 双引擎影子比对（重构 S2）
#
# 用法：
#   bash scripts/redline/cases/shadow.sh            # 比对全部场景
#   bash scripts/redline/cases/shadow.sh --filter r17
#   bash scripts/redline/cases/shadow.sh --keep     # 保留夹具仓库（排查用）
#
# 返回码：0 = 两个引擎在每个场景上输出逐字节一致；1 = 有分歧；2 = 用法错误
#
# 🔴 它和 run.sh 的区别（两者都要有，不能互相替代）
#   run.sh     : 单个引擎 vs expected/。回答「行为有没有变」（回归）
#   shadow.sh  : bash vs 新引擎。    回答「两个实现是不是同一个东西」（等价性）
#   影子期两个一起跑：run.sh 绿说明 bash 没动，shadow.sh 绿说明新引擎没走样。
#
# 为什么必须逐字节比 stdout 而不是比计数：
#   计数相同但报错位置/文案/顺序变了，就是"改完还绿着但判的东西变了"。
#   顺序也算：commit 门 -> 行级门的先后、R9b 在 R10 之前，都是输出契约的一部分。
# ============================================================
set -uo pipefail

CASES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOP="$(cd "$CASES_DIR/../../.." && pwd)"
SCAN="$TOP/scripts/redline/scan-rules.sh"
GATE="$TOP/scripts/redline/gate.ts"

KEEP=0
FILTER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --keep)   KEEP=1 ;;
    --filter) FILTER="${2:-}"; shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -f "$SCAN" ] || { echo "找不到 $SCAN" >&2; exit 2; }
[ -f "$GATE" ] || { echo "找不到 $GATE" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "需要 node（gate.ts 用 Node 22 原生跑 TS）" >&2; exit 2; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gate-shadow.XXXXXX")"
cleanup() { [ "$KEEP" = "1" ] || rm -rf "$WORK"; }
trap cleanup EXIT

# shellcheck source=/dev/null
source "$CASES_DIR/fixture.sh"

echo "构造夹具仓库: $WORK" >&2
MAP="$WORK/.aliases"
build_fixture "$WORK" > "$MAP" || { echo "夹具构造失败" >&2; exit 2; }
while read -r _n _s; do
  [ -n "${_n:-}" ] && [ -n "${_s:-}" ] && export "$_n=$_s"
done < "$MAP"
echo "夹具 commit: $(sed -n '2,$p' "$MAP" | wc -l | tr -d ' ') 个" >&2

run_engine() { # $1=bash|ts  $2=mode  $3=args  $4=id
  local engine="$1" mode="$2" args="$3" id="$4"
  local raw="$WORK/.$engine.$id.out"
  local expanded
  expanded="$(eval "printf '%s' \"$args\"")"
  if [ "$engine" = "bash" ]; then
    # shellcheck disable=SC2086
    ( cd "$WORK" && bash "$SCAN" --no-color "$mode" $expanded ) > "$raw" 2> "$WORK/.$engine.$id.err"
  else
    # shellcheck disable=SC2086
    ( cd "$WORK" && node "$GATE" --no-color "$mode" $expanded ) > "$raw" 2> "$WORK/.$engine.$id.err"
  fi
  local rc=$?
  normalize_output "$raw" "$MAP" "$WORK" "$WORK/.$engine.$id.norm"
  printf '%s' "$rc" > "$WORK/.$engine.$id.rc"
}

SAME=0; DIFF=0; SKIP=0; FAILED=""

echo >&2
while IFS=$'\t' read -r id mode args note; do
  id="${id#$'\xef\xbb\xbf'}"
  case "$id" in ''|'#'*) continue ;; esac
  if [ -n "$FILTER" ] && [[ "$id" != *"$FILTER"* ]]; then SKIP=$((SKIP+1)); continue; fi

  run_engine bash "$mode" "$args" "$id"
  run_engine ts   "$mode" "$args" "$id"

  local_rc_b="$(cat "$WORK/.bash.$id.rc")"
  local_rc_t="$(cat "$WORK/.ts.$id.rc")"

  if [ "$local_rc_b" != "$local_rc_t" ]; then
    DIFF=$((DIFF+1)); FAILED="${FAILED}\n    - ${id}（退出码不同: bash=${local_rc_b} ts=${local_rc_t}）"
    printf '  \033[0;31m✗\033[0m %s：退出码 bash=%s / ts=%s\n' "$id" "$local_rc_b" "$local_rc_t"
    continue
  fi

  if diff -q "$WORK/.bash.$id.norm" "$WORK/.ts.$id.norm" >/dev/null 2>&1; then
    SAME=$((SAME+1))
    printf '  \033[0;32m≡\033[0m %-34s exit=%s\n' "$id" "$local_rc_b"
  else
    DIFF=$((DIFF+1)); FAILED="${FAILED}\n    - ${id}"
    printf '  \033[0;31m✗\033[0m %s：输出不一致\n' "$id"
    diff -u "$WORK/.bash.$id.norm" "$WORK/.ts.$id.norm" | sed -n '3,16p' | sed 's/^/      /'
  fi
done < "$CASES_DIR/scenarios.tsv"

echo
printf '\033[1m影子一致 %s / 分歧 %s / 跳过 %s\033[0m\n' "$SAME" "$DIFF" "$SKIP"
if [ "$DIFF" -gt 0 ]; then
  printf '分歧场景：%s\n' "$FAILED"
  [ "$KEEP" = "1" ] && echo "夹具保留在: $WORK"
  exit 1
fi
exit 0
