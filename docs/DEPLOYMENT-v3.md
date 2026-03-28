# 📦 部署架构 v3.0 - 实施完成

> 三环境分离架构：Nginx 网关 + 网关服务 + 后端服务

---

## ✅ 实施完成状态

**实施时间：** 2026-03-28  
**架构版本：** v3.0

---

## 架构概述

```
用户请求
    ↓
https://admin.kedouai.com
    ↓
69 服务器 Nginx (SSL 终止 + 反向代理)
    ↓
http://106.52.176.246:3000
    ↓
246 服务器 Gateway 服务
├── 根据 Host 头返回静态资源
│   ├── admin.kedouai.com → /root/web_system/static/admin/
│   └── portal.kedouai.com → /root/web_system/static/portal/
└── API 请求代理到后端服务
    ├── /api/auth/* → auth-service:3001
    └── /api/user/* → user-service:3002
```

---

## 服务器配置

### 69 服务器 (42.194.200.69) - Nginx 网关
**角色：** 纯反向代理，SSL 终止

**配置：**
- `/etc/nginx/conf.d/admin.conf` - admin.kedouai.com
- `/etc/nginx/conf.d/portal.conf` - portal.kedouai.com

**特点：**
- ❌ 不托管静态资源
- ✅ 所有请求转发到 246:3000
- ✅ SSL 终止在 Nginx 层

### 246 服务器 (106.52.176.246) - 应用服务
**角色：** 网关服务 + 业务服务 + 静态资源

**目录结构：**
```
/root/web_system/
├── servers/
│   ├── gateway/           # 网关服务 (3000)
│   ├── auth-service/      # 认证服务 (3001)
│   └── user-service/      # 用户服务 (3002)
├── static/                # 静态资源
│   ├── admin/            # admin.kedouai.com
│   │   ├── index.html
│   │   └── assets/
│   └── portal/           # portal.kedouai.com
│       ├── index.html
│       └── assets/
├── logs/
└── ecosystem.config.js
```

**服务管理：**
```bash
pm2 status
pm2 restart gateway
pm2 logs gateway
```

---

## 部署流程

### 1. 构建前端应用
```bash
# 管理后台
cd /home/ubuntu/.openclaw/workspace/web_system/apps/admin-web
pnpm build

# 门户页面（如有）
cd ../portal
pnpm build
```

### 2. 上传静态资源到 246 服务器
```bash
# 管理后台
rsync -avz dist/ root@106.52.176.246:/root/web_system/static/admin/

# 门户页面
rsync -avz dist/ root@106.52.176.246:/root/web_system/static/portal/
```

### 3. 重启 Gateway 服务
```bash
ssh root@106.52.176.246 "pm2 restart gateway"
```

### 4. 验证访问
```bash
# 测试静态资源
curl -sk https://admin.kedouai.com/ | head -5

# 测试 API
curl -sk -X POST https://admin.kedouai.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```

---

## 路由逻辑

### Gateway 服务路由规则

**静态资源路由：**
```javascript
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
```javascript
POST /api/auth/login → auth-service:3001
GET  /api/user/profile → user-service:3002
```

---

## 访问地址

| 服务 | URL | 说明 |
|------|-----|------|
| 管理后台 | https://admin.kedouai.com | 后台管理系统 |
| 门户网站 | https://portal.kedouai.com | 主门户页面 |
| API 接口 | https://admin.kedouai.com/api/* | 所有 API 接口 |

---

## 配置管理

### Gateway 服务环境变量
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

### Nginx 配置
```nginx
# /etc/nginx/conf.d/admin.conf
server {
    listen 443 ssl http2;
    server_name admin.kedouai.com;
    
    location / {
        proxy_pass http://106.52.176.246:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 监控和日志

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
tail -f /var/log/nginx/admin.error.log
```

---

## 常见问题

### 1. 静态资源 404
**原因：** 静态资源未上传或路径错误

**解决：**
```bash
# 检查文件是否存在
ssh root@106.52.176.246 "ls -la /root/web_system/static/admin/"

# 重新上传
rsync -avz dist/ root@106.52.176.246:/root/web_system/static/admin/

# 重启服务
pm2 restart gateway
```

### 2. API 请求失败
**原因：** 后端服务未启动或配置错误

**解决：**
```bash
# 检查后端服务状态
pm2 status

# 检查 Gateway 配置
cat /root/web_system/servers/gateway/.env.local

# 重启所有服务
pm2 restart all
```

### 3. Nginx 转发失败
**原因：** Nginx 配置错误或 246 服务不可达

**解决：**
```bash
# 测试 Nginx 配置
nginx -t

# 测试 246 服务可达性
curl http://106.52.176.246:3000/

# 重启 Nginx
systemctl reload nginx
```

---

## 变更记录

### v3.0 (2026-03-28)
- ✅ Gateway 服务支持静态资源托管
- ✅ 根据 Host 头路由不同应用
- ✅ Nginx 改为纯反向代理
- ✅ 静态资源统一由 Gateway 管理
- ✅ 简化部署流程

### v2.0 (2026-03-28)
- ✅ 引入 PM2 进程管理
- ✅ 配置开机自启动

---

> 文档版本：v3.0  
> 最后更新：2026-03-28  
> 状态：✅ 实施完成
