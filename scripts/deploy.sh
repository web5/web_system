#!/bin/bash
# ===========================================================
# Web System - 一键部署脚本
# 本地执行，自动构建 + 同步 + 重启远程服务
#
# 用法:
#   ./scripts/deploy.sh                    # 部署 dev 全部
#   ./scripts/deploy.sh prod               # 部署 prod 全部
#   ./scripts/deploy.sh dev portal         # 只部署 portal 前端到 dev
#   ./scripts/deploy.sh prod admin         # 只部署 admin 到 prod
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

  # 版本目录名：优先用后端传入的 RELEASE_TAG（与版本表 versionTag 一致）
  local tag="${RELEASE_TAG:-manual-$(date +%Y%m%d-%H%M%S)}"
  log "同步到远程服务器（public/versions/portal/$tag/ + public/portal/ 兜底）..."
  ssh $SSH_OPTS "$SERVER" "mkdir -p $REMOTE_DIR/servers/gateway/public/versions/portal/$tag"
  tar czf - dist | ssh $SSH_OPTS "$SERVER" "cd $REMOTE_DIR/servers/gateway/public/versions/portal/$tag && rm -rf ./* && tar xzf - --strip-components=1"
  # 兜底目录（gateway 版本解析失败/未升级时的稳定版本）
  ssh $SSH_OPTS "$SERVER" "mkdir -p $REMOTE_DIR/servers/gateway/public/portal && cd $REMOTE_DIR/servers/gateway/public/portal && rm -rf ./* && cp -r ../versions/portal/$tag/* ./"
  # 素材 SVG 同步到独立路径 public/materials/，与页面路由分离
  ssh $SSH_OPTS "$SERVER" "mkdir -p $REMOTE_DIR/servers/gateway/public/materials && cp -r $REMOTE_DIR/servers/gateway/public/versions/portal/$tag/materials/* $REMOTE_DIR/servers/gateway/public/materials/"
  # 清理旧的 portal 根路径文件（迁移到 /portal/ 后不再需要；保留 versions 目录）
  ssh $SSH_OPTS "$SERVER" "cd $REMOTE_DIR/servers/gateway/public && find . -maxdepth 1 -not -name '.' -not -name 'admin' -not -name 'portal' -not -name 'materials' -not -name 'versions' -exec rm -rf {} + 2>/dev/null; true"
  log "Portal 同步完成（版本目录: versions/portal/$tag）"

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

  # 版本目录名：优先用后端传入的 RELEASE_TAG（与版本表 versionTag 一致）
  local tag="${RELEASE_TAG:-manual-$(date +%Y%m%d-%H%M%S)}"
  log "同步到远程服务器（public/versions/$pub/$tag/ + public/$pub/ 兜底）..."
  ssh $SSH_OPTS "$SERVER" "mkdir -p $REMOTE_DIR/servers/gateway/public/versions/$pub/$tag"
  tar czf - dist | ssh $SSH_OPTS "$SERVER" "cd $REMOTE_DIR/servers/gateway/public/versions/$pub/$tag && rm -rf ./* && tar xzf - --strip-components=1"
  # 兜底目录（gateway 版本解析失败/未升级时的稳定版本）
  ssh $SSH_OPTS "$SERVER" "mkdir -p $REMOTE_DIR/servers/gateway/public/$pub && cd $REMOTE_DIR/servers/gateway/public/$pub && rm -rf ./* && cp -r ../versions/$pub/$tag/* ./"
  log "$dir 同步完成（版本目录: versions/$pub/$tag）"

  deploy_gateway_restart
}

