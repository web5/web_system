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

// 运行数据根目录（uploads/temp-images 等，唯一实现，禁止各服务用 process.cwd() 自拼）
export { dataRoot, dataDir } from './data-root';

// 部署形态判定（cluster / standalone，唯一实现；禁止各服务按「有没有凭证」自行推断形态）
export {
  DEPLOY_MODE_ENV,
  DEPLOY_MODES,
  DeployModeError,
  resolveDeployMode,
  assertClusterConfigured,
  describeDeployMode,
} from './deploy-mode';
export type { DeployMode, ConfigSource, DeployModeResolution } from './deploy-mode';

// 数据目录解析（上提自 upload-service，唯一实现）：形态分派 + 系统表权威 + 启动自检
export {
  DEFAULT_STORAGE_BASE,
  DEFAULT_UPLOAD_DIR,
  CONFIG_FETCH_TIMEOUT_MS,
  INTERNAL_API_KEY_ENV,
  STORAGE_ALLOWED_ROOTS_ENV,
  STORAGE_ALLOWED_ROOTS_KEY,
  STORAGE_TEMP_DIR_ENV,
  STORAGE_TEMP_DIR_KEY,
  STORAGE_UPLOAD_DIR_ENV,
  STORAGE_UPLOAD_DIR_KEY,
  SYSTEM_SERVICE_URL_ENV,
  TEMP_DIR_SPEC,
  TEMP_DIR_SEGMENT,
  DEFAULT_TEMP_DIR,
  UPLOAD_DIR_SPEC,
  ALLOWED_ROOTS_SPEC,
  WEB_SYSTEM_DIR_ENV,
  allowedRoots,
  describePathError,
  ensureWritableDir,
  fetchConfiguredDir,
  parseAllowedRoots,
  resolveAllowedRootsAtStartup,
  resolveStorageDirAtStartup,
  resolveStorageDirInput,
  resolveStorageDirWithRoots,
  resolveStorageDirsAtStartup,
  resolveTempDirAtStartup,
  resolveUploadDirAtStartup,
} from './storage-dir';
export type {
  AllowedRootsResolution,
  FetchConfiguredDirOptions,
  StorageDirResolution,
  StorageDirSource,
  StorageDirSpec,
} from './storage-dir';

// 存储目录进程内持有者（装饰器求值期 / main.ts 静态挂载用）
export {
  STORAGE_DIRS,
  getStorageDirs,
  getTempDir,
  getUploadDir,
  hasStorageDirs,
  resetStorageDirsForTest,
  resolveAndHoldStorageDirs,
  setResolvedStorageDirs,
} from './storage-dirs';
export type { ResolvedStorageDirs } from './storage-dirs';

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

// 数据库连接目标守卫（content-hub / mcp-gateway 共用唯一实现，禁止各服务自行判 NODE_ENV）
export {
  DEFAULT_DB_TARGET,
  DB_TARGET_ALLOWLIST_ENV,
  FORBIDDEN_DB_TARGETS,
  DatabaseTargetError,
  resolveDbTarget,
} from './database-target';
export type { ResolveDbTargetInput, DbTargetResolution } from './database-target';

// 后端 RBAC 权限守卫（各微服务统一使用）
export { PermissionGuard, RequirePermission, REQUIRED_PERMISSION_KEY } from './auth/permission.guard';

// 统一认证助手（C1）：纯函数 + 可注入 fetch，401 与文案仍由各服务的薄 guard 抛
export {
  verifyRemoteToken,
  resolveAuthServiceUrl,
  extractBearerToken,
} from './auth/unified-auth';
export type { AuthMode, VerifyResult, RemoteAuthDeps } from './auth/unified-auth';

// 免鉴权标记（探活 / CI hook 等公共端点使用；key 'isPublic' 与各服务薄 guard 一致）
export { Public, IS_PUBLIC_KEY } from './auth/public.decorator';

/**
 * 前后端通用纯工具函数（从 `./utils` 再导出，**API 与拆文件前逐字一致**）。
 *
 * 为什么拆文件：这几个函数前端也在用，但它们原本和 storage-dir / typeorm 实体
 * 一起住在本 barrel 里，前端从 barrel 取 `API_TIMEOUT` 时会把 node-only 模块
 * 一并拖进浏览器产物（2026-11-06 微前端白屏事故）。
 * 前端请改用 `@web-system/shared` → `browser.ts` 入口（由各 vite.config 别名指向）。
 */
export { formatDateTime, randomString, sleep, debounce, throttle } from './utils';

// 公网访问基座（拼完整 URL：头像等相对路径在返回前端前拼域名，唯一实现）
export {
  PUBLIC_BASE_URL_ENV,
  normalizePublicBaseUrl,
  resolvePublicUrl,
} from './public-url';

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
