#!/usr/bin/env bash
# 阶段：restart（platform 节点 · 平台托管，locked=true，页面只读）
# 依赖变量：RELEASE_DIR / MODULE_KEY / MODULE_DIR / MODULE_TYPE / PM2_NAME / PORT
#           WS_PLATFORM_SCRIPTS_DIR（平台脚本目录，由引擎注入）
#
# 职责边界：本脚本只负责「委托谁」，不内联实现。
#   - 实现自 2026-09-14 起**随 console 走**（同目录 restart-backend.sh），
#     不再依赖发布分支里的 `scripts/pipeline/restart-backend.sh` ——
#     否则「发布一个还没合入该脚本的旧分支」就会让重启阶段拿不到实现，
#     而这个脚本本该是平台能力、不应受业务分支影响。
#   - 平台托管脚本随 **deploy-console 版本**走（两端启动时幂等同步，不会漂移）。
#
# 稳定性：fail-fast，不静默降级 —— 找不到实现时显式失败。
set -euo pipefail

: "${RELEASE_DIR:?缺少 RELEASE_DIR（发布目录）}"
: "${WS_PLATFORM_SCRIPTS_DIR:?缺少 WS_PLATFORM_SCRIPTS_DIR（平台脚本目录，由引擎注入）}"

TARGET="$WS_PLATFORM_SCRIPTS_DIR/restart-backend.sh"
if [ ! -f "$TARGET" ]; then
  echo "[pipeline:restart] 缺少 $TARGET" >&2
  echo "[pipeline:restart] 说明：该实现随 deploy-console 构建产物分发（nest-cli assets）。" >&2
  echo "[pipeline:restart] 处置：检查 console 的 dist/pipeline/scripts/ 是否完整，必要时重新构建 console。" >&2
  exit 1
fi

exec bash "$TARGET"
