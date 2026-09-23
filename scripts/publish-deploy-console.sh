#!/usr/bin/env bash
# ============================================================
# publish-deploy-console.sh — deploy-console 自身「本地研发发布」一键脚本
#
# 定位：deploy-console 是发布工具自身，不能走流水线（restart 会自杀式中断），
#       只能传统发布。本脚本把「工作区构建 → 复制到运行位置 → 重启 → 复检」
#       固化成一条命令，并把历史踩过的坑全部内建。
#
# 默认流程（本地研发改动）：
#   1. 打印源信息（工作区分支 / 未提交数）
#   2. 在**工作区**构建：后端 nest build + 前端 vite build
#   3. dist 复制到发布目录（发布目录只承担运行位置，不再是构建源）
#   4. 重启：干净 env + 孤儿进程铁律（6200 归属一致性）
#   5. pm2 save
#   6. 复检：/console/ 200 + /api/apps 存活 + 崩溃循环检测
#
# 用法：
#   ./scripts/publish-deploy-console.sh                  # 工作区构建 → 复制 → 重启 → 复检（本机）
#   ./scripts/publish-deploy-console.sh --env dev        # 工作区构建 → 打包 → 远端备份换 dist → 远端重启 → 探活
#   ./scripts/publish-deploy-console.sh --env dev --skip-build   # 已构建过：只走远端投递
#   ./scripts/publish-deploy-console.sh --skip-build     # 已构建过：只复制 + 重启
#   ./scripts/publish-deploy-console.sh --skip-health    # 跳过复检
#   ./scripts/publish-deploy-console.sh --from-release   # 旧路径：在发布目录同步分支并构建
#   ./scripts/publish-deploy-console.sh --from-release --branch master
#
# 环境变量：
#   RELEASE_DIR  发布目录（运行位置，默认 ~/web_system_release；仅 --env local 用）
#   DRY_RUN=1    只打印不执行
#
# --env dev|prod（远端）说明：
#   控制台是发布工具自身，不能走流水线，远端升级只能传统发布。本脚本把
#   「本机构建 → 打包 dist → scp → 远端备份 → 替换 → 重启 → 探活 → 失败自动回滚」
#   固化成一条命令；并内建 2026-09-23 实测踩到的两个**远端前置条件**：
#     ① 远端 servers/deploy-console/.env 必须有 JWT_SECRET（IAM 一期后无默认兜底，
#        缺失 → 启动即抛 → pm2 崩溃循环（restarts 达 880））；
#     ② 远端控制台库 deploy_pipelines 的 (module_key, name) 必须唯一
#        （新唯一索引 uq_tpl_module_name）；历史空名行会让 TypeORM synchronize 失败，
#        新进程起不来 —— 本脚本检测到即**先中止**并打印修法，不动线上。
#
#   目标机来源：scripts/.env.deploy 的 <ENV>_SERVER / _USER / _REMOTE_DIR / _PUBLIC_URL
#   （_KEY 可选，仅部分环境配了）；远端 pm2 名按候选链 web-deploy-console → deploy-console 解析。
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${RELEASE_DIR:-$HOME/web_system_release}"
PM2_BIN="$(command -v pm2 || echo "$(dirname "$(command -v node)")/pm2")"
DRY_RUN="${DRY_RUN:-0}"

SKIP_BUILD=0
SKIP_HEALTH=0
FROM_RELEASE=0
BRANCH_OPT=""
ENV_OPT="local"
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build)  SKIP_BUILD=1; shift ;;
    --skip-health) SKIP_HEALTH=1; shift ;;
    --from-release) FROM_RELEASE=1; shift ;;
    --env)         ENV_OPT="${2:-}"; [ -n "$ENV_OPT" ] || { echo "--env 缺少环境（local/dev/prod）" >&2; exit 2; }; shift 2 ;;
    --branch)      BRANCH_OPT="${2:-}"; [ -n "$BRANCH_OPT" ] || { echo "--branch 缺少分支名" >&2; exit 2; }; shift 2 ;;
    *) echo "未知参数: ${1}（支持 --env <local|dev|prod> / --skip-build / --skip-health / --from-release / --branch <b>）" >&2; exit 2 ;;
  esac
