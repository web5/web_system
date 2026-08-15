# 管理后台升级 · 技术方案

## 架构概述

```
admin-web (Vue3 + AntdV 4.x)
├── BasicLayout.vue (重构)
│   ├── Layout.Sider ← 左侧菜单（基于角色权限过滤）
│   ├── Layout.Content ← router-view
│   └── Layout.Header ← 用户信息 + 退出
├── Dashboard.vue (重构)
│   ├── 4 个 StatCard（用户数/活跃/课程/日志）
│   └── ECharts 图表（用户增长趋势）
├── Settings.vue (对接)
│   └── 调用 gateway → system-service API
└── Permission (新增)
    └── 路由守卫 + 指令（v-permission）

auth-service (NestJS)
├── permission.entity     (新增：permissions 表)
├── role.entity           (新增：roles 表)
├── user-role.entity      (新增：用户-角色关联表)
├── permission.guard.ts   (新增：API 权限守卫)
└── auth.controller.ts    (新增：GET /auth/permissions)

gateway (NestJS)
└── auth.module.ts        (新增：JWT 载荷携带 roles)
```

## 数据库变更（system-service）

### 新增 3 张表

```sql
-- 角色表
CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(32) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 权限表
CREATE TABLE permissions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,  -- e.g. "dashboard:view", "users:delete"
  name VARCHAR(64) NOT NULL,
  group_name VARCHAR(32),            -- e.g. "dashboard", "users"
  created_at TIMESTAMP DEFAULT NOW()
);

-- 角色-权限关联表
CREATE TABLE role_permissions (
  role_id INT REFERENCES roles(id),
  permission_id INT REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);
```

### 在 User 表新增字段

```sql
ALTER TABLE users ADD COLUMN role_id INT REFERENCES roles(id);
```

### 预置数据

```sql
INSERT INTO roles VALUES (1, 'admin', '超级管理员');
INSERT INTO roles VALUES (2, 'editor', '编辑者');
INSERT INTO roles VALUES (3, 'viewer', '只读用户');

INSERT INTO permissions VALUES 
  (1, 'dashboard:view', '查看看板', 'dashboard'),
  (2, 'users:view', '查看用户', 'users'),
  (3, 'users:create', '创建用户', 'users'),
  (4, 'users:edit', '编辑用户', 'users'),
  (5, 'users:delete', '删除用户', 'users'),
  (6, 'settings:view', '查看设置', 'settings'),
  (7, 'settings:edit', '修改设置', 'settings'),
  (8, 'logs:view', '查看日志', 'logs');

-- admin 拥有全部权限
INSERT INTO role_permissions (role_id, permission_id) 
  SELECT 1, id FROM permissions;
```

## 前端权限流程

```
用户登录 → JWT payload 含 { sub, username, roles }
  ↓
路由守卫 (router.beforeEach)
  ↓ 读取 route.meta.permission
  ↓ 对比 userStore.permissions
  ↓
有权限 → 渲染页面
无权限 → 403 页
```

左侧菜单过滤：
```typescript
// 菜单配置
const menuItems = [
  { key: 'dashboard', label: '工作台', icon: DashboardOutlined, permission: 'dashboard:view' },
  { key: 'users', label: '用户管理', icon: UserOutlined, permission: 'users:view' },
  { key: 'settings', label: '系统设置', icon: SettingOutlined, permission: 'settings:view' },
  // permission 为 null 的不需要权限
];

// 过滤后只显示有权限的菜单
const visibleMenus = menuItems.filter(item =>
  !item.permission || userStore.hasPermission(item.permission)
);
```

## Dashboard 数据来源

| 卡片 | 数据来源 | API |
|------|---------|-----|
| 用户总数 | user-service | `GET /users?limit=1` → total |
| 今日活跃 | auth-service | `GET /auth/stats/active-today` |
| 课程数 | 硬编码 / 后续对接 | 当前展示占位 |
| 日志数 | system-service | `GET /admin/logs?pageSize=1` → total |

ECharts 图表：暂时使用静态模拟数据，后续对接真实 API。

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `admin-web/src/layouts/BasicLayout.vue` | 重构 | 顶部菜单 → 左侧 Sider |
| `admin-web/src/views/Dashboard.vue` | 重构 | 统计卡片 + ECharts |
| `admin-web/src/views/Settings.vue` | 修改 | 对接 system-service API |
| `admin-web/src/router/index.ts` | 修改 | 加 meta.permission |
| `admin-web/src/stores/user.ts` | 修改 | 加 permissions/hasPermission |
| `admin-web/src/api/dashboard.ts` | 新增 | 看板数据 API |
| `admin-web/src/directives/permission.ts` | 新增 | v-permission 指令 |
| `auth-service/src/permission/` | 新增 | 权限模块(entity+controller) |
| `auth-service/src/user/user.entity.ts` | 修改 | 加 roleId |
| `auth-service/src/auth/auth.service.ts` | 修改 | JWT payload 加 roles |
