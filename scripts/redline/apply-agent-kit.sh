#!/usr/bin/env bash
# ============================================================
# apply-agent-kit.sh — 把【能力源】镜像到【运行源】（sync 两跳里的第二跳）
#
# 背景：上游 ai-agent-kit 经 sync-to-target 只写 `.codebuddy/agent-kit/`（**能力源**），
#       而 IDE 实际加载的是 `.codebuddy/skills/`（**运行源**），中间缺 apply → 漂移
#       （#117/#118 即此坑：上游合并了、能力源更新了，运行源没动 → Hub 不认识新角色）。
#       本脚本把「第二跳」脚本化 —— 它此前靠人记，必然漏。
#
# 语义：以能力源为准（覆盖运行源同名文件）；
#       **保护清单**内的项目专属技能与下游定制文件跳过（与 scan-rules.sh 的 check_r12
#       共用同一份清单语义：项目专属只在运行源，能力源本就没有）。
#
# 用法：
#   bash scripts/redline/apply-agent-kit.sh             # 实际应用
#   DRY_RUN=1 bash scripts/redline/apply-agent-kit.sh   # 只打印计划
#
# 应用后验证：bash scripts/redline/scan-rules.sh tree（或 dif）应报 R12 零漂移。
# ============================================================
set -uo pipefail

TOP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$TOP" || exit 1

SRC=".codebuddy/agent-kit/skills"
DST=".codebuddy/skills"
DRY_RUN="${DRY_RUN:-0}"

# 保护清单：与 scan-rules.sh 的 check_r12 保持一致（相对路径**包含匹配**即跳过）
PROTECTED=(
  "be-developer"
  "fe-developer"
  "design-reviewer"
  "release-reviewer"
  "contract-reviewer"
  "rd-digital-agent/references/project-context.md"
)

[ -d "$SRC" ] || { echo "[apply-kit] 能力源不存在：$SRC（跳过）"; exit 0; }

is_protected() { # $1 = 相对路径
  local rel="$1" x
  for x in "${PROTECTED[@]}"; do
    case "$rel" in *"$x"*) return 0 ;; esac
  done
  return 1
}

applied=0
skipped=0

echo "[apply-kit] 能力源 → 运行源：$SRC → $DST"
[ "$DRY_RUN" = "1" ] && echo "[apply-kit] DRY_RUN=1（只打印，不落盘）"

while IFS= read -r f; do
  [ -n "$f" ] || continue
  rel="${f#"$SRC"/}"

  if is_protected "$rel"; then
    skipped=$((skipped + 1))
    echo "  跳过（保护清单·项目专属/下游定制）: $rel"
    continue
  fi

  # 内容相同则不动（避免无意义的时间戳变化）
  if [ -f "$DST/$rel" ] && cmp -s "$f" "$DST/$rel"; then
    continue
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "  将同步: $rel"
  else
    mkdir -p "$(dirname "$DST/$rel")"
    cp "$f" "$DST/$rel" && echo "  已同步: $rel"
  fi
  applied=$((applied + 1))
done < <(find "$SRC" -type f -print 2>/dev/null | sort)

echo "[apply-kit] 完成：同步 $applied 个 · 跳过 $skipped 个"
if [ "$applied" -gt 0 ] && [ "$DRY_RUN" != "1" ]; then
  echo "[apply-kit] 下一步：git add $DST && git commit（然后跑 scan-rules 确认 R12 零漂移）"
fi
