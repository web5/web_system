#!/usr/bin/env bash
# ============================================================
# collect-gate-observations.sh — 评审门禁「观察期」数据采集（rd-process A2）
#
# 背景：R13/R14/R15/R17/R18 五个**凭证门**当前全是 warning（只报不拦），
#       升 error 之前必须先有真实数据。本脚本把「采一次」固化成可复跑动作，
#       避免靠人记、口径漂移。
#
#       这 5 个共用 `_trailer_check_one`（语义完全一致），所以必须**同时采**：
#       只采其中几个，就无法回答「这条机制整体该不该升 error」。
#       R16（SSE 契约一致）是另一种机制，作为附带参考指标一起采，不参与升级判断。
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
R17=$(count 'R17')
R18=$(count 'R18')

# 门禁被关掉的前兆指标：Micro-exempt / UI_GATE=off 使用频次
#
# 只数「豁免声明行」（行首 `Micro-exempt:`），不数「提到关键词」。
# 2026-10-23 实测：改成行首锚定前，近 20 commit 数出 4 次，逐条核对实际只有 2 次真豁免，
# 另 2 次是提交正文在**描述**这套机制（新增 R17/R18 的那条）。指标宽 2 倍会让趋势读反。
MICRO=$(git log "$RANGE" --pretty=%B 2>/dev/null | grep -ci '^[[:space:]]*micro-exempt[[:space:]]*:' || true)
UIGATE=$(git log "$RANGE" --pretty=%B 2>/dev/null | grep -ci 'ui_gate=off\|ui_gate: *off\|UI_GATE=off' || true)

# --first-parent：只数 master 主线上的提交。默认 rev-list 会把从分支合进来的 commit 全算上，
# 同一个 `master~20..master` 会数出 64（2026-10-23 实测），让「≥20 commit」这条判据凭空容易 3 倍。
COMMITS=$(git rev-list --count --first-parent "$RANGE" 2>/dev/null || echo 0)
STAMP="$(date '+%Y-%m-%d %H:%M')"

echo "采集范围: $RANGE （$COMMITS 个 commit）"
echo "采集时间: $STAMP"
echo "---------------------------------------------"
echo "R13（契约面）命中:   $R13"
echo "R14（发布面）命中:   $R14"
echo "R15（独立代码评审）: $R15"
echo "R17（测试用例）:     $R17"
echo "R18（研发方案清单）: $R18"
echo "R16（SSE 契约一致）: $R16   ← 非凭证门，仅参考"
echo "Micro-exempt 使用:   $MICRO"
echo "UI_GATE=off 使用:    $UIGATE"
echo "---------------------------------------------"

if [ "$APPEND" = "1" ]; then
  LOG="docs/development/gate-observation-log.md"
  [ -f "$LOG" ] || { echo "缺少 $LOG，跳过追加"; exit 0; }
  ROW="$(printf '| %s | `%s` | %s | %s | %s | %s | %s | %s | %s | %s | %s |' \
    "$STAMP" "$RANGE" "$COMMITS" "$R13" "$R14" "$R15" "$R17" "$R18" "$R16" "$MICRO" "$UIGATE")"

  # 必须插到「## 2 采集记录」表尾，**不能 >> 追加到文件末尾**：
  # 该文件在表后面还有 §3 人工观察 / §4 出口判据 / §5 关联，
  # 2026-10-23 首次实跑 `>>` 就把数据行写到了 §5 之后（表外，等于没记）。
  TMP="$(mktemp)"
  if awk -v row="$ROW" '
    { L[NR] = $0 }
    END {
      s = 0; e = 0
      for (i = 1; i <= NR; i++) {
        if (L[i] ~ /^## 2 /) { s = i; continue }
        if (s && L[i] ~ /^## /) { e = i; break }
      }
      if (!s) exit 3
      if (!e) e = NR + 1
      last = 0
      for (i = s + 1; i < e; i++)
        if (L[i] ~ /^\|/ && L[i] !~ /^\|[-: ]+\|?$/) last = i
      if (!last) exit 4
      for (i = 1; i <= NR; i++) { print L[i]; if (i == last) print row }
    }' "$LOG" >"$TMP"; then
    mv "$TMP" "$LOG"
    echo "已插入一行到 $LOG 的「## 2 采集记录」表尾"
  else
    rm -f "$TMP"
    echo "⚠ 插入失败（未找到「## 2 采集记录」表或表为空），请手工补一行："
    echo "$ROW"
  fi
fi
