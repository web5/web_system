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

# ---- 豁免（本门不适用的情况）----
# ① merge commit（$2 = merge）：合并进来的改动早已在各自分支走过凭证流程；
#    把「合并结果」当「本次改动」判定会**稳定误报**（2026-09-24 实测：merge master 时
#    因带入已合并的 .vue 而被拒）。注：squash 不豁免——它产生新 commit，内容仍需凭证。
# ② UI_GATE=off：批量机械改动 / 紧急修复的应急出口（wrapper `.githooks/commit-msg` 亦已实现；
#    此处自包含一份，保证直接调用本脚本时同样有出口）。
[ "${2:-}" = "merge" ] && exit 0
[ "${UI_GATE:-}" = "off" ] && exit 0

is_ui() {
  case "$1" in
    *.wxml|*.wxss|*.vue) return 0 ;;
    apps/*/pages/*) return 0 ;;
    apps/*/src/*.vue) return 0 ;;
    apps/*/components/*) return 0 ;;
    # ⚠️ 不能写 `packages/ui/*`：那会把 package.json / tsconfig / jest.config.js
    # 也算成 UI 源码 → 改个 lint 脚本都要求 Proto + Design 凭证（2026-10-22 实测误报）。
    # 源码在 src/ 下，故收窄到 packages/ui/src/*。
    packages/ui/src/*) return 0 ;;
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

# 门禁共享判定库（豁免机制 2.7/2.8 + 规格书识别 2.6）
# 与 CI 的 scan-rules.sh 共用同一份实现 —— 「本地认、CI 不认」正是 2.8 要消灭的摩擦源。
# ⚠️ 路径按脚本自身位置解析：本 hook 会在任意仓库/任意 worktree 下运行。
# shellcheck source=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gate-shared.sh"

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

# 3.5) 微调豁免：与 CI 的 R9b / R10 / R11 同口径（设计：specs/kit-sop-enforcement/design.md §3.5.1）
#      本地若认、CI 若不认（或反之），"记了豁免还是报错"会成为新的摩擦源。
#
# 卡 2.8：豁免改为**按门分类** —— `Micro-exempt: R11: <理由>` 只放行 R11（Design），
#   不再顺带放行 R10（Proto）。旧格式 `Micro-exempt: <理由>` 仍是一票否决（向后兼容）。
#   门号与 CI 侧一一对应：R10 = Proto 凭证，R11 = Design 凭证。
MSG_BODY="$(cat "$MSG" 2>/dev/null || true)"
exempt_parse "$MSG_BODY"
EXEMPT_LEGACY_HINT=""
if [ "$EXEMPT_PRESENT" = "1" ]; then
  if [ "$EXEMPT_LEGACY" = "1" ]; then
    # 旧格式：全门放行（与存量行为一致），但提示改用按门分类格式
    exit 0
  fi
  # 新格式：只放行列出的门
  if exempt_covers "R10"; then EXEMPT_SKIP_PROTO=1; else EXEMPT_SKIP_PROTO=0; fi
  if exempt_covers "R11"; then EXEMPT_SKIP_DESIGN=1; else EXEMPT_SKIP_DESIGN=0; fi
  # 卡 2.7：理由质量不达标 → 豁免不生效（放行 = 不豁免，即继续走下面的凭证校验）
  if ! exempt_quality "$EXEMPT_REASON" 0 0; then
    err "$CM 提示：Micro-exempt 理由不达标 —— ${EXEMPT_QUALITY_MSG}"
    err "  本次豁免不生效，请补充可审计的理由后重写 trailer。"
    EXEMPT_SKIP_PROTO=0
    EXEMPT_SKIP_DESIGN=0
  fi
fi

# 4) 含 UI 源码 → 须带 Proto 凭证
#    卡 2.8：仅当豁免范围含 R10 时才跳过整个 Proto 校验（EXEMPT_SKIP_PROTO）。
if [ "${EXEMPT_SKIP_PROTO:-0}" != "1" ]; then
  sha="$(grep -E '^Proto:[[:space:]]*[0-9a-fA-F]{7,40}' "$MSG" | head -n 1 | awk '{print $2}' | tr -d '\r')"
  if [ -z "$sha" ]; then
    err "$CM 拒绝：本次改动含 UI 源码（${ui_sample}），但 commit message 缺 Proto 凭证。"
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
  #    卡 2.6：规格书识别放宽 —— specs/**/prototype.html 这类「有原型但文件名不符约定」的
  #    也算数，不再逼执行者用 Micro-exempt 兜底。
  found=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if is_passport "$f" || is_spec_doc "$f"; then found=1; break; fi
  done < <(git show --name-only --format= "$sha" 2>/dev/null)

  if [ "$found" -ne 1 ]; then
    err "$CM 拒绝：Proto: $sha 未改动任何原型/规格文件（apps/*/prototype/**、docs/ui/prototypes/**、specs/**/page-spec*.md 或 specs/**/prototype*.html）。"
    exit 1
  fi
fi

# 5) 设计评审凭证 Design（error 级 · specs/design-reviewer/design.md §3.7）
#    UI commit 须带 `Design: pass`，表示 D3 实现一致性评审已过且阻塞项清零。
#    卡 2.8：仅当豁免范围含 R11 时才跳过（EXEMPT_SKIP_DESIGN）。
if [ "${EXEMPT_SKIP_DESIGN:-0}" = "1" ]; then
  exit 0
fi
dval="$(grep -E '^Design:[[:space:]]*[^[:space:]]+' "$MSG" | head -n 1 | sed -E 's/^Design:[[:space:]]*//' | tr -d '\r')"
if [ -z "$dval" ]; then
  err "$CM 拒绝：本次改动含 UI 源码（${ui_sample}），但 commit message 缺 Design 凭证。"
  err "  请在 message 末尾加一行：Design: pass"
  err "  （D3 实现一致性评审已过、报告阻塞项清零；纯视觉微调改走 Micro-exempt: <理由>）"
  err "  （见 specs/design-reviewer/design.md §3.7；CI R11 为 error 级兜底）"
  exit 1
fi
if [ "$dval" != "pass" ]; then
  err "$CM 拒绝：UI commit 的 Design 凭证须为 pass，实际为：$dval"
  err "  报告路径（Design: docs/ui/reviews/<topic>-<date>.md）应挂在原型/规格 commit 上，不挂在 UI commit 上。"
  exit 1
fi

exit 0