done
case "$ENV_OPT" in local|dev|prod) : ;; *) echo "不支持的 --env: ${ENV_OPT}（支持 local/dev/prod）" >&2; exit 2 ;; esac
FROM_RELEASE_ALLOWED="1"; [ "$ENV_OPT" = "local" ] || FROM_RELEASE_ALLOWED="0"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step() { echo -e "${GREEN}[deploy-console]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy-console][WARN]${NC} $1"; }
err()  { echo -e "${RED}[deploy-console][ERROR]${NC} $1"; exit 1; }
dry()  { if [ "$DRY_RUN" = "1" ]; then echo -e "${YELLOW}[dry-run]${NC} $1"; return 0; fi; return 1; }

WS_BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo '?')"
WS_DIRTY="$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
WS_HEAD="$(git -C "$ROOT" log --oneline -1 2>/dev/null | cut -d' ' -f1)"

# ---------- 0. 前置检查 ----------
[ -d "$RELEASE_DIR/servers/deploy-console" ] || err "发布目录不存在: $RELEASE_DIR"
[ -d "$RELEASE_DIR/apps/deploy-console" ] || err "缺少前端目录: $RELEASE_DIR/apps/deploy-console"

if [ "$FROM_RELEASE" = "1" ]; then
  BRANCH="${BRANCH_OPT:-$(git -C "$RELEASE_DIR" branch --show-current 2>/dev/null || echo master)}"
  step "源 = 发布目录 ${RELEASE_DIR}（分支 ${BRANCH}）"
else
  step "源 = 工作区 ${ROOT}（分支 ${WS_BRANCH} @ ${WS_HEAD}，未提交 ${WS_DIRTY} 项）"
  step "运行位置 = ${RELEASE_DIR}"
  [ "$WS_DIRTY" = "0" ] || warn "工作区有 ${WS_DIRTY} 项未提交改动：产物来自工作区代码，未提交的改动也会进产物"
fi

