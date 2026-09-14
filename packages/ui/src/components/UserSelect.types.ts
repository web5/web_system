/**
 * 人员选择器的公共类型（@web-system/ui）。
 *
 * 放在共享包而不是各端：admin / deploy-console 都要「选一个系统用户」，
 * 用户名、昵称、角色的展示口径必须一致，否则会出现
 * 「console 里显示昵称、admin 里显示用户名」这类跨端漂移。
 */

/** 候选人员（对 user-service 用户的最小投影） */
export interface UserOption {
  id?: string;
  /** 登录用户名（组件的 value 用它，唯一且稳定） */
  username: string;
  nickname?: string;
  roles?: string[];
}

/**
 * 加载器返回值。
 * `degraded` 表示**没能拿到权威名单**（权限服务不可用 / 清单为空）——
 * 此时后端通常不会做强校验，必须让使用者知情，避免"以为设了限制其实没有"。
 */
export interface UserSelectLoadResult {
  users: UserOption[];
  degraded?: boolean;
  reason?: string;
}
