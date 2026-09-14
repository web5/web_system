import request from './request';
import type { LoginRequest, WechatLoginRequest, LoginResponse } from '@web-system/types';

/**
 * 用户名密码登录
 *
 * `system: 'admin'` **必传**（IAM 一期）：登录默认按 `portal` 处理，而 portal 不做门禁 ——
 * 不显式声明系统，C 端账号也能登进运营后台。
 */
export function login(data: LoginRequest): Promise<LoginResponse> {
  return request.post('/auth/login', { ...data, system: data.system ?? 'admin' });
}

/**
 * 用户注册
 */
export function register(data: { username: string; password: string; email?: string }): Promise<LoginResponse> {
  return request.post('/auth/register', data);
}

/**
 * 微信扫码登录
 *
 * 同样声明 `system: 'admin'`：扫码进来的通常是 C 端账号，不声明系统就绕过了门禁。
 */
export function wechatLogin(data: WechatLoginRequest): Promise<LoginResponse> {
  return request.post('/auth/wechat-login', { ...data, system: data.system ?? 'admin' });
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
