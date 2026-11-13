#!/usr/bin/env bash
# ============================================================
# collect-gate-observations.sh — 评审门禁「观察期」数据采集（rd-process A2）
#
# 背景：R13/R14/R15/R17/R18 五个**凭证门**当前全是 warning（只报不拦），
#       升 error 之前必须先有真实数据。本脚本把「采一次」固化成可复跑动作，
#       避免靠人记、口径漂移。
#
#       这 5 个共用同一套凭证机制（语义完全一致），所以必须**同时采**：
#       只采其中几个，就无法回答「这条机制整体该不该升 error」。
#       R16（SSE 契约一致）是另一种机制，作为附带参考指标一起采，不参与升级判断。
#
# 用法:
#   bash scripts/redline/collect-gate-observations.sh                 # 默认 master~20..master
#   bash scripts/redline/collect-gate-observations.sh master~50..master
#   bash scripts/redline/collect-gate-observations.sh <range> --append # 追加进观察日志
#
# 产出:
#   1) 终端打印本次采集的指标
#   2) 默认只打印；带 --append 时把一行结果追加到
#      gates.yaml 的 observations.doc 指向的文件（当前是 docs/development/gate-observation-log.md）
#
# 采集范围说明：扫描的是「改动面」，不是全仓 tree（tree 模式过慢，勿用）。
#
# 🔴 2026-11-11 重写（S4）：采集口径不再靠 grep 反解引擎输出
#   旧实现：`count() { grep -cE "^[[:space:]]+\[R13\]" "$SCAN_OUT"; }`
#     —— 把「输出文本长什么样」当成契约。文案为可读性改一次，采集就**静默数错**：
#        不报错、不崩溃，只是数字慢慢偏离真相，而观察期数据正是判升级用的。
#        更糟的是门号清单硬编码在脚本里，加一道凭证门要改脚本，漏了不报错。
#   新实现：引擎 `--obs-json` 直接给结构化计数 + 要采哪些门（gates.yaml 的 observations 段）。
#        本脚本只做展示与拼行，不知道任何门号。
# ============================================================
set -uo pipefail

RANGE="${1:-master~20..master}"
APPEND=0
[ "${2:-}" = "--append" ] && APPEND=1

TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || TOP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$TOP" || exit 1

OBS_JSON="$(mktemp)"
META="$(mktemp)"
trap 'rm -f "$OBS_JSON" "$META"' EXIT

# 采集口径必须与门禁实际执行者同源，否则「统计的命中数」与「真正会拦的条数」是两个东西。
node scripts/redline/gate.ts diff "$RANGE" --no-color --obs-json >"$OBS_JSON" 2>/dev/null || true

# 把 JSON 摊平成 TSV（DOC / UPG / REF 三类行），bash 侧只做展示与拼行。
# 摊平放在 node 里：JSON 解析在 bash 里没有可靠手段（无 jq 依赖），手写正则必然出错。
if ! node -e '
  const fs = require("node:fs");
  let j;
  try {
    j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  } catch {
    console.error("✗ 引擎没有产出可解析的 JSON —— 扫描范围无效或引擎报错");
    process.exit(3);
  }
  const o = j.observations;
  if (!o || !Array.isArray(o.upgradeCandidates)) {
    console.error("✗ gates.yaml 缺少 observations 段 —— 采集不知道要采哪些门");
    process.exit(4);
  }
  console.log("DOC\t" + (o.doc || ""));
  for (const g of o.upgradeCandidates) console.log("UPG\t" + g.key + "\t" + g.title + "\t" + (j.gates[g.key] ?? 0));
  for (const g of (o.reference || [])) console.log("REF\t" + g.key + "\t" + g.title + "\t" + (j.gates[g.key] ?? 0));
' "$OBS_JSON" >"$META"; then
  echo "⚠ 采集失败：未记录任何数据（不写日志，避免写进一行全 0 的假数据）" >&2
  exit 1
fi

