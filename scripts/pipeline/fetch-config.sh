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
# 鉴权：`x-internal-key: $CONSOLE_TOKEN`（平台注入）。脚本鉴权**不依赖被下发的键本身**，故无鸡生蛋。
#   CONSOLE_TOKEN 有两种形态，脚本侧**无需区分**（服务端自行判定，见 common/internal-key.ts）：
#     ① run 短期令牌（以 `rt1_` 开头，2026-10-13 起默认）：本次发布现签，run 结束即撤销；
#     ② 静态 INTERNAL_API_KEY：未启用短期令牌（RUN_TOKEN_ENABLED=false 或缺签名密钥）时的回落。
#   排障提示：401 时先看令牌是不是 rt1_ 开头 —— 是，则多半是「run 已结束/过期」，重跑发布即可。
#
# 平台注入变量：CONSOLE_API / CONSOLE_TOKEN / DEPLOY_ENV（标准名）
#               RELEASE_DIR / MODULE_KEY / MODULE_DIR
#   环境 ID 兼容两个写法，**以 DEPLOY_ENV 为准**：
#     DEPLOY_ENV 是 PROTECTED_STAGE_KEYS（pipeline.service.ts:284）受保护键，不可能被配置中心/模板变量改写；
#     DEPLOY_ENV_ID 不在保护名单（gateway .env 里就有同名键），优先采信它可能被带到别的环境。
#   原实现只认 DEPLOY_ENV_ID，而平台注入的是 DEPLOY_ENV → 恒 skip（exit 0），
#   远端重启型发布的配置下发链路一直是断的（2026-09-25 修）。
# 本地调试：DRY_RUN=1 只打印计划，不写文件
# ============================================================
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
log() { echo "[pipeline:fetch-config] $*"; }
die() { echo "[pipeline:fetch-config] $*" >&2; exit 1; }

MODULE_DIR_NAME="${MODULE_DIR:-${MODULE_KEY:-}}"
: "${MODULE_DIR_NAME:?MODULE_KEY/MODULE_DIR 未设置}"

skip() { log "跳过：$1（沿用现有 .env.generated / .env）"; exit 0; }

DEPLOY_ENV_ID_EFF="${DEPLOY_ENV:-${DEPLOY_ENV_ID:-}}"
[ -n "${CONSOLE_API:-}" ]   || skip "CONSOLE_API 未注入"
[ -n "${CONSOLE_TOKEN:-}" ] || skip "CONSOLE_TOKEN 未注入"
[ -n "${DEPLOY_ENV_ID_EFF}" ] || skip "DEPLOY_ENV_ID / DEPLOY_ENV 均未注入"

RELEASE_DIR_EFF="${RELEASE_DIR:-${RELEASE_WORKSPACE:-}}"
[ -n "${RELEASE_DIR_EFF}" ] || skip "RELEASE_DIR 未设置"
SVC_DIR="${RELEASE_DIR_EFF}/servers/${MODULE_DIR_NAME}"
# 注意：CONSOLE_API 平台注入时**已含 /api 后缀**（pipeline.service.ts:591 → /api），
#   不能再拼一次 /api，否则变成 /api/api/config/... → 404 → fail-fast 让重启型发布直接红。
#   `${CONSOLE_API%/}` 先剥尾部斜杠再拼一（与已上线的 p25 脚本同一写法）。
URL="${CONSOLE_API%/}/config/internal/dispatch/${MODULE_KEY:-${MODULE_DIR_NAME}}?envId=${DEPLOY_ENV_ID_EFF}"

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
    die "拉取被拒绝（401）：CONSOLE_TOKEN 无效 —— 若它以 rt1_ 开头（run 短期令牌），通常是已过期或所属 run 已结束，重跑本次发布即可；否则检查它与控制台 INTERNAL_API_KEY 是否一致"
    ;;
  *)
    die "拉取失败：HTTP ${CODE}"
    ;;
esac
