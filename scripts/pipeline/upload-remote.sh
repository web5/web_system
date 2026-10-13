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
: "${REMOTE_SSH_TARGET:?REMOTE_SSH_TARGET 未设置（环境未登记目标机：基础设施 → 主机管理）}"
: "${REMOTE_DEST_DIR:?REMOTE_DEST_DIR 未设置（平台未算出落点，通常是静态根未配）}"

SRC_DIR="${BUILD_OUTPUT_DIR}"
TARGET="${REMOTE_SSH_TARGET}"
DEST="${REMOTE_DEST_DIR}"
SSH_KEY="${SSH_KEY_PATH:-}"
TAR="/tmp/${MODULE_KEY}-${COMMIT_ID}.tar.gz"

# BatchMode=yes：私钥不可用/需交互时立刻失败，而不是卡在密码输入上等超时
SSH_OPTS="-o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
[ -n "${SSH_KEY}" ] && SSH_OPTS="${SSH_OPTS} -i ${SSH_KEY}"

# ── ① 源产物校验：空 dist 投递过去就是「发布成功但页面 404」──
[ -d "${SRC_DIR}" ] || die "未找到构建产物目录：${SRC_DIR}（请确认 build 阶段已成功）"
FILE_COUNT="$(find "${SRC_DIR}" -type f | wc -l | tr -d ' ')"
[ "${FILE_COUNT}" -gt 0 ] || die "产物目录为空：${SRC_DIR}（build 产出 0 个文件，禁止投递）"
[ -f "${SRC_DIR}/index.html" ] || log "[warn] 产物缺少 index.html（${SRC_DIR}）—— 非静态入口模块可忽略"

# ── ② 私钥可用性：缺失要当场说清去哪补，而不是让 scp 报个 Permission denied ──
if [ -z "${SSH_KEY}" ]; then
  log "[warn] SSH_KEY_PATH 未注入 —— 按本机 ssh 默认行为连接（agent / ~/.ssh/config）"
else
  [ -f "${SSH_KEY}" ] || die "SSH 私钥不存在：${SSH_KEY} —— 请把私钥放到控制台所在机，或改「主机管理」的 sshKeyPath"
fi

log "模块 ${MODULE_KEY}｜源 ${SRC_DIR}（${FILE_COUNT} 个文件）→ ${TARGET}:${DEST}"

if [ "$DRY_RUN" = "1" ]; then
  log "[DRY_RUN] tar czf ${TAR} -C ${SRC_DIR} ."
  log "[DRY_RUN] scp ${TAR} ${TARGET}:/tmp/"
  log "[DRY_RUN] ssh ${TARGET} 解包到 ${DEST} 并对账文件数"
  exit 0
fi

# ── ③ 打包（先删同名残留，避免上一次的半成品被一起打包）──
rm -f "${TAR}"
tar czf "${TAR}" -C "${SRC_DIR}" .

# ── ④ 投递：scp 上传 → ssh 解包。两步都要有超时，卡死比失败更难排查 ──
scp -o ConnectTimeout=15 ${SSH_OPTS} "${TAR}" "${TARGET}:/tmp/" \
  || die "上传失败：scp ${TAR} → ${TARGET}:/tmp/（检查网络/磁盘/私钥权限 600）"

ssh -o ConnectTimeout=15 ${SSH_OPTS} "${TARGET}" \
  "set -e; mkdir -p '${DEST}'; cd '${DEST}'; find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar xzf '/tmp/$(basename "${TAR}")'; rm -f '/tmp/$(basename "${TAR}")'" \
  || die "远端解包失败：${TARGET}:${DEST}"

rm -f "${TAR}"

# ── ⑤ 回执：远端文件数回读，与本地对齐（投递成功的判据不能只看退出码）──
REMOTE_COUNT="$(ssh -o ConnectTimeout=15 ${SSH_OPTS} "${TARGET}" "find '${DEST}' -type f | wc -l" | tr -d ' ')"
[ "${REMOTE_COUNT}" = "${FILE_COUNT}" ] \
  || die "投递对账失败：本地 ${FILE_COUNT} 个文件，远端 ${REMOTE_COUNT} 个（${TARGET}:${DEST}）"

log "投递完成：${TARGET}:${DEST}（${REMOTE_COUNT} 个文件，与本地一致）"
