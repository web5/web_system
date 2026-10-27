/**
 * 敏感凭据读取层 —— config_items 解密优先 → process.env 兜底，DB 挂安静降级。
 *
 * #349 迁移背景：deploy-console 的 5 个敏感凭据（ADMIN_PASS / JWT_SECRET /
 * INTERNAL_API_KEY / RELEASE_HOOK_SECRET / RUN_TOKEN_SECRET）从 .env 迁到
 * config_items（scope=module, module_key=deploy-console, deliverable=0）。
 *
 * 为什么单独一层而不直接读 process.env：
 *   1. 语义明确：消费点不需要知道值是来自 config_items 还是 .env，统一走本模块；
 *   2. 运行时可刷新：配置中心改值后（重启场景），bootstrap 已合并到 process.env，
 *      本模块的缓存层允许后续扩展为「定时刷新」而不改消费点；
 *   3. 降级安全：DB 不可用时静默回落 process.env（即 .env 兜底值），不崩溃。
 *
 * 使用方式：
 *   - 启动时（bootstrap 之后）调用 {@link primeSensitiveConfig} 预热缓存；
 *   - 消费点调用 {@link getSensitiveConfig} 读值。
 *
 * 🔴 不迁：CONFIG_MASTER_KEY / MYSQL_* / REDIS_* / SSH 凭据 / HOME / PATH
 *   —— 引导凭据鸡生蛋，必须留 .env（见 RESERVED_LOCAL_KEYS / PROTECTED_ENV_KEYS）。
 */
import { Logger } from '@nestjs/common';

const logger = new Logger('SensitiveConfig');

/**
 * 需要走本读取层的 5 个敏感凭据键。
 * 判据：盘点清单 P0（deploy-console配置读取盘点清单.md §建议迁移优先级）。
 */
export const SENSITIVE_CONFIG_KEYS = [
  'ADMIN_PASS',
  'JWT_SECRET',
  'INTERNAL_API_KEY',
  'RELEASE_HOOK_SECRET',
  'RUN_TOKEN_SECRET',
] as const;

export type SensitiveConfigKey = (typeof SENSITIVE_CONFIG_KEYS)[number];

/** 缓存：config_items 解密后的值（bootstrap 预热填充） */
const cache = new Map<string, string>();

/**
 * 预热缓存：把 config_items 解密后的键值对灌入。
 * 由 bootstrap 的 {@code applyToProcessEnv} 之后调用。
 *
 * @param values config_items 解密后的键值对（仅 5 键）
 */
export function primeSensitiveConfig(values: Record<string, string>): void {
  for (const key of SENSITIVE_CONFIG_KEYS) {
    const v = values[key];
    if (v !== undefined && v !== '') {
      cache.set(key, v);
    }
  }
  logger.log(`敏感凭据缓存预热完成：${[...cache.keys()].join('、')}`);
}

/**
 * 读取敏感配置值。
 *
 * 取值链（高 → 低）：
 *   1. 缓存（config_items 解密值，由 primeSensitiveConfig 填充）
 *   2. process.env（.env 兜底值，含 bootstrap 合并结果）
 *
 * DB 不可用时（缓存为空、process.env 有值）自动走 .env 兜底，不抛错。
 *
 * @param key 配置键名
 * @returns 配置值；均无时返回空串
 */
export function getSensitiveConfig(key: SensitiveConfigKey): string {
  // 1. config_items 缓存优先
  const cached = cache.get(key);
  if (cached !== undefined && cached !== '') {
    return cached;
  }
  // 2. process.env 兜底（.env 或 bootstrap 合并值）
  return process.env[key] || '';
}

/** 仅测试用：清空缓存 */
export function resetSensitiveConfigCache(): void {
  cache.clear();
}
