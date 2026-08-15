#!/bin/bash
# ===========================================================
# Web System - 一键部署脚本
# 本地执行，自动构建 + 同步 + 重启远程服务
#
# 用法:
#   ./scripts/deploy.sh                    # 部署 dev 全部
#   ./scripts/deploy.sh prod               # 部署 prod 全部
#   ./scripts/deploy.sh dev portal         # 只部署 portal 前端到 dev
#   ./scripts/deploy.sh prod admin         # 只部署 admin-web 到 prod
#   ./scripts/deploy.sh dev system         # 只部署 system-service 到 dev
#   ./scripts/deploy.sh dev seed           # 只执行变变素材种子初始化
# ===========================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_ENV="${1:-dev}"
COMPONENT="${2:-all}"
RELEASE_TAG="${3}"

# 加载环境配置
ENV_FILE="$SCRIPT_DIR/scripts/.env.deploy"
if [ ! -f "$ENV_FILE" ]; then
  echo -e "\033[0;31m[ERROR]\033[0m 未找到配置文件 $ENV_FILE"
  echo "请复制 .env.deploy.example 为 .env.deploy 并填入服务器信息"
  exit 1
fi
source "$ENV_FILE"

# 根据环境选择服务器
case "$DEPLOY_ENV" in
  dev)
    SERVER="$DEV_SERVER"
    REMOTE_DIR="$DEV_REMOTE_DIR"
    PUBLIC_URL="$DEV_PUBLIC_URL"
    ;;
  prod)
    SERVER="$PROD_SERVER"
    REMOTE_DIR="$PROD_REMOTE_DIR"
    PUBLIC_URL="$PROD_PUBLIC_URL"
    ;;
  *)
    echo "未知环境: $DEPLOY_ENV (支持: dev, prod)"
    exit 1
    ;;
esac

if [ -z "$SERVER" ]; then
  echo -e "\033[0;31m[ERROR]\033[0m $DEPLOY_ENV 环境的 SERVER 未配置，请检查 .env.deploy"
  exit 1
fi

# 若由后端注入 DB 环境连接（DEPLOY_HOST 等），则覆盖 .env.deploy，支持任意/自定义环境
if [ -n "$DEPLOY_HOST" ]; then
  SERVER="$DEPLOY_USER@$DEPLOY_HOST"
  REMOTE_DIR="$DEPLOY_REMOTE_DIR"
  PUBLIC_URL="$DEPLOY_PUBLIC_URL"
  log "使用 DB 环境连接覆盖: $DEPLOY_USER@$DEPLOY_HOST ($REMOTE_DIR)"
fi

# 自定义 SSH 私钥（默认密钥无需指定）
SSH_OPTS=""
if [ -n "$DEPLOY_KEY" ] && [ "$DEPLOY_KEY" != "~/.ssh/id_ed25519_servers" ] && [ -f "$DEPLOY_KEY" ]; then
  SSH_OPTS="-i $DEPLOY_KEY"
fi

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} [$DEPLOY_ENV] $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} [$DEPLOY_ENV] $1"; }
err()   { echo -e "${RED}[ERROR]${NC} [$DEPLOY_ENV] $1"; exit 1; }

# 测试 SSH 连接
check_ssh() {
  log "检查 SSH 连接 ($SERVER)..."
  ssh $SSH_OPTS -o ConnectTimeout=5 -o BatchMode=yes "$SERVER" "echo ok" 2>/dev/null || err "SSH 连接失败: $SERVER"
  log "SSH 连接正常"
}

# ===========================================================
# 构建 & 同步 Portal 前端
# ===========================================================
deploy_portal() {
  log "===== 部署 Portal 前端 ====="

  cd "$SCRIPT_DIR/apps/portal"

  log "构建 portal..."
  npx vite build 2>&1 || err "Portal 构建失败"
  log "Portal 构建完成"

  log "同步到远程服务器（public/portal/）..."
  ssh $SSH_OPTS "$SERVER" "mkdir -p $REMOTE_DIR/servers/gateway/public/portal"
  tar czf - dist | ssh $SSH_OPTS "$SERVER" "cd $REMOTE_DIR/servers/gateway/public/portal && rm -rf ./* && tar xzf - --strip-components=1"
  # 素材 SVG 同步到独立路径 public/materials/，与页面路由分离
  ssh $SSH_OPTS "$SERVER" "mkdir -p $REMOTE_DIR/servers/gateway/public/materials && cp -r $REMOTE_DIR/servers/gateway/public/portal/materials/* $REMOTE_DIR/servers/gateway/public/materials/"
  # 清理旧的 portal 根路径文件（迁移到 /portal/ 后不再需要）
  ssh $SSH_OPTS "$SERVER" "cd $REMOTE_DIR/servers/gateway/public && find . -maxdepth 1 -not -name '.' -not -name 'admin' -not -name 'portal' -not -name 'materials' -exec rm -rf {} + 2>/dev/null; true"
  log "Portal 同步完成"

  deploy_gateway_restart
}

