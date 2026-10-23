import { test, expect } from '@playwright/test';

/**
 * Admin 管理后台冒烟测试（@smoke）
 *
 * 覆盖：页面加载 → 登录页/受控页可达 → 静态资源完整。
 * 未登录时重定向到登录页是正常行为。
 */
test.describe('Admin 冒烟 @smoke', () => {
  test('管理后台入口可加载', async ({ page }) => {
    const resp = await page.goto('/admin/');
    // 200 或 302/401 到登录页都算正常（未登录受保护）
    expect(resp?.status()).toBeLessThan(500);
  });

  test('静态资源不 404', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 400 && resp.url().includes('/static/')) {
        failed.push(resp.url());
      }
    });
    await page.goto('/admin/');
    await page.waitForLoadState('networkidle');
    expect(failed, `以下静态资源加载失败: ${failed.join(', ')}`).toHaveLength(0);
  });

  test('登录页渲染正常', async ({ page }) => {
    await page.goto('/admin/');
    await page.waitForLoadState('networkidle');
    // 应渲染出表单或页面内容（不是白屏）
    const hasContent = await page.evaluate(() => document.body.innerText.trim().length > 0);
    expect(hasContent, 'Admin 页面应有可见内容').toBe(true);
  });
});
