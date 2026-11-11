const assert = require('node:assert/strict');
const path = require('node:path');
const { afterEach, beforeEach, test } = require('node:test');

const configPath = path.resolve(__dirname, 'ecosystem.config.js');
const envKeys = ['WEB_SYSTEM_DIR', 'ENV_FILE', 'JWT_SECRET', 'REDIS_URL'];
let originalEnv;

beforeEach(() => {
  originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  delete require.cache[configPath];
  process.env.WEB_SYSTEM_DIR = '/tmp/web-system-redis-auth-test';
  process.env.ENV_FILE = '/tmp/web-system-redis-auth-test/no-real-env';
  process.env.JWT_SECRET = 'test-only-jwt-secret';
  // 对立假值：若根环境仍参与取值，它一定会泄进 app env，测试即可抓住。
  process.env.REDIS_URL = 'redis://root-env-must-not-leak.invalid:6379';
});

afterEach(() => {
  delete require.cache[configPath];
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('V1：根 Redis 环境不向任何 PM2 app 注入', () => {
  const config = require(configPath);

  assert.ok(config.apps.length > 0);
  for (const app of config.apps) {
    assert.equal(
      Object.hasOwn(app.env || {}, 'REDIS_URL'),
      false,
      `${app.name} 不应包含 REDIS_URL`,
    );
  }
});

test('V1：auth 保留 DB 注入，但 Redis 不再混入 baseDbConfig', () => {
  const config = require(configPath);
  const auth = config.apps.find((app) => app.name === 'auth-service');

  assert.ok(auth);
  assert.equal(auth.env.DB_TYPE, 'mysql');
  assert.equal(Object.hasOwn(auth.env, 'REDIS_URL'), false);
});
