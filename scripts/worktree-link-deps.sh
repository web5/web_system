#!/usr/bin/env bash
# worktree 备依赖 —— 把主工作区的 node_modules 软链进来，供类型检查/单测用。
#
# 背景：worktree 是纯检出，没有 node_modules；而 pnpm workspace 的依赖装一次要几分钟，
#   对「只是想跑一次 tsc」属于过度成本。故用软链复用主仓已有依赖，秒级完成。
#
# ⚠️ 关键一步：workspace 内部依赖（@kedouai/*）必须指回**本 worktree 自己的包**，
#   否则改了 packages/agent-core 却 tsc 到主仓 dist，等于白改（类型检查结果骗人）。
#
# 用法：
#   bash scripts/worktree-link-deps.sh            # 链接全部 servers/*（幂等）
#   bash scripts/worktree-link-deps.sh ai-service # 只链接指定服务
#   bash scripts/worktree-link-deps.sh --clean    # 移除本脚本创建的全部软链
#
# 约定：主仓路径取同级同名目录去后缀（-llm-tuning → 原名）；可用 MAIN_REPO 覆盖。
set -euo pipefail

WT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WT_NAME="$(basename "$WT_ROOT")"
MAIN_REPO="${MAIN_REPO:-$(dirname "$WT_ROOT")/${WT_NAME%%-*}}"

if [ ! -d "$MAIN_REPO" ]; then
  echo "找不到主仓：$MAIN_REPO（用 MAIN_REPO=<path> 指定）" >&2
  exit 2
fi

# worktree 自身提供的 workspace 包（优先级高于主仓同名软链）
declare -a LOCAL_PKGS=()
declare -a USED_PKGS=()
declare -a SKIPPED_PKGS=()
while IFS= read -r p; do
  LOCAL_PKGS+=("$(basename "$(dirname "$p")")")
done < <(find "$WT_ROOT/packages" -maxdepth 2 -name package.json -not -path "*/node_modules/*")

link_dir() {
  # link_dir <源 node_modules 绝对路径> <目标 node_modules 绝对路径>
  local src="$1" dest="$2"
  [ -d "$src" ] || { echo "跳过（主仓无依赖）：$src" >&2; return 0; }
  mkdir -p "$dest"
  (cd "$src" && for e in *; do
    [ -e "$e" ] || continue
    if [[ "$e" == @* ]]; then
      mkdir -p "$dest/$e"
      for s in "$e"/*; do ln -sfn "$src/$s" "$dest/$s"; done
    else
      ln -sfn "$src/$e" "$dest/$e"
    fi
  done)
  # 覆盖：本 worktree 的 workspace 包指回自身（读本仓 src/ 产出，而非主仓 dist）
  # ⚠️ 但**只覆盖已构建（dist 存在）的包**：若把未构建的包也指回本地，TypeScript 会报
  #   TS2307「Cannot find module '@web-system/shared'」—— 工作区里大部分包平时不构建，
  #   它们依赖主仓 dist（2026-10-10 实测踩到）。未构建的包保留主仓链接并在末尾提示。
  for pkg in "${LOCAL_PKGS[@]}"; do
    local owner sc
    owner="$(node -p "require('$WT_ROOT/packages/$pkg/package.json').name" 2>/dev/null || echo "@kedouai/$pkg")"
    if [ ! -d "$WT_ROOT/packages/$pkg/dist" ]; then
      SKIPPED_PKGS+=("$pkg")
      continue
    fi
    sc="${owner%%/*}"
    [ -n "$sc" ] && [ "$sc" != "$owner" ] && mkdir -p "$dest/$sc"
    ln -sfn "$WT_ROOT/packages/$pkg" "$dest/$owner"
    USED_PKGS+=("$pkg")
  done
  echo "已备依赖：$dest"
}

remove_link_dir() {
  # 先用 find 清内部软链；若整个 node_modules 本身也是软链则直接删链接本身
  local d="$1"
  [ -d "$d" ] || [ -L "$d" ] || return 0
  if [ -L "$d" ]; then rm -f "$d"; return 0; fi
  find "$d" -mindepth 1 -maxdepth 2 -type l -delete 2>/dev/null || true
  rmdir "$d"/*/ "$d" 2>/dev/null || true
}

# 根 node_modules（见下方说明为何必须是目录）
link_roots() {
  # 秒级操作。曾用 link_dir 逐个软链 1190 个条目（>2min，得不偿失），故改为单个软链。
  [ -e "$WT_ROOT/node_modules" ] || ln -sfn "$MAIN_REPO/node_modules" "$WT_ROOT/node_modules"
}

clean_links() {
  local n=0
  for d in "$WT_ROOT/node_modules" "$WT_ROOT"/servers/*/node_modules; do
    [ -d "$d" ] || [ -L "$d" ] || continue
    remove_link_dir "$d"
    n=$((n + 1))
  done
  echo "已清理 $n 处（$WT_ROOT 下由本脚本创建的软链）"
}

# ⚠️ 根 node_modules 用**单个软链**（秒级），两处配套设施必须知道：
#   1) 为什么要铺根：pnpm 提升依赖在 servers/*/node_modules 里是**相对路径**软链（如
#      ws → ../../node_modules/.pnpm/ws@x），搬到 worktree 后相对路径会漂到不存在的路径
#      → TS2307。铺了根，解析链才能回落主仓。
#   2) 副作用：gitignore 的 `node_modules/` 带斜杠只匹配目录、不匹配 symlink → 会以
#      `?? node_modules` 出现在 git status。想到的两条补救都无效或过贵：per-worktree exclude
#      **实测 git 2.39 不认**（写了照样报）；逐个软链 1190 条目要 2 分钟以上。
#      最终解法是仓库 .gitignore 增加不带斜杠的 `node_modules` 一行（实测生效），别再改回去。
case "${1:-}" in
  --clean) clean_links; exit 0 ;;
  "") link_roots; for d in "$WT_ROOT"/servers/*/; do link_dir "$MAIN_REPO/${d#$WT_ROOT/}/node_modules" "${d}node_modules"; done ;;
  *) link_roots; for name in "$@"; do link_dir "$MAIN_REPO/servers/$name/node_modules" "$WT_ROOT/servers/$name/node_modules"; done ;;
esac

echo
if [ "${#USED_PKGS[@]}" -gt 0 ]; then
  echo "指回本地：${USED_PKGS[*]}（改动这些包会被 tsc 看到）"
fi
if [ "${#SKIPPED_PKGS[@]}" -gt 0 ]; then
  echo "仍用主仓 dist：${SKIPPED_PKGS[*]}（本仓未构建；先构建再重跑本脚本才会指回本地）"
fi
echo
echo "下一步（按需，可直接复制）："
echo "  类型检查：$MAIN_REPO/node_modules/.bin/tsc --noEmit -p servers/<svc>/tsconfig.json"
echo "  包构建  ：cd packages/agent-core && $MAIN_REPO/node_modules/.bin/tsc -p tsconfig.build.json"
echo "  单测    ：$MAIN_REPO/node_modules/.bin/jest <具体 spec 路径>"
echo "  清理    ：bash scripts/worktree-link-deps.sh --clean"
