# 本地开发环境搭建指南

本指南说明如何在本机（macOS / Linux，无 brew、无 sudo）一键跑起 Web System 全栈工程：6 个 NestJS 后端服务 + 2 个前端（portal / admin-web）+ MySQL + Redis。

> 适用场景：纯本机原生开发，不依赖 Docker。生产部署请参考 `DEPLOYMENT.md` 与 `docker-compose*.yml`。

---

## 1. 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | 20.x | 已验证 |
| pnpm | 9.x | 通过 `corepack enable && corepack prepare pnpm@9.15.0 --activate` 启用 |
| MySQL | 8.4.x | 二进制解压到 `~/local`，无需 brew/sudo |
| Redis | 7.x（stable） | 源码编译到 `~/local`，无需 brew/sudo |

> 若本机已有 brew 或可直接 `sudo`，可改用 `brew install mysql redis`，但本指南脚本默认走 `~/local` 二进制路线。

---

## 2. 初始化基础设施（仅首次）

### 2.1 启用 pnpm

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm -v   # 应输出 9.15.0
```

### 2.2 安装 MySQL 与 Redis 到 ~/local（无 sudo）

1. 下载官方二进制 / 源码包到 `~/local`：
   - MySQL 8.4 macOS arm64 tarball → `~/local/mysql.tar.gz`
   - Redis stable 源码 → `~/local/redis-stable`
2. 一键启动并初始化（脚本幂等，可反复执行）：

```bash
./scripts/local-db.sh
```

脚本会：
- 解压 MySQL、初次 `mysqld --initialize-insecure`（root 无密码）
- 编译 Redis（首次）
- 启动 MySQL（socket `~/local/mysql-data/mysql.sock`，端口 3306）与 Redis（端口 6379）
- 创建数据库 `web_system`

> MySQL root 默认**无密码**。若需设置本地密码，执行：
> ```bash
> ~/local/mysql-8.4.0-macos14-arm64/bin/mysql -uroot -e \
>   "ALTER USER 'root'@'localhost' IDENTIFIED BY '你的密码';"
> ```
> 并设置后需把各服务 `.env` 的 `DB_PASSWORD` 同步为该密码（见 §4）。

---

## 3. 安装依赖与构建共享包

在项目根目录：

```bash
pnpm install
pnpm --filter @web-system/shared build
pnpm --filter @web-system/types build
```

`start-local.sh` 在检测到无 `node_modules` 时会自动跑 `pnpm install`，并自动构建 `shared` / `types`，因此通常无需手动执行。

---

## 4. 配置 .env

每个后端服务在 `servers/<service>/.env` 读取配置。**这些文件已被 `.gitignore` 忽略，不会入库。** 首次需自行创建，关键字段：

```dotenv
# 数据库（MySQL，本地 root 无密码示例）
DB_TYPE=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=            # 若 §2.2 设了密码则填这里
DB_DATABASE=web_system

# Redis
REDIS_URL=redis://127.0.0.1:6379

# JWT（本地随机值，禁止用于生产）
JWT_SECRET=<随机 48 字节 hex>
JWT_EXPIRES_IN=7d

# CORS（具体域名，禁止 *）
CORS_ORIGINS=http://localhost:5173,http://localhost:5174

# 第三方密钥（占位，待填真实值）
MINI_PROGRAM_APP_ID=REPLACE_ME
MINI_PROGRAM_SECRET=REPLACE_ME
```

需要 DB 的服务：auth / user / ai / system / todo。gateway 与 upload 不直连库。

---

## 5. 一键启动

```bash
# 启动整套：DB + 后端(6) + 前端(portal/admin-web/docs)
./scripts/start-local.sh

# 额外初始化种子用户（admin / test）
./scripts/start-local.sh --seed
```

脚本会：自动 `pnpm install`（缺失时）→ 构建共享包 → 调 `local-db.sh` 启 DB → 重启后端 → 启动前端 →（可选）seed。

各服务脚本名不同（已内部处理）：auth/user/system/todo/gateway 用 `dev`，ai-service 用 `start:dev`。

### 启动后地址

| 服务 | 地址 |
|------|------|
| Portal | http://localhost:5173 |
| Admin | http://localhost:5174/admin/ |
| Docs | http://localhost:4173 |
| Gateway | http://localhost:3000 |
| Auth | http://localhost:3001 |
| User | http://localhost:3002 |
| AI | http://localhost:3003 |
| System | http://localhost:3004 |
| Todo | http://localhost:3005 |

日志位于 `/tmp/<服务名>.log`，例如 `/tmp/auth-service.log`。

---

## 6. 种子用户（初始账号）

工程**不内置任何用户数据**，初始账号由 `servers/auth-service/scripts/seed.ts` 生成，需主动执行：

```bash
cd servers/auth-service
ADMIN_INIT_PASSWORD='你的管理员密码' \
TEST_INIT_PASSWORD='test123456' \
pnpm seed
```

| 用户名 | 角色 | 密码 |
|--------|------|------|
| `admin` | admin | 由 `ADMIN_INIT_PASSWORD` 指定（缺失则脚本报错退出） |
| `test` | user | 由 `TEST_INIT_PASSWORD` 指定（缺失则随机生成） |

> seed 脚本的 DB 密码**只从 `.env` 注入**，源码中无硬编码。

建好后即可用 admin 登录 Gateway 验证：

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"你的管理员密码"}'
```

---

## 7. 常见问题

**Q：登录报 `Unknown column 'password' in 'field list'`**
A：说明 `users` 表结构残缺（曾因 sync 异常只建了 `id`/`username`）。解决：
```bash
# 删除残缺表，让 TypeORM synchronize 按实体重建
~/local/mysql-8.4.0-macos14-arm64/bin/mysql -uroot web_system -e "DROP TABLE users;"
# 重启 auth-service 后会自动重建完整结构，再跑 §6 的 seed
```

**Q：ai-service 起不来 / 报 `Command "dev" not found`**
A：ai-service 的脚本名是 `start:dev`，不是 `dev`。用 `start-local.sh` 已自动处理；手动启动请用 `pnpm start:dev`。

**Q：MySQL 连不上 `Access denied`**
A：检查 `.env` 的 `DB_PASSWORD` 是否与 §2.2 设置的密码一致；无密码库则留空。

**Q：更换代码后表结构没更新**
A：开发环境 `synchronize: true` 会自动同步实体到表（不删数据）。若结构严重不一致，参考上面的 DROP 方案。

---

## 8. 停止与重启

直接 kill 对应端口即可，`start-local.sh` 启动时会先清理旧进程：

```bash
# 停止全部
lsof -ti:3000 -ti:3001 -ti:3002 -ti:3003 -ti:3004 -ti:3005 \
     -ti:5173 -ti:5174 -ti:4173 2>/dev/null | xargs kill -9
```
