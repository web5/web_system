/**
 * sensitive-config 单测 —— 三路径覆盖：
 *   1. config_items 缓存优先（db 优先路径）
 *   2. process.env 兜底（env 兜底路径）
 *   3. 缓存空 + env 空 → 空串（降级路径，DB 挂不崩）
 */
import {
  getSensitiveConfig,
  primeSensitiveConfig,
  resetSensitiveConfigCache,
  SENSITIVE_CONFIG_KEYS,
} from './sensitive-config';

describe('sensitive-config', () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    resetSensitiveConfigCache();
    // 清理 5 键的 env 值，避免测试间污染
    for (const k of SENSITIVE_CONFIG_KEYS) delete process.env[k];
  });

  afterAll(() => {
    // 恢复原始 env
    for (const k of SENSITIVE_CONFIG_KEYS) {
      if (ORIG_ENV[k] !== undefined) process.env[k] = ORIG_ENV[k];
      else delete process.env[k];
    }
    resetSensitiveConfigCache();
  });

  describe('路径 1：config_items 缓存优先', () => {
    it('primeSensitiveConfig 灌入缓存后，getSensitiveConfig 返回缓存值', () => {
      primeSensitiveConfig({ INTERNAL_API_KEY: 'db-secret-key-123' });
      expect(getSensitiveConfig('INTERNAL_API_KEY')).toBe('db-secret-key-123');
    });

    it('缓存值优先于 process.env（即使 env 也有值）', () => {
      process.env.INTERNAL_API_KEY = 'env-value';
      primeSensitiveConfig({ INTERNAL_API_KEY: 'db-value' });
      expect(getSensitiveConfig('INTERNAL_API_KEY')).toBe('db-value');
    });

    it('JWT_SECRET 缓存值正确返回', () => {
      primeSensitiveConfig({ JWT_SECRET: 'jwt-from-db' });
      expect(getSensitiveConfig('JWT_SECRET')).toBe('jwt-from-db');
    });
  });

  describe('路径 2：process.env 兜底', () => {
    it('缓存为空时，返回 process.env 值', () => {
      process.env.INTERNAL_API_KEY = 'env-fallback-key';
      expect(getSensitiveConfig('INTERNAL_API_KEY')).toBe('env-fallback-key');
    });

    it('缓存值为空串时，也走 env 兜底', () => {
      primeSensitiveConfig({ INTERNAL_API_KEY: '' }); // 空串不进缓存
      process.env.INTERNAL_API_KEY = 'env-value-when-empty-cache';
      expect(getSensitiveConfig('INTERNAL_API_KEY')).toBe('env-value-when-empty-cache');
    });

    it('【影子风险】config_items 空串视为未配置，不把 env 值影子掉', () => {
      // 模拟库实测场景：ADMIN_PASS / RUN_TOKEN_SECRET 三条 value 长度=0（空串占位）
      primeSensitiveConfig({ ADMIN_PASS: '', RUN_TOKEN_SECRET: '' });
      process.env.ADMIN_PASS = 'env-admin-pass';
      process.env.RUN_TOKEN_SECRET = 'env-run-token-secret';
      // 空串必须视为未配置 → 继续走 process.env 兜底，不能返回 '' 影子掉 env 值
      expect(getSensitiveConfig('ADMIN_PASS')).toBe('env-admin-pass');
      expect(getSensitiveConfig('RUN_TOKEN_SECRET')).toBe('env-run-token-secret');
    });

    it('缓存中只灌了部分键，未灌的键走 env 兜底', () => {
      primeSensitiveConfig({ JWT_SECRET: 'db-jwt' });
      process.env.INTERNAL_API_KEY = 'env-internal';
      expect(getSensitiveConfig('JWT_SECRET')).toBe('db-jwt');
      expect(getSensitiveConfig('INTERNAL_API_KEY')).toBe('env-internal');
    });
  });

  describe('路径 3：降级（DB 挂 + env 空）', () => {
    it('缓存空 + env 空 → 返回空串，不抛错', () => {
      expect(getSensitiveConfig('RELEASE_HOOK_SECRET')).toBe('');
    });

    it('全部 5 键在无缓存无 env 时均返回空串', () => {
      for (const key of SENSITIVE_CONFIG_KEYS) {
        expect(getSensitiveConfig(key)).toBe('');
      }
    });

    it('缓存有值但 env 被删 → 仍返回缓存值（降级后不丢数据）', () => {
      primeSensitiveConfig({ RUN_TOKEN_SECRET: 'cached-run-secret' });
      delete process.env.RUN_TOKEN_SECRET;
      expect(getSensitiveConfig('RUN_TOKEN_SECRET')).toBe('cached-run-secret');
    });
  });

  describe('resetSensitiveConfigCache', () => {
    it('清空缓存后重新走 env 兜底', () => {
      primeSensitiveConfig({ ADMIN_PASS: 'db-pass' });
      expect(getSensitiveConfig('ADMIN_PASS')).toBe('db-pass');
      resetSensitiveConfigCache();
      process.env.ADMIN_PASS = 'env-pass';
      expect(getSensitiveConfig('ADMIN_PASS')).toBe('env-pass');
    });
  });
});
