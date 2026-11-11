/**
 * tests/support/auth.fixture.ts — 登录态复用（storageState 模式，03 方案 §2.2）
 *
 * 两条路径，按用例依赖选：
 *
 *   A. injectFakeLogin(page) —— 伪 token 过前端路由守卫。
 *      portal 的路由守卫只做客户端 JWT exp 解码（apps/portal/src/router/index.ts
 *      isTokenExpired，不验签名），因此对「页面无后端 API 依赖」的用例（如
 *      portal.todo，Todo.vue 纯内存实现）可以直接预置伪 token，免去真登录。
 *      🔴 前提：被测页面不发真实 API 请求；发了就会 401，请走路径 B。
 *
 *   B. loginViaApi(request) —— 真登录拿真 token（@release-smoke 等业务链路）。
 *      账号来自 tests/fixtures/.env.test（TEST_USER_NAME / TEST_USER_PASS），
 *      文档真源 fixtures/test-accounts.md。缺账号时抛带指引的错误。
 *
 * 为什么不走「每个 spec 自己点登录 UI」：登录表单是慢路径且与被测功能无关，
 * storageState / addInitScript 预置是 Playwright 官方推荐模式，用例间仍各自
 * 独立 context（隔离原则与小程序线 session.js 语义对齐）。
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { TEST_USER_NAME, TEST_USER_PASS } from './env';

/** portal pinia persistedstate 的 localStorage key（stores/user.ts getStoredToken 的事实源） */
const USER_STORE_KEY = 'user-store';

/** 构造一个 exp 在 1 小时后的未签名 JWT（只过客户端 isTokenExpired 解码） */
export function buildFakeToken(): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64url({ alg: 'none', typ: 'JWT' });
  const payload = b64url({ sub: 'e2e-fake-user', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${header}.${payload}.e2e`;
}

/**
 * 路径 A：在页面脚本执行前预置已登录 localStorage（伪 token）。
 * 用法：test.beforeEach 里先 await injectFakeLogin(page)，再 page.goto(...)。
 */
export async function injectFakeLogin(page: Page): Promise<void> {
  const state = JSON.stringify({
    token: buildFakeToken(),
    refreshToken: 'e2e-fake-refresh',
    userInfo: { id: 'e2e', username: 'e2e-fake-user' },
  });
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [USER_STORE_KEY, state],
  );
}

/**
 * 路径 B：真登录，返回可写入 localStorage 的 user-store 值。
 * 调用方自行 injectFakeLogin 同款 addInitScript 或走 context storageState。
 * 缺测试账号时 FAIL-fast 并给出指引（不要静默降级成伪 token——业务链路必须真）。
 */
export async function loginViaApi(request: APIRequestContext): Promise<{ token: string; refreshToken: string }> {
  if (!TEST_USER_PASS) {
    throw new Error(
      '缺少测试账号：请按 tests/fixtures/test-accounts.md 创建 tests/fixtures/.env.test ' +
        '并填入 TEST_USER_NAME / TEST_USER_PASS（业务链路用例不接受伪 token）',
    );
  }
  const resp = await request.post('/api/auth/login', {
    data: { username: TEST_USER_NAME, password: TEST_USER_PASS },
  });
  if (!resp.ok()) {
    throw new Error(`测试账号登录失败：HTTP ${resp.status()} ${await resp.text()}`);
  }
  const body = await resp.json();
  const token = body?.data?.token ?? body?.token;
  const refreshToken = body?.data?.refreshToken ?? body?.refreshToken ?? '';
  if (!token) throw new Error(`登录响应缺少 token 字段：${JSON.stringify(body).slice(0, 200)}`);
  return { token, refreshToken };
}