# ===========================================================
# 通用前端打包发布（vite build → 上传到 gateway public/<pub>）
# 用法: deploy_frontend <app目录名> <public子路径> [build命令]
# ===========================================================
deploy_frontend() {
  local dir="$1"
  local pub="$2"
  local buildCmd="${3:-npx vite build}"
  log "===== 部署前端 $dir ====="

  cd "$SCRIPT_DIR/apps/$dir"

  log "构建 $dir ($buildCmd)..."
  eval "$buildCmd" 2>&1 || err "$dir 构建失败"
  log "$dir 构建完成"

  log "同步到远程服务器（public/$pub/）..."
  ssh $SSH_OPTS "$SERVER" "mkdir -p $REMOTE_DIR/servers/gateway/public/$pub"
  tar czf - dist | ssh $SSH_OPTS "$SERVER" "cd $REMOTE_DIR/servers/gateway/public/$pub && rm -rf ./* && tar xzf - --strip-components=1"
  log "$dir 同步完成"

  deploy_gateway_restart
}

# ===========================================================
# 小程序发布（走自有上传脚本，无远端服务）
# ===========================================================
deploy_mini_app() {
  log "===== 部署小程序 MiniApp ====="
  cd "$SCRIPT_DIR/apps/mini-app"
  log "上传小程序 (node scripts/upload.js)..."
  node scripts/upload.js 2>&1 || err "mini-app 上传失败"
  log "mini-app 上传完成（无需远端服务）"
}

# ===========================================================
# 后端服务 Git 发布（统一）
# 流程: 本地 git add -A / commit / push → 远端 git fetch + reset --hard
#        + npm install + npm run build + pm2 restart
# 注意: 远端会 reset --hard 到 origin/<branch>，远端工作区未提交的改动将被覆盖
#       （这是 git 发布的预期行为：远端只是部署目标，以本地推送的提交为准）
# 用法: deploy_backend_git <service目录名> <pm2名>
# ===========================================================
deploy_backend_git() {
  local svc="$1"
  local pm2name="$2"
  log "===== 部署 $svc (Git 发布) ====="

  local branch
  branch="$(git -C "$SCRIPT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo master)"

  # 1) 本地提交并推送到 origin
  if [ -n "$(git -C "$SCRIPT_DIR" status --porcelain)" ]; then
    log "本地有变更，提交并推送到 origin/$branch ..."
    git -C "$SCRIPT_DIR" add -A
    git -C "$SCRIPT_DIR" commit -m "deploy($DEPLOY_ENV/$svc): ${RELEASE_TAG:-manual-$(date +%Y%m%d-%H%M%S)}" \
      || warn "git commit 失败，继续尝试推送"
    git -C "$SCRIPT_DIR" push origin "$branch" \
      || err "git push 失败（请确认本机对 GitHub 的 SSH 推送权限，且本地分支已与 origin 同步）"
    log "已推送 $branch"
  else
    log "本地无变更，跳过 commit/push"
  fi

  # 2) 远端拉取最新提交并构建重启
  log "远端拉取 $branch 并构建 $svc ..."
  ssh $SSH_OPTS "$SERVER" "set -e
    cd $REMOTE_DIR
    git fetch origin
    git reset --hard origin/$branch
    git clean -fd
    pnpm install --prefer-offline --ignore-scripts
    cd servers/$svc
    npx tsc -p tsconfig.json
    pm2 restart $pm2name 2>/dev/null || pm2 start dist/main.js --name $pm2name
  " || err "$svc 远端构建/重启失败"
  log "$svc 部署完成"
}

deploy_auth() {
  deploy_backend_git auth-service auth-service
}

deploy_system() {
  deploy_backend_git system-service system-service
}

deploy_gateway() {
  deploy_backend_git gateway gateway
}

deploy_gateway_restart() {
  log "重启 gateway..."
  ssh $SSH_OPTS "$SERVER" "cd $REMOTE_DIR && pm2 restart gateway 2>/dev/null || pm2 start servers/gateway/dist/main.js --name gateway"
  log "gateway 重启完成"
}

# ===========================================================
# 模块分发（唯一真相源: scripts/modules.json）
# 根据模块 key 解析类型/目录/pm2名/前端public路径，自动选择发布方式
# ===========================================================
resolve_module() {
  local key="$1"
  node -e "const m=require('$SCRIPT_DIR/scripts/modules.json').find(x=>x.key==='$key'); if(!m){process.exit(1)} console.log([m.type, m.dir, m.publicPath||'', m.buildCmd||'', m.pm2||''].join('\t'))" 2>/dev/null
}

deploy_module() {
  local key="$1"
  local info
  info="$(resolve_module "$key")" || err "未知模块: $key（请检查 scripts/modules.json）"
  local TYPE DIR PUB BUILDCMD PM2
  IFS=$'\t' read -r TYPE DIR PUB BUILDCMD PM2 <<< "$info"
  case "$TYPE" in
    backend)
      deploy_backend_git "$DIR" "$PM2"
      ;;
    frontend)
      case "$key" in
        portal)   deploy_portal ;;
        mini-app) deploy_mini_app ;;
        *)        deploy_frontend "$DIR" "$PUB" "$BUILDCMD" ;;
      esac
      ;;
    *)
      err "未知模块类型: $TYPE"
      ;;
  esac
}

