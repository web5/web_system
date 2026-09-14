#!/usr/bin/env bash
# 阶段：verify（platform 节点 · 平台托管，locked=true，页面只读）
# 依赖变量：RELEASE_DIR / MODULE_KEY / MODULE_DIR / MODULE_TYPE / PM2_NAME / PORT
#           WS_PLATFORM_SCRIPTS_DIR（平台脚本目录，由引擎注入）
#
# 职责边界同 restart-step.sh：只负责「委托谁」。
# 实现自 2026-09-14 起**随 console 走**（同目录 verify-backend.sh），
# 不再依赖发布分支里的 `scripts/pipeline/verify-backend.sh`。
set -euo pipefail

: "${RELEASE_DIR:?缺少 RELEASE_DIR（发布目录）}"
: "${WS_PLATFORM_SCRIPTS_DIR:?缺少 WS_PLATFORM_SCRIPTS_DIR（平台脚本目录，由引擎注入）}"

TARGET="$WS_PLATFORM_SCRIPTS_DIR/verify-backend.sh"
if [ ! -f "$TARGET" ]; then
  echo "[pipeline:verify] 缺少 $TARGET" >&2
  echo "[pipeline:verify] 说明：该实现随 deploy-console 构建产物分发（nest-cli assets）。" >&2
  echo "[pipeline:verify] 处置：检查 console 的 dist/pipeline/scripts/ 是否完整，必要时重新构建 console。" >&2
  exit 1
fi

exec bash "$TARGET"
