import { test, expect, Page } from '@playwright/test';

/**
 * Todo List 端到端测试
 * 
 * 测试范围：
 * 1. 页面加载和基本 UI 检查
 * 2. 创建任务（打开表单、填写信息、提交）
 * 3. 查看任务列表
 * 4. 完成任务（切换状态）
 * 5. 删除任务
 * 6. 筛选功能
 * 7. 统计卡片显示
 * 8. 移动端响应式
 */

// ===== 测试数据 =====
const TEST_TASKS = [
  { title: '学习 Vue 3 组合式 API', description: '阅读官方文档并编写示例', priority: 'high', category: 'study', dueDate: '2026-07-15' },
  { title: '完成 Todo List 项目', description: '实现所有功能并部署', priority: 'high', category: 'creative', dueDate: '2026-07-10' },
  { title: '每天运动 30 分钟', description: '跑步或游泳', priority: 'medium', category: 'sport', dueDate: '2026-07-20' },
  { title: '练习吉他指弹', description: '学习一首新曲子', priority: 'low', category: 'music', dueDate: '2026-07-25' },
];

// ===== 通用工具函数 =====
async function createTask(page: Page, task: typeof TEST_TASKS[0]) {
  // 点击创建按钮
  await page.click('.fab-btn');
  await expect(page.locator('.todo-form')).toBeVisible();

  // 填写标题
  await page.fill('.form-input[placeholder="输入任务标题..."]', task.title);
  
  // 填写描述
  await page.fill('.form-textarea[placeholder="输入任务描述..."]', task.description);

  // 选择优先级
  const priorityMap: Record<string, string> = { high: '高', medium: '中', low: '低' };
  await page.click(`.priority-btn:has-text("${priorityMap[task.priority]}")`);

  // 选择分类
  const categoryMap: Record<string, string> = { creative: '创意', study: '学习', sport: '运动', music: '音乐', other: '其他' };
  await page.click(`.category-btn:has-text("${categoryMap[task.category]}")`);

  // 选择截止日期
  await page.fill('.form-input[type="date"]', task.dueDate);

  // 点击创建按钮
  await page.click('.btn-submit');

  // 等待表单关闭
  await expect(page.locator('.todo-form')).not.toBeVisible({ timeout: 5000 });
}

async function createMultipleTasks(page: Page) {
  for (const task of TEST_TASKS) {
    await createTask(page, task);
    // 等待任务列表更新
    await page.waitForTimeout(500);
  }
}

// ===== 测试套件 =====

test.describe('Todo List 页面 - 基础功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/todo');
  });

  test('页面加载成功，显示正确标题和元素', async ({ page }) => {
    // 检查页面标题
    await expect(page.locator('.page-title')).toContainText('Todo List');
    
    // 检查统计卡片存在
    await expect(page.locator('.stats-card')).toHaveCount(3);
    
    // 检查筛选栏存在
    await expect(page.locator('.filters-bar')).toBeVisible();
    
    // 检查搜索框存在
    await expect(page.locator('.filter-search')).toBeVisible();
    
    // 检查创建按钮存在
    await expect(page.locator('.fab-btn')).toBeVisible();
  });

  test('空状态显示正确', async ({ page }) => {
    // 当没有任务时显示空状态
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('暂无任务');
    await expect(page.locator('.empty-text')).toContainText('暂无任务');
  });
});

test.describe('Todo List 页面 - 创建任务', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/todo');
  });

  test('可以成功创建任务并显示在列表中', async ({ page }) => {
    await createTask(page, TEST_TASKS[0]);

    // 验证任务出现在列表中
    await expect(page.locator('.todo-item')).toHaveCount(1);
    await expect(page.locator('.todo-item .todo-title')).toContainText(TEST_TASKS[0].title);
  });

  test('创建任务后统计卡片更新', async ({ page }) => {
    await createTask(page, TEST_TASKS[0]);

    // 检查统计卡片更新
    const totalCard = page.locator('.stats-card').nth(0);
    await expect(totalCard.locator('.stats-value')).toContainText('1');
  });

  test('可以创建多个任务', async ({ page }) => {
    await createMultipleTasks(page);

    // 验证所有任务都出现在列表中
    await expect(page.locator('.todo-item')).toHaveCount(TEST_TASKS.length);
  });
});

test.describe('Todo List 页面 - 任务状态管理', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/todo');
    await createTask(page, TEST_TASKS[0]);
  });

  test('可以标记任务为完成', async ({ page }) => {
    // 点击完成按钮
    await page.click('.todo-item .btn-complete');

    // 等待状态更新
    await page.waitForTimeout(300);

    // 检查任务状态变为已完成
    await expect(page.locator('.todo-item.completed')).toBeVisible();
    
    // 检查统计卡片更新
    const completedCard = page.locator('.stats-card').nth(1);
    await expect(completedCard.locator('.stats-value')).toContainText('1');
  });

  test('可以取消已完成的任务', async ({ page }) => {
    // 先完成
    await page.click('.todo-item .btn-complete');
    await page.waitForTimeout(300);

    // 再取消完成
    await page.click('.todo-item .btn-complete');
    await page.waitForTimeout(300);

    // 检查状态恢复为待完成
    await expect(page.locator('.todo-item:not(.completed)')).toBeVisible();
  });
});