# ===========================================================
# 同步 ecosystem 配置
# ===========================================================
deploy_config() {
  log "===== 同步配置文件 ====="
  scp "$SCRIPT_DIR/ecosystem.config.js" "$SERVER:$REMOTE_DIR/ecosystem.config.js"
  log "ecosystem.config.js 已同步"
}

# ===========================================================
# 变变素材种子初始化（force 模式，覆盖为 SVG）
# ===========================================================
seed_bianbian() {
  log "===== 初始化变变素材库（替换为 SVG 图标） ====="

  # 通过 gateway 调用 seed API（force 模式：删除旧素材重建）
  local api_url="${PUBLIC_URL}/api/admin/bianbian/seed?force=1"
  log "调用 seed API: $api_url"

  local result
  result=$(curl -s -o /dev/null -w '%{http_code}' -X POST --max-time 10 "$api_url" 2>/dev/null || echo "000")
  if [ "$result" = "000" ]; then
    warn "API 调用失败（网络或端口），通过 SSH 直接调用..."
    ssh $SSH_OPTS "$SERVER" "curl -s -X POST 'http://127.0.0.1:3004/admin/bianbian/seed?force=1'" || warn "seed 调用失败，请登录管理后台手动操作"
  else
    log "seed API 响应: $result"
    if [ "$result" = "200" ] || [ "$result" = "201" ]; then
      log "素材库初始化成功！"
    else
      warn "seed API 返回 $result，可能需要登录管理后台手动操作"
    fi
  fi
}

# ===========================================================
# 全量部署
# ===========================================================
deploy_all() {
  log "===== 全量部署 ($DEPLOY_ENV) ====="
  deploy_backend_git gateway gateway
  deploy_backend_git auth-service auth-service
  deploy_backend_git system-service system-service
  deploy_backend_git user-service user-service
  deploy_backend_git ai-service ai-service
  deploy_backend_git todo-service todo-service
  deploy_backend_git upload-service upload-service
  deploy_backend_git mcp-gateway mcp-gateway
  deploy_backend_git finnews finnews
  deploy_portal
  deploy_frontend admin-web admin
  deploy_frontend mcp-admin mcp-admin
  deploy_config

  # 保存 PM2 配置
  ssh $SSH_OPTS "$SERVER" "pm2 save"
  log "PM2 配置已保存"

  log "===== 全部部署完成 ====="
}

# ===========================================================
# 健康检查
# ===========================================================
health_check() {
  log "===== 健康检查 ====="
  sleep 5

  services=(
    "Gateway:3000"
    "Auth:3001"
    "System:3004"
  )

  for svc in "${services[@]}"; do
    name="${svc%%:*}"
    port="${svc##*:}"
    code=$(ssh $SSH_OPTS "$SERVER" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$port/" 2>/dev/null || echo "000")
    if [ "$code" = "000" ]; then
      warn "$name (:$port) → 无法连接"
    else
      log "$name (:$port) → $code"
    fi
  done

  # 公网验证
  log "公网验证:"
  for url in "$PUBLIC_URL/" "$PUBLIC_URL/login" "$PUBLIC_URL/admin/"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")
    log "  $url → $code"
  done
}

# ===========================================================
# 发布快照（供回滚）
# 将远程 $REMOTE_DIR 当前状态打包到 releases/<tag>/web_system.tar.gz
# ===========================================================
create_snapshot() {
  local tag="$1"
  [ -z "$tag" ] && tag="manual-$(date +%Y%m%d-%H%M%S)"
  local base="$REMOTE_DIR/releases"
  log "创建发布快照: $tag"
  ssh $SSH_OPTS "$SERVER" "mkdir -p $base/$tag && cd $REMOTE_DIR && tar czf $base/$tag/web_system.tar.gz --exclude=./releases ." \
    || warn "快照创建失败（可继续，但将无法回滚到此版本）"
  # 仅保留最近 5 个快照
  ssh $SSH_OPTS "$SERVER" "ls -dt $base/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf" || true
  log "快照完成: $tag"
}

# ===========================================================
# 主流程
# ===========================================================
echo ""
echo "=========================================="
echo "  Web System 部署脚本"
echo "  环境: $DEPLOY_ENV"
echo "  服务器: $SERVER"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
echo ""

check_ssh

case "$COMPONENT" in
  all)
    deploy_all
    health_check
    ;;
  config)
    deploy_config
    ;;
  seed)
    seed_bianbian
    ;;
  *)
    deploy_module "$COMPONENT"
    health_check
    ;;
esac

# 部署成功后创建快照（供回滚选择）
create_snapshot "$RELEASE_TAG"

echo ""
echo "=========================================="
echo "  🎉 部署完成！"
echo "  访问地址: $PUBLIC_URL"
echo "=========================================="
