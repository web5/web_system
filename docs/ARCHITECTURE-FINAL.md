# 📦 系统架构 v3.0 - 最终版

> 基于域名路由的静态资源和 API 统一网关架构

---

## 架构设计

```
用户请求
    ↓
https://admin.kedouai.com 或 https://portal.kedouai.com
    ↓
69 服务器 Nginx (SSL 终止)
    ↓ (根据域名转发，保持 Host 头)
http://106.52.176.246:3000
    ↓
246 服务器 Gateway 服务
    ├─ 根据 Host 头判断应用
    │   ├─ admin.kedouai.com → /root/web_system/static/admin/
    │   └─ portal.kedouai.com → /root/web_system/static/portal/
    ├─ 返回静态资源 (index.html, JS, CSS)
    └─ /api/* → 代理到后端服务
```

---

## 目录结构

### 246 服务器
```
/root/web_system/
├── static/                    # 静态资源目录
│   ├── admin/                # admin.kedouai.com
│   │   ├── index.html        # 管理后台入口
│   │   └── assets/           # JS/CSS 资源
│   └── portal/               # portal.kedouai.com
│       ├── index.html        # 门户页面入口
│       └── assets/
├── servers/
│   ├── gateway/              # 网关服务 (3000)
│   ├── auth-service/         # 认证服务 (3001)
│   └── user-service/         # 用户服务 (3002)
└── ...
```

### 源码结构
```
web_system/
├── apps/
│   ├── admin-web/            # 管理后台源码
│   │   ├── src/
│   │   └── dist/ → 构建产物
│   └── portal/               # 门户页面源码
│       ├── src/
│       └── dist/ → 构建产物
└── ...
```

---

## 部署流程

### 1. 构建前端应用
```bash
# 管理后台
cd web_system/apps/admin-web
pnpm install
pnpm build
# 产出：apps/admin-web/dist/

# 门户页面
cd web_system/apps/portal
pnpm install
pnpm build
# 产出：apps/portal/dist/
```

### 2. 上传静态资源到 246 服务器
```bash
# 管理后台
rsync -avz apps/admin-web/dist/ root@106.52.176.246:/root/web_system/static/admin/

# 门户页面
rsync -avz apps/portal/dist/ root@106.52.176.246:/root/web_system/static/portal/
```

### 3. 重启 Gateway 服务
```bash
ssh root@106.52.176.246 "pm2 restart gateway"
```

### 4. 验证访问
```bash
# 测试管理后台
curl -sk https://admin.kedouai.com/ | head -5

# 测试门户页面
curl -sk https://portal.kedouai.com/ | head -5

# 测试 API
curl -sk -X POST https://admin.kedouai.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```

---

## 路由逻辑

### Gateway 服务 (246 服务器)

**静态资源路由：**
```typescript
const appMap = {
  'admin.kedouai.com': 'admin',
  'portal.kedouai.com': 'portal',
  'localhost': 'admin',
};

// 根据 Host 头返回对应应用的静态资源
GET / → 返回 {app}/index.html
GET /assets/* → 返回 {app}/assets/*
```

**API 路由：**
```typescript
POST /api/auth/login → auth-service:3001
GET  /api/user/profile → user-service:3002
```

### Nginx 配置 (69 服务器)

**admin.kedouai.com:**
```nginx
server {
    listen 443 ssl http2;
    server_name admin.kedouai.com;
    
    location / {
        proxy_pass http://106.52.176.246:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

**portal.kedouai.com:**
```nginx
server {
    listen 443 ssl http2;
    server_name portal.kedouai.com;
    
    location / {
        proxy_pass http://106.52.176.246:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## 访问地址

| 应用 | 域名 | 静态资源目录 | 说明 |
|------|------|-------------|------|
| 管理后台 | https://admin.kedouai.com | /root/web_system/static/admin/ | 后台管理系统 |
| 门户网站 | https://portal.kedouai.com | /root/web_system/static/portal/ | 主门户页面 |
| API 接口 | 同上 | - | 统一由网关代理 |

---

## 核心优势

### 1. 统一网关
- ✅ 静态资源和 API 统一由 Gateway 服务管理
- ✅ Nginx 配置简单，只做反向代理和 SSL 终止
- ✅ 易于扩展新应用（只需添加域名和静态资源目录）

### 2. 构建分离
- ✅ `apps/admin-web` → 构建 → `static/admin/`
- ✅ `apps/portal` → 构建 → `static/portal/`
- ✅ 各应用独立构建，互不影响

### 3. 部署简单
- ✅ 构建后上传到对应目录
- ✅ 重启 Gateway 服务即可
- ✅ 无需修改 Nginx 配置

---

## 配置文件

### Gateway 环境变量
```bash
# /root/web_system/servers/gateway/.env.local
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
AUTH_SERVICE_URL=http://127.0.0.1:3001
PUBLIC_URL=http://106.52.176.246:3000
CORS_ORIGINS=*
STATIC_ROOT=/root/web_system/static
```

### PM2 配置
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'gateway',
    script: './servers/gateway/dist/main.js',
    cwd: '/root/web_system',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
}
```

---

## 监控和维护

### 服务状态
```bash
# 246 服务器
pm2 status
pm2 monit
```

### 日志查看
```bash
# Gateway 日志
pm2 logs gateway
tail -f /root/web_system/logs/gateway-*.log

# Nginx 日志 (69 服务器)
tail -f /var/log/nginx/admin.access.log
tail -f /var/log/nginx/portal.access.log
```

---

> 文档版本：v3.0  
> 实施时间：2026-03-28  
> 状态：✅ 已完成
