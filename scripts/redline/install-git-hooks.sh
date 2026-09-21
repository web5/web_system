#!/usr/bin/env bash
# ============================================================
# install-git-hooks.sh — 启用 .githooks/ 到本仓库 git
#
# 原理：git config core.hooksPath .githooks（零依赖，无需 husky）。
# hook 脚本本体入库（.githooks/ 目录），团队成员安装一次即可共享。
# 幂等：重复执行安全。
# 用法:
#   bash scripts/redline/install-git-hooks.sh     # 安装
#   bash scripts/redline/install-git-hooks.sh -d  # 显示当前配置
#   bash scripts/redline/install-git-hooks.sh -u  # 卸载（恢复默认）
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOP="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOOKS_DIR=".githooks"

case "${1:-}" in
  -d)
    echo "core.hooksPath = $(git config core.hooksPath || echo '(未设置，用默认 .git/hooks)')"
    exit 0
    ;;
  -u)
    git config --unset core.hooksPath 2>/dev/null && echo "已卸载，恢复默认 .git/hooks" || echo "本就未设置"
    exit 0
    ;;
  -h|--help) sed -n '1,20p' "$0"; exit 0 ;;
esac

# 从仓库根执行，保证相对路径正确
cd "$TOP"

[ -d "$HOOKS_DIR" ] || { echo "缺少目录 $HOOKS_DIR，无法安装" >&2; exit 1; }

# 安装目录下全部 hook 脚本（v1.1 起不止 pre-commit：新增 commit-msg 方案 B 校验）
INSTALLED=""
for f in "$HOOKS_DIR"/*; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in *.md|*.sample) continue ;; esac
  chmod +x "$f"
  INSTALLED="$INSTALLED $(basename "$f")"
done
[ -n "$INSTALLED" ] || { echo "目录 $HOOKS_DIR 内没有可安装的 hook 脚本" >&2; exit 1; }

git config core.hooksPath "$HOOKS_DIR"
echo "✓ 已启用 git hooks: $HOOKS_DIR"
echo "  (core.hooksPath=$(git config core.hooksPath))"
echo "  已安装：$INSTALLED"
echo "  pre-commit  = 红线扫描（R1~R8 / R9）"
echo "  commit-msg  = UI 源码须带 Proto: <sha> 凭证（specs/kit-sop-enforcement/design.md §3.8）"
echo "  提示：执行 bash scripts/redline/install-git-hooks.sh -d 可查看当前配置。"
