/**
 * tests/support/env.ts — E2E 环境解析单一真源
 *
 * 职责：
 *   1. 加载 tests/fixtures/.env.test（不入库，模板见 fixtures/test-accounts.md）。
 *      消除「模板有了但没人加载」的断链（03 方案 §2.2）。
 *   2. 统一解析 BASE_URL / CONSOLE_URL，优先级：环境变量 > .env.test > 默认值。
 *
 * 纪律：选择器/账号/URL 只允许从这里或 fixtures/test-accounts.md 出，禁止在 spec 里硬编码。
 */
import * as path from 'node:path';
import { config as loadDotenv } from 'dotenv';

// override: false —— 显式环境变量优先于 .env.test 文件
loadDotenv({ path: path.resolve(__dirname, '../fixtures/.env.test'), override: false });

/**
 * portal / admin / mobile-portal / release 的基地址。
 * 默认走本机 envoy 前门 https://local.kedouai.com（→ gateway :6000）。
 * ⚠️ 不要指 http://localhost:6000：6000 在 Chromium 受限端口清单（ERR_UNSAFE_PORT），
 *    浏览器导航直接失败——这是「gateway 在 6000 但 e2e 默认不能打 6000」的原因。
 */
export const BASE_URL = process.env.BASE_URL || 'https://local.kedouai.com';

/** deploy-console 的基地址 */
export const CONSOLE_URL = process.env.CONSOLE_URL || 'http://localhost:6200';

/** 测试账号（真实登录用；来源见 fixtures/test-accounts.md） */
export const TEST_USER_NAME = process.env.TEST_USER_NAME || 'testuser';
export const TEST_USER_PASS = process.env.TEST_USER_PASS || '';

/** project 名 → 该 project 依赖的基地址（preflight 按此映射探测） */
export const PROJECT_URLS: Record<string, string> = {
  portal: BASE_URL,
  admin: BASE_URL,
  'mobile-portal': BASE_URL,
  release: BASE_URL,
  console: CONSOLE_URL,
};