# ---------- 0b. 远端（--env dev|prod）：目标机解析 + 前置条件 ----------
R_SERVER=""; R_USER=""; R_DIR=""; R_URL=""; R_KEY=""; R_KEY_OPT=""; R_PM2=""
rssh() { ssh $R_KEY_OPT -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$R_USER@$R_SERVER" "$@"; }
rscp() { scp -q $R_KEY_OPT -o BatchMode=yes -o ConnectTimeout=10 "$@"; }

if [ "$ENV_OPT" != "local" ]; then
  [ "$FROM_RELEASE" != "1" ] || err "--env ${ENV_OPT} 不支持 --from-release（远端发布一律在工作区构建后投递产物）"
  ENV_FILE="$ROOT/scripts/.env.deploy"
  [ -f "$ENV_FILE" ] || err "缺少 ${ENV_FILE}（远端地址来源）"
  set -a; . "$ENV_FILE"; set +a
  ENV_UC="$(echo "$ENV_OPT" | tr '[:lower:]' '[:upper:]')"
  eval "R_SERVER=\"\${${ENV_UC}_SERVER:-}\""
  eval "R_USER=\"\${${ENV_UC}_USER:-}\""
  eval "R_DIR=\"\${${ENV_UC}_REMOTE_DIR:-}\""
  eval "R_URL=\"\${${ENV_UC}_PUBLIC_URL:-}\""
  eval "R_KEY=\"\${${ENV_UC}_KEY:-}\""
  [ -n "$R_SERVER" ] && [ -n "$R_USER" ] && [ -n "$R_DIR" ] \
    || err "scripts/.env.deploy 缺少 ${ENV_UC}_SERVER / _USER / _REMOTE_DIR"
  [ -z "$R_KEY" ] || [ -f "$R_KEY" ] || err "${ENV_UC}_KEY 指向的密钥文件不存在: $R_KEY"
  [ -z "$R_KEY" ] || R_KEY_OPT="-i $R_KEY"
  step "目标 = ${R_USER}@${R_SERVER}:${R_DIR}（env=${ENV_OPT}${R_URL:+，${R_URL}}）"

  dry "SSH 连通性检查" || rssh "echo ok" >/dev/null 2>&1 || err "SSH 连不上 ${R_USER}@${R_SERVER}（需免密登录；确认 .env.deploy 与密钥）"
  dry "远端目录检查" || rssh "test -f ${R_DIR}/servers/deploy-console/.env -a -d ${R_DIR}/apps/deploy-console" \
    || err "远端缺 ${R_DIR}/servers/deploy-console/.env 或 ${R_DIR}/apps/deploy-console（先完成该环境初始化）"

  # 前置 ①：JWT_SECRET（IAM 一期后无默认兜底；缺失 → 启动即抛 → pm2 崩溃循环，2026-09-23 实测）
  if ! dry "检查远端 JWT_SECRET"; then
    rssh "grep -q '^JWT_SECRET=' ${R_DIR}/servers/deploy-console/.env" || err "远端 ${ENV_OPT} 的 servers/deploy-console/.env 缺 JWT_SECRET：
  控制台升级后会启动即崩（pm2 崩溃循环）。与同机 auth-service 同值补上（不打印值）：
    ssh ${R_USER}@${R_SERVER} 'v=\$(grep -m1 \"^JWT_SECRET=\" ${R_DIR}/servers/auth-service/.env | cut -d= -f2-); printf \"JWT_SECRET=%s\\n\" \"\$v\" >> ${R_DIR}/servers/deploy-console/.env'"
  fi

  # 前置 ②：控制台库模板名唯一（新唯一索引 uq_tpl_module_name(moduleKey,name)；
  #        历史空名行会让 TypeORM synchronize 失败 → 新进程起不来。检测到先中止，不动线上）
  if ! dry "检查远端 deploy_pipelines 模板名唯一性"; then
    DUP="$(rssh 'cd '"${R_DIR}"'/servers/deploy-console && \
      H=$(grep -m1 "^MYSQL_HOST=" .env | cut -d= -f2-); P=$(grep -m1 "^MYSQL_PORT=" .env | cut -d= -f2-); \
      U=$(grep -m1 "^MYSQL_USER=" .env | cut -d= -f2-); W=$(grep -m1 "^MYSQL_PASSWORD=" .env | cut -d= -f2-); D=$(grep -m1 "^MYSQL_DB=" .env | cut -d= -f2-); \
      MYSQL_PWD="$W" mysql -h "$H" -P "${P:-3306}" -u "$U" "$D" -N -e \
      "SELECT CONCAT(module_key,\" | \",IFNULL(name,\"NULL\"),\" | \",COUNT(*)) FROM deploy_pipelines GROUP BY module_key,name HAVING COUNT(*)>1"' 2>/dev/null | tr -d '\r')"
    [ -z "$DUP" ] || err "远端控制台库存在同模块同名模板（新唯一索引会建不上 → 新进程起不来）：
$(printf '%s\n' "$DUP" | sed 's/^/    /')
  修法（先备份该表，再把空名回填为模块内唯一）：
    ssh ${R_USER}@${R_SERVER} 'cd ${R_DIR}/servers/deploy-console && H=\$(grep -m1 \"^MYSQL_HOST=\" .env|cut -d= -f2-) && P=\$(grep -m1 \"^MYSQL_PORT=\" .env|cut -d= -f2-) && U=\$(grep -m1 \"^MYSQL_USER=\" .env|cut -d= -f2-) && W=\$(grep -m1 \"^MYSQL_PASSWORD=\" .env|cut -d= -f2-) && D=\$(grep -m1 \"^MYSQL_DB=\" .env|cut -d= -f2-) && MYSQL_PWD=\$W mysqldump -h \$H -u \$U \$D deploy_pipelines > /tmp/deploy_pipelines.bak.sql && MYSQL_PWD=\$W mysql -h \$H -P \${P:-3306} -u \$U \$D -e \"UPDATE deploy_pipelines p JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY module_key ORDER BY created_at,id) rn FROM deploy_pipelines WHERE name=\x27\x27) t ON t.id=p.id SET p.name=IF(t.rn=1,\x27默认\x27,CONCAT(\x27默认 #\x27,t.rn)) WHERE p.name=\x27\x27;\"'"
  fi

  # 远端 pm2 名（候选链：仓库 ecosystem 用 web-deploy-console，实测 dev 用短名 deploy-console）
  R_PM2="$(rssh "pm2 jlist 2>/dev/null | python3 -c \"import sys,json
ns=[p['name'] for p in json.load(sys.stdin)]
print(next((n for n in ['web-deploy-console','deploy-console'] if n in ns), ''))\"" 2>/dev/null | tr -d '\r\n')"
  [ -n "$R_PM2" ] || err "远端 pm2 里找不到控制台进程（web-deploy-console / deploy-console）"
  step "远端 pm2 进程名 = ${R_PM2}"
fi

# ---------- 1. 构建 ----------
if [ "$SKIP_BUILD" != "1" ]; then
  if [ "$FROM_RELEASE" = "1" ]; then
    # 1A. 旧路径：同步发布目录分支 + 在发布目录构建
    step "同步 release → ${BRANCH} ..."
    if dry "git -C ${RELEASE_DIR} fetch origin ${BRANCH} && git merge --ff-only origin/${BRANCH}"; then
      :
    elif git -C "$RELEASE_DIR" fetch origin "$BRANCH" 2>&1 | tail -2 \
      && git -C "$RELEASE_DIR" merge --ff-only "origin/$BRANCH" 2>&1 | tail -3; then
      :
    else
      err "ff-only 快进失败：发布目录与 origin/${BRANCH} 分叉或有本地改动。
  处理：
    git -C ${RELEASE_DIR} status --porcelain | head    # 看本地改动
    git -C ${RELEASE_DIR} log --oneline -1             # 看当前 HEAD
    git -C ${RELEASE_DIR} checkout -- . && git -C ${RELEASE_DIR} merge --ff-only origin/${BRANCH}
    或加 --skip-build 跳过同步（沿用发布目录现有代码）"
    fi
    NODE_BIN="${RELEASE_DIR}/node_modules/.bin"
    [ -x "$NODE_BIN/nest" ] || err "发布目录缺少 node_modules/.bin/nest，先安装依赖"
    step "构建后端（发布目录 nest build）..."
    dry "(cd ${RELEASE_DIR}/servers/deploy-console && ${NODE_BIN}/nest build)" \
      || { (cd "$RELEASE_DIR/servers/deploy-console" && "$NODE_BIN/nest" build) || err "后端构建失败（旧产物保留）"; }
    step "构建前端（发布目录 vite build）..."
    dry "(cd ${RELEASE_DIR}/apps/deploy-console && ${NODE_BIN}/vite build)" \
      || { (cd "$RELEASE_DIR/apps/deploy-console" && "$NODE_BIN/vite" build >/tmp/dc-fe-build.log 2>&1) || { tail -20 /tmp/dc-fe-build.log; err "前端构建失败"; }; }
  else
    # 1B. 默认：在工作区构建
    step "构建后端（工作区 npm run build）..."
    dry "(cd ${ROOT}/servers/deploy-console && npm run build)" \
      || { (cd "$ROOT/servers/deploy-console" && npm run build >/tmp/dc-be-build.log 2>&1) || { tail -25 /tmp/dc-be-build.log; err "后端构建失败，见上方日志"; }; }
    step "构建前端（工作区 npm run build）..."
    dry "(cd ${ROOT}/apps/deploy-console && npm run build)" \
      || { (cd "$ROOT/apps/deploy-console" && npm run build >/tmp/dc-fe-build.log 2>&1) || { tail -25 /tmp/dc-fe-build.log; err "前端构建失败，见上方日志"; }; }
  fi
else
  step "跳过构建（--skip-build）"
fi

# ---------- 1b. 远端发布（--env dev|prod）：打包 → 投递 → 备份替换 → 重启 → 探活 → 失败回滚 ----------
remote_restarts() {
  rssh "pm2 jlist 2>/dev/null | python3 -c \"
import sys,json
for p in json.load(sys.stdin):
  if p['name']=='${R_PM2}': print(p['pm2_env'].get('restart_time',''))\"" 2>/dev/null | tr -d '\r\n'
}

rollback_remote() {
  local BAK
  BAK="$(rssh 'cat /tmp/dc-last-bak 2>/dev/null' 2>/dev/null | tr -d '\r\n')"
  warn "回滚到发布前的 dist（dist.bak-${BAK:-未知}）..."
  rssh "set -e; cd ${R_DIR}; TS=\$(cat /tmp/dc-last-bak); \
    rm -rf servers/deploy-console/dist apps/deploy-console/dist; \
    mv servers/deploy-console/dist.bak-\${TS} servers/deploy-console/dist; \
    mv apps/deploy-console/dist.bak-\${TS} apps/deploy-console/dist; \
    pm2 restart ${R_PM2} >/dev/null 2>&1; sleep 6; \
    echo \"回滚后 /console/ = \$(curl -s -o /dev/null -w '%{http_code}' -m 6 http://127.0.0.1:6200/console/)\"" \
    || err "回滚失败，请人工介入：ssh ${R_USER}@${R_SERVER}"
}

publish_remote() {
  local TS PACK RES CODE API R1 R2
  TS="$(date +%s)"; PACK="dc-dist-${TS}.tgz"
  [ -f "$ROOT/servers/deploy-console/dist/main.js" ] || err "缺 servers/deploy-console/dist/main.js（先构建，或去掉 --skip-build）"
  [ -f "$ROOT/apps/deploy-console/dist/index.html" ] || err "缺 apps/deploy-console/dist/index.html（先构建，或去掉 --skip-build）"

  step "打包产物（后端 dist + 前端 dist）..."
  # macOS(bsdtar) 默认写入 xattr/AppleDouble，远端 GNU tar 会刷一屏 "Ignoring unknown extended header"；
  # 这里按平台能力关掉（不影响内容）。
  local TAR_OPT=""
  tar --no-xattrs -cf /dev/null /dev/null >/dev/null 2>&1 && TAR_OPT="--no-xattrs"
  dry "tar ${TAR_OPT} czf /tmp/${PACK} -C ${ROOT} servers/deploy-console/dist apps/deploy-console/dist" \
    || COPYFILE_DISABLE=1 tar $TAR_OPT -czf "/tmp/${PACK}" -C "$ROOT" servers/deploy-console/dist apps/deploy-console/dist || err "打包失败"

  step "上传 → ${R_SERVER}:/tmp/${PACK} ..."
  dry "scp /tmp/${PACK} → ${R_USER}@${R_SERVER}:/tmp/" \
    || rscp "/tmp/${PACK}" "${R_USER}@${R_SERVER}:/tmp/" || err "上传失败"

  step "远端备份现有 dist 并替换（备份 dist.bak-${TS}）..."
  dry "远端备份 + 解包 + 清理旧备份（各留最近 2 份）" || rssh "set -e; cd ${R_DIR}; \
    cp -a servers/deploy-console/dist servers/deploy-console/dist.bak-${TS}; \
    cp -a apps/deploy-console/dist apps/deploy-console/dist.bak-${TS}; \
    for d in servers/deploy-console apps/deploy-console; do \
      ls -1dt \$d/dist.bak-* 2>/dev/null | tail -n +3 | xargs -r rm -rf; \
    done; \
    tar xzf /tmp/${PACK} -C ${R_DIR}; \
    echo ${TS} > /tmp/dc-last-bak; \
    rm -f /tmp/${PACK}" || err "远端替换失败（未重启，线上未变）"

  step "远端重启 ${R_PM2} ..."
  dry "pm2 restart ${R_PM2}" || rssh "pm2 restart ${R_PM2} >/dev/null 2>&1; sleep 3" || warn "远端重启调用失败（继续探活判定）"

  if [ "$SKIP_HEALTH" = "1" ]; then
    warn "跳过远端探活（--skip-health）：请自行确认 ${R_PM2} 状态"
    return 0
  fi

  step "远端探活（/console/ 200 且 /api/apps 200|401；最多 100s）..."
  RES="$(rssh 'c=000; for i in $(seq 1 25); do \
      c=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://127.0.0.1:6200/console/ 2>/dev/null || echo 000); \
      [ "$c" = "200" ] && break; sleep 4; done; \
    a=$(curl -s -o /dev/null -w "%{http_code}" -m 6 http://127.0.0.1:6200/api/apps 2>/dev/null || echo 000); echo "$c $a"' 2>/dev/null | tr -d '\r')"
  CODE="${RES%% *}"; API="${RES##* }"
  step "远端 /console/ = ${CODE}，/api/apps = ${API}"

  if [ "$CODE" = "200" ] && { [ "$API" = "200" ] || [ "$API" = "401" ]; }; then
    # 崩溃循环检测：端口在、pm2 online，但进程秒级重启（DI 缺注册 / 配置错误 / 启动即抛）
    R1="$(remote_restarts)"; sleep 5; R2="$(remote_restarts)"
    if [ -n "$R2" ] && [ "$R1" != "$R2" ]; then
      warn "远端进程 5s 内重启 ${R1}→${R2} 次（启动即崩），执行回滚..."
      rollback_remote; return 1
    fi
    step "远端发布成功 ✓（pm2=${R_PM2}，restarts 稳定于 ${R2:-?}，发布前产物保留为 dist.bak-${TS}）"
    if [ -n "$R_URL" ]; then
      step "版本指针（${R_URL%/}）: $(curl -s -m 8 "${R_URL%/}/__manifest__" 2>/dev/null | tr -d '\n' | head -c 220)"
    fi
    return 0
  fi

  warn "远端探活未通过（/console/=${CODE} /api/apps=${API}）"
  rssh "tail -30 ~/.pm2/logs/${R_PM2}-error.log 2>/dev/null | grep -vE '^\s+at ' | tail -12" 2>/dev/null || true
  warn "已知成因：① 缺 JWT_SECRET；② 控制台库模板名重复（uq_tpl_module_name）；③ 其它启动期配置错误"
  rollback_remote
  return 1
}

if [ "$ENV_OPT" != "local" ]; then
  publish_remote || err "远端发布失败（已尝试回滚到发布前版本）"
  step "完成 ✓（env=${ENV_OPT}，源 ${WS_BRANCH} @ ${WS_HEAD}）"
  exit 0
fi

# ---------- 2. 复制 dist 到运行位置 ----------
# 默认路径：工作区 dist → 发布目录（发布目录只是运行位置）
# --from-release 时构建已在发布目录就地完成，无需复制。
if [ "$FROM_RELEASE" != "1" ]; then
  step "复制 dist → 运行位置 ..."
  [ -f "$ROOT/servers/deploy-console/dist/main.js" ] || err "工作区缺 servers/deploy-console/dist/main.js（构建产物不完整）"
  [ -f "$ROOT/apps/deploy-console/dist/index.html" ] || err "工作区缺 apps/deploy-console/dist/index.html（前端产物不完整）"
  if ! dry "cp 后端/前端 dist → ${RELEASE_DIR}"; then
    mkdir -p "$RELEASE_DIR/servers/deploy-console/dist" "$RELEASE_DIR/apps/deploy-console/dist"
    cp -R "$ROOT/servers/deploy-console/dist/." "$RELEASE_DIR/servers/deploy-console/dist/" || err "后端 dist 复制失败"
    cp -R "$ROOT/apps/deploy-console/dist/."    "$RELEASE_DIR/apps/deploy-console/dist/"    || err "前端 dist 复制失败"
  fi
fi
NEW_INDEX="$(grep -oE 'index-[^"]*\.js' "$RELEASE_DIR/apps/deploy-console/dist/index.html" 2>/dev/null | head -1)"
step "产物就位 → 前端入口 ${NEW_INDEX:-（未取到）}"

