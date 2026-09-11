#!/usr/bin/env bash
# ============================================================
# release-deploy-console.sh — deploy-console 的发布封装（CI / 人工共用）
#
# 为什么需要它：deploy-console 是发布平台自己，**不能走平台流水线** ——
#   restart 阶段执行 `pm2 restart web-deploy-console` 会把正在跑流水线的进程杀掉，
#   且其后还有 version/pointer/verify 同在进程内，流水线会永久卡在 running 并占住发布锁。
#   因此只能由外部直连执行。设计见 specs/ci-cd/gh-actions-release.md §五 B。
#
# 分工：
#   本脚本          = 同步发布目录到目标分支 + 调用下者
#   publish-deploy-console.sh = 构建（nest build + vite build）+ 干净重启
#                             + 孤儿进程/6200 一致性校验 + 健康复检
#
# 用法：
#   bash scripts/release-deploy-console.sh                        # 用发布目录当前分支
#   bash scripts/release-deploy-console.sh --branch feature/test  # 指定分支
#   DRY_RUN=1 bash scripts/release-deploy-console.sh --branch feature/test
#
# 环境变量：
#   RELEASE_DIR  发布目录（默认 ~/web_system_release）
#   DRY_RUN=1    只打印将要做什么，不执行
# 退出码：0 成功；非 0 失败（CI 据此判红）
# ============================================================
set -euo pipefail

RELEASE_DIR="${RELEASE_DIR:-$HOME/web_system_release}"
DRY_RUN="${DRY_RUN:-0}"
BRANCH=""

while [ $# -gt 0 ]; do
  case "$1" in
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    *)
      echo "未知参数: $1（支持 --branch <name>）" >&2
      exit 2
      ;;
  esac
done

[ -d "$RELEASE_DIR/.git" ] || {
  echo "[release-console] 发布目录不存在或不是 git 仓库: $RELEASE_DIR" >&2
  exit 1
}

if [ -z "$BRANCH" ]; then
  BRANCH="$(git -C "$RELEASE_DIR" branch --show-current)"
fi
[ -n "$BRANCH" ] || {
  echo "[release-console] 无法确定目标分支（发布目录可能处于 detached HEAD），请用 --branch 指定" >&2
  exit 1
}

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "  [dry-run] $*"
  else
    eval "$@"
  fi
}

echo "[release-console] 发布目录=$RELEASE_DIR 分支=$BRANCH"

# 发布目录必须干净：它是运行现场，带脏改动去 merge/reset 会覆盖人工修改
DIRTY="$(git -C "$RELEASE_DIR" status --porcelain)"
if [ -n "$DIRTY" ]; then
  echo "[release-console] 发布目录有未提交改动，拒绝发布（避免覆盖人工修改）：" >&2
  echo "$DIRTY" | head -10 >&2
  exit 1
fi

CUR="$(git -C "$RELEASE_DIR" branch --show-current)"
if [ "$CUR" != "$BRANCH" ]; then
  echo "[release-console] 切换分支：${CUR:-detached} → $BRANCH"
  run "git -C '$RELEASE_DIR' checkout '$BRANCH'"
fi

echo "[release-console] 同步到 origin/$BRANCH ..."
run "git -C '$RELEASE_DIR' fetch origin '$BRANCH'"
run "git -C '$RELEASE_DIR' merge --ff-only 'origin/$BRANCH'"
NEW="$(git -C "$RELEASE_DIR" rev-parse --short HEAD)"
echo "[release-console] 已同步到 $NEW"

[ -f "$RELEASE_DIR/scripts/publish-deploy-console.sh" ] || {
  echo "[release-console] 缺少构建发布脚本: $RELEASE_DIR/scripts/publish-deploy-console.sh" >&2
  exit 1
}

echo "[release-console] 调用 publish-deploy-console.sh --skip-sync（构建 + 重启 + 探活）..."
run "bash '$RELEASE_DIR/scripts/publish-deploy-console.sh' --skip-sync"

# 注意：变量后紧跟中文/全角字符时必须用 ${VAR}，否则某些 locale 下会被并入变量名
echo "[release-console] 完成 ✓（commit=${NEW}）"
