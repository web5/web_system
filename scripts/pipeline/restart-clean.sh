#!/usr/bin/env bash
# ============================================================
# restart-clean —— 后端服务「干净重启」唯一实现
# 供 deploy_tool_catalog 的 shell 工具引用（编排侧只传参数，不写正文）
#
# 为什么必须 delete + start（不是 pm2 restart / --update-env）：
#   pm2 in-place restart 的进程环境 = 上次存下的 pm2_env（merge 语义）；
#   @nestjs/config 只补不覆盖已存在的键（config.module.js:188
#   `filter(key => !(key in process.env))`）
#   → 结果：新增键生效，**改已有键的值永久失效**。
#   只有 `pm2 delete` + `env -i` 能把进程环境清零，让 .env 成为唯一配置源。
#
# 松耦合约定：**脚本不认识任何具体服务**。
#   所有业务知识由调用方注入（工具目录参数 / 模块配置）：
#     REQUIRED_ENV   必需配置键（逗号分隔）；缺省读 <服务目录>/env.required
#     EXTRA_ENV      额外注入进程环境的变量（空格分隔 K=V，如 gateway 静态根）
#     CROSS_CHECK    跨服务一致性检查（格式见下）
# ============================================================
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"

log()  { echo "[restart-clean] $*"; }
die()  { echo "[restart-clean][FATAL] $*" >&2; exit 1; }
rdie() { echo "[restart-clean][FATAL] $*" >&2; rollback_and_restart; exit 1; }

# ── 参数（全部由调用方注入；脚本内零服务名、零端口、零路径硬编码）──
: "${MODULE_KEY:?MODULE_KEY 未设置}"
: "${PORT:?PORT 未设置}"

# 服务目录：两种布局都支持（远端「发布根即服务目录」/ 本地「发布根/servers/<dir>」）
if [ -n "${SVC_DIR:-}" ]; then
  : "${SVC_DIR:?}"                                   # 显式给定，优先
elif [ -n "${RELEASE_DIR:-}" ]; then
  SVC_DIR="${RELEASE_DIR}/servers/${MODULE_DIR:-${MODULE_KEY}}"
else
  die "SVC_DIR 或 RELEASE_DIR 二者必给其一"
fi

ENV_FILE="${SVC_DIR}/.env"
PM2="${PM2_BIN:-$(command -v pm2 || echo "${RELEASE_DIR:-$SVC_DIR}/node_modules/.bin/pm2")}"
STAMP="$(date +%Y%m%d-%H%M%S)"
HEALTH_PATH="${HEALTH_PATH:-/health}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
KEEP_BAK="${KEEP_BAK:-3}"
PM2_ALLOW_NEW="${PM2_ALLOW_NEW:-0}"
ROLLBACK="${ROLLBACK:-1}"          # 失败时回滚 dist（仅 VER_DIR 模式下有效）
VER_DIR="${VER_DIR:-}"             # 版本目录；给了才做「落地 dist」，不给只重启

# 脚本自身指纹（排障第一问：跑的是哪一版）
SELF_SHA="$(sha256sum "$0" 2>/dev/null | cut -c1-12 || echo unknown)"

log "模块 ${MODULE_KEY}｜端口 ${PORT}｜服务目录 ${SVC_DIR}"
log "脚本指纹 sha256:${SELF_SHA}｜DRY_RUN=${DRY_RUN}"

env_get() { # $1=env 文件 $2=键名
  [ -f "$1" ] || return 0
  grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true
}

# ════════════════════════════════════════════════════════════
# ① 前置校验
# ════════════════════════════════════════════════════════════
[ -d "$SVC_DIR" ]        || die "服务目录不存在：${SVC_DIR}"
[ -f "${SVC_DIR}/dist/main.js" ] || die "未找到构建产物：${SVC_DIR}/dist/main.js（build 阶段是否成功）"

# 必需键清单：**服务自己声明**（env.required，构建期生成），平台不掌握业务知识
REQ="${REQUIRED_ENV:-}"
if [ -z "$REQ" ] && [ -f "${SVC_DIR}/env.required" ]; then
  REQ="$(tr '\n' ',' < "${SVC_DIR}/env.required" | sed 's/,$//')"
fi
if [ -n "$REQ" ]; then
  missing=""
  IFS=',' read -r -a KEYS <<< "$REQ"
  for k in "${KEYS[@]}"; do
    k="$(echo "$k" | tr -d ' ')"
    [ -n "$k" ] || continue
    [ -n "$(env_get "$ENV_FILE" "$k")" ] || missing="${missing} ${k}"
  done
  [ -z "$missing" ] || die "${MODULE_KEY}/.env 缺少必需键：${missing}
  修复：在 ${ENV_FILE} 补齐后重试（清单来源：${SVC_DIR}/env.required 或调用方 REQUIRED_ENV）"
  log "必需键校验通过（$((${#KEYS[@]})) 项）"
