import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';
import { BASE_URL, CONSOLE_URL } from './support/env';

/**
 * Playwright 多 project 配置（web_system 统一 E2E 唯一入口）
 *
 * 🔴 红线：禁止再开独立 playwright.config（apps 下自治孤岛已随 portal 收敛拆除，
 *    见 tests/README.md）。新前端入口 = 在本文件 projects 加一行 + spec 命名
 *    `<app>.<suite>.spec.ts`。
 *
 * projects：
 *   - portal / admin / mobile-portal / console: 前端入口（gateway :6000 / console :6200）
 *   - release: tests/smoke/release-smoke.spec.ts（@release-smoke，发布后业务链路）
 *
 * 标签三级（03 方案 §2.2）：
 *   @smoke          页面能开（PR 门禁，CI quality-gate e2e-smoke job）
 *   @release-smoke  关键链路（发布后，连真实环境）
 *   @regression     功能面（如 portal.todo，按需/定时）
 *
 * 用法:
 *   pnpm test:e2e                                    # 全部
 *   pnpm test:e2e --project=portal                   # 单个 project
 *   pnpm test:e2e --grep @smoke                      # 仅冒烟
 *   BASE_URL=https://dev.kedouai.com pnpm test:e2e --grep @release-smoke
 *
 * 环境变量（tests/support/env.ts 统一解析，.env.test 自动加载）:
 *   BASE_URL      覆盖默认 baseURL（默认 https://local.kedouai.com；
 *                 ⚠️ 勿指 http://localhost:6000，6000 是 Chromium 受限端口）
 *   CONSOLE_URL   覆盖 console baseURL（默认 http://localhost:6200）
 *   E2E_WEBSERVER 设为 1 时由 Playwright 自起 tests/support/static-server.mjs
 *                 （无后端静态伺服 portal/admin 构建产物，CI @smoke 与本地轻量验证用）
 */

const staticServerPort = (() => {
  try {
    return Number(new URL(BASE_URL).port) || 8899;
  } catch {
    return 8899;
  }
})();

export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // 产物目录钉死在 tests/ 下（与 cwd 无关），由 tests/.gitignore 兜底不入仓
  outputDir: path.join(__dirname, 'test-results'),
  reporter: process.env.CI ? [['html', { outputFolder: path.join(__dirname, 'playwright-report') }], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    // 代理加固：本地 e2e 流量纯本地，强制禁系统代理。
    // 背景：Chromium 默认跟随系统代理，macOS 豁免名单不含 local.kedouai.com，
    // 系统代理开启时域名路径会被发给代理服务器（ERR_PROXY_CONNECTION_FAILED /
    // ERR_TUNNEL_CONNECTION_FAILED），且 preflight TCP 探测不走代理 → 出现
    // 「preflight 绿但导航全挂」假象。实测证据见 tests/README.md 已知限制节。
    launchOptions: { args: ['--no-proxy-server'] },
  },
  // 仅在显式要求时自起静态伺服（本地全栈/连 dev 时不抢戏）
  ...(process.env.E2E_WEBSERVER === '1'
    ? {
        webServer: {
          // 注意：webServer 的 cwd 是本配置文件所在目录（tests/）
          command: `node support/static-server.mjs --port ${staticServerPort}`,
          url: `${BASE_URL}/portal/`,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      }
    : {}),
  projects: [
    {
      name: 'portal',
      testMatch: /e2e\/portal\..*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: BASE_URL },
    },
    {
      name: 'admin',
      testMatch: /e2e\/admin\..*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: BASE_URL },
    },
    {
      name: 'console',
      testMatch: /e2e\/console\..*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: CONSOLE_URL,
      },
    },
    {
      name: 'mobile-portal',
      testMatch: /e2e\/portal\.mobile\..*\.spec\.ts/,
      use: { ...devices['Pixel 5'], baseURL: BASE_URL },
    },
    {
      name: 'release',
      testMatch: /smoke\/release-smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: BASE_URL },
    },
  ],
});