# ---------- 3. 重启（干净 env + 孤儿进程铁律） ----------
# 铁律：6200 占用者必须 == pm2 当前 pid。console 只 app.listen()、没有优雅退出，
# restart 后旧进程不释放端口 → 新进程 EADDRINUSE 反复崩溃，对外仍是旧孤儿。
# 故用确定性重建：先放掉端口 → delete → start。
CLEAN_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$(dirname "$(command -v node)")"

# 主密钥：只注入**文件路径**，不注入值 —— 值会落到 pm2_env / dump.pm2，并被 `ps e` 读到（违反 K2）。
# 见 specs/config-master-key-distribution/design.md §5.1 / Q7。勿改用 `pm2 startOrRestart --update-env`。
KEY_FILE="${CONFIG_MASTER_KEY_FILE:-/etc/web-system/config-master.key}"
KEY_ENV_OPT=""
if [ -f "$KEY_FILE" ]; then
  KEY_ENV_OPT="CONFIG_MASTER_KEY_FILE=$KEY_FILE"
else
  warn "未找到主密钥文件 ${KEY_FILE}：本次沿用 .env 的 CONFIG_MASTER_KEY（过渡态，建议尽快 provision）"
fi
pm2_pid() { "$PM2_BIN" pid web-deploy-console 2>/dev/null || true; }
pm2_field() {
  "$PM2_BIN" jlist 2>/dev/null | python3 -c "
import json, sys
field = '$1'
try:
    d = [p for p in json.load(sys.stdin) if p['name'] == 'web-deploy-console']
    print(d[0]['pm2_env'].get(field, '') if d else '')
except Exception:
    print('')"
}
listen_pid() { lsof -tiTCP:6200 -sTCP:LISTEN 2>/dev/null | head -1 || true; }
pm2_logs()   { "$PM2_BIN" logs web-deploy-console --lines "${1:-30}" --nostream 2>&1 | tail -"${1:-30}"; }

