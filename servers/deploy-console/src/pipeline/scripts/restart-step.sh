#!/usr/bin/env bash
# 阶段：restart（platform 节点 · 平台托管，locked=true，页面只读）
# 依赖变量：RELEASE_DIR / MODULE_KEY / MODULE_DIR / MODULE_TYPE / PM2_NAME / PORT
#
# 职责边界：本脚本只负责「委托谁」，不内联实现。
#   - 平台托管脚本随 **deploy-console 版本**走（两端启动时幂等同步，不会漂移）；
#   - 具体实现随 **业务代码**走（仓库 scripts/pipeline/restart-backend.sh：依赖装配校验 +
#     干净环境重建），可 review、可 bash -n、可单测。
#   二者分开，各自按自己的节奏演进；改了实现不必动库，改了「调用谁」才动库。
#
# 稳定性：fail-fast，不静默降级 —— 发布分支缺脚本时显式失败（否则会悄悄退回旧语义，
#   正是「脚本存在但跑的是旧逻辑」这类难查问题的来源）。
set -euo pipefail

: "${RELEASE_DIR:?缺少 RELEASE_DIR（发布目录）}"

TARGET="$RELEASE_DIR/scripts/pipeline/restart-backend.sh"
if [ ! -f "$TARGET" ]; then
  echo "[pipeline:restart] 缺少 $TARGET" >&2
  echo "[pipeline:restart] 说明：发布分支必须包含 scripts/pipeline/restart-backend.sh（master 已含）。" >&2
  echo "[pipeline:restart] 处置：确认发布用的分支/commit 已合并该脚本，或先把分支合入 master 后重发。" >&2
  exit 1
fi

exec bash "$TARGET"