DOC="$(awk -F'\t' '$1=="DOC" {print $2}' "$META")"
COMMITS=$(git rev-list --count --first-parent "$RANGE" 2>/dev/null || echo 0)
STAMP="$(date '+%Y-%m-%d %H:%M')"

# 门禁被关掉的前兆指标：Micro-exempt / UI_GATE=off 使用频次
#
# 只数「豁免声明行」（行首 `Micro-exempt:`），不数「提到关键词」。
# 2026-10-23 实测：改成行首锚定前，近 20 commit 数出 4 次，逐条核对实际只有 2 次真豁免，
# 另 2 次是提交正文在**描述**这套机制（新增 R17/R18 的那条）。指标宽 2 倍会让趋势读反。
#
# 口径是**逐 commit 解析**，与引擎的豁免判定同口径：
#   · 一个 commit 里写了多行 Micro-exempt → 只算一次（引擎只认第一行）
#   · 行首、大小写敏感（与引擎的 `^Micro-exempt:` 一致）
#   · 数的是「commit 数」不是「文本行数」，才对得上「豁免被用了多少次」
MICRO=0
UIGATE=0
while IFS= read -r _c; do
  [ -n "$_c" ] || continue
  _body="$(git log -1 --format=%B "$_c" 2>/dev/null)"
  if printf '%s\n' "$_body" | grep -qE '^Micro-exempt:'; then
    MICRO=$((MICRO + 1))
  fi
  if printf '%s\n' "$_body" | grep -qiE 'ui_gate=off|ui_gate: *off'; then
    UIGATE=$((UIGATE + 1))
  fi
done < <(git rev-list "$RANGE" 2>/dev/null)

echo "采集范围: ${RANGE}（${COMMITS} 个 commit）"
echo "采集时间: ${STAMP}"
echo "---------------------------------------------"
while IFS=$'\t' read -r kind key title cnt; do
  case "$kind" in
    UPG) printf '%-3s %s: %s\n' "$key" "$title" "$cnt" ;;
    REF) printf '%-3s %s: %s   ← 非凭证门，仅参考\n' "$key" "$title" "$cnt" ;;
  esac
done <"$META"
echo "Micro-exempt 使用:   ${MICRO}"
echo "UI_GATE=off 使用:    ${UIGATE}"
echo "---------------------------------------------"

if [ "$APPEND" != "1" ]; then
  exit 0
fi

if [ -z "$DOC" ]; then
  echo "⚠ gates.yaml 的 observations.doc 为空，无处可写" >&2
  exit 1
fi
if [ ! -f "$DOC" ]; then
  # 🔴 这里必须失败，不能像旧版那样「跳过追加 + exit 0」：
  #    2026-11-04 该文件被归档到 archive/，旧版从此每天打印「跳过追加」然后成功退出，
  #    7 天没人发现观察期其实一行数据都没记。
  echo "✗ 观察日志不存在: ${DOC}" >&2
  echo "  若是有意归档，请同步改 gates.yaml 的 observations.doc 并更新消费方；" >&2
  echo "  否则恢复文件（它是活跃机制，不是史料）。" >&2
  exit 1
fi

# 按 observations 的声明顺序拼行：时间 | 范围 | commits | UPG… | REF… | Micro-exempt | UI_GATE=off
# 列序必须与日志表头一致，gates-lint 会校验表头（改了一边没改另一边就红）。
CELLS=""
while IFS=$'\t' read -r kind _key _title cnt; do
  case "$kind" in
    UPG | REF) CELLS="${CELLS} ${cnt} |" ;;
  esac
done <"$META"
ROW="| ${STAMP} | \`${RANGE}\` | ${COMMITS} |${CELLS} ${MICRO} | ${UIGATE} |"

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
  }' "$DOC" >"$TMP"; then
  mv "$TMP" "$DOC"
  echo "已插入一行到 ${DOC} 的「## 2 采集记录」表尾"
else
  rm -f "$TMP"
  echo "⚠ 插入失败（未找到「## 2 采集记录」表或表为空），请手工补一行：" >&2
  echo "$ROW" >&2
  exit 1
fi
