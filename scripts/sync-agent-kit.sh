#!/usr/bin/env bash
#
# sync-agent-kit.sh — ai-agent-kit(源) → web_system 半自动同步助手
#
# 背景：ai-agent-kit 的 CI 只会把更新同步到 web_system 的
#       .codebuddy/agent-kit/（副本/镜像），而 web_system 运行时真正加载的
#       是 .codebuddy/skills/（运行源，含项目专属的 fe/be 路由）。
#       两者不互通，所以 CI 同步不会自动让数字人行为更新。
#
# 本脚本作用：拉取源的通用更新后，把「源 vs 运行源」的差异清晰地报告出来，
#             标注哪些是通用更新（可吸收）、哪些是项目专属（须保留），
#             并安全地镜像更新副本目录。
#
# 安全原则：
#   - 绝不自动覆盖运行源 .codebuddy/skills/（会丢失 fe/be 路由）
#   - 副本 .codebuddy/agent-kit/ 是镜像，可安全同步
#   - 默认 dry-run 只报告；需显式 --mirror 才写副本；运行源永远人工合
#
# 用法：
#   ./scripts/sync-agent-kit.sh                 # 报告差异（默认）
#   ./scripts/sync-agent-kit.sh --pull          # 先 git pull 源仓库
#   ./scripts/sync-agent-kit.sh --mirror        # 额外把副本镜像同步到最新
#   SRC=/path DST=/path ./scripts/sync-agent-kit.sh
#
set -euo pipefail

SRC="${SRC:-/Users/geekwen/workspace/ai-agent-kit}"
DST="${DST:-/Users/geekwen/workspace/web_system}"
SKILLS=(rd-digital-agent rd-plan rd-execute)
DO_PULL=0
DO_MIRROR=0

for a in "$@"; do
  case "$a" in
    --pull)   DO_PULL=1 ;;
    --mirror) DO_MIRROR=1 ;;
    -h|--help) sed -n '1,20p' "$0"; exit 0 ;;
    *) echo "未知参数: $a" >&2; exit 1 ;;
  esac
done

[[ -d "$SRC" ]] || { echo "源目录不存在: $SRC" >&2; exit 1; }
[[ -d "$DST" ]] || { echo "目标目录不存在: $DST" >&2; exit 1; }

if (( DO_PULL )); then
  echo ">> 拉取 ai-agent-kit 最新 (git pull --ff-only)..."
  git -C "$SRC" pull --ff-only
fi

echo "源:   $SRC"
echo "目标: $DST"
echo

for sk in "${SKILLS[@]}"; do
  src_f="$SRC/skills/$sk/SKILL.md"
  run_f="$DST/.codebuddy/skills/$sk/SKILL.md"
  mir_f="$DST/.codebuddy/agent-kit/skills/$sk/SKILL.md"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "▸ $sk"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 版本号对比（frontmatter 第一行 version:）
  v_src=$(grep -m1 '^version:' "$src_f" 2>/dev/null | sed 's/version:[[:space:]]*//')
  v_run=$(grep -m1 '^version:' "$run_f" 2>/dev/null | sed 's/version:[[:space:]]*//')
  v_mir=$(grep -m1 '^version:' "$mir_f" 2>/dev/null | sed 's/version:[[:space:]]*//')
  echo "  版本  源=$v_src  运行源=$v_run  副本=$v_mir"

  # 源 vs 运行源：需人工合并
  if [[ -f "$run_f" ]]; then
    if diff -q "$src_f" "$run_f" >/dev/null 2>&1; then
      echo "  [✓] 运行源与源已一致，无需合并"
    else
      echo "  [!] 运行源需人工合并（源含通用更新，运行源含项目专属如 fe/be 路由）"
      echo "  ---- 统一 diff（左侧=运行源 / 右侧=源）----"
      diff -u "$run_f" "$src_f" | sed 's/^/      /' || true
      echo "  提示：'-' 开头 = 运行源独有（多为项目专属，务必保留）"
      echo "        '+' 开头 = 源独有（通用更新，可吸收到运行源）"
    fi
  else
    echo "  [+] 运行源缺失，建议新建并从源复制:"
    echo "      cp \"$src_f\" \"$run_f\""
  fi

  # 副本镜像（安全，可整文件覆盖）
  if [[ -f "$mir_f" ]]; then
    if diff -q "$src_f" "$mir_f" >/dev/null 2>&1; then
      echo "  [✓] 副本已是镜像最新"
    else
      if (( DO_MIRROR )); then
        cp "$src_f" "$mir_f"
        echo "  [→] 副本已镜像同步: $mir_f"
      else
        echo "  [→] 副本落后（可安全镜像）; 加 --mirror 自动同步，或手动:"
        echo "      cp \"$src_f\" \"$mir_f\""
      fi
    fi
  fi
  echo
done

echo "完成。运行源人工合并后，记得两边 bump 版本号并分别提交。"
