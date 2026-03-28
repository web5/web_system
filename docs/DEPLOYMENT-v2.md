# 📦 系统部署文档 v2.0

> 生产环境部署实施记录

---

## ✅ 部署完成状态

**部署时间：** 2026-03-28  
**实施人员：** OpenClaw

---

## 服务器架构

### 69 服务器 (42.194.200.69) - Nginx 网关
- **角色：** 反向代理 + SSL 终止 + 静态资源
- **服务：**
  - Nginx (80/443)
  - 静态资源：`/var/www/portal` (门户页面)

### 246 服务器 (106.52.176.246) - 应用服务
- **角色：** Node.js 后端 + 数据库
- **服务：**
  - Gateway (3000) - API 网关
  - Auth Service (3001) - 认证服务
  - User Service (3002) - 用户服务
  - MySQL (3306) - 数据库
  - Redis (6379) - 缓存（可选）

---

## 部署目录

### 246 服务器
```
/root/web_system/
├── servers/
│   ├── gateway/           # API 网关服务
│   ├── auth-service/      # 认证服务
│   └── user-service/      # 用户服务
├── logs/                  # 应用日志
├── ecosystem.config.js    # PM2 配置
└── docs/                  # 文档
```

### 69 服务器
```
/var/www/portal/           # 门户页面静态资源
/etc/nginx/conf.d/         # Nginx 配置
```

---

## 服务管理

### PM2 进程管理

**查看所有服务：**
```bash
pm2 status
```

**重启服务：**
```bash
pm2 restart all
pm2 restart gateway
pm2 restart auth-service
pm2 restart user-service
```

**查看日志：**
```bash
pm2 logs
pm2 logs gateway --lines 50
```

**查看监控：**
```bash
pm2 monit
```

### 日志文件位置
- Gateway: `/root/web_system/logs/gateway-*.log`
- Auth: `/root/web_system/logs/auth-*.log`
- User: `/root/web_system/logs/user-*.log`

---

## 访问地址

| 服务 | URL | 说明 |
|------|-----|------|
| 管理后台 | https://admin.kedouai.com | 后台管理系统 |
| 门户网站 | https://portal.kedouai.com | 主门户页面 |
| API 网关 | https://admin.kedouai.com/api/* | API 接口 |

---

## 数据库

### MySQL 配置
- **主机：** localhost
- **端口：** 3306
- **数据库：** web_system
- **用户：** web_system
- **密码：** web_system123

### 数据表
- `users` - 用户表

### 数据库维护
```bash
# 备份数据库
mysqldump -u web_system -pweb_system123 web_system > backup.sql

# 恢复数据库
mysql -u web_system -pweb_system123 web_system < backup.sql
```

---

## 环境变量

### Gateway (.env.local)
```bash
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
AUTH_SERVICE_URL=http://127.0.0.1:3001
PUBLIC_URL=http://106.52.176.246:3000
CORS_ORIGINS=*
```

### Auth Service (.env.local)
```bash
PORT=3001
NODE_ENV=production
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=web_system
DB_PASSWORD=web_system123
DB_DATABASE=web_system
JWT_SECRET=production-secret-key-change-this
JWT_EXPIRES_IN=7d
REDIS_URL=redis://localhost:6379
```

---

## 部署流程

### 更新代码
```bash
# 1. 拉取最新代码
cd /root/web_system
git pull

# 2. 安装依赖
pnpm install --prod

# 3. 构建项目
pnpm build

# 4. 重启服务
pm2 restart all
```

### 数据库迁移
```bash
# 如有数据库变更，执行迁移脚本
mysql -u web_system -pweb_system123 web_system < scripts/migration.sql
```

---

## 监控和告警

### 服务健康检查
```bash
# 检查服务状态
pm2 status

# 检查端口
netstat -tlnp | grep -E '3000|3001|3002'

# 测试 API
curl http://localhost:3000/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```

### 系统资源监控
```bash
# CPU 和内存
htop

# 磁盘空间
df -h

# 日志大小
du -sh /root/web_system/logs/
```

---

## 常见问题

### 1. 服务无法启动
```bash
# 查看 PM2 日志
pm2 logs --lines 100

# 检查端口占用
lsof -i :3000
lsof -i :3001
lsof -i :3002

# 重启服务
pm2 restart all
```

### 2. 数据库连接失败
```bash
# 检查 MySQL 状态
systemctl status mysqld

# 测试数据库连接
mysql -u web_system -pweb_system123 web_system -e "SELECT 1"
```

### 3. Nginx 代理失败
```bash
# 检查 Nginx 配置
nginx -t

# 重启 Nginx
systemctl restart nginx

# 查看 Nginx 日志
tail -50 /var/log/nginx/admin.error.log
```

---

## 备份策略

### 数据库备份（每天凌晨 2 点）
```bash
0 2 * * * mysqldump -u web_system -pweb_system123 web_system > /backup/web_system_$(date +\%Y\%m\%d).sql
```

### 日志备份（每周）
```bash
# 压缩旧日志
find /root/web_system/logs -name "*.log" -mtime +7 -exec gzip {} \;
```

---

## 变更记录

### v2.0 (2026-03-28)
- ✅ 引入 PM2 进程管理
- ✅ 统一服务配置和环境变量
- ✅ 规范化日志管理
- ✅ 配置开机自启动
- ✅ 完善部署文档

---

> 文档版本：v2.0  
> 最后更新：2026-03-28  
> 维护人员：系统管理员
