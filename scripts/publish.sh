#!/usr/bin/env bash
# ============================================================
# publish.sh — web_system 统一发布入口
#
# 目标：把「预检 → 构建 → 部署 → 复检」收成一条命令，
#       避免发布时反复弹权限确认（一次授权跑完全部）。
#
# 用法：
#   ./scripts/publish.sh dev              # dev 全量（后端全部 + 前端 portal/admin）
#   ./scripts/publish.sh dev all          # 同上
#   ./scripts/publish.sh dev user todo    # 只发指定后端服务
#   ./scripts/publish.sh dev portal admin # 只发前端模块
#   ./scripts/publish.sh prod all
#
# 环境变量：
#   SKIP_CHECK=1  跳过预检/复检
#   DRY_RUN=1     预览不执行
# ============================================================
set -uo pipefail

TARGET="${1:?用法: $0 <dev|prod> [targets...]（默认 all）}"
shift || true
TARGETS="${*:-all}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_CHECK="${SKIP_CHECK:-0}"
DRY_RUN="${DRY_RUN:-0}"

# ---------- 0. SSH 免密前置检查 ----------
SSH_ALIAS="kedou-$TARGET"
if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$SSH_ALIAS" "echo ok" >/dev/null 2>&1; then
  err "检测到 $SSH_ALIAS 尚未免密登录。\n  请先执行一次: ./scripts/setup-ssh-key.sh\n  （只需跑一次，之后发布全程不再弹密码）"
fi

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[publish:$TARGET]${NC} $1"; }
warn() { echo -e "${YELLOW}[publish:$TARGET][WARN]${NC} $1"; }
err()  { echo -e "${RED}[publish:$TARGET][ERROR]${NC} $1"; exit 1; }

# 归一化：all => 后端全部 + 前端 portal/admin
normalize_targets() {
  local t="$*"
  if [ "$t" = "all" ]; then
    echo "gateway auth user ai system todo content-hub mcp-gateway portal admin"
  else
    echo "$t"
  fi
}
NORMALIZED="$(normalize_targets "$TARGETS")"

log "发布开始 → $TARGET"
log "目标: $NORMALIZED"

# ---------- 1. 预检 ----------
if [ "$SKIP_CHECK" != "1" ]; then
  log "预检环境配置（空值/占位符）..."
  if [ "$DRY_RUN" != "1" ]; then
    "$ROOT/scripts/check-env.sh" "$TARGET" 2>&1 | grep -E "\[空值\]|\[占位符\]" | head -10 || true
  fi
  log "预检服务状态..."
  if [ "$DRY_RUN" != "1" ]; then
    FAILS=$("$ROOT/scripts/health-check.sh" "$TARGET" 2>&1 | grep -E "\[FAIL\]" | head -10 || true)
    if [ -n "$FAILS" ]; then
      warn "存在 FAIL 服务："; echo "$FAILS"
    else
      log "预检通过（无 FAIL）"
    fi
  fi
fi

# ---------- 2. 部署 ----------
# 注意：deploy.sh 在 build 失败时会 exit 1。这里把输出捕获到变量后再判断真实退出码，
#       避免管道 + head 引发的 SIGPIPE 误判（不用 pipefail 组合）。
for tgt in $NORMALIZED; do
  log "部署 $tgt ..."
  if [ "$DRY_RUN" = "1" ]; then
    DRY_RUN=1 "$ROOT/scripts/deploy.sh" "$TARGET" "$tgt" 2>&1 | grep -E "部署完成|dry-run|error" | head -3
  else
    out=$("$ROOT/scripts/deploy.sh" "$TARGET" "$tgt" 2>&1); rc=$?
    echo "$out" | grep -E "部署完成|\[FAIL\]|\[ERROR\]|error" | head -5
    [ "$rc" = "0" ] || err "部署 $tgt 失败，已中断发布（旧代码保留）"
  fi
done

# ---------- 2.5 数据库 schema 自动同步（幂等，漏跑有风险）----------
if [ "$SKIP_CHECK" != "1" ]; then
  log "同步数据库 schema（幂等）..."
  if [ "$DRY_RUN" = "1" ]; then
    DRY_RUN=1 "$ROOT/scripts/sync-schema.sh" "$TARGET" web_system 2>&1 | head -5
  else
    "$ROOT/scripts/sync-schema.sh" "$TARGET" web_system 2>&1 | grep -E "ok|完成|ERROR" | head -10 || true
  fi
fi

# ---------- 3. 复检 ----------
if [ "$SKIP_CHECK" != "1" ]; then
  log "发布后健康复检..."
  if [ "$DRY_RUN" != "1" ]; then
    "$ROOT/scripts/health-check.sh" "$TARGET" 2>&1 | grep -E "\[OK\]|\[FAIL\]" | tail -12
  fi
fi

log "发布完成 🎉"
