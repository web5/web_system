# 🏗️ 系统架构方案 v3.0

> 三环境分离架构：开发环境 + Nginx 网关 + 生产环境

---

## 📋 目录

1. [架构概述](#架构概述)
2. [服务器角色](#服务器角色)
3. [流量架构](#流量架构)
4. [改动清单](#改动清单)
5. [实施步骤](#实施步骤)

---

## 架构概述

### 核心设计理念
- **Nginx 网关（69 服务器）**：只做反向代理，不托管静态资源
- **网关服务（246 服务器）**：统一处理静态资源和 API 路由
- **开发环境**：独立部署，用于开发测试

### 优势
- ✅ 静态资源和 API 统一由网关服务管理
- ✅ Nginx 配置简单，只负责转发
- ✅ 网关服务可以灵活控制路由逻辑
- ✅ 开发/生产环境隔离

---

## 服务器角色

### 69 服务器 (42.194.200.69) - Nginx 网关
**角色：** 外网流量入口，纯反向代理

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 公网域名 | *.kedouai.com | 所有子域名 |
| Nginx 端口 | 80/443 | HTTP/HTTPS |
| SSL 终止 | ✅ | 在 Nginx 层处理 |
| 静态资源 | ❌ | 不托管，转发到网关服务 |
| 转发目标 | 246 服务器网关 | 所有请求 |

**Nginx 配置策略：**
```nginx
# 所有请求转发到 246 服务器的网关服务
location / {
    proxy_pass http://106.52.176.246:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 246 服务器 (106.52.176.246) - 生产环境
**角色：** 网关服务 + 业务服务 + 数据库

| 服务 | 端口 | 说明 |
|------|------|------|
| Gateway | 3000 | 网关服务（静态资源 + API 路由） |
| Auth Service | 3001 | 认证服务 |
| User Service | 3002 | 用户服务 |
| MySQL | 3306 | 数据库 |
| Redis | 6379 | 缓存 |

**网关服务职责：**
1. 根据 URL path 判断请求类型
2. 静态资源请求 → 返回本地静态文件
3. API 请求 → 代理到对应的后端服务

### 开发环境 - 本地/独立服务器
**角色：** 开发测试环境

| 配置项 | 说明 |
|--------|------|
| 部署位置 | 本地或独立服务器 |
| 服务 | 与生产环境相同 |
| 访问方式 | 本地 localhost 或内网 IP |
| 数据 | 独立数据库，不与生产混用 |

---

## 流量架构

### 请求流程

```
用户请求
    ↓
https://admin.kedouai.com/xxx
    ↓
69 服务器 Nginx (SSL 终止)
    ↓
http://106.52.176.246:3000/xxx
    ↓
246 服务器 Gateway 服务
    ├─ / → 返回静态资源 (index.html, JS, CSS)
    ├─ /api/auth/* → 代理到 auth-service:3001
    ├─ /api/user/* → 代理到 user-service:3002
    └─ /api/* → 默认代理到 auth-service:3001
```

### 域名路由

| 域名 | Nginx 转发 | Gateway 处理 | 最终目标 |
|------|-----------|-------------|----------|
| admin.kedouai.com | → 246:3000 | 根据 path 路由 | 静态资源 + API |
| portal.kedouai.com | → 246:3000 | 根据 path 路由 | 静态资源 + API |
| api.kedouai.com | → 246:3000 | API 路由 | 后端服务 |

---

## 改动清单

### 1. Nginx 配置改动 (69 服务器)

#### 1.1 admin.kedouai.com 配置
**当前配置：**
```nginx
location / {
    root /var/www/admin;
    try_files $uri $uri/ /index.html;
}
location /api {
    proxy_pass http://106.52.176.246:3000;
}
```

**修改为：**
```nginx
location / {
    proxy_pass http://106.52.176.246:3000/admin/$uri;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

# SPA 路由：所有非文件请求返回 index.html
location !/\.[^/]+$ {
    proxy_pass http://106.52.176.246:3000/admin/index.html;
}
```

**更简单的方案（推荐）：**
```nginx
location / {
    proxy_pass http://106.52.176.246:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Gateway 服务根据 Host 头返回对应的 index.html**

#### 1.2 portal.kedouai.com 配置
**当前配置：**
```nginx
location / {
    root /var/www/portal;
    try_files $uri $uri/ /index.html;
}
```

**修改为：**
```nginx
location / {
    proxy_pass http://106.52.176.246:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

#### 1.3 新增 api.kedouai.com 配置（可选）
```nginx
server {
    listen 443 ssl http2;
    server_name api.kedouai.com;
    
    location / {
        proxy_pass http://106.52.176.246:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

### 2. Gateway 服务改动 (246 服务器)

#### 2.1 静态资源服务
**需要实现：**
- 根据 `Host` 头判断是哪个应用（admin/portal）
- 返回对应应用的静态资源
- 支持 SPA 路由（所有未知路径返回 index.html）

**目录结构：**
```
/root/web_system/static/
├── admin/           # 管理后台静态资源
│   ├── index.html
│   └── assets/
└── portal/          # 门户页面静态资源
    ├── index.html
    └── assets/
```

**路由逻辑：**
```javascript
// 根据 Host 判断应用
const appMap = {
  'admin.kedouai.com': 'admin',
  'portal.kedouai.com': 'portal',
  'localhost': 'admin'  // 开发环境默认
};

// 静态资源路由
app.get('*', (req, res) => {
  const appName = appMap[req.headers.host] || 'admin';
  const staticPath = path.join(__dirname, '../static', appName);
  
  // API 请求不处理，交给 proxy
  if (req.path.startsWith('/api/')) {
    return next();
  }
  
  // 返回静态文件
  res.sendFile(req.path, { root: staticPath }, (err) => {
    if (err) {
      // SPA 路由：返回 index.html
      res.sendFile('index.html', { root: staticPath });
    }
  });
});
```

#### 2.2 API 代理路由
**当前配置：**
```javascript
AUTH_SERVICE_URL=http://127.0.0.1:3001
```

**保持不变，但需要明确路由规则：**
```javascript
// API 路由配置
const apiRoutes = {
  '/api/auth': 'http://127.0.0.1:3001',  // 认证服务
  '/api/user': 'http://127.0.0.1:3002',  // 用户服务
  '/api': 'http://127.0.0.1:3001'        // 默认到认证服务
};
```

---

### 3. 部署流程改动

#### 3.1 静态资源部署
**当前：** 构建后上传到 69 服务器 `/var/www/`

**修改为：** 构建后上传到 246 服务器 `/root/web_system/static/`

**部署脚本：**
```bash
# 1. 本地构建
cd apps/admin-web && pnpm build

# 2. 上传到 246 服务器
rsync -avz dist/ root@106.52.176.246:/root/web_system/static/admin/

# 3. 重启网关服务
ssh root@106.52.176.246 "pm2 restart gateway"
```

#### 3.2 开发环境部署
**独立部署，不影响生产：**
```bash
# 开发环境配置
cp .env.example .env.local
pnpm install
pnpm dev
```

---

### 4. 配置文件改动

#### 4.1 Gateway 服务环境变量
**新增：**
```bash
# 静态资源路径
STATIC_ROOT=/root/web_system/static

# 应用映射
APP_ADMIN_HOST=admin.kedouai.com
APP_PORTAL_HOST=portal.kedouai.com

# 开发模式
NODE_ENV=production
DEV_MODE=false
```

#### 4.2 PM2 配置
**保持不变**，但需要确保 Gateway 服务有正确的环境变量。

---

### 5. 目录结构调整

#### 246 服务器新目录结构
```
/root/web_system/
├── servers/
│   ├── gateway/
│   ├── auth-service/
│   └── user-service/
├── static/              # 新增：静态资源目录
│   ├── admin/
│   └── portal/
├── docs/
├── scripts/
├── logs/
├── ecosystem.config.js
└── package.json
```

---

## 实施步骤

### Phase 1: Gateway 服务改造 (预计 2 小时)
- [ ] 1.1 创建静态资源目录 `/root/web_system/static/`
- [ ] 1.2 修改 Gateway 代码，支持静态资源服务
- [ ] 1.3 根据 Host 头路由到不同应用
- [ ] 1.4 测试静态资源访问

### Phase 2: Nginx 配置修改 (预计 30 分钟)
- [ ] 2.1 修改 admin.kedouai.com 配置（移除静态资源托管）
- [ ] 2.2 修改 portal.kedouai.com 配置（移除静态资源托管）
- [ ] 2.3 测试 Nginx 转发
- [ ] 2.4 清理 69 服务器上的静态资源目录

### Phase 3: 部署和测试 (预计 1 小时)
- [ ] 3.1 部署 admin 静态资源到 246 服务器
- [ ] 3.2 部署 portal 静态资源到 246 服务器
- [ ] 3.3 重启 Gateway 服务
- [ ] 3.4 测试 admin.kedouai.com
- [ ] 3.5 测试 portal.kedouai.com
- [ ] 3.6 测试 API 接口

### Phase 4: 文档和清理 (预计 30 分钟)
- [ ] 4.1 更新部署文档
- [ ] 4.2 清理临时文件
- [ ] 4.3 备份旧配置

---

## 风险和注意事项

### 风险点
1. **Gateway 服务单点故障**：所有流量都经过 Gateway，需要确保高可用
2. **静态资源缓存**：需要配置合适的缓存策略
3. **性能影响**：静态资源由 Node.js 提供，性能不如 Nginx

### 解决方案
1. **PM2 集群模式**：Gateway 服务使用多实例
2. **缓存配置**：在 Gateway 中配置静态资源缓存头
3. **性能优化**：启用 Gzip 压缩，使用 CDN（可选）

---

## 回滚方案

如果新架构出现问题，可以快速回滚：

1. **恢复 Nginx 配置**：
   ```bash
   # 恢复旧配置
   cp /etc/nginx/conf.d/admin.conf.bak /etc/nginx/conf.d/admin.conf
   nginx -t && systemctl reload nginx
   ```

2. **恢复静态资源到 69 服务器**：
   ```bash
   rsync -avz /root/web_system/static/admin/ root@42.194.200.69:/var/www/admin/
   ```

3. **验证回滚**：
   ```bash
   curl -sk https://admin.kedouai.com/ | head -5
   ```

---

## 待确认事项

### 需要用户确认
- [ ] ✅ 架构设计是否符合预期
- [ ] ⏳ 静态资源目录位置：`/root/web_system/static/` 是否合适
- [ ] ⏳ Gateway 服务路由逻辑是否需要调整
- [ ] ⏳ 是否需要支持更多域名/应用
- [ ] ⏳ 开发环境的具体部署位置

### 技术细节待确认
- [ ] 静态资源是否需要版本控制（如 `/assets/index.v1.2.3.js`）
- [ ] 是否需要配置 CDN
- [ ] 是否需要启用 Gzip 压缩
- [ ] Gateway 服务是否需要集群模式（多实例）

---

## 总结

### 架构变更对比

| 项目 | 当前架构 | 新架构 |
|------|---------|--------|
| Nginx 角色 | 静态资源 + 反向代理 | 纯反向代理 |
| 静态资源托管 | 69 服务器 Nginx | 246 服务器 Gateway |
| API 路由 | Gateway 服务 | Gateway 服务（不变） |
| 配置复杂度 | 中等 | 降低（Nginx 配置简化） |
| 灵活性 | 中等 | 高（Gateway 控制所有路由） |

### 预期收益
- ✅ 架构更清晰，职责分离
- ✅ 静态资源和 API 统一管理
- ✅ 部署流程简化
- ✅ 开发/生产环境隔离

---

> 文档版本：v3.0  
> 创建时间：2026-03-28  
> 状态：**待用户确认**
