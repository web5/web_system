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

export interface UserInfo {
  id: number;
  username: string;
  email?: string;
  avatar?: string;
  roles: string[];
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
