#!/usr/bin/env bash
# ============================================================
# 发布流水线 · 拉取配置中心下发内容 → 落盘 servers/<dir>/.env.generated
#
# 用途：**restart-only**（只重启、不重新部署）场景补齐配置下发。
#   部署（apply）路径已由 console 内置覆盖（DeployService.writeGeneratedEnv，
#   deploy.service.ts:518），本脚本只补「重启阶段也要先落盘」这一环。
#
# 为什么必须在**重启之前**执行：进程启动时读 dotenv，
#   `.env.generated` 排在 `.env` 之前（先出现者优先）→ 先落盘才能保证重启即读到新值。
#
# 鉴权：`x-internal-key: $CONSOLE_TOKEN`（平台注入；其值 = 控制台的 INTERNAL_API_KEY，
#   见 pipeline.service.ts:265）。脚本鉴权**不依赖被下发的键本身**，故无鸡生蛋。
#
# 平台注入变量：CONSOLE_API / CONSOLE_TOKEN / DEPLOY_ENV_ID
#               RELEASE_DIR / MODULE_KEY / MODULE_DIR
# 本地调试：DRY_RUN=1 只打印计划，不写文件
# ============================================================
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
log() { echo "[pipeline:fetch-config] $*"; }
die() { echo "[pipeline:fetch-config] $*" >&2; exit 1; }

MODULE_DIR_NAME="${MODULE_DIR:-${MODULE_KEY:-}}"
: "${MODULE_DIR_NAME:?MODULE_KEY/MODULE_DIR 未设置}"

skip() { log "跳过：$1（沿用现有 .env.generated / .env）"; exit 0; }

[ -n "${CONSOLE_API:-}" ]   || skip "CONSOLE_API 未注入"
[ -n "${CONSOLE_TOKEN:-}" ] || skip "CONSOLE_TOKEN 未注入"
[ -n "${DEPLOY_ENV_ID:-}" ] || skip "DEPLOY_ENV_ID 未注入"

RELEASE_DIR_EFF="${RELEASE_DIR:-${RELEASE_WORKSPACE:-}}"
[ -n "${RELEASE_DIR_EFF}" ] || skip "RELEASE_DIR 未设置"
SVC_DIR="${RELEASE_DIR_EFF}/servers/${MODULE_DIR_NAME}"
URL="${CONSOLE_API}/api/config/internal/dispatch/${MODULE_KEY:-${MODULE_DIR_NAME}}?envId=${DEPLOY_ENV_ID}"

# DRY_RUN 先返回：本地调试时目标机目录可能不存在，不应因此失败
if [ "$DRY_RUN" = "1" ]; then
  log "[DRY_RUN] 将拉取 ${URL} → ${SVC_DIR}/.env.generated (0600)"
  exit 0
fi

[ -d "${SVC_DIR}" ] || die "服务目录不存在：${SVC_DIR}"

TMP="${SVC_DIR}/.env.generated.tmp.$$"
cleanup() { rm -f "$TMP" 2>/dev/null || true; }
trap cleanup EXIT

CODE="$(curl -sS -o "$TMP" -w '%{http_code}' --max-time 20 \
  -H "x-internal-key: ${CONSOLE_TOKEN}" \
  -H 'Accept: text/plain' \
  "$URL" 2>/dev/null || echo 000)"

case "$CODE" in
  200)
    # 落盘：0600（文件里可能含密钥明文），先写临时文件再原子替换
    chmod 600 "$TMP"
    mv -f "$TMP" "${SVC_DIR}/.env.generated"
    trap - EXIT
    # 只回显键数量，**绝不打印内容**（审计与日志都不记明文）
    KEYS="$(grep -c '=' "${SVC_DIR}/.env.generated" 2>/dev/null || echo 0)"
    log "配置已下发 ${SVC_DIR}/.env.generated（${KEYS} 个键，0600）"
    ;;
  204)
    log "该「环境 × 服务」在配置中心无下发项，保留现状"
    ;;
  000)
    die "拉取失败：控制台不可达或超时（${CONSOLE_API}）"
    ;;
  401)
    die "拉取被拒绝（401）：CONSOLE_TOKEN 与控制台 INTERNAL_API_KEY 不一致 —— 检查控制台 .env 与流水线变量注入"
    ;;
  *)
    die "拉取失败：HTTP ${CODE}"
    ;;
esac
