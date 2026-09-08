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

[ -f "$HOOKS_DIR/pre-commit" ] || { echo "缺少 $HOOKS_DIR/pre-commit，无法安装" >&2; exit 1; }
chmod +x "$HOOKS_DIR/pre-commit"

git config core.hooksPath "$HOOKS_DIR"
echo "✓ 已启用 git hooks: $HOOKS_DIR"
echo "  (core.hooksPath=$(git config core.hooksPath))"
echo "  下次 git commit 会自动执行 pre-commit 红线检查。"
echo "  提示：执行 bash scripts/redline/install-git-hooks.sh -d 可查看当前配置。"
