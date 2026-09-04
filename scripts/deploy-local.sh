#!/usr/bin/env bash
# ============================================================
# deploy-local.sh — 本地开发环境一键部署（workspace → release）
#
# 背景（踩过的坑，勿删）：
#   1) nginx /static/modules/ alias 指向 web_system_release，前端产物必须拷到 release，
#      只拷 workspace 的 gateway/public 不会生效（浏览器加载 404）。
#   2) pm2 启动的是 release/servers/<svc>/dist/main.js，后端服务同样跑在 release 副本，
#      在 workspace 构建后端不会生效，必须同步源码到 release 并在 release 内构建。
#   3) 端口可能被"孤儿残留进程"占用（非 pm2 管理的旧实例），导致 pm2 新进程无法监听、
#      新代码永远进不来 —— 重启前必须清理端口上的非 pm2 进程。
#   4) gateway 的 DEPLOY_ENV_ID=local，版本表要更新 env_id='local' 行（不是 dev 行）。
#
# 用法：
#   ./scripts/deploy-local.sh                 # 全量（前端 admin + 全部后端）
#   ./scripts/deploy-local.sh admin           # 只发前端 admin
#   ./scripts/deploy-local.sh ai-agent        # 只发 ai-agent
#   ./scripts/deploy-local.sh admin ai-agent  # 组合
#
# 环境变量：
#   DRY_RUN=1      只打印不执行
#   SKIP_TEST=1    跳过部署后验证
#   FORCE_CLEAN=1  清理端口上非 pm2 管理的残留进程（默认不清理，避免误杀）
# ============================================================
set -euo pipefail

WORKSPACE="${WORKSPACE:-/Users/geekwen/workspace/web_system}"
RELEASE="${RELEASE:-/Users/geekwen/web_system_release}"
DRY_RUN="${DRY_RUN:-0}"
SKIP_TEST="${SKIP_TEST:-0}"

# 前端微前端模块（vite MF 构建）
FRONTENDS="admin portal"
# 后端：pm2名:端口:release目录名:workspace包名
BACKENDS="
web-gateway:6000:gateway:@web-system/gateway
web-auth:6101:auth-service:@web-system/auth-service
web-user:6002:user-service:@web-system/user-service
web-ai:6003:ai-service:@web-system/ai-service
web-ai-agent:6010:ai-agent:@web-system/ai-agent
web-system:6004:system-service:@web-system/system-service
web-mcp-gateway:6006:mcp-gateway:@web-system/mcp-gateway
web-content-hub:6007:content-hub:@web-system/content-hub
"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[1;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[local]${NC} $1"; }
warn() { echo -e "${YELLOW}[local][WARN]${NC} $1"; }
err()  { echo -e "${RED}[local][ERROR]${NC} $1"; exit 1; }

[ -d "$WORKSPACE" ] || err "workspace 不存在: $WORKSPACE"
[ -d "$RELEASE" ]   || err "release 不存在: $RELEASE"

run() {
  if [ "$DRY_RUN" = "1" ]; then echo "  [dry-run] $*"; else eval "$@"; fi
}

TARGETS="${*:-all}"

# ---------- 前端部署 ----------
deploy_frontend() {
  local mod="$1"
  [ "$TARGETS" = "all" ] || echo " $TARGETS " | grep -q " $mod " || return 0
  log "===== 部署前端模块：$mod ====="

  local ver
  ver="$(cd "$WORKSPACE" && git rev-parse --short HEAD)"
  log "版本号: $ver"

  # 1) workspace 内构建
  log "构建 $mod（MF 模式）..."
  run "cd '$WORKSPACE/apps/$mod' && NODE_OPTIONS= RELEASE_TAG=$ver MF_FORMAT=system npx vite build --mode mf"

  # 2) 拷贝到 workspace（gateway 兜底）与 release（nginx 实际加载）
  log "拷贝产物 → workspace + release ..."
  run "mkdir -p '$WORKSPACE/servers/gateway/public/static/modules/$mod/$ver'"
  run "cp -r '$WORKSPACE/apps/$mod/dist/'* '$WORKSPACE/servers/gateway/public/static/modules/$mod/$ver/'"
  run "mkdir -p '$RELEASE/servers/gateway/public/static/modules/$mod/$ver'"
  run "cp -r '$WORKSPACE/apps/$mod/dist/'* '$RELEASE/servers/gateway/public/static/modules/$mod/$ver/'"

  # 3) 更新版本表（local 生效行 + dev 保持一致）
  log "更新版本表 → $ver ..."
  run "cd '$WORKSPACE' && NODE_OPTIONS= node -e \"const m=require('mysql2/promise');(async()=>{const c=await m.createConnection({host:'127.0.0.1',port:3306,user:'root',password:'KedouLocal@2026',database:'web_system_deploy'});await c.execute(\\\"UPDATE deploy_deployments SET current_version='$ver', status='deployed', deployed_at=NOW() WHERE module_key='$mod'\\\");console.log('  version -> $ver');await c.end()})()\""
}