else
  log "未声明必需键（REQUIRED_ENV 空且无 env.required）→ 跳过键校验"
fi

# 跨服务一致性（可选）：CROSS_CHECK="本服务键@<他服务目录>:他服务键"
# 例：MCP_CLIENT_KEY@/data/web_system/servers/mcp-gateway:MCP_CLIENT_KEY
if [ -n "${CROSS_CHECK:-}" ]; then
  mine_key="${CROSS_CHECK%%@*}"
  rest="${CROSS_CHECK#*@}"
  other_dir="${rest%%:*}"
  other_key="${rest##*:}"
  mine_val="$(env_get "$ENV_FILE" "$mine_key")"
  other_val="$(env_get "${other_dir}/.env" "$other_key")"
  if [ -n "$mine_val" ] && [ -n "$other_val" ] && [ "$mine_val" != "$other_val" ]; then
    die "${MODULE_KEY}.${mine_key} 与 ${other_dir}.${other_key} 不一致 —— 服务间调用会 401"
  fi
  log "跨服务一致性校验通过：${mine_key} ↔ ${other_dir##*/}.${other_key}"
fi

# ════════════════════════════════════════════════════════════
# ② 解析 pm2 进程名（注册表名 ↔ 实际进程名兼容）
# ════════════════════════════════════════════════════════════
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
        print(c); break
'
}

NAME="$(resolve_name)"
if [ -z "$NAME" ]; then
  if [ "$PM2_ALLOW_NEW" = "1" ]; then
    NAME="${PM2_NAME:-web-${MODULE_KEY}}"
    log "pm2 中未找到 → 首次纳管，进程名取 ${NAME}"
  else
    die "pm2 中未找到服务（候选 ${PM2_NAME:-未设置} / web-${MODULE_KEY} / web-${MODULE_KEY%-service}）—— 请先纳管，或置 PM2_ALLOW_NEW=1"
  fi
fi

# 运行目录：**默认服务目录**（2026-11-02 修正）。
# 旧行为是「沿用进程现有 cwd」，看起来稳妥，实际是把污染固化：
# ecosystem.config.js 的全局 cwd 曾把 ai-service 起在 /data/web_system，
# 沿用现状 → 每次重启都继承这个错误身份 → 平台 identity 校验每次都撞。
# 平台侧判据是 pm_cwd == 服务目录，所以这里以服务目录为准；
# 确有例外时由调用方显式传 PM2_CWD 覆盖（保留逃生口）。
#
# 附：ai-service 的 bianbian 用 process.cwd() 拼 temp-images/uploads，
# 已在 prod 上用软链 `servers/ai-service/{temp-images,uploads} -> /data/web_system/...`
# 对齐到服务目录（2026-11-02 止血），因此改用服务目录不会丢存量文件。
CWD="${PM2_CWD:-$SVC_DIR}"
log "运行目录 cwd=${CWD}${PM2_CWD:+ （由 PM2_CWD 显式覆盖）}"

# ════════════════════════════════════════════════════════════
# ③ 版本目录 → dist（可选；给了 VER_DIR 才做，含备份与回滚）
# ════════════════════════════════════════════════════════════
rollback_and_restart() {
  [ "$ROLLBACK" = "1" ] || return 0
  LAST="$(ls -1dt "${SVC_DIR}"/dist.bak-* 2>/dev/null | head -1 || true)"
  [ -n "$LAST" ] || { log "无 dist 备份可回滚"; return 0; }
  log "回滚 dist ← ${LAST##*/}"
  rm -rf "${SVC_DIR}/dist" && mv "$LAST" "${SVC_DIR}/dist"
  if [ -n "$NAME" ]; then
    "$PM2" delete "$NAME" >/dev/null 2>&1 || true
    env -i PATH="$PATH" HOME="${HOME:-/root}" PORT="$PORT" \
      "$PM2" start "${SVC_DIR}/dist/main.js" --name "$NAME" --cwd "$CWD" \
      --max-memory-restart 512M >/dev/null 2>&1 || true
    log "已用回滚后的 dist 重启 ${NAME}"
  fi
}

# DRY_RUN 出口必须在**任何写操作之前**（含 dist 落地）
if [ "$DRY_RUN" = "1" ]; then
  log "[DRY_RUN] 将要执行："
  [ -n "$VER_DIR" ] && log "[DRY_RUN]   1. 落地 dist：${VER_DIR} → ${SVC_DIR}/dist（备份保留 ${KEEP_BAK} 份）"
  log "[DRY_RUN]   2. pm2 delete ${NAME}"
  log "[DRY_RUN]   3. env -i PATH HOME PORT=${PORT} ${EXTRA_ENV:-} pm2 start ${SVC_DIR}/dist/main.js --name ${NAME} --cwd ${CWD} --max-memory-restart 512M"
  log "[DRY_RUN]   4. 探活 http://127.0.0.1:${PORT}${HEALTH_PATH}（超时 ${HEALTH_TIMEOUT}s），失败回滚 dist"
  exit 0
