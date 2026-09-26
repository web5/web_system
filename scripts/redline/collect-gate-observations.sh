#!/usr/bin/env bash
# ============================================================
# collect-gate-observations.sh — 评审门禁「观察期」数据采集（rd-process A2）
#
# 背景：R13/R14/R15/R16 四个评审门当前全是 warning（只报不拦），
#       升 error 之前必须先有真实数据。本脚本把「采一次」固化成可复跑动作，
#       避免靠人记、口径漂移。
#
# 用法:
#   bash scripts/redline/collect-gate-observations.sh                 # 默认 master~20..master
#   bash scripts/redline/collect-gate-observations.sh master~50..master
#   bash scripts/redline/collect-gate-observations.sh <range> --append # 追加进观察日志
#
# 产出:
#   1) 终端打印本次采集的 4 项指标
#   2) 默认只打印；带 --append 时把一行结果追加到
#      docs/development/gate-observation-log.md 的「采集记录」表
#
# 采集范围说明：扫描的是「改动面」，不是全仓 tree（tree 模式过慢，勿用）。
# ============================================================
set -uo pipefail

RANGE="${1:-master~20..master}"
APPEND=0
[ "${2:-}" = "--append" ] && APPEND=1

TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || TOP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$TOP" || exit 1

SCAN_OUT="$(mktemp)"
trap 'rm -f "$SCAN_OUT"' EXIT

bash scripts/redline/scan-rules.sh diff "$RANGE" --no-color >"$SCAN_OUT" 2>&1 || true

count() { grep -oE "$1" "$SCAN_OUT" | wc -l | tr -d ' '; }

R13=$(count 'R13')
R14=$(count 'R14')
R15=$(count 'R15')
R16=$(count 'R16')

# 门禁被关掉的前兆指标：Micro-exempt / UI_GATE=off 使用频次
MICRO=$(git log "$RANGE" --pretty=%B 2>/dev/null | grep -ci 'micro-exempt' || true)
UIGATE=$(git log "$RANGE" --pretty=%B 2>/dev/null | grep -ci 'ui_gate=off\|ui_gate: *off\|UI_GATE=off' || true)

COMMITS=$(git rev-list --count "$RANGE" 2>/dev/null || echo 0)
STAMP="$(date '+%Y-%m-%d %H:%M')"

echo "采集范围: $RANGE （$COMMITS 个 commit）"
echo "采集时间: $STAMP"
echo "---------------------------------------------"
echo "R13（契约面）命中:   $R13"
echo "R14（发布面）命中:   $R14"
echo "R15（独立代码评审）: $R15"
echo "R16（SSE 契约一致）: $R16"
echo "Micro-exempt 使用:   $MICRO"
echo "UI_GATE=off 使用:    $UIGATE"
echo "---------------------------------------------"

if [ "$APPEND" = "1" ]; then
  LOG="docs/development/gate-observation-log.md"
  [ -f "$LOG" ] || { echo "缺少 $LOG，跳过追加"; exit 0; }
  printf '| %s | `%s` | %s | %s | %s | %s | %s | %s | %s |\n' \
    "$STAMP" "$RANGE" "$COMMITS" "$R13" "$R14" "$R15" "$R16" "$MICRO" "$UIGATE" >>"$LOG"
  echo "已追加一行到 $LOG"
fi