# ===========================================================
# 微前端模块发布：本地 vite build --mode mf → 上传到 nginx static/modules 目录
# 替代 deploy_frontend（旧函数保留作过渡，新发布一律走本函数）
# 用法: deploy_micro_frontend <module-key>
# 环境变量: RELEASE_TAG（版本号=git commit）、DEPLOY_MODULE_KEY
# 产物: $REMOTE_DIR/static/modules/<module-key>/<version>/{index.js,index.css,manifest.json}
# 不重启 gateway/nginx（gateway versionCache TTL 10s 过期后自动生效）
# ===========================================================
deploy_micro_frontend() {
  local key="$1"
  if [ -z "$key" ]; then key="$DEPLOY_MODULE_KEY"; fi
  [ -z "$key" ] && err "deploy_micro_frontend 需要模块 key 参数"

  local moduleDef
  moduleDef=$(resolve_module "$key") || err "模块未注册: $key"
  local dir
  dir=$(echo "$moduleDef" | jq -r '.dir')
  local pub
  pub=$(echo "$moduleDef" | jq -r '.publicPath')

  log "===== 部署微前端模块 $key (dir=$dir) ====="
  cd "$SCRIPT_DIR/apps/$dir"

  local tag="${RELEASE_TAG:-$(git -C "$SCRIPT_DIR" rev-parse --short HEAD)}"
  log "构建 $dir (vite build --mode mf, version=$tag)..."
  RELEASE_TAG=$tag npx vite build --mode mf 2>&1 || err "$dir 微前端构建失败"
  log "$dir 构建完成 (index.js + index.css + manifest.json)"

  # 上传到 nginx 静态目录（不走 gateway public）
  log "同步到 nginx 静态目录 ($SERVER:$REMOTE_DIR/static/modules/$key/$tag/)..."
  ssh $SSH_OPTS "$SERVER" "mkdir -p $REMOTE_DIR/static/modules/$key/$tag"
  tar czf - -C dist . | ssh $SSH_OPTS "$SERVER" "cd $REMOTE_DIR/static/modules/$key/$tag && rm -rf ./* && tar xzf -"
  log "$key 同步完成 (版本目录: static/modules/$key/$tag)"

  # 不重启 gateway/nginx
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
# 单台服务器远端部署（git fetch + reset --hard + pnpm install + tsc + pm2 restart）
deploy_to_server() {
  local svc="$1"
  local pm2name="$2"
  local host="$3"        # user@host
  local key="$4"         # ssh 私钥路径（可为空，用默认密钥）
  local remote_dir="$5"
  local branch="$6"

  local ssh_opts=""
  if [ -n "$key" ] && [ "$key" != "~/.ssh/id_ed25519_servers" ] && [ -f "$key" ]; then
    ssh_opts="-i $key"
  fi

  log "    → 部署到 $host (remote_dir=$remote_dir)"
  ssh $ssh_opts "$host" "set -e
    cd $remote_dir
    git fetch origin
    git reset --hard origin/$branch
    git clean -fd
    pnpm install --prefer-offline --ignore-scripts
    cd servers/$svc
    npx tsc -p tsconfig.json
    pm2 restart $pm2name 2>/dev/null || pm2 start dist/main.js --name $pm2name
  " || err "$svc 部署到 $host 失败"
}

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

  # 2) 远端拉取最新提交并构建重启（支持多服务器：DEPLOY_SERVERS 为 JSON 数组 [{host,sshUser,sshKeyPath,remoteDir}]）
  log "远端拉取 $branch 并构建 $svc ..."
  if [ -n "$DEPLOY_SERVERS" ]; then
    log "多服务器分发（环境服务路由注入）..."
    echo "$DEPLOY_SERVERS" | node -e "
      let s='';
      process.stdin.on('data', d => s += d);
      process.stdin.on('end', () => {
        const list = JSON.parse(s);
        for (const srv of list) {
          const key = srv.sshKeyPath || '~/.ssh/id_ed25519_servers';
          console.log([srv.sshUser + '@' + srv.host, key, srv.remoteDir].join('\t'));
        }
      });
    " | while IFS=$'\t' read -r host key remote_dir; do
      [ -z "$host" ] && continue
      deploy_to_server "$svc" "$pm2name" "$host" "$key" "$remote_dir" "$branch"
    done
  else
    deploy_to_server "$svc" "$pm2name" "$SERVER" "${DEPLOY_KEY:-}" "$REMOTE_DIR" "$branch"
  fi
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
# 模块分发
# 优先使用部署服务注入的模块定义（DEPLOY_MODULE_JSON，来自 DB 模块注册表 deploy_modules），
# 未注入（手动执行脚本）时回退 scripts/modules.json
# ===========================================================
resolve_module() {
  local key="$1"
  if [ -n "$DEPLOY_MODULE_JSON" ]; then
    node -e "const m=JSON.parse(process.argv[1]); if(m.key!==process.argv[2]){process.exit(1)} console.log([m.type, m.dir, m.publicPath||'', m.buildCmd||'', m.pm2||''].join('\t'))" "$DEPLOY_MODULE_JSON" "$key" 2>/dev/null && return 0
  fi
  node -e "const m=require('$SCRIPT_DIR/scripts/modules.json').find(x=>x.key==='$key'); if(!m){process.exit(1)} console.log([m.type, m.dir, m.publicPath||'', m.buildCmd||'', m.pm2||''].join('\t'))" 2>/dev/null
}

deploy_module() {
  local key="$1"
  local info
  info="$(resolve_module "$key")" || err "未知模块: $key（请检查模块注册表/DB 或 scripts/modules.json）"
  local TYPE DIR PUB BUILDCMD PM2
  IFS=$'\t' read -r TYPE DIR PUB BUILDCMD PM2 <<< "$info"
  case "$TYPE" in
    backend)
      deploy_backend_git "$DIR" "${PM2:-$DIR}"
      ;;
    frontend | micro-frontend)
      # shell 仍走旧 deploy_frontend（基座独立 SPA）；mini-app 走自有上传
      case "$key" in
        shell)    deploy_frontend "$DIR" "$PUB" "$BUILDCMD" ;;
        mini-app) deploy_mini_app ;;
        *)
          # 其它 micro-frontend 模块统一走 deploy_micro_frontend（vite build --mode mf + nginx static/modules/）
          if [ "$TYPE" = "micro-frontend" ]; then
            deploy_micro_frontend "$key"
          else
            deploy_frontend "$DIR" "$PUB" "$BUILDCMD"
          fi
          ;;
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
  deploy_micro_frontend portal
  deploy_micro_frontend admin
  deploy_frontend shell shell
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
  micro-frontend:*)
    # deploy-console publishModule 调用：component=micro-frontend:<key>
    key="${COMPONENT#micro-frontend:}"
    deploy_micro_frontend "$key"
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
