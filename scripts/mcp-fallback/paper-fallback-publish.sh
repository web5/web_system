#!/usr/bin/env bash
# ============================================================
# paper-fallback-publish.sh — 论文学习日报降级脚本
#
# 背景：论文 MCP 不可用时，本脚本兜底：
#   1. SSH 登录 dev 机器（ubuntu@175.27.189.123）
#   2. 传输 remote-paper-publish.sh 到 dev 机器
#   3. 在 dev 机器上拉 arXiv → 生成中英双语 HTML → 调 content-hub 建稿/发布
#
# 用法：
#   ./scripts/mcp-fallback/paper-fallback-publish.sh                  # 建草稿（默认）
#   ./scripts/mcp-fallback/paper-fallback-publish.sh --publish        # 建草稿+发布
#   ./scripts/mcp-fallback/paper-fallback-publish.sh --title "标题"    # 自定义标题
#   ./scripts/mcp-fallback/paper-fallback-publish.sh --max 5          # 论文条数（默认 5）
#   ./scripts/mcp-fallback/paper-fallback-publish.sh --dry-run        # 只打印不执行
#
# 环境变量：
#   DEV_HOST        dev 机器（默认 ubuntu@175.27.189.123）
#   CH_BASE         content-hub 地址（默认 http://127.0.0.1:6007）
#   COVER_IMAGE_URL 封面图 URL
#   CATEGORIES      arxiv 分类（默认 cs.AI+OR+cs.CL+OR+cs.CV+OR+cs.LG）
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_HOST="${DEV_HOST:-ubuntu@175.27.189.123}"
CH_BASE="${CH_BASE:-http://127.0.0.1:6007}"
COVER_IMAGE_URL="${COVER_IMAGE_URL:-https://dummyimage.com/800x400/4A90E2/fff.png&text=arXiv+Daily}"
CATEGORIES="${CATEGORIES:-cs.AI+OR+cs.CL+OR+cs.CV+OR+cs.LG}"
MAX_RESULTS="${MAX_RESULTS:-5}"
PUBLISH=0
DRY_RUN=0
TITLE=""
DATE_TAG="$(date +%Y-%m-%d)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[paper-fb]${NC} $1"; }
warn() { echo -e "${YELLOW}[paper-fb][WARN]${NC} $1"; }
err()  { echo -e "${RED}[paper-fb][ERROR]${NC} $1"; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish) PUBLISH=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --title)   TITLE="$2"; shift 2 ;;
    --max)     MAX_RESULTS="$2"; shift 2 ;;
    *) err "未知参数: $1（用法见文件头注释）" ;;
  esac
done

TITLE="${TITLE:-${DATE_TAG} arXiv 论文日报（降级通道）}"

log "论文降级发布任务开始"
log "目标机器: ${DEV_HOST}  content-hub: ${CH_BASE}"
log "标题: ${TITLE}  论文分类: ${CATEGORIES}  条数: ${MAX_RESULTS}"
log "模式: $([ "$PUBLISH" = "1" ] && echo '建稿+发布' || echo '仅建草稿')"

# ── 1. 探测 SSH ──
log "探测 SSH 连接..."
ssh -o ConnectTimeout=8 -o BatchMode=yes "$DEV_HOST" "echo ok" >/dev/null 2>&1 \
  || err "SSH 连接失败: ${DEV_HOST}"

# ── 2. 探测 content-hub ──
log "探测 content-hub 服务..."
ssh -o ConnectTimeout=8 -o BatchMode=yes "$DEV_HOST" \
  "curl -sf -m 5 ${CH_BASE}/api/market-pulse >/dev/null" 2>/dev/null \
  || err "content-hub 不可达: ${CH_BASE}（请先确认 dev 机器 content-hub 已启动）"

# ── 3. 探测 arXiv 网络可达性（避免拉取失败时白跑）──
log "探测 arXiv 网络可达性..."
ssh -o ConnectTimeout=8 -o BatchMode=yes "$DEV_HOST" \
  "curl -sf -m 8 -A 'Mozilla/5.0' 'http://export.arxiv.org/api/query?search_query=cat:cs.AI&max_results=1' -o /dev/null" 2>/dev/null \
  || warn "arXiv 不可达，将仍尝试执行（可能失败）"

# ── 4. 传输远程脚本并执行 ──
REMOTE_SCRIPT="$(cat "${SCRIPT_DIR}/remote-paper-publish.sh")"
B64="$(printf '%s' "$REMOTE_SCRIPT" | base64)"

if [ "$DRY_RUN" = "1" ]; then
  log "[dry-run] 将传输 remote-paper-publish.sh 到 ${DEV_HOST} 并执行："
  echo "  CH_BASE=${CH_BASE}  COVER_URL=${COVER_IMAGE_URL}"
  echo "  TITLE=${TITLE}  CATEGORIES=${CATEGORIES}  MAX_RESULTS=${MAX_RESULTS}  PUBLISH_FLAG=${PUBLISH}"
  echo "  远程脚本长度: ${#REMOTE_SCRIPT} 字节（base64 ${#B64}）"
  exit 0
fi

log "传输远程脚本并执行..."
REMOTE_CMD="set -e; \
echo '${B64}' | base64 -d > /tmp/remote-paper-publish.sh; \
chmod +x /tmp/remote-paper-publish.sh; \
CH_BASE='${CH_BASE}' COVER_URL='${COVER_IMAGE_URL}' TITLE='${TITLE}' \
CATEGORIES='${CATEGORIES}' MAX_RESULTS='${MAX_RESULTS}' \
PUBLISH_FLAG='${PUBLISH}' bash /tmp/remote-paper-publish.sh; \
rm -f /tmp/remote-paper-publish.sh"

OUTPUT=$(ssh -o ConnectTimeout=15 -o BatchMode=yes "$DEV_HOST" "$REMOTE_CMD") \
  || err "远程执行失败"
echo "$OUTPUT" | tail -5

log "论文降级发布完成"
