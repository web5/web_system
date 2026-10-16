#!/usr/bin/env bash
# ============================================================
# install-worktree-gate.sh — 把 worktree 门禁装到任意工程（幂等）
#
# 用法：
#   ./install-worktree-gate.sh /path/to/target-repo
#   ./install-worktree-gate.sh /path/to/target-repo --dry-run
#
# 做什么：
#   1) 复制 hook-worktree-gate.py / hook-worktree-session.py /
#      hook-worktree-shell-gate.py 到 <target>/scripts/redline/
#   2) 幂等合并 hook 到 <target>/.codebuddy/settings.json（不破坏已有 hook）
#   3) 确保 .gitignore 含 .worktrees/（否则 worktree 内容会被提交进仓库）
#
# 不做什么：
#   - 不改全局 ~/.workbuddy（配置跟工程走，随仓库分发）
#   - 不顺手建任何 worktree（建树是会话开始后的动作，由 hook 引导）
#
# 幂等：重复执行不会产生重复条目。
# ============================================================
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-}"
DRY=0
[ "${2:-}" = "--dry-run" ] && DRY=1

if [ -z "$TARGET" ]; then
  echo "用法: $0 <目标仓库路径> [--dry-run]" >&2
  exit 1
fi
[ -d "$TARGET" ] || { echo "❌ 目标不存在: $TARGET" >&2; exit 1; }
TARGET="$(cd "$TARGET" && pwd)"

git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "❌ 不是 git 仓库: $TARGET" >&2; exit 1
}

echo "目标仓库: $TARGET"
echo "源脚本目录: $SRC_DIR"
[ "$DRY" = "1" ] && echo "（dry-run：只打印，不落盘）"
echo

# ---- 1. 复制脚本 ----
DST="$TARGET/scripts/redline"
for f in hook-worktree-gate.py hook-worktree-session.py hook-worktree-shell-gate.py; do
  [ -f "$SRC_DIR/$f" ] || { echo "❌ 缺少源脚本 $f" >&2; exit 1; }
  if [ "$DRY" = "1" ]; then
    echo "[dry] 复制 $f → $DST/$f"
  else
    mkdir -p "$DST"
    cp "$SRC_DIR/$f" "$DST/$f"
    echo "✅ 复制 $f"
  fi
done

# ---- 2. 合并 settings.json ----
SETTINGS="$TARGET/.codebuddy/settings.json"
if [ "$DRY" = "1" ]; then
  echo "[dry] 合并 hook → $SETTINGS"
else
  mkdir -p "$(dirname "$SETTINGS")"
  [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
  CODEBUDDY_PROJECT_DIR="$TARGET" python3 - "$SETTINGS" <<'PYEOF'
import json, os, sys, io

path = sys.argv[1]
try:
    d = json.load(io.open(path, encoding='utf-8'))
except Exception:
    print('❌ settings.json 解析失败，已中止（未修改）')
    sys.exit(1)

d.setdefault('hooks', {})
P = '"${CODEBUDDY_PROJECT_DIR:-.}/scripts/redline/%s"'
NEW = [
    ('SessionStart', '', 'hook-worktree-session.py'),
    ('PreToolUse', 'write_to_file|replace_in_file|Write|Edit|MultiEdit',
     'hook-worktree-gate.py'),
    # Bash 通道：Write/Edit 类工具不经过时（echo > / sed -i / tee / python -c）
    # 文件照样落盘，故单独挂一道（默认 soft 只提醒）
    ('PreToolUse', 'execute_command|Bash', 'hook-worktree-shell-gate.py'),
]
changed = []
for event, matcher, script in NEW:
    groups = d['hooks'].setdefault(event, [])
    target = None
    for g in groups:
        if (g.get('matcher') or '') == matcher:
            target = g
            break
    if target is None:
        target = {'matcher': matcher, 'hooks': []}
        groups.append(target)
    target.setdefault('hooks', [])
    cmd = 'python3 ' + (P % script)
    if any(h.get('command') == cmd for h in target['hooks']):
        continue  # 已存在，幂等
    target['hooks'].append({'type': 'command', 'command': cmd, 'timeout': 10})
    changed.append('%s → %s' % (event, script))

if changed:
    io.open(path, 'w', encoding='utf-8').write(
        json.dumps(d, ensure_ascii=False, indent=2) + '\n')
    for c in changed:
        print('✅ 注册 hook:', c)
else:
    print('· hook 已存在，跳过')
PYEOF
fi

# ---- 3. .gitignore ----
GI="$TARGET/.gitignore"
if [ -f "$GI" ] && grep -qE '^\.?worktrees/?$' "$GI"; then
  echo "· .gitignore 已含 worktrees，跳过"
else
  if [ "$DRY" = "1" ]; then
    echo "[dry] 追加 .worktrees/ 到 .gitignore"
  else
    printf '\n# git worktree 隔离目录（多会话并行用）\n.worktrees/\n' >> "$GI"
    echo "✅ .gitignore 追加 .worktrees/"
  fi
fi

echo
echo "完成。验证方式："
echo "  cd $TARGET && git worktree list"
echo "  WORKTREE_GATE=soft 可降级为只提醒；=off 关闭（Write/Edit 通道）"
echo "  WORKTREE_SHELL_GATE=hard 把 Bash 通道从提醒升级为阻断；=off 关闭"