restart_console() {
  local lp
  for lp in $(lsof -tiTCP:6200 -sTCP:LISTEN 2>/dev/null || true); do
    dry "kill -9 ${lp}（释放 6200）" || kill -9 "$lp" 2>/dev/null || true
  done
  for lp in $(pgrep -f 'deploy-console/dist/main.js' 2>/dev/null || true); do
    [ "$lp" = "$(pm2_pid)" ] && continue
    dry "kill -9 ${lp}（残留 main.js）" || kill -9 "$lp" 2>/dev/null || true
  done
  sleep 1

  dry "(cd ${RELEASE_DIR}/servers/deploy-console && env PATH=${CLEAN_PATH} ${PM2_BIN} delete web-deploy-console)" \
    || (cd "$RELEASE_DIR/servers/deploy-console" && env PATH="$CLEAN_PATH" "$PM2_BIN" delete web-deploy-console >/dev/null 2>&1) || true
  dry "(cd ${RELEASE_DIR}/servers/deploy-console && env PATH=${CLEAN_PATH} ${KEY_ENV_OPT} ${PM2_BIN} start dist/main.js --name web-deploy-console --cwd ${RELEASE_DIR}/servers/deploy-console)" \
    || { (cd "$RELEASE_DIR/servers/deploy-console" && env PATH="$CLEAN_PATH" $KEY_ENV_OPT "$PM2_BIN" start dist/main.js --name web-deploy-console --cwd "$RELEASE_DIR/servers/deploy-console" >/dev/null 2>&1) || err "pm2 start 失败"; }
  sleep 6
}

