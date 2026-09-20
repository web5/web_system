# Todo Service 架构更新

**日期**: 2026-07-03  
**变更**: 从 user-service 模块 → 独立 todo-service 微服务

---

## 1. 架构变化

### 之前（集成模式）
```
Frontend → Gateway (3000) → user-service (3002)
                                    └── TodoModule (代码集成)
```

### 现在（独立服务）
```
Frontend → Gateway (3000) → todo-service (3005)
             └── /api/todos/* 代理到 todo-service
```

---

## 2. 完成的变更

### 2.1 创建独立 todo-service
**路径**: `servers/todo-service/`

| 文件 | 说明 |
|------|------|
| `package.json` | 依赖配置（NestJS 10、TypeORM、MySQL/PostgreSQL） |
| `tsconfig.json` | TypeScript 配置 |
| `src/main.ts` | 入口文件（端口 3005、Swagger、CORS） |
| `src/app.module.ts` | 根模块（Config、TypeORM、TodoModule） |
| `src/todo/todo.entity.ts` | Todo 实体（独立） |
| `src/todo/user.entity.ts` | 最小 User 实体（外键关联） |
| `src/todo/dto/*.dto.ts` | 3 个 DTO（Create、Update、Query） |
| `src/todo/todo.service.ts` | 业务逻辑（7 个方法） |
| `src/todo/todo.controller.ts` | API 控制器（7 个端点） |
| `src/todo/todo.module.ts` | NestJS 模块定义 |

### 2.2 更新 Gateway 代理
**文件**: `servers/gateway/src/proxy/`

| 文件 | 变更 |
|------|------|
| `proxy.service.ts` | 添加 `todoServiceUrl`、`createTodoProxy()` 方法 |
| `proxy.controller.ts` | 添加 `proxyTodos()` 方法，处理 `/api/todos/*` |

### 2.3 清理 user-service
| 变更 | 说明 |
|------|------|
| 删除 `src/todo/` 目录 | 所有 todo 代码已迁移 |
| 更新 `src/app.module.ts` | 移除 TodoModule 导入和 Todo 实体 |

---

## 3. 服务端口分配

| 服务 | 端口 | 说明 |
|------|------|------|
| gateway | 3000 | API 网关（静态文件、代理、文档聚合） |
| auth-service | 3001 | 认证服务（登录、注册、JWT） |
| user-service | 3002 | 用户服务（用户信息管理） |
| ai-service | 3003 | AI 服务（图像生成、对话） |
| system-service | 3004 | 系统服务（配置、日志、素材） |
| **todo-service** | **3005** | **Todo 服务（任务管理）** |

---

## 4. API 端点

所有 Todo API 通过 Gateway 访问：`http://localhost:3000/api/todos/*`

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/todos` | 获取任务列表（分页、筛选） | Bearer Token |
| GET | `/api/todos/stats` | 获取任务统计 | Bearer Token |
| GET | `/api/todos/:id` | 获取任务详情 | Bearer Token |
| POST | `/api/todos` | 创建任务 | Bearer Token |
| PUT | `/api/todos/:id` | 更新任务 | Bearer Token |
| DELETE | `/api/todos/:id` | 删除任务（软删除） | Bearer Token |
| PATCH | `/api/todos/:id/status` | 更新任务状态 | Bearer Token |

---

## 5. 数据库

### 表结构
- **表名**: `todo_tasks`
- **外键**: `user_id` → `users.id`（级联删除）
- **软删除**: `deleted_at` 字段（非 NULL 表示已删除）

### 迁移脚本
**文件**: `docs/todo-list/migration.sql`

执行方式：
```bash
# 方式 1: 直接执行 SQL
mysql -h 127.0.0.1 -u root -p web_system < docs/todo-list/migration.sql

# 方式 2: TypeORM 自动同步（仅开发环境）
# 设置 todo-service 的 app.module.ts 中 synchronize: true
```

---

## 6. 部署步骤

### 6.1 数据库迁移
```bash
# 执行迁移脚本
mysql -u root -p web_system < docs/todo-list/migration.sql
```

### 6.2 启动 todo-service
```bash
cd servers/todo-service
npm install
npm run build
npm run start:prod

# 或使用 PM2
pm2 start dist/main.js --name todo-service
```

### 6.3 重启 Gateway
```bash
cd servers/gateway
pm2 restart gateway
```

### 6.4 验证代理
```bash
# 测试代理是否生效
curl http://localhost:3000/api/todos/stats \
  -H "Authorization: Bearer <your-token>"
```

---

## 7. 前端集成

前端代码**无需修改**，因为：
- API 路径仍是 `/api/todos/*`（通过 Gateway 代理）
- 前端 HTTP 封装已正确配置（`apps/portal/src/api/todo.ts`）

只需确保：
1. 用户已登录（JWT Token 有效）
2. Gateway 正常运行
3. todo-service 正常运行

---

## 8. 开发命令

### todo-service
```bash
cd servers/todo-service

# 开发模式（热重载）
npm run dev

# 构建
npm run build

# 生产模式
npm run start:prod

# 测试
npm test
npm run test:watch
npm run test:cov

# Lint
npm run lint
```

---

## 9. 监控与日志

### PM2 管理
```bash
# 查看所有服务
pm2 list

# 查看 todo-service 日志
pm2 logs todo-service

# 重启 todo-service
pm2 restart todo-service

# 停止 todo-service
pm2 stop todo-service
```

### 健康检查
```bash
# todo-service 健康状态
curl http://localhost:3005/

# Gateway 代理健康检查
curl http://localhost:3000/health
```

---

## 10. 故障排查

### 问题 1: Gateway 代理失败
**症状**: 访问 `/api/todos` 返回 500 或 404  
**排查**:
1. 检查 todo-service 是否运行：`pm2 list`
2. 检查代理配置：`cat servers/gateway/src/proxy/proxy.controller.ts`
3. 检查环境变量：`echo $TODO_SERVICE_URL`

**修复**:
```bash
# 设置环境变量（开发环境）
export TODO_SERVICE_URL=http://localhost:3005

# 或写入 .env 文件
echo "TODO_SERVICE_URL=http://localhost:3005" >> servers/gateway/.env
```

### 问题 2: 数据库表不存在
**症状**: todo-service 启动失败，报错"table not found"  
**排查**:
1. 检查数据库：`mysql -u root -p -e "SHOW TABLES;" web_system`
2. 检查迁移脚本是否执行：`docs/todo-list/migration.sql`

**修复**:
```bash
# 执行迁移脚本
mysql -u root -p web_system < docs/todo-list/migration.sql
```

### 问题 3: 外键约束失败
**症状**: 创建任务时报错"foreign key constraint fails"  
**原因**: `user_id` 引用的用户不存在  
**修复**: 确保 `users` 表中有对应的用户记录

---

## 11. 后续优化

1. **Docker 化**: 创建 `Dockerfile` 和 `docker-compose.yml`
2. **CI/CD**: 配置 GitHub Actions 自动构建、测试、部署
3. **监控**: 集成 Prometheus + Grafana 监控
4. **日志**: 集中式日志管理（ELK Stack）
5. **测试**: 提升测试覆盖率至 80%+

---

**文档结束** 🎉
