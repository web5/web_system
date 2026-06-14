# Web System 部署指南

## 架构总览

```
dev.kedouai.com
      ↓ DNS
42.194.200.69 (Nginx 网关服务器, CentOS)
      ↓ HTTPS 代理
175.27.189.123:3000 / 10.206.16.5:3000 (内网)
      │
      ├── /assets/*    → ServeStaticModule (public/)
      ├── /admin/*     → ServeStaticModule (public/admin/)
      ├── /            → SPA 回退中间件 → index.html
      ├── /create      → SPA 回退中间件 → index.html (SPA 路由)
      ├── /api/auth/*  → ProxyModule → Auth Service (:3001)
      ├── /api/users*  → ProxyModule → User Service (:3002)
      ├── /api/ai/*    → ProxyModule → AI Service (:3003)
      ├── /api/*       → 404
      ├── /docs        → Swagger 文档
      └── /swagger     → Swagger 聚合文档
```

## 服务器信息

| 角色 | IP | 用户 | 系统 |
|------|-----|------|------|
| Nginx 网关 | 42.194.200.69 | root | CentOS 5.4 |
| 后端服务器 | 175.27.189.123 (公网) / 10.206.16.5 (内网) | ubuntu | Ubuntu 24.04 |

## 端口分配

| 端口 | 服务 | 说明 |
|------|------|------|
| 3000 | NestJS Gateway | 统一入口，托管前端 + API 代理 |
| 3001 | Auth Service | 认证/登录 |
| 3002 | User Service | 用户管理 |
| 3003 | AI Service | AI 对话/图片生成 |
| 3004 | System Service | 系统设置/操作日志 |
| 3306 | MySQL | 本地数据库 |
| 6379 | Redis | 系统原生运行 |

## 一、后端服务器部署 (175.27.189.123)

### 1. 项目目录

```
/data/web_system/
├── servers/           # NestJS 后端微服务
│   ├── gateway/       # API 网关 (端口 3000)
│   ├── auth-service/  # 认证服务 (端口 3001)
│   ├── user-service/  # 用户服务 (端口 3002)
│   ├── ai-service/    # AI 服务 (端口 3003)
│   └── system-service/# 系统服务 (端口 3004)
├── apps/              # 前端应用
│   ├── portal/        # 门户 SPA
│   └── admin-web/     # 管理后台 SPA (base: /admin/)
├── .env.production    # 生产环境变量
└── ecosystem.config.js # PM2 配置
```

### 2. 环境变量 (.env.production)

```bash
PORT=3000
HOST=0.0.0.0
AUTH_SERVICE_URL=http://127.0.0.1:3001
USER_SERVICE_URL=http://127.0.0.1:3002
AI_SERVICE_URL=http://127.0.0.1:3003
SYSTEM_SERVICE_URL=http://127.0.0.1:3004
PUBLIC_URL=http://dev.kedouai.com
CORS_ORIGINS=*
JWT_SECRET=kedouai-prod-jwt-secret-2026
JWT_EXPIRES_IN=7d
REDIS_URL=redis://127.0.0.1:6379
DB_TYPE=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=web_system_root_2026
DB_DATABASE=web_system
```

### 3. 启动/重启服务

```bash
cd /data/web_system

# 加载环境变量并重启所有微服务
export $(cat .env.production | grep -v "^#" | xargs)
pm2 restart all --update-env

# 查看状态
pm2 status
pm2 logs
```

### 4. 更新部署

```bash
cd /data/web_system

# 拉取最新代码
git pull

# 安装依赖（如需）
pnpm install

# 构建后端
cd servers/gateway && npx nest build
cd ../auth-service && npx nest build
cd ../user-service && npx nest build
cd ../ai-service && npx nest build
cd ../system-service && npx nest build
cd ../..

# 构建前端（注意跳过 vue-tsc 类型检查）
cd apps/portal && npx vite build && cp -r dist/* /data/web_system/servers/gateway/public/
cd ../admin-web && npx vite build && cp -r dist/* /data/web_system/servers/gateway/public/admin/
cd ../..

# 重启服务
export $(cat .env.production | grep -v "^#" | xargs)
pm2 restart all --update-env
```

## 二、Nginx 网关服务器 (42.194.200.69)

### 1. 配置 HTTPS 代理

配置文件：`/etc/nginx/conf.d/dev.kedouai.com.conf`

```nginx
server {
    listen 80;
    server_name dev.kedouai.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name dev.kedouai.com;

    ssl_certificate /etc/nginx/ssl/dev.kedouai.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/dev.kedouai.com/privkey.pem;

    location / {
        proxy_pass http://175.27.189.123:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 2. 修改后重载

```bash
nginx -t && nginx -s reload
```

## 三、Gateway 路由说明

### 静态资源

使用 `@nestjs/serve-static` 托管 `servers/gateway/public/` 目录：

| 请求路径 | 物理文件 |
|----------|----------|
| `/assets/*` | `public/assets/*` |
| `/admin/*` | `public/admin/*` |
| `/favicon.svg` | `public/favicon.svg` |

### SPA 回退

Express 中间件处理前端路由，非 API/文档/管理后台路径统一返回 `index.html`：

```typescript
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (path.startsWith('/api') || path.startsWith('/docs') || ...) return next();
  if (extname(path)) return next(); // 跳过静态资源
  res.sendFile('public/index.html');
});
```

### API 代理

| 前缀 | 目标 |
|------|------|
| `/api/auth/*` | Auth Service (:3001) |
| `/api/users*` | User Service (:3002) |
| `/api/ai/*` | AI Service (:3003) |
| `/api/*` | 404 |

## 四、常见问题

### 1. 数据库连接超时

检查 MySQL 是否在运行：
```bash
sudo systemctl status mysql
mysql -h 127.0.0.1 -u root -pweb_system_root_2026 -e "SELECT 1;"
```

### 2. 前端构建失败（vue-tsc 错误）

vue-tsc 与高版本 TypeScript 不兼容，使用 `npx vite build` 跳过类型检查：
```bash
cd apps/portal && rm -rf dist && npx vite build
```

### 3. PM2 服务启动失败

```bash
cd /data/web_system
export $(cat .env.production | grep -v "^#" | xargs)
pm2 restart all --update-env
pm2 logs --lines 50
```

### 4. 端口被占用

```bash
sudo lsof -i :3000
sudo systemctl status caddy  # 检查是否使用了 Caddy
```

## 五、Git 工作流

```bash
# 本地修改后
git add .
git commit -m "feat: xxx"
git push

# 服务器更新
ssh ubuntu@175.27.189.123
cd /data/web_system
git pull
# 按"三、更新部署"步骤执行
```
