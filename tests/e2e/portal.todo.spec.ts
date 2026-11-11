import { test, expect, Page } from '@playwright/test';
import { injectFakeLogin } from '../support/auth.fixture';

/**
 * Portal Todo 页面 E2E（@regression）
 *
 * 来源：自 apps/portal/e2e/todo.spec.ts 收敛（2026-11-11，03 方案 §2.1 / S2）。
 *
 * ⚠️ 与 03 方案的偏差（重要）：03 假设「todo.spec.ts 断言体一行不动」即可收编，
 * 实测原孤岛 spec 断言的是**纯内存演示版** Todo.vue（.page-title / .stats-card /
 * .btn-complete 等选择器），而当前实现已是 **API 驱动版**
 * （@/api/todo → todo-service 后端 + TodoStats/TodoItem/TodoForm 子组件），
 * 原 18 条断言 15 条与现 UI 对不上（孤岛长期失修正是要拆它的原因）。处置：
 *
 *   describe 一「UI 骨架」：无后端可验的部分按**现实现**重写，静态伺服/CI 均可绿。
 *   describe 二「CRUD 链路」：依赖 todo-service 真后端 + 真登录态（伪 token 过不了
 *     服务端验签），整体 test.fixme() 标 BLOCKED（已知限制 W③），
 *     待按《02 用例卡规范 v2.0》填卡重写、挂本地全栈环境后逐条解除。
 *
 * 路由：/portal/todo（vue-router base=/portal/，requiresAuth → injectFakeLogin 伪 token
 * 过客户端守卫；UI 骨架层不发 API 或 API 失败有兜底，符合 auth.fixture 路径 A 前提）。
 */

async function gotoTodo(page: Page) {
  await injectFakeLogin(page);
  await page.goto('/portal/todo');
}

// ===== 一、UI 骨架（无后端可验，静态伺服/CI 绿） =====

test.describe('Todo 页面 - UI 骨架 @regression', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTodo(page);
  });

  test('页面骨架渲染：统计卡 / 筛选栏 / 搜索框 / 创建按钮', async ({ page }) => {
    // 统计卡片 4 张（总任务 / 已完成 / 进行中 / 完成率）
    await expect(page.locator('.stat-card')).toHaveCount(4);
    await expect(page.locator('.stat-label').nth(0)).toHaveText('总任务');

    // 筛选栏（状态 + 优先级两个下拉）
    await expect(page.locator('.filters-bar')).toBeVisible();
    await expect(page.locator('.filter-select')).toHaveCount(2);

    // 搜索框与创建按钮
    await expect(page.locator('.filter-search')).toBeVisible();
    await expect(page.locator('.fab-btn')).toBeVisible();
  });

  test('空态兜底：列表为空时显示空状态', async ({ page }) => {
    // 无后端时 getTodoList 失败 → todos 为空 → 空态兜底可见
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-text')).toContainText('暂无任务');
    await expect(page.locator('.empty-hint')).toContainText('创建新任务');
  });

  test('创建表单打开：字段与提交按钮完整', async ({ page }) => {
    await page.click('.fab-btn');
    await expect(page.locator('.todo-form')).toBeVisible();
    await expect(page.locator('.form-header h3')).toHaveText('创建任务');
    await expect(page.locator('.form-input[placeholder="输入任务标题..."]')).toBeVisible();
    await expect(page.locator('.form-textarea[placeholder="输入任务描述..."]')).toBeVisible();
    await expect(page.locator('.priority-btn')).toHaveCount(3);
    await expect(page.locator('.category-btn')).toHaveCount(5);
    await expect(page.locator('.btn-submit')).toHaveText('创建');
  });

  test('表单可通过取消按钮关闭', async ({ page }) => {
    await page.click('.fab-btn');
    await expect(page.locator('.todo-form')).toBeVisible();
    await page.click('.btn-cancel');
    await expect(page.locator('.todo-form')).not.toBeVisible();
  });

  test('必填校验：空标题无法提交（纯前端拦截）', async ({ page }) => {
    await page.click('.fab-btn');
    await expect(page.locator('.todo-form')).toBeVisible();
    // 不填标题直接提交：TodoForm.handleSubmit 空标题早退，表单保持打开
    await page.click('.btn-submit');
    await expect(page.locator('.todo-form')).toBeVisible();
  });
});

test.describe('Todo 页面 - 移动端骨架 @regression', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('移动端布局：筛选栏 / 创建按钮可见', async ({ page }) => {
    await gotoTodo(page);
    await expect(page.locator('.filters-bar')).toBeVisible();
    await expect(page.locator('.fab-btn')).toBeVisible();
  });

  test('移动端表单底部弹出且宽度适配', async ({ page }) => {
    await gotoTodo(page);
    await page.click('.fab-btn');
    const form = page.locator('.todo-form');
    await expect(form).toBeVisible();
    const box = await form.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(375);
  });
});

// ===== 二、CRUD 链路（BLOCKED：依赖 todo-service 真后端 + 真登录态） =====

test.describe('Todo 页面 - CRUD 链路 @regression', () => {
  test.beforeEach(async () => {
    test.fixme(
      true,
      'BLOCKED（已知限制 W③）：CRUD 依赖 todo-service 真后端与真登录态（伪 token 过不了服务端验签），' +
        '静态伺服/CI 环境不可测。待按 02 用例卡规范 v2.0 填卡重写并挂本地全栈环境后解除。',
    );
  });

  test('创建任务后出现在列表中', async () => {
    // 原孤岛用例意图保留：createTask → .todo-item count=1、标题匹配。
    // 现实现差异：走 createTodo API + TodoItem 子组件，选择器与数据流均需按卡重写。
  });

  test('创建任务后统计卡片更新', async () => {
    // 原意图：创建后 .stat-number 总数 +1（现实现 fetchStats 后端聚合）。
  });

  test('可以创建多个任务', async () => {
    // 原意图：批量创建 4 条，.todo-item count=4（现实现分页加载，需后端种子数据）。
  });

  test('标记任务完成 / 取消完成', async () => {
    // 原意图：.todo-checkbox 切换 → todo-item.completed 类 + 统计更新
    // （现实现 updateTodoStatus API，TodoItem 已无 .btn-complete）。
  });

  test('编辑任务标题', async () => {
    // 原意图：TodoItem 编辑按钮（.action-btn[title=编辑]）→ 表单预填 → 保存 → 标题更新。
  });

  test('删除任务', async () => {
    // 原意图：删除 → 空态。现实现有 confirm() 对话框（需 page.on dialog 处理）。
  });

  test('按状态 / 优先级筛选', async () => {
    // 原意图：selectOption 后列表数量正确（现实现 filters 变更触发 fetchTodos 后端过滤）。
  });

  test('搜索框过滤', async () => {
    // 原意图：关键词过滤列表（现实现 debounceSearch → 后端 keyword 查询）。
  });
});
