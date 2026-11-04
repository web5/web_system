#!/usr/bin/env bash
# ============================================================
# 发布流水线 · cleanup 节点（远端历史版本清理）**官方脚本模板**
#
# ⚠️ 本文件是**模板副本**：真正执行的正文在 DB，挂载方式见
# docs/operations/pipeline-boundary-scripts.md。改这里不影响线上流水线。
#
# 取代什么：CleanupExecutor 的 remote 分支（RemoteArtifactCleanupService.cleanup）。
#   该分支是发布路径上**第二处**（也是最后一处）平台 SSH：平台 ssh 到目标机
#   ls 一遍算保留计划再删。S1 之后平台只做诊断/监控类 SSH。
#
# 裁决与执行的分界（重要，别搞反）：
#   「保留哪些版本」= **裁决**，必须由平台算好注入（当前版本 + 启用中的灰度版本，
#   灰度规则在 DB，脚本不该也不能去读）；脚本只负责「按名单删」。
#   名单为空 ⇒ 视为全保护，一个都不删（宁可漏删，不可误删正在跑的版本）。
#
# 平台注入变量：
#   MODULE_KEY / KEEP_VERSIONS（保留份数，平台算，默认 5）
#   PROTECTED_VERSIONS        受保护版本，空格分隔（**必填语义**：空 = 全保护）
#   REMOTE_SSH_TARGET         user@host
#   REMOTE_MODULES_ROOT       远端静态产物根（平台三级取值链算出）
#   SSH_KEY_PATH              私钥路径（空 = 未检测到，走本机 ssh 默认行为）
#
# 需要按流水线声明的一个变量（legacy 布局）：
#   REMOTE_VERSIONS_DIR       版本目录层（可用 ${REMOTE_MODULES_ROOT}/${MODULE_KEY} 组合）
#   —— 为什么不让脚本自己拼：远端布局有两种，投递落点是 <根>/<模块>/<版本>，
#      而 env-dir 布局多一层 <环境>（<根>/<模块>/<envId>/<版本>）。猜错一层 =
#      要么一个都扫不到，要么扫到别人的目录。默认取投递布局，不匹配请显式声明。
#
# Phase 2 CDN 布局（平台只在 `CDN_LAYOUT_MODE=cdn` 时注入下面四件套）：
#   REMOTE_CDN_ROOT           入口机 CDN 根（判据：非空即 CDN 模式）
#   REMOTE_CDN_SSH_TARGET     入口机 user@host（**只打入口机，不回落应用机**）
#   REMOTE_CDN_VERSIONS_DIR   版本目录层 <root>/<env>/<app>（平台算好，脚本不拼顺序）
#   （REMOTE_CDN_DEST 是 upload 用的本次落点，cleanup 不用）
#   —— CDN 模式 BASE 直接取 REMOTE_CDN_VERSIONS_DIR，**空即 fail-fast**，
#      绝不自己拼 `<root>/<env>/<app>`（env/app 顺序只写在平台一处）。
#
# 默认**只观测**：REMOTE_CLEANUP_APPLY=1 才真删。
# ============================================================
set -euo pipefail

log() { echo "[pipeline:cleanup] $*"; }
die() { echo "[pipeline:cleanup] $*" >&2; exit 1; }

# ── 布局：CDN（Phase 2）/ legacy（沿用旧行为）──────────────────────────────
# 判据 = 平台是否下发了 REMOTE_CDN_ROOT（与 upload-remote.sh 同源）。
# 平台只在 CDN_LAYOUT_MODE=cdn 时注入 CDN 四件套，所以**不设开关时本脚本行为与改造前一致**。
CDN_ROOT_VAR="${REMOTE_CDN_ROOT:-}"
if [ -n "${CDN_ROOT_VAR}" ]; then
  CDN_MODE=1
  : "${MODULE_KEY:?MODULE_KEY 未设置}"
  TARGET="${REMOTE_CDN_SSH_TARGET:-${REMOTE_SSH_TARGET:-}}"
  BASE="${REMOTE_CDN_VERSIONS_DIR:-}"
  : "${TARGET:?CDN 布局需 REMOTE_CDN_SSH_TARGET（入口机）；为空说明未配 CDN_SSH_TARGET_<ENV>}"
  : "${BASE:?CDN 布局需 REMOTE_CDN_VERSIONS_DIR（平台算出的 <root>/<env>/<app>）；为空说明版本目录层未解析，禁止清理}"
else
  CDN_MODE=0
  : "${MODULE_KEY:?MODULE_KEY 未设置}"
  : "${REMOTE_SSH_TARGET:?REMOTE_SSH_TARGET 未设置（环境未登记目标机：基础设施 → 主机管理）}"
  : "${REMOTE_MODULES_ROOT:?REMOTE_MODULES_ROOT 未设置（平台未算出静态根）}"
  TARGET="${REMOTE_SSH_TARGET}"
  BASE="${REMOTE_VERSIONS_DIR:-${REMOTE_MODULES_ROOT}/${MODULE_KEY}}"
