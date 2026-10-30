#!/usr/bin/env bash
# ============================================================
# run.sh — 门禁黄金用例集运行器
#
# 用法：
#   bash scripts/redline/cases/run.sh                 # 校验（默认）：与 expected/ 逐字节比对
#   bash scripts/redline/cases/run.sh --update         # 重新生成 expected/（改动规则后必须人工 review diff）
#   bash scripts/redline/cases/run.sh --filter r17     # 只跑 id 含 r17 的场景
#   bash scripts/redline/cases/run.sh --keep           # 保留临时夹具仓库（排查用）
#
# 返回码：0 = 全部一致；1 = 有差异或场景本身报错；2 = 用法错误
#
# 🔴 什么时候该跑它：
#   · 改 scan-rules.sh / gate-shared.sh 的判定逻辑 → 先跑它，diff 里每一条变化都必须是"你有意改的"
#   · 换执行引擎（门禁架构重构 S2 影子期）→ 新引擎跑它，输出必须与 expected/ 逐字节一致
# 🔴 什么时候不该直接 --update：
#   期望值只能由"人工确认过的行为"产生。先看 diff，确认变化是对的，再 --update。
#   盲目 --update 等于把"当前行为"当"正确行为"，黄金集就退化成快照记录器了。
# ============================================================
set -uo pipefail

CASES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOP="$(cd "$CASES_DIR/../../.." && pwd)"
SCAN="$TOP/scripts/redline/scan-rules.sh"
EXPECTED_DIR="$CASES_DIR/expected"

UPDATE=0
KEEP=0
FILTER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --update) UPDATE=1 ;;
    --keep)   KEEP=1 ;;
    --filter) FILTER="${2:-}"; shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -f "$SCAN" ] || { echo "找不到 $SCAN" >&2; exit 2; }
mkdir -p "$EXPECTED_DIR"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gate-cases.XXXXXX")"
cleanup() { [ "$KEEP" = "1" ] || rm -rf "$WORK"; }
trap cleanup EXIT

# shellcheck source=/dev/null
source "$CASES_DIR/fixture.sh"

echo "构造夹具仓库: $WORK" >&2
MAP="$WORK/.aliases"
build_fixture "$WORK" > "$MAP" || { echo "夹具构造失败" >&2; exit 2; }
# 别名导出为环境变量：场景表里写 ${C_R17_FAKE} 就能在 run_one 的 eval 中展开成真实 sha
while read -r _n _s; do
  [ -n "${_n:-}" ] && [ -n "${_s:-}" ] && export "$_n=$_s"
done < "$MAP"
echo "夹具 commit: $(sed -n '2,$p' "$MAP" | wc -l | tr -d ' ') 个" >&2

PASS=0; FAIL=0; SKIP=0
FAILED=""

run_one() { # $1=id $2=mode $3=args
  local id="$1" mode="$2" args="$3"
  local raw_out="${WORK}/.out.${id}" raw_err="${WORK}/.err.${id}"
  # 占位展开：${C_XXX} → 真实 sha（只用于构造 range，不参与比对）
  local expanded
  expanded="$(eval "printf '%s' \"$args\"")"
  # shellcheck disable=SC2086
  ( cd "$WORK" && bash "$SCAN" --no-color "$mode" $expanded ) > "$raw_out" 2> "$raw_err"
  local rc=$?

  local norm_out="${WORK}/.norm.${id}"
  normalize_output "$raw_out" "$MAP" "$WORK" "$norm_out"

  # 从汇总行取 error/warning 计数（门禁的标准收尾行，两份实现共用此格式）
  local counts
  counts="$(grep -oE '[0-9]+ error / [0-9]+ warning' "$norm_out" | tail -1)"
  local ne="${counts%% error*}"; ne="${ne:-?}"
  local nw="${counts##*/ }"; nw="${nw%% warning*}"; nw="${nw:-?}"

  local golden="${EXPECTED_DIR}/${id}.txt"
  local actual="${WORK}/.golden.${id}"
  {
    printf 'exit=%s\nerrors=%s\nwarnings=%s\n--- stdout ---\n' "$rc" "$ne" "$nw"
    cat "$norm_out"
  } > "$actual"

  if [ "$UPDATE" = "1" ]; then
    cp "$actual" "$golden"
    printf '  \033[1;33m⟳\033[0m %s（已更新）\n' "$id"
    PASS=$((PASS+1))
    return 0
  fi

  if [ ! -f "$golden" ]; then
    FAIL=$((FAIL+1)); FAILED="${FAILED}\n    - ${id}（缺期望文件，跑 --update 生成）"
    printf '  \033[0;31m✗\033[0m %s：缺期望文件\n' "$id"
    return 0
  fi

  if diff -q "$golden" "$actual" >/dev/null 2>&1; then
    PASS=$((PASS+1))
    printf '  \033[0;32m✓\033[0m %-32s exit=%s %s error / %s warning\n' "$id" "$rc" "$ne" "$nw"
  else
    FAIL=$((FAIL+1)); FAILED="${FAILED}\n    - ${id}"
    printf '  \033[0;31m✗\033[0m %s：输出不一致\n' "$id"
    diff -u "$golden" "$actual" | sed -n '3,14p' | sed 's/^/      /'
  fi
}

echo >&2
while IFS=$'\t' read -r id mode args note; do
  # 去 BOM：编辑器/写入工具可能给首行塞 U+FEFF，导致 `#` 注释判断失效（会被当成场景跑）
  id="${id#$'\xef\xbb\xbf'}"
  case "$id" in ''|'#'*) continue ;; esac
  if [ -n "$FILTER" ] && [[ "$id" != *"$FILTER"* ]]; then SKIP=$((SKIP+1)); continue; fi
  run_one "$id" "$mode" "$args"
done < "$CASES_DIR/scenarios.tsv"

echo
if [ "$UPDATE" = "1" ]; then
  printf '\033[1m已更新 %s 个期望文件 → %s\033[0m\n' "$PASS" "$EXPECTED_DIR"
  printf '\033[1;33m⚠ 必须 review：git diff --stat %s\033[0m\n' "$EXPECTED_DIR"
  exit 0
fi

printf '\033[1m通过 %s / 失败 %s / 跳过 %s\033[0m\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf '失败场景：%s\n' "$FAILED"
  exit 1
fi
exit 0
