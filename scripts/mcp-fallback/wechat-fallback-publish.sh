#!/usr/bin/env bash
# ============================================================
# wechat-fallback-publish.sh — 公众号发布降级脚本
#
# 背景：MCP 主链路（finnews + wechat_mp）不通时，本脚本兜底：
#   1. SSH 登录 dev 机器（ubuntu@175.27.189.123）
#   2. 传输 remote-wechat-publish.sh 到 dev 机器
#   3. 在 dev 机器上调用 content-hub REST 接口
#      - 拉取财经数据（/api/market-pulse、/api/topics）生成日报 HTML
#      - 调 /api/content/wechat/draft 建草稿（默认不发布，安全）
#      - 加 --publish 可一键发布
#
# 用法：
#   ./scripts/mcp-fallback/wechat-fallback-publish.sh                  # 建草稿（默认）
#   ./scripts/mcp-fallback/wechat-fallback-publish.sh --publish        # 建草稿+发布
#   ./scripts/mcp-fallback/wechat-fallback-publish.sh --title "标题"    # 自定义标题
#   ./scripts/mcp-fallback/wechat-fallback-publish.sh --dry-run        # 只打印不执行
#
# 环境变量：
#   DEV_HOST        dev 机器（默认 ubuntu@175.27.189.123）
#   CH_BASE         content-hub 地址（默认 http://127.0.0.1:6007）
#   COVER_IMAGE_URL 封面图 URL（默认 picsum 随机图）
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_HOST="${DEV_HOST:-ubuntu@175.27.189.123}"
CH_BASE="${CH_BASE:-http://127.0.0.1:6007}"
COVER_IMAGE_URL="${COVER_IMAGE_URL:-https://dummyimage.com/800x400/FF8C42/fff.png&text=Finance+Daily}"
PUBLISH=0
DRY_RUN=0
TITLE=""
DATE_TAG="$(date +%Y-%m-%d)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[fallback]${NC} $1"; }
warn() { echo -e "${YELLOW}[fallback][WARN]${NC} $1"; }
err()  { echo -e "${RED}[fallback][ERROR]${NC} $1"; exit 1; }

# ── 解析参数 ──
while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish) PUBLISH=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --title)   TITLE="$2"; shift 2 ;;
    *) err "未知参数: $1（用法见文件头注释）" ;;
  esac
done

TITLE="${TITLE:-${DATE_TAG}财经日报（降级通道）}"

log "降级发布任务开始"
log "目标机器: ${DEV_HOST}  content-hub: ${CH_BASE}"
log "标题: ${TITLE}  模式: $([ "$PUBLISH" = "1" ] && echo '建稿+发布' || echo '仅建草稿')"

# ── 1. 探测 SSH ──
log "探测 SSH 连接..."
ssh -o ConnectTimeout=8 -o BatchMode=yes "$DEV_HOST" "echo ok" >/dev/null 2>&1 \
  || err "SSH 连接失败: ${DEV_HOST}"

# ── 2. 探测 content-hub ──
log "探测 content-hub 服务..."
ssh -o ConnectTimeout=8 -o BatchMode=yes "$DEV_HOST" \
  "curl -sf -m 5 ${CH_BASE}/api/market-pulse >/dev/null" 2>/dev/null \
  || err "content-hub 不可达: ${CH_BASE}（请先确认 dev 机器 content-hub 已启动）"

# ── 3. 传输远程脚本并执行（base64 编码，避免引号/heredoc 嵌套问题） ──
REMOTE_SCRIPT="$(cat "${SCRIPT_DIR}/remote-wechat-publish.sh")"
B64="$(printf '%s' "$REMOTE_SCRIPT" | base64)"

if [ "$DRY_RUN" = "1" ]; then
  log "[dry-run] 将传输 remote-wechat-publish.sh 到 ${DEV_HOST} 并执行："
  echo "  CH_BASE=${CH_BASE}  COVER_URL=${COVER_IMAGE_URL}"
  echo "  TITLE=${TITLE}  PUBLISH_FLAG=${PUBLISH}"
  echo "  远程脚本长度: ${#REMOTE_SCRIPT} 字节（base64 ${#B64}）"
  exit 0
fi

log "传输远程脚本并执行..."
REMOTE_CMD="set -e; \
echo '${B64}' | base64 -d > /tmp/remote-wechat-publish.sh; \
chmod +x /tmp/remote-wechat-publish.sh; \
CH_BASE='${CH_BASE}' COVER_URL='${COVER_IMAGE_URL}' TITLE='${TITLE}' \
PUBLISH_FLAG='${PUBLISH}' bash /tmp/remote-wechat-publish.sh; \
rm -f /tmp/remote-wechat-publish.sh"

OUTPUT=$(ssh -o ConnectTimeout=15 -o BatchMode=yes "$DEV_HOST" "$REMOTE_CMD") \
  || err "远程执行失败"
echo "$OUTPUT" | tail -5

log "降级发布完成"