fi

KEEP="${KEEP_VERSIONS:-5}"
APPLY="${REMOTE_CLEANUP_APPLY:-0}"
SSH_KEY="${SSH_KEY_PATH:-}"

SSH_OPTS="-o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
[ -n "${SSH_KEY}" ] && SSH_OPTS="${SSH_OPTS} -i ${SSH_KEY}"

# 保护名单为空 = 一个都不许删
if [ -z "${PROTECTED_VERSIONS:-}" ]; then
  log "未注入 PROTECTED_VERSIONS —— 视为全保护，跳过清理"
  exit 0
fi

if [ -z "${SSH_KEY}" ]; then
  log "[warn] SSH_KEY_PATH 未注入 —— 按本机 ssh 默认行为连接"
else
  [ -f "${SSH_KEY}" ] || die "SSH 私钥不存在：${SSH_KEY}"
fi

if [ -z "${REMOTE_VERSIONS_DIR:-}" ]; then
  log "[warn] 未声明 REMOTE_VERSIONS_DIR，按投递布局取 ${BASE}（env-dir 布局请显式声明）"
fi

# ── ① 扫描：只列一级目录，且只认形如版本号的目录名（防误伤同级其它目录）──
VERSIONS="$(ssh -o ConnectTimeout=15 ${SSH_OPTS} "${TARGET}" \
  "cd '${BASE}' 2>/dev/null && ls -1 | grep -E '^[0-9a-f]{7,40}$|^v?[0-9]+\.[0-9]+\.[0-9]+.*$' | sort || true")"

if [ -z "${VERSIONS}" ]; then
  log "远端无版本目录：${TARGET}:${BASE}"
  exit 0
fi

# ── ② 排计划：受保护的跳过；其余按 mtime 倒序保留最近 KEEP 份 ──
PROTECTED=" ${PROTECTED_VERSIONS} "
ORDERED="$(ssh -o ConnectTimeout=15 ${SSH_OPTS} "${TARGET}" "cd '${BASE}' && ls -1t" 2>/dev/null || true)"
TOTAL=0
KEEPING=""
REMOVING=""
for v in ${VERSIONS}; do
  TOTAL=$((TOTAL + 1))
  case "${PROTECTED}" in
    *" ${v} "*) continue ;;   # 受保护：不进候选
  esac
  if [ "$(echo "${KEEPING}" | wc -w)" -lt "${KEEP}" ] && echo "${ORDERED}" | grep -qx "${v}"; then
    KEEPING="${KEEPING} ${v}"
  else
    REMOVING="${REMOVING} ${v}"
  fi
done

log "扫描 ${TOTAL} 个版本｜保留 ${KEEPING:-无}｜待清理 ${REMOVING:-无}"

if [ -z "${REMOVING}" ]; then
  log "无需清理"
  exit 0
fi

if [ "${APPLY}" != "1" ]; then
  log "[只读观测] REMOTE_CLEANUP_APPLY=1 才会真正删除（运维确认后开启）"
  exit 0
fi

# ── ③ 执行 ──────────────────────────────────────────────────────────────
if [ "$CDN_MODE" = "1" ]; then
  # CDN 布局：单次连接完成「cd → realpath 归属断言 → 逐个删」。
  # realpath 断言防的是「BASE 被 symlink 改写 / 顺序改错却恰好同名」这类能通过
  # 版本名正则的误删（与平台内置 cleanup 执行体同一道闸）。
  ssh -o ConnectTimeout=15 ${SSH_OPTS} "${TARGET}" \
    "cd '${BASE}' || exit 1; real=\$(pwd -P) || exit 1; if [ \"\$real\" != '${BASE}' ]; then echo \"REFUSE: \$real\"; exit 9; fi; for v in ${REMOVING}; do if [ -d \"\$v\" ] && [ \"\$v\" != dist ] && [ \"\$v\" != '.' ]; then rm -rf -- \"\$v\"; fi; done" \
    || die "CDN 清理失败：${TARGET}:${BASE}（REFUSE 表示 realpath 与期望目录不一致，已拒绝删除）"
  log "已删除 ${REMOVING}"
else
  # legacy：逐个删，失败即断（不做「继续删别的」，避免半清状态难以对账）
  for v in ${REMOVING}; do
    ssh -o ConnectTimeout=15 ${SSH_OPTS} "${TARGET}" "rm -rf '${BASE}/${v}'" \
      || die "删除失败：${TARGET}:${BASE}/${v}"
    log "已删除 ${v}"
  done
fi

log "清理完成：${REMOVING}（保护名单：${PROTECTED_VERSIONS}）"