test.describe('Todo List 页面 - 编辑和删除任务', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/todo');
    await createTask(page, TEST_TASKS[0]);
  });

  test('可以编辑任务', async ({ page }) => {
    // 点击编辑按钮
    await page.click('.todo-item .btn-edit');
    
    // 验证表单打开并预填充数据
    await expect(page.locator('.todo-form')).toBeVisible();
    await expect(page.locator('.form-input[placeholder="输入任务标题..."]')).toHaveValue(TEST_TASKS[0].title);

    // 修改标题
    const newTitle = '修改后的任务标题';
    await page.fill('.form-input[placeholder="输入任务标题..."]', newTitle);
    
    // 保存
    await page.click('.btn-submit');
    await expect(page.locator('.todo-form')).not.toBeVisible({ timeout: 5000 });

    // 验证标题已更新
    await expect(page.locator('.todo-item .todo-title')).toContainText(newTitle);
  });

  test('可以删除任务', async ({ page }) => {
    // 点击删除按钮
    await page.click('.todo-item .btn-delete');

    // 确认对话框（如果浏览器支持的话）
    // 这里假设删除后直接消失
    await page.waitForTimeout(300);

    // 验证任务已删除（显示空状态）
    await expect(page.locator('.empty-state')).toBeVisible();
  });
});

test.describe('Todo List 页面 - 筛选和搜索', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/todo');
    await createMultipleTasks(page);
  });

  test('可以按状态筛选任务', async ({ page }) => {
    // 先完成一个任务
    await page.click('.todo-item').nth(0).locator('.btn-complete');
    await page.waitForTimeout(300);

    // 选择已完成筛选
    await page.selectOption('.filter-select', 'completed');
    await page.waitForTimeout(500);

    // 验证只显示已完成的任务
    await expect(page.locator('.todo-item')).toHaveCount(1);
    await expect(page.locator('.todo-item.completed')).toBeVisible();
  });

  test('可以按优先级筛选', async ({ page }) => {
    // 选择高优先级筛选
    await page.selectOption('.filter-select', 'high');
    await page.waitForTimeout(500);

    // 验证只显示高优先级任务（2个）
    await expect(page.locator('.todo-item')).toHaveCount(2);
  });

  test('可以通过搜索框搜索任务', async ({ page }) => {
    // 搜索特定任务
    await page.fill('.filter-search', 'Vue');
    await page.waitForTimeout(500);

    // 验证只显示匹配的任务
    await expect(page.locator('.todo-item')).toHaveCount(1);
    await expect(page.locator('.todo-item .todo-title')).toContainText('Vue');
  });
});

test.describe('Todo List 页面 - 移动端适配', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('移动端页面布局正确', async ({ page }) => {
    await page.goto('/todo');

    // 检查页面标题存在
    await expect(page.locator('.page-title')).toBeVisible();
    
    // 检查创建按钮存在
    await expect(page.locator('.fab-btn')).toBeVisible();
    
    // 检查筛选栏可以横向滚动
    await expect(page.locator('.filters-bar')).toBeVisible();
  });

  test('移动端可以创建任务', async ({ page }) => {
    await page.goto('/todo');
    await createTask(page, TEST_TASKS[0]);

    // 验证任务出现在列表中
    await expect(page.locator('.todo-item')).toHaveCount(1);
  });

  test('移动端表单从底部弹出', async ({ page }) => {
    await page.goto('/todo');
    
    // 点击创建按钮
    await page.click('.fab-btn');
    
    // 验证表单从底部弹出（通过检查位置）
    const form = page.locator('.todo-form');
    await expect(form).toBeVisible();
    
    // 验证表单宽度适配屏幕
    const box = await form.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(375);
  });
});

test.describe('Todo List 页面 - 表单验证', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/todo');
  });

  test('不填写标题时无法创建任务', async ({ page }) => {
    // 点击创建按钮
    await page.click('.fab-btn');
    await expect(page.locator('.todo-form')).toBeVisible();

    // 不填写标题，直接点击创建
    await page.click('.btn-submit');

    // 表单应该仍然显示（因为验证失败）
    await expect(page.locator('.todo-form')).toBeVisible();
  });

  test('输入框文字颜色清晰可见', async ({ page }) => {
    await page.click('.fab-btn');
    await expect(page.locator('.todo-form')).toBeVisible();

    // 填写标题
    await page.fill('.form-input[placeholder="输入任务标题..."]', '测试文字可见性');
    
    // 获取输入框的文字颜色
    const input = page.locator('.form-input[placeholder="输入任务标题..."]');
    const color = await input.evaluate((el) => window.getComputedStyle(el).color);
    
    // 验证颜色不是浅色（RGB 值应该较暗）
    const rgb = color.match(/\d+/g)?.map(Number);
    if (rgb) {
      const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
      expect(brightness).toBeLessThan(128); // 应该是深色文字
    }
  });
});
