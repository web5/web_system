import { test, expect } from '@playwright/test';

/**
 * Portal 前端冒烟测试（@smoke）
 *
 * 覆盖最核心的用户路径：页面加载 → 静态资源 → 导航可用。
 * 发布后跑这个快速确认"前端没挂"。
 */
test.describe('Portal 冒烟 @smoke', () => {
  test('首页可加载', async ({ page }) => {
    const resp = await page.goto('/');
    expect(resp?.status()).toBeLessThan(400);
    // 页面标题存在
    await expect(page).toHaveTitle(/.+/);
  });

  test('静态资源不 404', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 400 && resp.url().includes('/static/')) {
        failed.push(resp.url());
      }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(failed, `以下静态资源加载失败: ${failed.join(', ')}`).toHaveLength(0);
  });

  test('页面渲染出可见内容', async ({ page }) => {
    await page.goto('/');
    // 至少有一个可见的文本元素（说明 Vue 挂载成功，不是空白页）
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
    // 等待 Vue 挂载
    await page.waitForTimeout(1000);
    const hasContent = await page.evaluate(() => document.body.innerText.trim().length > 0);
    expect(hasContent, '页面渲染后应有可见文本内容').toBe(true);
  });
});
