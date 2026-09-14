#!/usr/bin/env bash
# 阶段：verify（platform 节点 · 平台托管，locked=true，页面只读）
# 依赖变量：RELEASE_DIR / MODULE_KEY / MODULE_DIR / MODULE_TYPE / PM2_NAME / PORT
#
# 职责边界同 restart-step.sh：本脚本只负责「委托谁」。
#   实现见仓库 scripts/pipeline/verify-backend.sh —— pm2 online 轮询 + 端口 TCP 探活 +
#   AI 链路端到端探活（401 → 网关密钥不一致；4010 → 网关与知识服务内部密钥不一致）。
#
# 为什么要叠加业务层探活：端口通 ≠ 可用。历史事故里「发布成功」出现过两类假健康：
#   进程 online 但端口没监听；端口通但 MCP 工具未注册/跨服务密钥不一致。
set -euo pipefail

: "${RELEASE_DIR:?缺少 RELEASE_DIR（发布目录）}"

TARGET="$RELEASE_DIR/scripts/pipeline/verify-backend.sh"
if [ ! -f "$TARGET" ]; then
  echo "[pipeline:verify] 缺少 $TARGET" >&2
  echo "[pipeline:verify] 说明：发布分支必须包含 scripts/pipeline/verify-backend.sh。" >&2
  echo "[pipeline:verify] 处置：确认发布用的分支/commit 已合并该脚本，或先把分支合入 master 后重发。" >&2
  exit 1
fi

exec bash "$TARGET"
