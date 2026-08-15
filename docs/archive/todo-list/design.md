# Todo List 技术设计文档

**版本**: v1.0  
**日期**: 2026-07-03  
**作者**: AI Assistant  
**审核**: 待审核

---

## 1. 系统架构

### 1.1 架构图

```
┌─────────────────────────────────────────────────────┐
│                   前端 (Vue 3)                     │
│  apps/portal/src/views/Todo*                       │
│  apps/portal/src/api/todo.ts                       │
└──────────────────┬──────────────────────────────────┘
                   │ HTTPS (JWT Auth)
                   ↓
┌─────────────────────────────────────────────────────┐
│              API Gateway (NestJS)                   │
│           servers/gateway/ (Port 3000)             │
│  代理转发 /api/todos/* → todo-service               │
└──────────────────┬──────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────┐
│         Todo Service (NestJS)                       │
│      servers/todo-service/ (Port 3005)             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │Controller│ │ Service  │ │ Entity   │          │
│  └──────────┘ └──────────┘ └──────────┘          │
└──────────────────┬──────────────────────────────────┘
                   │ TypeORM
                   ↓
┌─────────────────────────────────────────────────────┐
│              Database (MySQL/PostgreSQL)            │
│  todo_tasks 表                                     │
└─────────────────────────────────────────────────────┘
```

### 1.2 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | Vue 3 + TypeScript | 现有技术栈 |
| UI 库 | Ant Design Vue 4.x | 现有 UI 库 |
| 状态管理 | Pinia | 现有状态管理 |
| 后端 | NestJS 10 + TypeScript | 现有技术栈 |
| ORM | TypeORM 0..3 | 现有 ORM |
| 数据库 | MySQL (现有) | 复用现有数据库 |
| 认证 | JWT (现有 Gateway) | 复用认证机制 |

---

## 2. 数据库设计

### 2.1 表结构

#### `todo_tasks` 表