step "处理 6200 端口一致性（孤儿进程铁律）..."
PRE_PM2="$(pm2_pid)"
for p in $(lsof -tiTCP:6200 -sTCP:LISTEN 2>/dev/null || true); do
  if [ -n "$PRE_PM2" ] && [ "$p" != "$PRE_PM2" ]; then
    step "清理孤儿进程 ${p}（占 6200 且非 pm2 pid ${PRE_PM2}）..."
    dry "kill -9 ${p}" || kill -9 "$p" 2>/dev/null || true
  fi
done

step "干净 env 重启 web-deploy-console ..."
restart_console

LISTEN="$(listen_pid)"; STATUS="$(pm2_field status)"; CUR_PM2="$(pm2_pid)"
if [ "$LISTEN" != "$CUR_PM2" ] || [ "$STATUS" != "online" ]; then
  warn "首次重启后不一致（listen=${LISTEN} pm2=${CUR_PM2} status=${STATUS}），清理残留并重试..."
  for p in $(lsof -tiTCP:6200 -sTCP:LISTEN 2>/dev/null || true); do
    if [ "$p" != "$(pm2_pid)" ]; then dry "kill -9 ${p}" || kill -9 "$p" 2>/dev/null || true; fi
  done
  restart_console
fi

LISTEN="$(listen_pid)"; STATUS="$(pm2_field status)"; CUR_PM2="$(pm2_pid)"
[ "$STATUS" = "online" ] || { pm2_logs 30; err "web-deploy-console 非 online（status=${STATUS}），见上方日志"; }
[ -n "$LISTEN" ] || { pm2_logs 30; err "6200 未被监听（服务启动失败），见上方日志"; }
[ "$LISTEN" = "$CUR_PM2" ] || err "6200 占用者 ${LISTEN} ≠ pm2 pid ${CUR_PM2}，仍有孤儿进程，请手动 kill -9 ${LISTEN} 后重跑本脚本"
step "端口一致性 OK（6200 == pm2 ${CUR_PM2}, status=${STATUS}）"

