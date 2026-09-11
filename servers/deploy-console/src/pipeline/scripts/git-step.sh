#!/usr/bin/env bash
# 阶段：git（platform 节点 · 平台托管，locked=true，页面只读）
# 依赖变量：RELEASE_DIR / BRANCH / COMMIT_ID / MODULE_* / WS_SAFE_DELETE
# 约束：机器无关 —— 只依赖「本机自身」变量，禁止引用 REMOTE_*（那是发起端概念）
# 稳定性：三处前置校验全部 fail-fast，不静默降级
#   ① 无 origin            → 失败（防「拿本地工作区代码发出去」）
#   ② 分支不存在           → 失败（不吞错误、不悄悄换分支）
#   ③ commit 不可达        → 失败（绝不退化成"分支最新代码"，这是历史高危场景）
#   ④ reset 后 HEAD 自证   → 失败即失败，把错误锁在 git 阶段
# 说明：依赖同步与共享包预构建**不在此脚本内**，由平台在 git 阶段之后执行（流水线级一次）。
set -euo pipefail

: "${RELEASE_DIR:?缺少 RELEASE_DIR（发布目录）}"
: "${BRANCH:?缺少 BRANCH}"

cd "$RELEASE_DIR"
[ -d .git ] || { echo "[git] 发布目录不是 git 仓库: $RELEASE_DIR（请先 git clone）" >&2; exit 1; }

# ① 必须有 origin：代码来源不可确认时不构建
git remote get-url origin >/dev/null 2>&1 || {
  echo "[git] 未配置 origin: $RELEASE_DIR（git remote -v 自检；如需容忍本地仓库请调整脚本）" >&2
  exit 1
}

# ② 取回全部引用（失败即失败：离线/无凭证不允许用旧代码继续构建）
echo "[git] fetch --all --prune --tags"
git fetch --all --prune --tags

# ③ 检出目标分支：origin 优先；origin 与本地都没有 → 直接失败
if git rev-parse --verify --quiet "refs/remotes/origin/${BRANCH}" >/dev/null; then
  git checkout -B "$BRANCH" "origin/${BRANCH}"
elif git rev-parse --verify --quiet "refs/heads/${BRANCH}" >/dev/null; then
  echo "[git] [warn] origin/${BRANCH} 不存在，回退本地分支 ${BRANCH}（代码来源非远端，请确认）" >&2
  git checkout -B "$BRANCH" "$BRANCH"
else
  echo "[git] 分支不存在: ${BRANCH}（origin 与本地均无）；请核对分支名或先 push" >&2
  exit 1
fi

# ④ 指定 commit → 必须可达，否则 fail-fast
#    COMMIT_ID 在 R6 下是完整引用（default/<commit>），取末段作为 git 目标
TARGET="${COMMIT_ID##*/}"
if [ -n "$TARGET" ]; then
  git rev-parse --verify --quiet "${TARGET}^{commit}" >/dev/null || {
    echo "[git] commit 不可达: ${TARGET}（未 push 到 origin 或哈希错误）；请先 push 后重发" >&2
    exit 1
  }
  WANT=$(git rev-parse "${TARGET}^{commit}")   # 统一成全哈希，避免短哈希位数差异
  echo "[git] reset --hard ${TARGET}"
  git reset --hard "$WANT"

  # 自证：HEAD 必须等于目标 commit（与平台断言互为双保险）
  GOT=$(git rev-parse HEAD)
  [ "$GOT" = "$WANT" ] || { echo "[git] 自检失败: HEAD=${GOT} 期望=${WANT}" >&2; exit 1; }
fi

# ⑤ 清理未跟踪文件（残留会污染构建）
git clean -fd

echo "[git] 就绪 HEAD=$(git rev-parse --short HEAD) branch=$(git rev-parse --abbrev-ref HEAD)"
