#!/usr/bin/env bash
#
# sync-agent-kit.sh — agent-kit 能力源 → 运行源 同步助手
#
# 架构（2026-09-10 收敛后，唯一能力源 = .codebuddy/agent-kit/）：
#   .codebuddy/agent-kit/  能力源镜像：ai-agent-kit 的 kits/ + skills/ + rules/general/ + references/ + AGENT.md
#                          由 ai-agent-kit 仓库 CI 自动同步（scripts/sync-to-target.sh）
#   .codebuddy/skills/     运行源：IDE 真正加载的技能根
#   运行源 = agent-kit/skills 的全量镜像
#            + 项目专属技能 be-developer / fe-developer
#            + 项目专属文件 rd-digital-agent/references/project-context.md
#
# 本脚本做两件事：
#   ① 报告上游 ai-agent-kit 源仓库与 .codebuddy/agent-kit 的差异（有没有新版本待同步）
#   ② 把 .codebuddy/agent-kit/skills 同步进运行源 .codebuddy/skills（幂等；保护项目专属文件）
#
# 用法：
#   ./scripts/sync-agent-kit.sh              # 默认 dry-run：只报告，不写
#   ./scripts/sync-agent-kit.sh --apply      # 执行同步（写运行源）
#   ./scripts/sync-agent-kit.sh --pull       # 先 git pull ai-agent-kit 源仓库再报告
#   SRC=/path DST=/path ./scripts/sync-agent-kit.sh
#
set -euo pipefail

SRC="${SRC:-$HOME/workspace/ai-agent-kit}"
DST="${DST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

KIT_REL=".codebuddy/agent-kit"
RUN_REL=".codebuddy/skills"

# 项目专属技能：不在 agent-kit 镜像里，同步时保留、不删
PROJECT_SKILLS=(be-developer fe-developer)

# 项目专属文件（相对 skills/）：含项目定制，同步时跳过，不被上游覆盖
EXCLUDES=(
  "rd-digital-agent/references/project-context.md"
)

DO_PULL=0
DO_APPLY=0

for a in "$@"; do
  case "$a" in
    --pull)  DO_PULL=1 ;;
    --apply) DO_APPLY=1 ;;
    --dry-run) DO_APPLY=0 ;;
    -h|--help) sed -n '1,26p' "$0"; exit 0 ;;
    *) echo "未知参数: $a" >&2; exit 1 ;;
  esac
done

[[ -d "$DST/$KIT_REL/skills" ]] || { echo "能力源不存在: $DST/$KIT_REL/skills" >&2; exit 1; }
[[ -d "$DST/$RUN_REL" ]]       || { echo "运行源不存在: $DST/$RUN_REL" >&2; exit 1; }

is_excluded() {
  local rel="$1" e
  for e in "${EXCLUDES[@]}"; do [[ "$rel" == "$e" ]] && return 0; done
  return 1
}

# ---------- ① 上游源仓库 vs 能力源镜像 ----------
if [[ -d "$SRC" ]]; then
  if (( DO_PULL )); then
    echo ">> 拉取上游 ai-agent-kit 最新 (git pull --ff-only)..."
    git -C "$SRC" pull --ff-only || true
  fi
  echo "━━━ ① 上游 $SRC ↔ 能力源 $KIT_REL ━━━"
  for sub in AGENT.md skills rules/general references kits; do
    if [[ ! -e "$SRC/$sub" ]]; then continue; fi
    if diff -rq "$SRC/$sub" "$DST/$KIT_REL/$sub" >/dev/null 2>&1; then
      echo "  [✓] $sub 一致"
    else
      echo "  [!] $sub 有差异（上游更新需先经 CI/手动同步进能力源）"
      diff -rq "$SRC/$sub" "$DST/$KIT_REL/$sub" 2>/dev/null | sed 's/^/      /' | head -20 || true
    fi
  done
else
  echo "（跳过 ①：上游源仓库不存在 $SRC，用 SRC=/path 指定）"
fi
echo

# ---------- ② 能力源镜像 → 运行源 ----------
echo "━━━ ② 能力源 $KIT_REL/skills → 运行源 $RUN_REL ━━━"
changed=0
while IFS= read -r -d '' f; do
  rel="${f#"$DST/$KIT_REL/skills/"}"
  if is_excluded "$rel"; then
    echo "  [=] 跳过（项目专属） $rel"
    continue
  fi
  dst="$DST/$RUN_REL/$rel"
  if [[ ! -f "$dst" ]]; then
    echo "  [+] 新增 $rel"
    changed=1
  elif ! cmp -s "$f" "$dst"; then
    echo "  [~] 更新 $rel"
    changed=1
  fi
  if (( DO_APPLY )); then
    mkdir -p "$(dirname "$dst")"
    cp "$f" "$dst"
  fi
done < <(find "$DST/$KIT_REL/skills" -type f -print0)

# 运行源里镜像已不存在的、且非项目专属的技能目录 → 只告警，不自动删
if [[ -d "$DST/$RUN_REL" ]]; then
  for d in "$DST/$RUN_REL"/*/; do
    d="${d%/}"
    [[ -d "$d" ]] || continue
    name="$(basename "$d")"
    if [[ -e "$DST/$KIT_REL/skills/$name" ]]; then continue; fi
    keep=0
    for p in "${PROJECT_SKILLS[@]}"; do [[ "$name" == "$p" ]] && keep=1; done
    [[ -L "$d" ]] && keep=1   # karpathy-* 等外部符号链接
    if (( keep == 0 )); then
      echo "  [!] 运行源目录镜像中已不存在（确认后手动删除）: $name"
    fi
  done
fi

echo
if (( DO_APPLY )); then
  echo "完成（已写入运行源）。"
else
  echo "以上为 dry-run 预览。执行同步请加 --apply。"
fi
echo "提示：项目专属技能 ${PROJECT_SKILLS[*]} 与 ${EXCLUDES[*]} 不会被覆盖。"
