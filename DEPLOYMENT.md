# Web System 部署指南

## 服务器信息

- **新服务器**: 106.52.176.246 (部署应用服务)
- **代理服务器**: 42.194.200.69 (Nginx 转发 portal.kedouai.com)

## 一、新服务器部署 (106.52.176.246)

### 1. 准备环境

```bash
# 安装 Node.js (v20+)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 pnpm
npm install -g pnpm

# 安装 Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# 安装 Nginx
sudo apt-get install -y nginx
```

### 2. 克隆项目

```bash
cd /home/ubuntu
git clone git@github.com:web5/web_system.git
cd web_system
```

### 3. 安装依赖并构建

```bash
# 安装依赖
pnpm install

# 构建前端
cd apps/portal && pnpm build
cd ../admin-web && pnpm build
cd ../..

# 构建后端
cd servers/gateway && pnpm build
cd ../auth-service && pnpm build
cd ../user-service && pnpm build
cd ../..
```

### 4. 启动数据库和缓存

```bash
docker-compose up -d postgres redis
```

### 5. 启动后端服务

使用 PM2:

```bash
npm install -g pm2

pm2 start servers/gateway/dist/main.js --name gateway
pm2 start servers/auth-service/dist/main.js --name auth-service
pm2 start servers/user-service/dist/main.js --name user-service

pm2 save
pm2 startup
```

或使用 Docker:

```bash
docker-compose up -d
```

### 6. 配置 Nginx

```bash
# 复制配置文件
sudo cp nginx-server.conf /etc/nginx/sites-available/web-system
sudo ln -s /etc/nginx/sites-available/web-system /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
```

### 7. 验证部署

访问以下地址验证:
- 门户首页：http://106.52.176.246:3003
- 管理后台：http://106.52.176.246:3001
- API 网关：http://106.52.176.246:3000

## 二、代理服务器配置 (42.194.200.69)

### 1. 配置 Nginx 转发

```bash
# 复制配置文件
sudo cp nginx-proxy.conf /etc/nginx/sites-available/portal-proxy
sudo ln -s /etc/nginx/sites-available/portal-proxy /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
```

### 2. 验证域名解析

确保 `portal.kedouai.com` DNS 解析到 42.194.200.69

```bash
ping portal.kedouai.com
# 应该显示 42.194.200.69
```

### 3. 访问测试

访问 https://portal.kedouai.com 应该能够看到少儿教育门户首页

## 三、环境变量配置

### 生产环境变量

创建 `.env.production` 文件:

```bash
# 网关服务
PORT=3000
AUTH_SERVICE_URL=http://localhost:3001
USER_SERVICE_URL=http://localhost:3002

# 认证服务
JWT_SECRET=your-super-secret-jwt-key-change-this
JWT_EXPIRES_IN=7d

# 数据库
DATABASE_URL=postgresql://web_system:web_system123@localhost:5432/web_system

# Redis
REDIS_URL=redis://localhost:6379
```

## 四、常见问题

### 1. 端口被占用

```bash
# 查看端口占用
sudo lsof -i :3000
sudo lsof -i :3001
sudo lsof -i :3002
sudo lsof -i :3003

# 杀死占用进程
sudo kill -9 <PID>
```

### 2. 数据库连接失败

```bash
# 检查 PostgreSQL 状态
docker ps | grep postgres

# 查看日志
docker logs web_system_postgres
```

### 3. Nginx 配置错误

```bash
# 测试配置
sudo nginx -t

# 查看错误日志
sudo tail -f /var/log/nginx/error.log
```

## 五、持续部署

### 使用 GitHub Actions (可选)

创建 `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to server
        uses: appleboy/ssh-action@master
        with:
          host: 106.52.176.246
          username: ubuntu
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /home/ubuntu/web_system
            git pull
            pnpm install
            pnpm build
            pm2 restart all
```

## 六、监控和维护

### 查看服务状态

```bash
# PM2 服务
pm2 status
pm2 logs

# Docker 容器
docker-compose ps
docker-compose logs
```

### 备份数据库

```bash
docker exec web_system_postgres pg_dump -U web_system web_system > backup.sql
```

### 更新部署

```bash
cd /home/ubuntu/web_system
git pull
pnpm install
pnpm build
pm2 restart all
```

---

**部署完成后，访问:**
- 🎨 少儿教育门户：https://portal.kedouai.com
- 🔧 管理后台：http://admin.kedouai.com (或 http://106.52.176.246:3001)
