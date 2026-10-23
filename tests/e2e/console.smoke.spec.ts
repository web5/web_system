import { test, expect } from '@playwright/test';

/**
 * deploy-console 控制台冒烟测试（@smoke）
 *
 * 覆盖：控制台页面加载 → API 存活 → 前端资源完整。
 * 默认连 http://localhost:6200，用 CONSOLE_URL 环境变量覆盖。
 */
test.describe('Console 冒烟 @smoke', () => {
  test('控制台页面可加载', async ({ page }) => {
    const resp = await page.goto('/console/');
    expect(resp?.status()).toBe(200);
  });

  test('API 存活（/api/apps 返回 200|401）', async ({ request }) => {
    const resp = await request.get('/api/apps');
    // 200 = 已鉴权/放行, 401 = 存活待鉴权
    expect([200, 401]).toContain(resp.status());
  });

  test('前端资源完整', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', (resp) => {
      if (resp.status() >= 400) {
        failed.push(`${resp.status()} ${resp.url()}`);
      }
    });
    await page.goto('/console/');
    await page.waitForLoadState('networkidle');
    // 只检查同源资源（外部 CDN 可能 429 等，不算发布失败）
    const localFailed = failed.filter((f) => f.includes('localhost') || f.includes('127.0.0.1'));
    expect(localFailed, `本地资源加载失败: ${localFailed.join(', ')}`).toHaveLength(0);
  });
});
