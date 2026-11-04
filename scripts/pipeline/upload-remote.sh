#!/usr/bin/env bash
# ============================================================
# 发布流水线 · upload 节点（远端投递）**官方脚本模板**
#
# ⚠️ 本文件是**模板副本**：真正执行的正文在 DB（deploy_pipeline_actions /
# deploy_pipeline_step_command），挂载方式见 docs/operations/pipeline-boundary-scripts.md。
# 改这里**不会**影响线上流水线；改流水线行为请改 DB 里的那份（页面可编辑）。
# 本文件的作用：可评审、可体检（pipeline-lint）、可复制到新流水线。
#
# 取代什么：UploadExecutor 的 remote 分支（RemoteDeliveryService.uploadDist）。
#   平台**不再在发布路径上 spawn scp/ssh**，改由本脚本完成；
#   平台只剩「算好落点 + 注入变量 + 读回执」，即「执行下放、裁决保留」。
#
# 为什么值得下放：
#   ① 落点规则 / 产物校验 / 重试这些细节，改一次就要发一次 console；
#      脚本改完下次发布即生效（DB 文本，页面可编辑）；
#   ② 平台进程长期持有目标机私钥 = 发布系统自带「任意命令执行」面；
#      脚本化后私钥只在脚本进程生命周期内被用到。
#
# 平台注入变量（均为保护键，不可被配置中心/流水线变量覆盖）：
#   MODULE_KEY / COMMIT_ID / BUILD_OUTPUT_DIR        产物的源目录
#   REMOTE_SSH_TARGET      user@host（平台按环境解析后下发）
#   REMOTE_DEST_DIR        最终落点 = <根>/<模块>/<版本>（**由平台算，脚本不算**）
#   SSH_KEY_PATH           私钥**路径**（不是私钥内容）；为空 = 未检测到可用私钥
#
# ⚠️ 落点为什么必须由平台给：远端静态根是三级取值链（REMOTE_MODULES_ROOT_<ENV>
#   → STATIC_PUBLIC_ROOT_<ENV>/static/modules → 旧常量），prod 与 dev 完全不同。
#   脚本自己拼 = 「投递成功但页面 404」，且日志完全看不出来（诊断 #3）。
#
# 本地调试：DRY_RUN=1 只打印计划，不改远端。
# ============================================================
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"

log() { echo "[pipeline:upload] $*"; }
die() { echo "[pipeline:upload] $*" >&2; exit 1; }

: "${MODULE_KEY:?MODULE_KEY 未设置}"
: "${COMMIT_ID:?COMMIT_ID 未设置}"
: "${BUILD_OUTPUT_DIR:?BUILD_OUTPUT_DIR 未设置}"

# ── 布局：CDN（Phase 2）/ legacy（沿用旧行为）──────────────────────────────
# 判据 = 平台是否下发了 REMOTE_CDN_ROOT（**不能拿 REMOTE_CDN_DEST 判**：版本为空时
# 平台会把 DEST 置空，此时若按 DEST 判会静默退回 legacy 布局，投到旧路径还报成功）。
# 平台只在 CDN_LAYOUT_MODE=cdn 时注入这三个键，所以**不设开关时本脚本行为与改造前一致**。
CDN_ROOT_VAR="${REMOTE_CDN_ROOT:-}"
if [ -n "${CDN_ROOT_VAR}" ]; then
  CDN_MODE=1
  TARGET="${REMOTE_CDN_SSH_TARGET:-${REMOTE_SSH_TARGET:-}}"
  DEST="${REMOTE_CDN_DEST:-}"
  : "${TARGET:?CDN 布局需 REMOTE_CDN_SSH_TARGET（入口机）；为空说明未配 CDN_SSH_TARGET_<ENV>}"
  : "${DEST:?CDN 布局需 REMOTE_CDN_DEST（平台算出的 <root>/<env>/<app>/<commit>）；为空说明版本号未解析，禁止投递}"
else
  CDN_MODE=0
  : "${REMOTE_SSH_TARGET:?REMOTE_SSH_TARGET 未设置（环境未登记目标机：基础设施 → 主机管理）}"
  : "${REMOTE_DEST_DIR:?REMOTE_DEST_DIR 未设置（平台未算出落点，通常是静态根未配）}"
  TARGET="${REMOTE_SSH_TARGET}"
  DEST="${REMOTE_DEST_DIR}"
fi

SRC_DIR="${BUILD_OUTPUT_DIR}"
SSH_KEY="${SSH_KEY_PATH:-}"
TAR="/tmp/${MODULE_KEY}-${COMMIT_ID}.tar.gz"

# BatchMode=yes：私钥不可用/需交互时立刻失败，而不是卡在密码输入上等超时
SSH_OPTS="-o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
[ -n "${SSH_KEY}" ] && SSH_OPTS="${SSH_OPTS} -i ${SSH_KEY}"

# ── ① 源产物校验：空 dist 投递过去就是「发布成功但页面 404」──
[ -d "${SRC_DIR}" ] || die "未找到构建产物目录：${SRC_DIR}（请确认 build 阶段已成功）"
FILE_COUNT="$(find "${SRC_DIR}" -type f | wc -l | tr -d ' ')"
# CDN 布局的文件数要排除清单自身（远端清单由 sha256sum 生成，不含 `_manifest.sha256`）
CDN_FILE_COUNT="$(find "${SRC_DIR}" -type f ! -name _manifest.sha256 | wc -l | tr -d ' ')"
[ "${FILE_COUNT}" -gt 0 ] || die "产物目录为空：${SRC_DIR}（build 产出 0 个文件，禁止投递）"
[ -f "${SRC_DIR}/index.html" ] || log "[warn] 产物缺少 index.html（${SRC_DIR}）—— 非静态入口模块可忽略"

