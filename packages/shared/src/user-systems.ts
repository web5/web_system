/**
 * 系统维度（IAM 一期）：一个账号属于哪些内部系统。
 *
 * 背景：`users` 表里 **C 端用户（微信/小程序注册）与运营、运维用户混存**，
 * 只靠 roles 区分不出「能不能登运维控制台」—— 今天给 `wx_xxx` 授
 * `deploy:pipeline:approve` 技术上完全可行。隔离是审批体系能成立的前提，
 * 故引入最小系统维度（不做租户 / 计费 / 开放 API）。
 *
 * 设计取舍：
 *  - 用 **JSON 数组**而非单值：一个用户可以跨系统（如 admin 兼运维）；
 *  - 归属由**创建路径**写入 + 回填脚本兜底，不靠用户名前缀
 *    （`mp_` / `wx_` 前缀不可靠：微信与小程序两条注册路径都生成 `wx_` 前缀）。
 */

export const SYSTEMS = ['portal', 'admin', 'deploy'] as const;

export type AppSystem = (typeof SYSTEMS)[number];

/** 运营后台角色（区别于 C 端的 `user`） */
export const OPERATION_ROLES = ['super_admin', 'admin', 'editor', 'viewer'] as const;

/**
 * 存量运维账号白名单：历史由 `.env` 单一管理员运维，迁移期保留其运维权限，
 * 免得改完直接把自己锁在门外（IAM 一期的"不能把自己关在门外"原则）。
 */
export const LEGACY_OPS_USERNAMES = ['admin'] as const;

/** 登录未声明系统时的默认值：portal（对 C 端零影响，运营/运维端需显式声明） */
export const DEFAULT_APP_SYSTEM: AppSystem = 'portal';

/** 系统中文名（登录报错等文案用，避免各端各自翻译） */
export const SYSTEM_LABELS: Record<AppSystem, string> = {
  portal: '用户端',
  admin: '运营后台',
  deploy: '运维控制台',
};

export function isAppSystem(v: unknown): v is AppSystem {
  return typeof v === 'string' && (SYSTEMS as readonly string[]).includes(v);
}

/**
 * 归一化登录时传入的 system：空值 / 非法值 → `portal`。
 *
 * 为什么非法值也落到 portal 而不是报错：系统参数是**收窄**用途（声明"我要进哪个系统"），
 * 不是授权依据；真正决定能不能进的是用户自己的 systems。落到最小权限系统最安全。
 */
export function normalizeAppSystem(v?: unknown): AppSystem {
  if (typeof v !== 'string') return DEFAULT_APP_SYSTEM;
  const s = v.trim();
  return isAppSystem(s) ? s : DEFAULT_APP_SYSTEM;
}

/** 可判定系统归属的最小用户投影（三个服务都能拿到这些字段） */
export interface SystemResolvableUser {
  systems?: unknown;
  mpOpenid?: string | null;
  oaOpenid?: string | null;
  username?: string | null;
  roles?: unknown;
}

/** 归一化：去空、去重、丢弃非法值；空则 null（便于判断"未归类"） */
export function normalizeSystems(list?: unknown): AppSystem[] {
  if (!Array.isArray(list)) return [];
  const out: AppSystem[] = [];
  for (const raw of list) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (isAppSystem(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * 判定用户归属哪些系统（纯函数，幂等）。
 *
 * 优先级：已归类 → C 端（有 openid）→ 存量运维白名单 → 运营角色 → 兜底 portal。
 * 兜底取 `portal` 而不是 `admin`：归类不确定时给**最小权限**，
 * 宁可让运营账号少一个入口，也不能让 C 端账号摸到后台。
 */
export function resolveUserSystems(u: SystemResolvableUser): AppSystem[] {
  const existing = normalizeSystems(u.systems);
  if (existing.length) return existing;

  if (u.mpOpenid || u.oaOpenid) return ['portal'];

  if (u.username && (LEGACY_OPS_USERNAMES as readonly string[]).includes(u.username)) {
    return ['admin', 'deploy'];
  }

  const roles = Array.isArray(u.roles) ? (u.roles as unknown[]).map(String) : [];
  if (roles.some((r) => (OPERATION_ROLES as readonly string[]).includes(r))) return ['admin'];

  return ['portal'];
}

/** 用户是否属于某系统 */
export function hasSystem(u: { systems?: unknown }, system: AppSystem): boolean {
  return normalizeSystems(u.systems).includes(system);
}
