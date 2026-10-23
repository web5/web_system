import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 多 project 配置（web_system 统一 E2E 入口）
 *
 * 三个 project 对应三个前端入口：
 *   - portal:   门户前端（微前端模块）
 *   - admin:    管理后台（微前端模块）
 *   - console:  deploy-console 控制台
 *
 * 用法:
 *   npx playwright test                          # 全部
 *   npx playwright test --project=portal         # 单个 project
 *   npx playwright test --project=admin --grep @smoke  # 仅冒烟
 *
 * 环境变量:
 *   BASE_URL  覆盖默认 baseURL（如 https://dev.kedouai.com）
 */
const BASE = process.env.BASE_URL || 'http://localhost:6000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'portal',
      testMatch: /portal\..*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: BASE },
    },
    {
      name: 'admin',
      testMatch: /admin\..*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: BASE },
    },
    {
      name: 'console',
      testMatch: /console\..*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.CONSOLE_URL || 'http://localhost:6200',
      },
    },
    {
      name: 'mobile-portal',
      testMatch: /portal\.mobile\..*\.spec\.ts/,
      use: { ...devices['Pixel 5'], baseURL: BASE },
    },
  ],
});
