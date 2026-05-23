# 🏗️ 系统部署架构方案 v2.0

> 重新设计的生产环境部署架构

---

## 📋 目录

1. [架构概述](#架构概述)
2. [服务器角色](#服务器角色)
3. [技术架构](#技术架构)
4. [部署方案](#部署方案)
5. [实施步骤](#实施步骤)

---

## 架构概述

### 当前问题
- ❌ 前端静态资源分散在两台服务器
- ❌ Node 服务手动启动，无进程管理
- ❌ 数据库表结构不完整
- ❌ 缺少统一的部署流程
- ❌ 开发/生产环境混用

### 设计目标
- ✅ 清晰的职责分离（网关/应用/静态资源）
- ✅ 统一的部署流程
- ✅ 进程守护（PM2）
- ✅ 环境隔离（dev/staging/prod）
- ✅ 易于扩展和维护

---

## 服务器角色

### 69 服务器 (42.194.200.69) - 网关服务器
**角色：** Nginx 反向代理 + 静态资源托管

| 服务 | 端口 | 说明 |
|------|------|------|
| Nginx | 80/443 | 反向代理、SSL 终止、静态资源 |
| 静态资源 | - | 门户页面、管理后台构建产物 |

**目录结构：**
```
/var/www/
├── portal/          # 主门户页面 (portal.kedouai.com)
└── admin/           # 管理后台 (admin.kedouai.com)
```

### 246 服务器 (106.52.176.246) - 应用服务器
**角色：** Node.js 后端服务 + 数据库

| 服务 | 端口 | 说明 |
|------|------|------|
| Gateway | 3000 | API 网关服务 |
| Auth Service | 3001 | 认证授权服务 |
| User Service | 3002 | 用户服务 |
| MySQL | 3306 | 数据库 |
| Redis | 6379 | 缓存 |

**目录结构：**
```
/opt/web_system/
├── servers/
│   ├── gateway/
│   ├── auth-service/
│   └── user-service/
├── docs/
└── scripts/
    ├── deploy.sh
    └── backup.sh
```

---

## 技术架构

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户请求                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              69 服务器 - Nginx 网关                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  SSL 终止 / 反向代理 / 静态资源                       │    │
│  └─────────────────────────────────────────────────────┘    │
│         │                    │                              │
│    静态资源              动态请求                            │
│   (portal/admin)      (API 代理)                            │
└─────────┼────────────────────┼──────────────────────────────┘
          │                    │
          │                    ▼
          │    ┌───────────────────────────────────────────┐
          │    │     246 服务器 - Node.js 应用服务           │
          │    │  ┌─────────┐ ┌─────────┐ ┌─────────┐     │
          │    │  │Gateway  │ │  Auth   │ │  User   │     │
          │    │  │ :3000   │ │ :3001   │ │ :3002   │     │
          │    │  └─────────┘ └─────────┘ └─────────┘     │
          │    └───────────────────────────────────────────┘
          │                    │
          │                    ▼
          │    ┌───────────────────────────────────────────┐
          │    │         数据层                             │
          │    │  ┌─────────┐      ┌─────────┐            │
          │    │  │  MySQL  │      │  Redis  │            │
          │    │  │  :3306  │      │  :6379  │            │
          │    │  └─────────┘      └─────────┘            │
          │    └───────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│              外部服务                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  微信 API   │  │  AI 服务     │  │  COS 存储    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### Nginx 配置策略

```nginx
# portal.kedouai.com → 69 服务器本地静态文件
# admin.kedouai.com → 代理到 246:3000
# API 请求 → 代理到 246:3000
```

---

## 部署方案

### 环境规划

| 环境 | 域名 | 服务器 | 说明 |
|------|------|--------|------|
| Production | *.kedouai.com | 69 + 246 | 生产环境 |
| Staging | *.test.kedouai.com | 246 | 测试环境（可选） |
| Development | localhost | 本地 | 开发环境 |

### 服务管理

**使用 PM2 管理 Node 进程：**
```bash
# 启动所有服务
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 重启服务
pm2 restart all

# 查看日志
pm2 logs
```

### 部署流程

```
1. 本地构建 → 2. 上传产物 → 3. 执行部署脚本 → 4. 重启服务
```

---

## 实施步骤

### Phase 1: 基础设施准备 (1 天)
- [ ] 246 服务器安装 PM2
- [ ] 246 服务器安装 MySQL/Redis（如未安装）
- [ ] 69 服务器创建标准目录结构
- [ ] 配置 SSH 免密（已完成✅）

### Phase 2: 应用服务迁移 (1 天)
- [ ] 迁移 Node 服务到 `/opt/web_system/`
- [ ] 配置 PM2 进程管理
- [ ] 配置 Nginx 反向代理
- [ ] 数据库迁移和验证

### Phase 3: 前端资源整理 (0.5 天)
- [ ] 门户页面部署到 `/var/www/portal/`
- [ ] 管理后台部署到 `/var/www/admin/`
- [ ] 配置 Nginx 静态资源服务

### Phase 4: 部署脚本和文档 (0.5 天)
- [ ] 编写自动化部署脚本
- [ ] 编写备份脚本
- [ ] 更新部署文档

---

## 目录结构规范

### 69 服务器 (Nginx 网关)
```
/var/www/
├── portal/              # 门户页面
│   ├── index.html
│   ├── assets/
│   └── ...
└── admin/               # 管理后台
    ├── index.html
    ├── assets/
    └── ...

/etc/nginx/conf.d/
├── portal.conf          # portal.kedouai.com
├── admin.conf           # admin.kedouai.com
└── api.conf             # API 代理配置
```

### 246 服务器 (应用服务)
```
/opt/web_system/
├── servers/
│   ├── gateway/
│   │   ├── dist/
│   │   ├── src/
│   │   ├── package.json
│   │   └── .env.local
│   ├── auth-service/
│   │   └── ...
│   └── user-service/
│       └── ...
├── ecosystem.config.js  # PM2 配置
├── docs/
└── scripts/
    ├── deploy.sh
    ├── backup-db.sh
    └── health-check.sh
```

---

## 配置文件示例

### PM2 Ecosystem 配置

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'gateway',
      script: './servers/gateway/dist/main.js',
      cwd: '/opt/web_system',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'auth-service',
      script: './servers/auth-service/dist/main.js',
      cwd: '/opt/web_system',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    },
    {
      name: 'user-service',
      script: './servers/user-service/dist/main.js',
      cwd: '/opt/web_system',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 3002
      }
    }
  ]
}
```

### Nginx 配置

```nginx
# /etc/nginx/conf.d/portal.conf
server {
    listen 443 ssl http2;
    server_name portal.kedouai.com;
    
    ssl_certificate /etc/nginx/ssl/kedouai.com_bundle.crt;
    ssl_certificate_key /etc/nginx/ssl/kedouai.com.key;
    
    root /var/www/portal;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# /etc/nginx/conf.d/admin.conf
server {
    listen 443 ssl http2;
    server_name admin.kedouai.com;
    
    ssl_certificate /etc/nginx/ssl/kedouai.com_bundle.crt;
    ssl_certificate_key /etc/nginx/ssl/kedouai.com.key;
    
    location / {
        proxy_pass http://106.52.176.246:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# /etc/nginx/conf.d/api.conf
server {
    listen 443 ssl http2;
    server_name api.kedouai.com;
    
    ssl_certificate /etc/nginx/ssl/kedouai.com_bundle.crt;
    ssl_certificate_key /etc/nginx/ssl/kedouai.com.key;
    
    location / {
        proxy_pass http://106.52.176.246:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## 监控和日志

### 服务监控
- PM2 内置监控：`pm2 monit`
- 系统资源：`htop`, `nmon`
- Nginx 日志：`/var/log/nginx/`

### 日志管理
- 应用日志：`/var/log/web_system/`
- 日志轮转：logrotate 配置
- 日志保留：30 天

---

## 备份策略

### 数据库备份
```bash
# 每天凌晨 2 点备份
0 2 * * * /opt/web_system/scripts/backup-db.sh
```

### 备份内容
- MySQL 数据库
- Redis 数据（如需要）
- 用户上传文件
- 配置文件

---

## 下一步

1. 确认架构方案
2. 开始 Phase 1 实施
3. 逐步迁移服务
4. 验证和测试

---

> 文档版本：v2.0  
> 创建时间：2026-03-28  
> 作者：系统架构师
