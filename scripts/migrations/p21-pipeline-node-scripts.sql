-- ===========================================================
-- P21: 流水线节点脚本初始化（平台不再分发脚本）
--
-- 背景（2026-09-21）：平台侧删除了「随 console 分发的脚本」机制
--   （WS_PLATFORM_SCRIPTS_DIR / step-scripts.ts / PlatformScriptSeedService / pipeline/scripts/*）；
--   动作脚本一律 curl 调平台内部接口（`/api/internal/release/{versions,pointer}`，x-internal-key 鉴权）。
-- 本脚本两个用途：
--   ① 新环境初始化：给所有模板补 git 节点的默认脚本（仅当为空时填，不覆盖运维已有脚本）；
--   ② 存量迁移：把 write-version 动作从「调平台分发的 .mjs」改为 curl 调接口。
-- 幂等：可重复执行。执行库：web_system_deploy
-- ===========================================================

-- ① git 节点默认脚本（空值才填；运维改过的不动）
UPDATE deploy_pipeline_step_commands
SET command = '#!/usr/bin/env bash
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
ORIGIN_URL="$(git remote get-url origin)"
echo "[git] origin=$ORIGIN_URL"

# ①-2 代码来源自证：配置中心 REPO_URL（global）非空时，origin 必须与之完全一致
#      存在意义：历史高危场景 = 发布目录 origin 被改错后照常构建，代码来源在流水线里不可见
if [ -n "${REPO_URL:-}" ] && [ "$ORIGIN_URL" != "$REPO_URL" ]; then
  echo "[git] 代码来源不符: 期望 $REPO_URL 实际 $ORIGIN_URL" >&2
  echo "[git] 处置：核对配置中心 REPO_URL，或修正发布目录的 origin" >&2
  exit 1
fi

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
',
    updated_by = 'p21',
    updated_at = NOW()
WHERE node_key = 'git' AND (command IS NULL OR command = '');

-- ② write-version 动作：改为 curl 调平台接口（旧正文引用已删除的平台工具）
UPDATE deploy_pipeline_actions
SET script = '#!/usr/bin/env bash
# 发布流水线 · write-version（写版本记录）：直连平台接口，不依赖平台分发的脚本
#
# 2026-09-21 起平台不再分发脚本（原实现是调用平台分发的 write-version.mjs）：
# 动作脚本一律用 curl 调平台内部接口（x-internal-key 鉴权）。
set -euo pipefail
: "${CONSOLE_API:?缺少 CONSOLE_API（平台未注入，检查 resolveStageVars）}"
: "${CONSOLE_TOKEN:?缺少 CONSOLE_TOKEN（平台未注入）}"
: "${MODULE_KEY:?缺少 MODULE_KEY}" "${DEPLOY_ENV:?缺少 DEPLOY_ENV}" "${COMMIT_ID:?缺少 COMMIT_ID}"

curl -sf -X POST "${CONSOLE_API}/internal/release/versions" \\
  -H "Content-Type: application/json" \\
  -H "x-internal-key: ${CONSOLE_TOKEN}" \\
  -d "{\\"moduleKey\\":\\"${MODULE_KEY}\\",\\"env\\":\\"${DEPLOY_ENV}\\",\\"versionTag\\":\\"${COMMIT_ID}\\",\\"gitBranch\\":\\"${BRANCH}\\",\\"operator\\":\\"pipeline-script\\"}" \\
  >/dev/null \\
  || { echo "[write-version] 写版本失败：${CONSOLE_API}/internal/release/versions（检查 CONSOLE_API / CONSOLE_TOKEN）" >&2; exit 1; }

echo "[write-version] 版本记录已写入: ${DEPLOY_ENV}/${MODULE_KEY}@${COMMIT_ID}"
',
    updated_by = 'p21',
    updated_at = NOW()
WHERE name LIKE 'write-version%';

SELECT 'p21-pipeline-node-scripts done' AS note;
