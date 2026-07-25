# Todo List 端到端测试

## 测试方式

本项目支持两种端到端测试方式：

### 方式一：Playwright CLI（推荐，交互式）

使用 `playwright-cli` 命令行工具进行交互式浏览器测试，适合快速验证和调试。

```bash
# 1. 确保前端服务器已启动
npm run dev

# 2. 在另一个终端运行测试脚本
bash e2e/todo-playwright-cli.sh
```

### 方式二：Playwright Test（自动化）

使用 `@playwright/test` 编写标准测试用例，适合 CI/CD 集成。

```bash
# 安装依赖（如果尚未安装）
npm install -D @playwright/test

# 安装浏览器
npx playwright install

# 运行所有测试
npx playwright test

# 运行特定测试文件
npx playwright test e2e/todo.spec.ts

# 运行特定浏览器（桌面 Chrome）
npx playwright test --project=chromium

# 运行移动端测试
npx playwright test --project="Mobile Chrome"

# 查看测试报告
npx playwright show-report
```

## 测试覆盖范围

| 测试场景 | 说明 | 优先级 |
|---------|------|--------|
| 页面加载 | 检查标题、统计卡片、筛选栏、创建按钮 | P0 |
| 创建任务 | 打开表单、填写信息、提交、验证列表更新 | P0 |
| 任务状态 | 标记完成、取消完成、验证统计更新 | P0 |
| 编辑任务 | 打开编辑、修改内容、保存、验证更新 | P0 |
| 删除任务 | 删除任务、验证列表更新 | P0 |
| 筛选功能 | 按状态筛选、按优先级筛选 | P1 |
| 搜索功能 | 关键词搜索、实时过滤 | P1 |
| 移动端适配 | 375px 宽度布局、表单弹出、触摸操作 | P0 |
| 表单验证 | 必填验证、输入框清晰度 | P0 |

## 测试截图

测试过程中会自动保存截图到 `e2e/screenshots/` 目录：

| 文件名 | 说明 |
|-------|------|
| 01-page-loaded.png | 页面初始加载 |
| 02-form-opened.png | 创建表单打开 |
| 03-form-filled.png | 表单填写完成 |
| 04-task-created.png | 任务创建成功 |
| 05-task-completed.png | 任务标记完成 |
| 06-filter-completed.png | 筛选已完成的任务 |
| 07-search-result.png | 搜索结果 |
| 08-mobile-view.png | 移动端视图 |
| 09-mobile-form.png | 移动端表单 |
| 10-text-visibility.png | 输入框文字清晰度 |
| 11-desktop-view.png | 桌面视图恢复 |
| 12-task-deleted.png | 任务删除后 |

## 测试环境要求

- Node.js >= 18
- 前端服务器运行在 http://localhost:5173
- Todo Service 运行在 http://localhost:3005
- MySQL 数据库运行（Docker 或本地）

## 常见问题

### 1. 测试超时

如果前端服务器启动较慢，可以增加等待时间或调整脚本中的 `sleep` 值。

### 2. 元素选择器失效

如果 UI 发生变化，需要更新 `e2e/todo.spec.ts` 和 `e2e/todo-playwright-cli.sh` 中的选择器。

### 3. 数据库连接失败

确保 MySQL 正在运行：

```bash
# 使用 Docker 启动 MySQL
docker start web-system-mysql
```

### 4. 端口冲突

如果 5173 或 3005 端口被占用，可以修改 `.env` 文件和 `playwright.config.ts` 中的端口配置。

## CI/CD 集成

在 GitHub Actions 中运行测试：

```yaml
name: E2E Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npx playwright install
      - run: npx playwright test
```
