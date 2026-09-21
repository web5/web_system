#!/usr/bin/env bash
# ============================================================
# check-commit-msg.sh — commit-msg 校验：UI 源码须携带已确认原型的凭证（v1.1 · 方案 B）
#
# 设计：specs/kit-sop-enforcement/design.md §3.8 · 判据 V15–V18
# 用法：bash scripts/redline/check-commit-msg.sh <msgfile>
#      （由 .githooks/commit-msg 调用）
#
# 为什么必须是 commit-msg 而不是 pre-commit：pre-commit 拿不到 commit message。
#
# 判定表（§3.8）：
#   1. staged 不含 UI 源码                → 放行
#   2. staged 含 UI 源码 且 含原型/规格    → error（混合提交，绕过用户确认节点；Q7 一律 error）
#   3. staged 只含原型/规格                → 放行（这就是 Proto 起点 commit）
#   4. staged 含 UI 源码                  → 须带 Proto: <sha> 且 sha 为祖先原型 commit（四条校验）
# ============================================================
set -uo pipefail

MSG="${1:-}"
[ -n "$MSG" ] && [ -f "$MSG" ] || exit 0
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "${ROOT:-}" ] || exit 0
cd "$ROOT"

is_ui() {
  case "$1" in
    *.wxml|*.wxss|*.vue) return 0 ;;
    apps/*/pages/*) return 0 ;;
    apps/*/src/*.vue) return 0 ;;
    apps/*/components/*) return 0 ;;
    packages/ui/*) return 0 ;;
    app.json|apps/*/app.json) return 0 ;;
  esac
  return 1
}

is_passport() {
  case "$1" in
    */prototype/*) return 0 ;;
    docs/ui/prototypes/*) return 0 ;;
    */page-spec*.md|page-spec*.md) return 0 ;;
  esac
  return 1
}

err() { echo "$@" >&2; }

CM="$(basename "$0")"

staged="$(git diff --cached --name-only --no-renames 2>/dev/null)"
[ -n "$staged" ] || exit 0

has_ui=0
has_passport=0
ui_sample=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if is_ui "$f"; then
    has_ui=1
    [ -n "$ui_sample" ] || ui_sample="$f"
  fi
  if is_passport "$f"; then has_passport=1; fi
done <<EOF
$staged
EOF

# 1) 与本门无关 → 放行
[ "$has_ui" -eq 0 ] && exit 0

# 2) 混合提交（Q7：一律 error，混合提交正是绕过形态）
if [ "$has_passport" -eq 1 ]; then
  err "$CM 拒绝：原型/规格与 UI 源码混入同一 commit。"
  err "  这正是绕过用户确认节点的形态（改原型 + 落码一次提交）。"
  err "  做法：先单独提交原型/规格，取得 sha；再提交 UI 源码并带 trailer：Proto: <sha>"
  err "  应急：UI_GATE=off 环境变量，或 git commit --no-verify（CI 的 R10 仍会兜底）。"
  exit 1
fi

# 3) 只含原型/规格 → 放行（已由上面 has_ui=0 覆盖）

# 4) 含 UI 源码 → 须带 Proto 凭证
sha="$(grep -E '^Proto:[[:space:]]*[0-9a-fA-F]{7,40}' "$MSG" | head -n 1 | awk '{print $2}' | tr -d '\r')"
if [ -z "$sha" ]; then
  err "$CM 拒绝：本次改动含 UI 源码（$ui_sample），但 commit message 缺 Proto 凭证。"
  err "  请在 message 末尾加一行：Proto: <原型/规格 commit 的 sha>"
  err "  （§2.5 动作门：原型/规格先单独 commit 并经用户确认；详见 specs/kit-sop-enforcement/design.md §3.8）"
  exit 1
fi

# ① sha 存在
if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
  err "$CM 拒绝：Proto: $sha 不是本仓库存在的 commit。"
  exit 1
fi

# ② sha 在祖先链上（原型必须已经先落库）
if ! git merge-base --is-ancestor "$sha" HEAD 2>/dev/null; then
  err "$CM 拒绝：Proto: $sha 不在当前 HEAD 的祖先链上（原型必须已经先落库）。"
  exit 1
fi

# ③ 该 commit 确实改的是原型/规格（不是随便一个祖先 sha）
found=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if is_passport "$f"; then found=1; break; fi
done < <(git show --name-only --format= "$sha" 2>/dev/null)

if [ "$found" -ne 1 ]; then
  err "$CM 拒绝：Proto: $sha 未改动任何原型/规格文件（apps/*/prototype/**、docs/ui/prototypes/**、specs/**/page-spec*.md）。"
  exit 1
fi

exit 0
