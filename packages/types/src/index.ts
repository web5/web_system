// 用户相关类型
export interface User {
  id: number;
  username: string;
  email?: string;
  phone?: string;
  avatar?: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type UserStatus = 'active' | 'inactive' | 'banned';

// 登录相关类型
export interface LoginRequest {
  username: string;
  password: string;
}

export interface WechatLoginRequest {
  code: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserInfo;
}

export type Gender = 'male' | 'female' | 'unknown';

/**
 * 前端使用的用户信息（API 返回格式，精简敏感字段）
 */
export interface UserInfo extends Pick<User, 'id' | 'username'> {
  email?: string;
  avatar?: string;
  nickname?: string;
  phone?: string;
  gender?: Gender;
  roles: string[];
  /** 管理员后台用字段 */
  role?: string;
  enabled?: boolean;
  /** 个人每日变身次数限制，null=使用全局默认 */
  dailyTransformLimit?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

// Token 相关类型
export interface TokenPayload {
  sub: number;
  username: string;
  roles: string[];
  iat?: number;
  exp?: number;
}

// API 响应类型
export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data?: T;
}

export interface PageResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// 微信相关类型
export interface WechatUserInfo {
  openid: string;
  unionid?: string;
  nickname: string;
  avatar: string;
}

export interface WechatTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  openid: string;
  scope: string;
}

// 小程序 code2Session 响应
export interface MiniprogramSessionResponse {
  openid: string;
  session_key: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

// 小程序登录请求
export interface MiniprogramLoginRequest {
  code: string;
  nickname?: string;
  avatar?: string;
}

// 小程序登录响应（复用 LoginResponse，增加 isNewUser）
export interface MiniprogramLoginResponse extends LoginResponse {
  isNewUser: boolean;
}

// 权限系统
export type Role = 'admin' | 'editor' | 'viewer';

export interface PermissionDef {
  code: string;
  name: string;
  group: 'dashboard' | 'users' | 'settings' | 'logs' | 'mcp';
}

export const PERMISSIONS: Record<string, PermissionDef> = {
  'dashboard:view': { code: 'dashboard:view', name: '查看工作台', group: 'dashboard' },
  'users:view':     { code: 'users:view',     name: '查看用户',   group: 'users' },
  'users:create':   { code: 'users:create',   name: '创建用户',    group: 'users' },
  'users:edit':     { code: 'users:edit',     name: '编辑用户',    group: 'users' },
  'users:delete':   { code: 'users:delete',   name: '删除用户',    group: 'users' },
  'settings:view':  { code: 'settings:view',  name: '查看设置',    group: 'settings' },
  'settings:edit':  { code: 'settings:edit',  name: '修改设置',    group: 'settings' },
  'logs:view':      { code: 'logs:view',      name: '查看日志',    group: 'logs' },
  'bianbian:view':  { code: 'bianbian:view',  name: '变变管理',    group: 'dashboard' },
  'mcp:view':       { code: 'mcp:view',       name: 'MCP 管理',     group: 'mcp' },
  'agents:view':    { code: 'agents:view',    name: 'Agents 对话',  group: 'mcp' },
};

export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  admin:  Object.keys(PERMISSIONS),
  editor: ['dashboard:view', 'users:view', 'settings:view', 'logs:view', 'bianbian:view'],
  viewer: ['dashboard:view', 'logs:view', 'bianbian:view'],
};
