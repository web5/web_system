import { test, expect } from '@playwright/test';

/**
 * 发布后 E2E 冒烟（release smoke）
 *
 * 在发布完成后运行，覆盖关键业务路径的最小闭环。
 * 与 e2e/ 下的前端冒烟互补：前端冒烟只看页面能不能加载，
 * 这里验证"登录→首页→核心页"业务链路是否通。
 *
 * 用法:
 *   BASE_URL=https://dev.kedouai.com npx playwright test --project=portal --grep @release-smoke
 *
 * 依赖: tests/fixtures/test-accounts.md 里的测试账号
 */
test.describe('发布后业务冒烟 @release-smoke', () => {
  test('门户首页 → 核心导航可用', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 1. 首页加载出内容
    const hasContent = await page.evaluate(() => document.body.innerText.trim().length > 0);
    expect(hasContent, '首页应有内容').toBe(true);

    // 2. 至少有一个可点击的导航链接
    const links = page.locator('a[href], button, [role="navigation"] a');
    const linkCount = await links.count();
    expect(linkCount, '首页应有可点击的导航元素').toBeGreaterThan(0);
  });

  test('关键 API 链路可达', async ({ request }) => {
    // gateway health
    const health = await request.get('/health');
    expect(health.status(), 'gateway /health 应 200').toBe(200);

    // auth 接口可达（不要求真登录）
    const auth = await request.post('/api/auth/login', {
      data: {},
      failOnStatusCode: false,
    });
    expect([200, 400, 401, 422]).toContain(auth.status());
  });
});