```sql
CREATE TABLE `todo_tasks` (
  `id` VARCHAR(36) PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `status` ENUM('pending', 'in_progress', 'completed', 'overdue', 'cancelled') DEFAULT 'pending',
  `priority` ENUM('low', 'medium', 'high') DEFAULT 'medium',
  `category` JSON,  -- 存储标签数组 ["study", "art"]
  `due_date` DATETIME,
  `completed_at` DATETIME,
  `user_id` VARCHAR(36) NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME,  -- 软删除
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_due_date` (`due_date`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2.2 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID，主键 |
| title | VARCHAR(255) | 任务标题 |
| description | TEXT | 任务描述（可选） |
| status | ENUM | 状态：pending/in_progress/completed/overdue/cancelled |
| priority | ENUM | 优先级：low/medium/high |
| category | JSON | 分类标签（JSON 数组） |
| due_date | DATETIME | 截止日期（可选） |
| completed_at | DATETIME | 完成时间（可选） |
| user_id | VARCHAR(36) | 所属用户 ID（外键） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |
| deleted_at | DATETIME | 删除时间（软删除标记） |

### 2.3 索引策略
- `idx_user_id`: 加速按用户查询
- `idx_status`: 加速按状态筛选
- `idx_due_date`: 加速按截止日期查询、逾期任务查询

---

## 3. 后端 API 设计

### 3.1 模块结构

```
servers/todo-service/
├── src/
│   ├── main.ts                          # 入口文件
│   ├── app.module.ts                    # 根模块
│   ├── todo/
│   │   ├── todo.module.ts              # Todo 模块
│   │   ├── todo.controller.ts          # 控制器
│   │   ├── todo.service.ts             # 业务逻辑
│   │   ├── todo.entity.ts              # 实体类
│   │   ├── dto/
│   │   │   ├── create-todo.dto.ts     # 创建 DTO
│   │   │   ├── update-todo.dto.ts     # 更新 DTO
│   │   │   └── query-todo.dto.ts      # 查询 DTO
│   │   └── interfaces/
│   │       └── todo.interface.ts      # 接口定义
│   └── config/
│       └── database.ts                 # 数据库配置
├── package.json
└── tsconfig.json
```

### 3.2 API 端点详细设计

#### 3.2.1 获取任务列表
```
GET /api/todos
Query Parameters:
  - page: number (页码，默认 1)
  - pageSize: number (每页数量，默认 20，最大 100)
  - status: string (状态筛选，可选)
  - priority: string (优先级筛选，可选)
  - category: string (分类筛选，可选)
  - keyword: string (关键词搜索，可选)
  - sortBy: string (排序字段，默认 created_at)
  - sortOrder: string (排序方向，asc/desc，默认 desc)

Response:
{
  "code": 0,
  "data": {
    "items": [
      {
        "id": "uuid",
        "title": "完成任务 A",
        "description": "详细描述",
        "status": "pending",
        "priority": "high",
        "category": ["study"],
        "due_date": "2026-07-05T00:00:00Z",
        "completed_at": null,
        "created_at": "2026-07-03T12:00:00Z",
        "updated_at": "2026-07-03T12:00:00Z"
      }
    ],
    "total": 100,
    "page": 1,
    "pageSize": 20
  },
  "message": "success"
}
```

#### 3.2.2 获取任务详情
```
GET /api/todos/:id

Response:
{
  "code": 0,
  "data": { /* 单个任务对象 */ },
  "message": "success"
}
```

#### 3.2.3 创建任务
```
POST /api/todos
Request Body:
{
  "title": "字符串，必填，1-255 字符",
  "description": "字符串，可选",
  "priority": "low|medium|high，默认 medium",
  "category": ["字符串数组，可选"],
  "due_date": "ISO 8601 日期字符串，可选"
}

Response:
{
  "code": 0,
  "data": { /* 创建的任务对象 */ },
  "message": "创建成功"
}
```

#### 3.2.4 更新任务
```
PUT /api/todos/:id
Request Body:
{
  "title": "字符串，可选",
  "description": "字符串，可选",
  "status": "枚举值，可选",
  "priority": "枚举值，可选",
  "category": ["字符串数组，可选"],
  "due_date": "日期字符串，可选"
}

Response:
{
  "code": 0,
  "data": { /* 更新后的任务对象 */ },
  "message": "更新成功"
}
```

#### 3.2.5 删除任务（软删除）
```
DELETE /api/todos/:id

Response:
{
  "code": 0,
  "data": null,
  "message": "删除成功"
}
```

#### 3.2.6 更新任务状态
```
PATCH /api/todos/:id/status
Request Body:
{
  "status": "pending|in_progress|completed|overdue|cancelled"
}

Response:
{
  "code": 0,
  "data": { /* 更新后的任务对象 */ },
  "message": "状态更新成功"
}
```

#### 3.2.7 获取任务统计
```
GET /api/todos/stats
Query Parameters:
  - period: string (today/week/month，默认 today)

Response:
{
  "code": 0,
  "data": {
    "total": 10,
    "completed": 5,
    "pending": 3,
    "overdue": 2,
    "completionRate": 50.0  // 完成率（百分比）
  },
  "message": "success"
}
```

### 3.3 错误处理机制

| 错误码 | 说明 | HTTP 状态码 |
|--------|------|-------------|
| 0 | 成功 | 200 |
| 400 | 请求参数错误 | 400 |
| 401 | 未认证 | 401 |
| 403 | 无权限（访问他人任务） | 403 |
| 404 | 任务不存在 | 404 |
| 500 | 服务器内部错误 | 500 |

---

## 4. 前端设计

### 4.1 目录结构

```
apps/portal/src/
├── views/
│   └── Todo.vue                    # Todo 列表页（主页面）
├── components/
│   └── todo/
│       ├── TodoList.vue            # 任务列表组件
│       ├── TodoItem.vue            # 任务列表项组件
│       ├── TodoForm.vue            # 任务表单（创建/编辑）
│       ├── TodoStats.vue           # 统计卡片组件
│       ├── TodoFilters.vue         # 筛选栏组件
│       └── TodoEmpty.vue          # 空状态组件
├── api/
│   └── todo.ts                    # Todo API 封装
├── types/
│   └── todo.ts                    # TypeScript 类型定义
└── router/
    └── index.ts                   # 添加 /todo 路由
```

### 4.2 类型定义

```typescript
// types/todo.ts

/** 任务状态 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';

/** 任务优先级 */
export type TodoPriority = 'low' | 'medium' | 'high';

/** 任务分类（预设） */
export type TodoCategory = 'creative' | 'study' | 'sport' | 'music' | 'other';

/** 任务对象 */
export interface Todo {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  priority: TodoPriority;
  category: TodoCategory[];
  due_date?: string;
  completed_at?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

/** 创建任务 DTO */
export interface CreateTodoDto {
  title: string;
  description?: string;
  priority?: TodoPriority;
  category?: TodoCategory[];
  due_date?: string;
}

/** 更新任务 DTO */
export interface UpdateTodoDto {
  title?: string;
  description?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  category?: TodoCategory[];
  due_date?: string;
}

/** 查询任务参数 */
export interface QueryTodoParams {
  page?: number;
  pageSize?: number;
  status?: TodoStatus;
  priority?: TodoPriority;
  category?: TodoCategory;
  keyword?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** 任务统计 */
export interface TodoStats {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  completionRate: number;
}
```

### 4.3 页面路由

```typescript
// router/index.ts
{
  path: '/todo',
  name: 'Todo',
  component: () => import('@/views/Todo.vue'),
  meta: { requiresAuth: true, title: 'Todo List' }
}
```

### 4.4 状态管理（Pinia Store）

```typescript
// stores/todo.ts

interface TodoStore {
  // 状态
  tasks: Todo[];
  stats: TodoStats | null;
  loading: boolean;
  pagination: { page: number; pageSize: number; total: number };
  filters: QueryTodoParams;

  // 动作
  fetchTasks(): Promise<void>;
  fetchStats(): Promise<void>;
  createTask(data: CreateTodoDto): Promise<Todo>;
  updateTask(id: string, data: UpdateTodoDto): Promise<Todo>;
  deleteTask(id: string): Promise<void>;
  updateStatus(id: string, status: TodoStatus): Promise<Todo>;
  setFilters(filters: Partial<QueryTodoParams>): void;
  resetFilters(): void;
}
```

---

## 5. UI/UX 设计

### 5.1 设计系统（变变风格）

| 元素 | 设计规范 |
|------|----------|
| 主色 | #FF8C42（魔法橙） |
| 辅色 | #4ECDC4（天空蓝） |
| 背景 | #FFF8F0（暖白） |
| 成功色 | #7ED957（薄荷绿） |
| 警告色 | #FFD93D（阳光黄） |
| 危险色 | #FF6B6B（珊瑚红） |
| 文字主色 | #333333 |
| 文字辅色 | #888888 |
| 圆角（卡片） | 24px |
| 圆角（按钮） | 16px |
| 圆角（标签） | 12px |
| 字体大小 | 14px（正文）、12px（辅助）、16px（标题） |

### 5.2 页面布局（移动端 375px）

```
┌─────────────────────────────────┐
│  ← 返回   Todo List    [⚙️]   │  ← 顶部导航（固定）
├─────────────────────────────────┤
│                                 │
│  ┌─────────────────────────┐   │
│  │  📊 今日统计            │   │  ← 统计卡片（可选展示）
│  │  已完成 3/10  完成率 30% │   │
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │  [全部 ▼]  [状态 ▼]    │   │  ← 筛选栏
│  │  [分类]  [优先级]       │   │
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │ ☑️ 完成任务 A           │   │  ← 任务卡片
│  │    📚 学习  🟡 中优先级 │   │
│  │    📅 2026-07-05       │   │
│  │    [编辑] [删除]        │   │
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │ ☐ 进行中的任务 B       │   │
│  │    🎨 创意  🔴 高优先级 │   │
│  │    📅 2026-07-04 逾期  │   │
│  └─────────────────────────┘   │
│                                 │
│                                 │
│          ┌─────┐                │
│          │  +  │                │  ← 悬浮创建按钮
│          └─────┘                │
│                                 │
└─────────────────────────────────┘
```

### 5.3 交互细节

#### 任务卡片
- **左滑**：显示"编辑"、"删除"按钮（移动端）
- **长按**：快速标记完成（震动反馈）
- **点击**：进入任务详情/编辑页

#### 创建/编辑表单
- **底部弹出**：移动端使用 ActionSheet 或 BottomSheet
- **日期选择**：调用原生日期选择器
- **分类选择**：标签式多选

#### 动画效果
- **任务完成**：✨ 粒子爆炸动画（confetti）
- **列表刷新**：下拉刷新动画
- **按钮反馈**：点击缩放 0.95

---

## 6. 安全设计

### 6.1 认证与授权
- **JWT 认证**：所有 API 请求需在 Header 携带 `Authorization: Bearer <token>`
- **行级权限**：用户只能访问自己的任务（`user_id` 匹配）
- **软删除**：不物理删除数据，保护用户数据

### 6.2 输入验证
- **后端验证**：使用 class-validator 验证 DTO
- **XSS 防护**：前端转义用户输入，后端使用参数化查询
- **SQL 注入防护**：TypeORM 自动参数化，不使用原生 SQL

### 6.3 限流
- **API 限流**：每分钟 60 次请求（未来配置）

---

## 7. 性能优化

### 7.1 前端优化
- **虚拟滚动**：任务列表超过 100 条时启用（vue-virtual-scroller）
- **分页加载**：每次加载 20 条，上拉加载更多
- **图片懒加载**：任务附件（未来功能）
- **防抖搜索**：筛选关键词输入防抖 300ms

### 7.2 后端优化
- **数据库索引**：为常用查询字段建立索引
- **查询结果缓存**：统计数据缓存 5 分钟（Redis）
- **分页查询**：避免全表扫描

---

## 8. 测试策略

### 8.1 单元测试
- **后端**：Service 层、Controller 层（Jest）
- **前端**：组件渲染、状态管理（Vitest + Vue Test Utils）

### 8.2 集成测试
- **API 测试**：端到端 API 测试（Supertest）
- **数据库测试**：使用测试数据库

### 8.3 E2E 测试
- **用户流程**：创建任务 → 编辑 → 完成 → 删除（未来）

---

## 9. 部署计划

### 9.1 后端部署
1. 创建 `todo-service` 微服务
2. 配置 PM2（ecosystem.config.js）
3. 更新 API Gateway 代理配置
4. 数据库迁移（创建表）

### 9.2 前端部署
1. 创建 Todo 页面组件
2. 更新路由配置
3. 构建并部署到静态托管

---

## 10. 开发排期

| 阶段 | 任务 | 工时 | 负责人 |
|------|------|------|--------|
| 数据库 | 创建 todo_tasks 表 | 0.5h | - |
| 后端 | 搭建 todo-service 框架 | 1h | - |
| 后端 | 实现 CRUD API | 2h | - |
| 后端 | 实现统计 API | 1h | - |
| 前端 | 创建类型定义、API 封装 | 1h | - |
| 前端 | 开发 Todo 列表页 | 2h | - |
| 前端 | 开发创建/编辑表单 | 2h | - |
| 前端 | 开发统计组件 | 1h | - |
| 联调 | 前后端联调 | 1h | - |
| 测试 | 功能测试、回归测试 | 1h | - |
| **合计** | | **12.5h** | |

---

## 11. 风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 后端服务新增，增加运维成本 | 中 | 考虑将 Todo 模块集成到现有 user-service |
| 数据库性能（大量任务） | 低 | 索引优化、分页查询 |
| 移动端兼容性 | 中 | 充分测试 iOS、Android |
| 未来小程序集成 | 低 | 使用标准 API，避免浏览器特有 API |

---

**文档状态**: ✅ 已完成  
**下一步**: 编码实现（后端 → 前端 → 联调）