fi

if [ -n "$VER_DIR" ]; then
  [ -d "$VER_DIR" ] || die "版本目录不存在：${VER_DIR}"
  if [ -d "${SVC_DIR}/dist" ]; then
    mv "${SVC_DIR}/dist" "${SVC_DIR}/dist.bak-${STAMP}" || die "备份 dist 失败"
    log "dist → dist.bak-${STAMP}"
  fi
  mkdir -p "${SVC_DIR}/dist" && cp -a "${VER_DIR}/." "${SVC_DIR}/dist/" || rdie "落地 dist 失败"
  ls -1dt "${SVC_DIR}"/dist.bak-* 2>/dev/null | tail -n +$((KEEP_BAK + 1)) | xargs -r rm -rf
  log "已落地 dist ← ${VER_DIR}（保留最近 ${KEEP_BAK} 份备份）"
fi

# ════════════════════════════════════════════════════════════
# ④ 端口孤儿清理（防自杀护栏：pm2 纳管进程一律不杀）
# ════════════════════════════════════════════════════════════
all_pm2_pids="$("$PM2" jlist 2>/dev/null | python3 -c '
import sys, json
try:
    print(" ".join(str(p["pid"]) for p in json.load(sys.stdin) if p.get("pid")))
except Exception:
    pass
' 2>/dev/null || true)"
for occ in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
  case " $all_pm2_pids " in
    *" $occ "*) log "端口 ${PORT} 占用者 ${occ} 是 pm2 纳管进程，跳过（疑似 PORT 配置冲突）" ;;
    *) log "清理端口 ${PORT} 孤儿进程 ${occ}"; kill -9 "$occ" 2>/dev/null || true ;;
  esac
done

# ════════════════════════════════════════════════════════════
# ⑤ 干净重启：delete + env -i（进程环境只留 PATH / HOME / PORT + EXTRA_ENV）
# ════════════════════════════════════════════════════════════
EXTRA_ARGS=()
if [ -n "${EXTRA_ENV:-}" ]; then
  read -r -a EXTRA_ARGS <<< "$EXTRA_ENV"
fi

"$PM2" delete "$NAME" >/dev/null 2>&1 || true
env -i \
  PATH="$PATH" \
  HOME="${HOME:-/root}" \
  PORT="$PORT" \
  ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} \
  "$PM2" start "${SVC_DIR}/dist/main.js" \
  --name "$NAME" \
  --cwd "$CWD" \
  --max-memory-restart 512M \
  || rdie "启动失败：${NAME}（查看 pm2 logs ${NAME}）"

"$PM2" save >/dev/null 2>&1 || true
log "已重建 ${NAME}：进程环境仅 PATH/HOME/PORT${EXTRA_ENV:+ +EXTRA_ENV}，配置源 ${ENV_FILE}"

# ════════════════════════════════════════════════════════════
# ⑥ 健康断言（失败即回滚）
# ════════════════════════════════════════════════════════════
ok=0
for i in $(seq 1 "$HEALTH_TIMEOUT"); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}${HEALTH_PATH}" || echo 000)"
  if [ "$code" = "200" ]; then ok=1; log "探活通过（${i}s）→ HTTP 200 ${HEALTH_PATH}"; break; fi
  sleep 1
done
[ "$ok" = "1" ] || rdie "启动后 ${HEALTH_TIMEOUT}s 内探活未通过：http://127.0.0.1:${PORT}${HEALTH_PATH}"

# ════════════════════════════════════════════════════════════
# ⑦ 收尾自检：pm2_env 业务键残留（应为 0，非 0 说明还在吃历史环境）
# ════════════════════════════════════════════════════════════
residue="$("$PM2" jlist 2>/dev/null | python3 -c '
import sys, json, os
name = os.environ.get("NAME", "")
try:
    env = next(p["pm2_env"] for p in json.load(sys.stdin) if p["name"] == name)
except Exception:
    print("unknown"); raise SystemExit
skip = ("PM2_", "LC_", "NVM_", "XDG_", "SSH_", "NODE_APP")
base = {"PATH","HOME","PWD","OLDPWD","SHELL","USER","LOGNAME","LANG","SHLVL","PORT","NODE_ENV","PWD"}
keys = [k for k in env if k.isupper() and not k.startswith(skip) and k not in base]
print(len(keys))
' NAME="$NAME" 2>/dev/null || echo unknown)"
log "pm2_env 业务键残留：${residue}（0 = 配置全部来自 .env）"
log "完成：${MODULE_KEY}@${COMMIT_ID:-未指定} 进程 ${NAME}"
