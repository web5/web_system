import request from './request';
import type { LoginRequest, WechatLoginRequest, LoginResponse } from '@web-system/types';

/**
 * 用户名密码登录
 */
export function login(data: LoginRequest): Promise<LoginResponse> {
  return request.post('/auth/login', data);
}

/**
 * 用户注册
 */
export function register(data: { username: string; password: string; email?: string }): Promise<LoginResponse> {
  return request.post('/auth/register', data);
}

/**
 * 微信扫码登录
 */
export function wechatLogin(data: WechatLoginRequest): Promise<LoginResponse> {
  return request.post('/auth/wechat-login', data);
}

/**
 * 刷新 Token
 */
export function refreshToken(refreshToken: string): Promise<LoginResponse> {
  return request.post('/auth/refresh', { refreshToken });
}

/**
 * 登出
 */
export function logout(): Promise<void> {
  return request.post('/auth/logout');
}

/**
 * 获取微信登录二维码
 */
export function getWechatQrCode(): Promise<{ qrcodeUrl: string; scene: string }> {
  return request.get('/auth/wechat/qrcode');
}
