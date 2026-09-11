#!/usr/bin/env bash
# ============================================================
# 发布流水线 · restart 阶段（backend）
#
# 为什么单独成脚本：restart 不只是「把进程拉起来」，还要保证服务拿到的
# **依赖配置**是正确的。真实事故（2026-09-11 dev 环境）：
#   ① ai-agent/.env 缺 MCP_GATEWAY_URL → 所有 MCP 能力静默不注册，
#      直到 Playground 报「工具 knowledge_list 未注册」才暴露；
#   ② `pm2 restart --update-env` 把**执行会话**的环境固化进 pm2_env，
#      而 dotenv 不覆盖已存在的 process.env → 各服务的 .env 形同虚设，
#      实际生效的是会话里混入的 .env.production 变量，跨服务密钥不一致
#      （网关 401 / 知识服务 4010），排查成本极高。
#
# 设计原则：**服务自身的 .env 是唯一配置源**。
#   1) 依赖校验：关键依赖缺失 / 跨服务密钥不一致 → fail-fast，阻断发布；
#   2) 干净重启：pm2 delete + start，进程环境只保留 PATH / HOME / PORT，
#      配置全部由服务 .env 提供（不留历史污染残留）。
#
# 平台下发变量：RELEASE_DIR / MODULE_KEY / MODULE_DIR / MODULE_TYPE /
#              PM2_NAME / PORT / COMMIT_ID / BRANCH
# 本地调试：DRY_RUN=1 只打印计划，不改动进程
# ============================================================
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"

log() { echo "[pipeline:restart] $*"; }
die() { echo "[pipeline:restart] $*" >&2; exit 1; }

case "${MODULE_TYPE:-}" in
  backend) ;;
  *) log "MODULE_TYPE=${MODULE_TYPE:-未设置} 非后端模块，跳过"; exit 0 ;;
esac

: "${RELEASE_DIR:?RELEASE_DIR 未设置}"
: "${MODULE_KEY:?MODULE_KEY 未设置}"

MODULE_DIR_NAME="${MODULE_DIR:-${MODULE_KEY}}"
SVC_DIR="${RELEASE_DIR}/servers/${MODULE_DIR_NAME}"
ENV_FILE="${SVC_DIR}/.env"
PM2="${PM2_BIN:-$(command -v pm2 || echo "${RELEASE_DIR}/node_modules/.bin/pm2")}"

[ -f "${SVC_DIR}/dist/main.js" ] || die "未找到构建产物：${SVC_DIR}/dist/main.js（请确认 build 阶段已成功）"

# 读 .env 中某个键的值（文件不存在或键缺失时返回空）
env_get() { # $1=env 文件路径 $2=键名
  [ -f "$1" ] || return 0
  grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true
}

# ── ① 依赖校验：配置不完整 / 跨服务不一致 ⇒ 不允许上线 ──
check_deps() {
  case "${MODULE_KEY}" in
    ai-agent)
      [ -f "$ENV_FILE" ] || die "ai-agent 缺少 .env（${ENV_FILE}）"
      [ -n "$(env_get "$ENV_FILE" MCP_GATEWAY_URL)" ] || die \
        "ai-agent/.env 缺少 MCP_GATEWAY_URL —— 所有 MCP 能力（knowledge_* 等）都不会注册，运行时报「工具未注册」。
      修复：在 ${ENV_FILE} 增加 MCP_GATEWAY_URL=http://127.0.0.1:6006"
      local agent_key gw_key
      agent_key="$(env_get "$ENV_FILE" MCP_CLIENT_KEY)"
      gw_key="$(env_get "${RELEASE_DIR}/servers/mcp-gateway/.env" MCP_CLIENT_KEY)"
      if [ -n "$agent_key" ] && [ -n "$gw_key" ] && [ "$agent_key" != "$gw_key" ]; then
        die "ai-agent.MCP_CLIENT_KEY 与 mcp-gateway.MCP_CLIENT_KEY 不一致 —— /mcp/tools/call 会返回 401"
      fi
      ;;
    mcp-gateway)
      local gw_token ks_key
      gw_token="$(env_get "$ENV_FILE" KNOWLEDGE_SERVICE_AUTH_CONFIG \
        | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
      ks_key="$(env_get "${RELEASE_DIR}/servers/knowledge-service/.env" INTERNAL_API_KEY)"
      if [ -n "$gw_token" ] && [ -n "$ks_key" ] && [ "$gw_token" != "$ks_key" ]; then
        die "mcp-gateway.KNOWLEDGE_SERVICE_AUTH_CONFIG.token 与 knowledge-service.INTERNAL_API_KEY 不一致 —— knowledge 工具调用会返回 4010"
      fi
      ;;
  esac
  return 0
}