# ---------- 共享包同步（packages/*，后端服务的依赖） ----------
# 注意：release 内部有自己的 packages，且 servers/*/node_modules 软链到 release/packages，
#      所以只同步 servers 源码不够，共享包改动必须同步并在 release 内重建。
sync_packages() {
  log "===== 同步共享包 packages → release ====="
  local p
  for p in types shared agent-core mcp-core; do
    [ -d "$WORKSPACE/packages/$p/src" ] || continue
    run "mkdir -p '$RELEASE/packages/$p'"
    run "rsync -a --delete --exclude 'node_modules' --exclude 'dist' \
         '$WORKSPACE/packages/$p/src/' '$RELEASE/packages/$p/src/'"
  done
  log "release 内构建共享包 ..."
  run "cd '$RELEASE' && NODE_OPTIONS= pnpm --filter '@web-system/types' --filter '@web-system/shared' --filter '@kedouai/agent-core' run build"
}

# ---------- 后端部署 ----------
deploy_backend() {
  local name="$1" port="$2" dir="$3" pkg="$4"
  [ "$TARGETS" = "all" ] || echo " $TARGETS " | grep -q " $dir " || [ "$TARGETS" = "$name" ] || return 0
  log "===== 部署后端：${name} （端口 ${port}）====="

  # 1) 同步源码到 release（只同步 src，避免覆盖 release 的 .env 等运行配置）
  log "同步源码 → release/${dir} ..."
  run "mkdir -p '$RELEASE/servers/$dir'"
  run "rsync -a --delete --exclude 'node_modules' --exclude 'dist' \
       '$WORKSPACE/servers/$dir/src/' '$RELEASE/servers/$dir/src/'"

  # 2) release 内构建（依赖改动时需先在 release 执行 pnpm install）
  log "release 内构建 $pkg ..."
  run "cd '$RELEASE' && NODE_OPTIONS= pnpm --filter '$pkg' run build"

  # 3) 端口占用检查：清理"孤儿残留进程"
  # ⚠️ 注意：`pm2 pid <name>` 返回的可能是已失效的旧 pid，不能用它做判断（会误杀正常服务）。
  #    必须以 `pm2 jlist` 中该 app 的当前 pid 为准：
  #    端口上的进程 ≠ jlist pid  ⇒ 它是残留孤儿（占着端口导致新进程监听不上），需要清理。
  local jlist_pid pids pid
  jlist_pid="$(pm2 jlist 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const a=(j||[]).find(x=>x.name==='$name');process.stdout.write(a&&a.pid?String(a.pid):'')}catch(e){process.stdout.write('')}})" 2>/dev/null || echo '')"
  pids="$(lsof -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || echo '')"
  for pid in $pids; do
    [ -z "${pid:-}" ] && continue
    if [ -n "$jlist_pid" ] && [ "$pid" != "$jlist_pid" ]; then
      warn "端口 ${port} 被残留进程 ${pid} 占用（pm2 当前 pid=${jlist_pid}），终止以便新进程监听"
      run "kill $pid 2>/dev/null || true"
      sleep 1
    else
      log "端口 ${port} 由进程 ${pid} 监听（与 pm2 pid 一致，正常）"
    fi
  done

  # 4) 重启
  log "pm2 restart $name ..."
  run "pm2 restart '$name' --update-env"
}

# ---------- 验证 ----------
verify() {
  [ "$SKIP_TEST" = "1" ] && return 0
  log "===== 验证 ====="
  sleep 3
  local ver
  ver="$(cd "$WORKSPACE" && git rev-parse --short HEAD)"
  log "manifest: $(curl -s http://localhost:6000/__manifest__ | grep -o '"name":"admin","version":"[^"]*"' || echo '读取失败')"
  log "nginx entry: $(curl -s -o /dev/null -w '%{http_code}' "https://local.kedouai.com/static/modules/admin/$ver/index.js" 2>/dev/null || echo 'N/A')"
  log "ai-agent /agent/models: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:6010/agent/models 2>/dev/null || echo 'N/A')"
  log "完成 ✅（如版本未更新，等 gateway 10s 版本缓存或 pm2 restart web-gateway 后重试）"
}

# ---------- 主流程 ----------
log "workspace: $WORKSPACE"
log "release:   $RELEASE"
log "目标: $TARGETS"
[ "$DRY_RUN" = "1" ] && warn "DRY_RUN 模式：只打印不执行"

# 先同步共享包（后端服务依赖 packages/*）
[ "$TARGETS" = "all" ] || [ "$TARGETS" != "admin" ] && sync_packages

# 后端先发（前端 manifest 依赖后端服务）
# 注意：清单用冒号分隔，需指定 IFS=':'，否则 read 按空格切分会导致整行被当成 name
while IFS=':' read -r name port dir pkg; do
  [ -z "${name:-}" ] && continue
  deploy_backend "$name" "$port" "$dir" "$pkg"
done <<< "$BACKENDS"

for mod in $FRONTENDS; do
  deploy_frontend "$mod"
done

verify
log "本地部署完成 🎉"
