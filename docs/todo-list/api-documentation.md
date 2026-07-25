# Todo List API 文档

## 概述

Todo List 服务提供任务管理功能，包括创建、查询、更新、删除任务，以及任务统计。

**基础 URL**: `http://localhost:3005/todos`  
**Swagger 文档**: `http://localhost:3005/docs`

---

## 认证

所有 API 端点需要 JWT 认证。在请求头中添加：

```
Authorization: Bearer <your-jwt-token>
```

---

## API 端点

### 1. 获取任务列表

**GET** `/todos`

获取当前用户的任务列表，支持分页、筛选和排序。

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | string | 否 | 任务状态筛选（pending/in_progress/completed/overdue/cancelled） |
| `priority` | string | 否 | 优先级筛选（low/medium/high） |
| `category` | string | 否 | 分类筛选 |
| `page` | number | 否 | 页码（默认 1） |
| `limit` | number | 否 | 每页数量（默认 20，最大 100） |
| `sortBy` | string | 否 | 排序字段（created_at/updated_at/due_date/priority） |
| `sortOrder` | string | 否 | 排序方向（ASC/DESC，默认 DESC） |

#### 响应示例

```json
{
  "code": 200,
  "data": {
    "items": [
      {
        "id": 1,
        "title": "完成项目文档",
        "description": "编写 API 文档和使用说明",
        "status": "pending",
        "priority": "high",
        "category": ["study"],
        "due_date": "2026-07-10T18:00:00.000Z",
        "completed_at": null,
        "user_id": 1,
        "created_at": "2026-07-03T15:30:00.000Z",
        "updated_at": "2026-07-03T15:30:00.000Z",
        "deleted_at": null
      }
    ],
    "meta": {
      "total": 1,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    }
  }
}
```

---

### 2. 获取任务统计

**GET** `/todos/stats`

获取当前用户的任务统计数据。

#### 响应示例

```json
{
  "code": 200,
  "data": {
    "total": 10,
    "completed": 3,
    "inProgress": 2,
    "pending": 5,
    "overdue": 0,
    "completionRate": 30
  }
}
```

---

### 3. 获取任务详情

**GET** `/todos/:id`

获取指定任务的详细信息。

#### 路径参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | number | 是 | 任务 ID |

#### 响应示例

```json
{
  "code": 200,
  "data": {
    "id": 1,
    "title": "完成项目文档",
    "description": "编写 API 文档和使用说明",
    "status": "pending",
    "priority": "high",
    "category": ["study"],
    "due_date": "2026-07-10T18:00:00.000Z",
    "completed_at": null,
    "user_id": 1,
    "created_at": "2026-07-03T15:30:00.000Z",
    "updated_at": "2026-07-03T15:30:00.000Z",
    "deleted_at": null
  }
}
```

---

### 4. 创建任务

**POST** `/todos`

创建新任务。

#### 请求体

```json
{
  "title": "完成项目文档",
  "description": "编写 API 文档和使用说明",
  "priority": "high",
  "category": ["study"],
  "due_date": "2026-07-10T18:00:00.000Z"
}
```

#### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 任务标题（最多 255 字符） |
| `description` | string | 否 | 任务描述 |
| `priority` | string | 否 | 优先级（low/medium/high，默认 medium） |
| `category` | string[] | 否 | 分类标签数组 |
| `due_date` | string | 否 | 截止日期（ISO 8601 格式） |

#### 响应示例

```json
{
  "code": 201,
  "message": "任务创建成功",
  "data": {
    "id": 1,
    "title": "完成项目文档",
    "description": "编写 API 文档和使用说明",
    "status": "pending",
    "priority": "high",
    "category": ["study"],
    "due_date": "2026-07-10T18:00:00.000Z",
    "completed_at": null,
    "user_id": 1,
    "created_at": "2026-07-03T15:30:00.000Z",
    "updated_at": "2026-07-03T15:30:00.000Z",
    "deleted_at": null
  }
}
```

---

### 5. 更新任务

**PUT** `/todos/:id`

更新指定任务的信息。

#### 路径参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | number | 是 | 任务 ID |

#### 请求体

```json
{
  "title": "完成项目文档（修订版）",
  "description": "编写详细的 API 文档",
  "priority": "medium",
  "category": ["study", "creative"],
  "due_date": "2026-07-15T18:00:00.000Z"
}
```

#### 响应示例

```json
{
  "code": 200,
  "message": "任务更新成功",
  "data": {
    "id": 1,
    "title": "完成项目文档（修订版）",
    "description": "编写详细的 API 文档",
    "status": "pending",
    "priority": "medium",
    "category": ["study", "creative"],
    "due_date": "2026-07-15T18:00:00.000Z",
    "completed_at": null,
    "user_id": 1,
    "created_at": "2026-07-03T15:30:00.000Z",
    "updated_at": "2026-07-03T16:00:00.000Z",
    "deleted_at": null
  }
}
```