# ── ② 解析 pm2 进程名（注册表名 ↔ 实际进程名兼容）──
resolve_name() {
  MK="$MODULE_KEY" PM2N="${PM2_NAME:-}" "$PM2" jlist 2>/dev/null \
    | MK="$MODULE_KEY" PM2N="${PM2_NAME:-}" python3 -c '
import sys, json, os
mk = os.environ.get("MK", "")
base = mk[:-8] if mk.endswith("-service") else mk
cands = [os.environ.get("PM2N", ""), "web-" + mk, "web-" + base, mk, base]
try:
    procs = {p["name"] for p in json.load(sys.stdin)}
except Exception:
    sys.exit(0)
for c in cands:
    if c and c in procs:
        print(c)
        break
'
}

# ── ③ 端口孤儿清理（防自杀护栏：pm2 纳管进程一律不杀）──
clean_orphan_port() {
  [ -n "${PORT:-}" ] || return 0
  local all_pm2_pids occ
  all_pm2_pids="$("$PM2" jlist 2>/dev/null | python3 -c '
import sys, json
try:
    print(" ".join(str(p["pid"]) for p in json.load(sys.stdin) if p.get("pid")))
except Exception:
    pass
' 2>/dev/null || true)"
  for occ in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    case " $all_pm2_pids " in
      *" $occ "*) log "端口 $PORT 占用者 $occ 为 pm2 纳管进程，跳过清理（疑似 PORT 配置冲突）" ;;
      *) log "清理端口 $PORT 孤儿进程 $occ"; kill -9 "$occ" 2>/dev/null || true ;;
    esac
  done
}

log "模块 ${MODULE_KEY}｜目录 servers/${MODULE_DIR_NAME}｜配置源 ${ENV_FILE}"
check_deps

NAME="$(resolve_name)"
[ -n "$NAME" ] || die "pm2 中未找到服务（候选 ${PM2_NAME:-未设置} / web-${MODULE_KEY} / web-${MODULE_KEY%-service}）—— 请先纳管进程"

if [ "$DRY_RUN" = "1" ]; then
  log "[DRY_RUN] 将清理端口 ${PORT:-未设置} 孤儿进程，并以干净环境重建："
  log "[DRY_RUN] env -i PATH HOME PORT=${PORT:-} pm2 start ${SVC_DIR}/dist/main.js --name ${NAME} --cwd ${SVC_DIR} --max-memory-restart 512M"
  exit 0
fi

clean_orphan_port

# ── ④ 干净重启：delete + start（进程环境只留 PATH / HOME / PORT）──
# 不用 `pm2 restart --update-env`：它只增量更新，历史 pm2_env 中的混杂变量
# （如 .env.production 的 JWT_SECRET / 微信密钥 / MCP_CLIENT_KEY）会残留，
# 而 dotenv 不覆盖已存在的 process.env → 服务实际用的是错误来源的配置。
"$PM2" delete "$NAME" >/dev/null 2>&1 || true
env -i \
  PATH="$PATH" \
  HOME="${HOME:-/root}" \
  PORT="${PORT:-}" \
  "$PM2" start "${SVC_DIR}/dist/main.js" \
  --name "$NAME" \
  --cwd "$SVC_DIR" \
  --max-memory-restart 512M \
  || die "启动失败：${NAME}（查看 pm2 logs ${NAME}）"

"$PM2" save >/dev/null 2>&1 || true
log "已重建 ${NAME}：进程环境仅 PATH/HOME/PORT，依赖配置由 ${ENV_FILE} 提供"