# ── ② 私钥可用性：缺失要当场说清去哪补，而不是让 scp 报个 Permission denied ──
if [ -z "${SSH_KEY}" ]; then
  log "[warn] SSH_KEY_PATH 未注入 —— 按本机 ssh 默认行为连接（agent / ~/.ssh/config）"
else
  [ -f "${SSH_KEY}" ] || die "SSH 私钥不存在：${SSH_KEY} —— 请把私钥放到控制台所在机，或改「主机管理」的 sshKeyPath"
fi

log "模块 ${MODULE_KEY}｜源 ${SRC_DIR}（${FILE_COUNT} 个文件）→ ${TARGET}:${DEST}（layout=$([ "$CDN_MODE" = 1 ] && echo cdn || echo legacy)）"

if [ "$DRY_RUN" = "1" ]; then
  log "[DRY_RUN] tar czf ${TAR} -C ${SRC_DIR} ."
  log "[DRY_RUN] scp ${TAR} ${TARGET}:/tmp/"
  if [ "$CDN_MODE" = "1" ]; then
    log "[DRY_RUN] ssh ${TARGET} 判重（目录已存在即失败）→ 解包到 ${DEST} → 生成 _manifest.sha256"
  else
    log "[DRY_RUN] ssh ${TARGET} 解包到 ${DEST} 并对账文件数"
  fi
  exit 0
fi

# ── ③ 打包（先删同名残留，避免上一次的半成品被一起打包）──
rm -f "${TAR}"
if [ "$CDN_MODE" = "1" ]; then
  tar czf "${TAR}" --exclude='_manifest.sha256' -C "${SRC_DIR}" .
else
  tar czf "${TAR}" -C "${SRC_DIR}" .
fi

# ── ④ 投递：scp 上传 → ssh 解包。两步都要有超时，卡死比失败更难排查 ──
scp -o ConnectTimeout=15 ${SSH_OPTS} "${TAR}" "${TARGET}:/tmp/" \
  || die "上传失败：scp ${TAR} → ${TARGET}:/tmp/（检查网络/磁盘/私钥权限 600）"

if [ "$CDN_MODE" = "1" ]; then
  # CDN 布局：目录不可变。**已存在即失败**（同一 commit 的产物内容不可能变，覆盖只会掩盖问题），
  # 且**绝不 `rm -rf` 已存在目录** —— 旧版本目录全程保留，切 DB 指针才是最后一步。
  ssh -o ConnectTimeout=15 ${SSH_OPTS} "${TARGET}" \
    "set -e; if [ -e '${DEST}' ]; then echo 'ERR:EXISTS'; exit 3; fi; mkdir -p '${DEST}'; cd '${DEST}'; tar xzf '/tmp/$(basename "${TAR}")'; rm -f '/tmp/$(basename "${TAR}")'; find . -type f ! -name _manifest.sha256 -print0 | sort -z | xargs -0 -r sha256sum > _manifest.sha256" \
    || die "CDN 投递失败：${TARGET}:${DEST}（若为 ERR:EXISTS 说明该 commit 目录已存在，拒绝覆盖）"
else
  ssh -o ConnectTimeout=15 ${SSH_OPTS} "${TARGET}" \
    "set -e; mkdir -p '${DEST}'; cd '${DEST}'; find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar xzf '/tmp/$(basename "${TAR}")'; rm -f '/tmp/$(basename "${TAR}")'" \
    || die "远端解包失败：${TARGET}:${DEST}"
fi

rm -f "${TAR}"

# ── ⑤ 回执：远端文件数回读，与本地对齐（投递成功的判据不能只看退出码）──
if [ "$CDN_MODE" = "1" ]; then
  # CDN 布局：以**清单行数**对账（清单由远端 sha256sum 生成，行数 = 实际文件数），
  # 同时要求清单自身存在 —— 否则 verify 阶段必 404，那时代码已经把指针切了。
  REMOTE_MANIFEST_COUNT="$(ssh -o ConnectTimeout=15 ${SSH_OPTS} "${TARGET}" "test -f '${DEST}/_manifest.sha256' && wc -l < '${DEST}/_manifest.sha256' || echo 0" | tr -d ' ')"
  [ "${REMOTE_MANIFEST_COUNT}" = "${CDN_FILE_COUNT}" ] \
    || die "CDN 投递对账失败：本地 ${CDN_FILE_COUNT} 个文件，远端清单 ${REMOTE_MANIFEST_COUNT} 行（${TARGET}:${DEST}）"
  log "投递完成：${TARGET}:${DEST}（清单 ${REMOTE_MANIFEST_COUNT} 个文件，与本地一致）"
else
  REMOTE_COUNT="$(ssh -o ConnectTimeout=15 ${SSH_OPTS} "${TARGET}" "find '${DEST}' -type f | wc -l" | tr -d ' ')"
  [ "${REMOTE_COUNT}" = "${FILE_COUNT}" ] \
    || die "投递对账失败：本地 ${FILE_COUNT} 个文件，远端 ${REMOTE_COUNT} 个（${TARGET}:${DEST}）"
  log "投递完成：${TARGET}:${DEST}（${REMOTE_COUNT} 个文件，与本地一致）"
fi
