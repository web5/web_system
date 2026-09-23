export { API_TIMEOUT } from './api';

// 后端服务地址默认值（唯一真相源，禁止各服务自行硬编码端口）
export {
  SERVICE_URL_DEFAULTS,
  REQUIRED_SERVICE_URLS_IN_PROD,
  missingRequiredServiceUrls,
  serviceUrlFailFastHint,
} from './services';

// 跨平台存储路径解析（上传根目录等，唯一实现，禁止各服务自行拼路径）
export {
  resolveStoragePath,
  isWithinRoot,
  StoragePathError,
  WINDOWS_ENV_ALLOWLIST,
} from './storage-path';
export type { ResolveStoragePathOptions } from './storage-path';

// 合同翻译官 — 共享类型 / IRR / 法定标准库
export * from './contract';

// 统一数据模型基础件（规范业务表设计）
export { AbstractEntity, BigIntEntity, UuidEntity } from './entities/abstract.entity';
export { User, UI_RADIUS_STYLES } from './entities/user.entity';
export type { UiRadiusStyle, UserPreferences } from './entities/user.entity';

// IAM 一期：系统维度（归属判定 / 归一化，唯一真相源）
export {
  SYSTEMS,
  SYSTEM_LABELS,
  DEFAULT_APP_SYSTEM,
  OPERATION_ROLES,
  LEGACY_OPS_USERNAMES,
  resolveUserSystems,
  normalizeSystems,
  normalizeAppSystem,
  hasSystem,
  isAppSystem,
} from './user-systems';
export type { AppSystem, SystemResolvableUser } from './user-systems';
export type {
  ModuleContext,
  UserInfo,
  ModuleManifestEntry,
  ModulesManifest,
  ModuleLifecycle,
  ModuleInstance,
  ModuleManifest,
} from './micro-frontend';
export { SnakeNamingStrategy } from './naming/snake-naming.strategy';

// 后端 RBAC 权限守卫（各微服务统一使用）
export { PermissionGuard, RequirePermission, REQUIRED_PERMISSION_KEY } from './auth/permission.guard';

import dayjs from 'dayjs';

/**
 * 格式化日期时间
 */
export function formatDateTime(date: Date | string | number, format = 'YYYY-MM-DD HH:mm:ss'): string {
  return dayjs(date).format(format);
}

/**
 * 生成随机字符串
 * 注意：使用 Math.random()，非密码学安全，仅适用于非安全场景（如临时 ID）
 * 安全场景（token、密钥等）请使用 crypto.randomBytes
 */
export function randomString(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 延迟执行
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function (this: any, ...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;
  return function (this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * 环境变量获取
 */
export function getEnv(key: string, defaultValue?: string): string {
  return process.env[key] || defaultValue || '';
}

/**
 * 判断是否为开发环境
 */
export function isDev(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * 判断是否为生产环境
 */
export function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}