---

### 6. 更新任务状态

**PATCH** `/todos/:id/status`

更新指定任务的状态。

#### 路径参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | number | 是 | 任务 ID |

#### 请求体

```json
{
  "status": "in_progress"
}
```

#### 状态码说明

| 状态 | 说明 |
|------|------|
| `pending` | 待完成 |
| `in_progress` | 进行中 |
| `completed` | 已完成 |
| `overdue` | 逾期 |
| `cancelled` | 已取消 |

#### 响应示例

```json
{
  "code": 200,
  "message": "任务状态更新成功",
  "data": {
    "id": 1,
    "title": "完成项目文档",
    "status": "in_progress",
    "completed_at": null,
    "updated_at": "2026-07-03T16:30:00.000Z"
  }
}
```

---

### 7. 删除任务（软删除）

**DELETE** `/todos/:id`

软删除指定任务（设置 `deleted_at` 字段）。

#### 路径参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | number | 是 | 任务 ID |

#### 响应示例

```json
{
  "code": 200,
  "message": "任务删除成功"
}
```

---

## 数据模型

### TodoTask

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 任务 ID（自增） |
| `title` | string | 任务标题 |
| `description` | string | 任务描述（可选） |
| `status` | enum | 任务状态（pending/in_progress/completed/overdue/cancelled） |
| `priority` | enum | 优先级（low/medium/high） |
| `category` | string[] | 分类标签数组 |
| `due_date` | Date | 截止日期（可选） |
| `completed_at` | Date | 完成时间（可选） |
| `user_id` | number | 用户 ID（外键） |
| `created_at` | Date | 创建时间 |
| `updated_at` | Date | 更新时间 |
| `deleted_at` | Date | 删除时间（软删除，可选） |

---

## 错误码

| HTTP 状态码 | 说明 |
|------------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 401 | 未认证（缺少或无效的 JWT Token） |
| 404 | 任务不存在或无权限访问 |
| 500 | 服务器内部错误 |

---

## 示例请求

### cURL 示例

#### 创建任务

```bash
curl -X POST http://localhost:3005/todos \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "完成项目文档",
    "description": "编写 API 文档",
    "priority": "high",
    "category": ["study"],
    "due_date": "2026-07-10T18:00:00.000Z"
  }'
```

#### 获取任务列表

```bash
curl -X GET "http://localhost:3005/todos?status=pending&page=1&limit=20" \
  -H "Authorization: Bearer <your-jwt-token>"
```

#### 更新任务状态

```bash
curl -X PATCH http://localhost:3005/todos/1/status \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_progress"}'
```

---

## 前端集成

### API 请求封装（已创建）

文件位置: `apps/portal/src/api/todo.ts`

```typescript
import request from '@/utils/request';

export interface TodoTask {
  id: number;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  category?: string[];
  due_date?: string;
  completed_at?: string;
  user_id: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export const todoApi = {
  // 获取任务列表
  getTodos: (params: { status?: string; priority?: string; page?: number; limit?: number }) =>
    request.get('/api/todos', { params }),

  // 获取任务统计
  getStats: () =>
    request.get('/api/todos/stats'),

  // 创建任务
  createTodo: (data: Partial<TodoTask>) =>
    request.post('/api/todos', data),

  // 更新任务
  updateTodo: (id: number, data: Partial<TodoTask>) =>
    request.put(`/api/todos/${id}`, data),

  // 删除任务
  deleteTodo: (id: number) =>
    request.delete(`/api/todos/${id}`),
};
```

---

## 部署说明

### 1. 本地开发

```bash
# 启动 Docker MySQL
docker run -d --name web-system-mysql -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=web_system_root_2026 \
  -e MYSQL_DATABASE=web_system \
  mysql:8.0

# 启动 todo-service
cd servers/todo-service
npm install
npm run dev
```

### 2. 生产部署

```bash
# 构建
cd servers/todo-service
npm run build

# 使用 PM2 管理
pm2 start dist/main.js --name todo-service
```

---

## 注意事项

1. **认证**: 所有 API 需要有效的 JWT Token
2. **权限**: 用户只能访问自己的任务（user_id 匹配）
3. **软删除**: 删除任务只是设置 `deleted_at` 字段，数据不会真正删除
4. **枚举值**: status 和 priority 字段使用 enum 类型，必须使用指定值
5. **分类字段**: category 使用 JSON 格式存储数组

---

**文档版本**: 1.0.0  
**最后更新**: 2026-07-03  
**维护者**: GEKENWEN