# ---------- 4. 崩溃循环检测 ----------
# 端口在、pm2 online，但进程其实在秒级重启（DI 缺注册 / 配置错误 / 启动即抛）——
# 这类"进程在但服务废了"只能靠 restarts 增长发现。
R1="$(pm2_field restart_time)"; sleep 5; R2="$(pm2_field restart_time)"
if [ -n "${R2}" ] && [ "$R1" != "$R2" ]; then
  pm2_logs 40
  err "进程在 5s 内重启 ${R1}→${R2} 次（启动即崩，多为 DI 缺注册或配置错误），见上方日志"
fi
step "无崩溃循环（restarts 稳定于 ${R2:-0}）"

# ---------- 5. pm2 save ----------
step "固化 pm2 进程表 ..."
dry "${PM2_BIN} save" || "$PM2_BIN" save >/dev/null 2>&1 || warn "pm2 save 失败（不阻断）"

# ---------- 6. 健康复检 ----------
if [ "$SKIP_HEALTH" != "1" ]; then
  step "健康复检 ..."
  CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6200/console/ 2>/dev/null || echo 000)"
  [ "$CODE" = "200" ] && step "静态页 /console/ 200 ✓" || err "静态页 /console/ 返回 ${CODE}"
  # 后端 API：200=已鉴权/无鉴权放行，401=存活待鉴权；000=后端没起来
  API="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6200/api/apps 2>/dev/null || echo 000)"
  case "$API" in
    200|401) step "后端 API /api/apps ${API} ✓" ;;
    *) pm2_logs 30; err "后端 API 无响应（/api/apps=${API}），后端可能启动失败，见上方日志" ;;
  esac
fi

step "发布完成 ✓（前端入口 ${NEW_INDEX:-未知}，源 ${WS_BRANCH} @ ${WS_HEAD}）"
echo "提示：浏览器访问 https://local.kedouai.com/console/ 建议硬刷新（Cmd/Ctrl+Shift+R）"
