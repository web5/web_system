import request from './request';

export interface QrcodeTicketResponse {
  ticketId: string;
}

export interface QrcodeCheckResponse {
  status: 'pending' | 'confirmed' | 'expired';
  accessToken?: string;
  refreshToken?: string;
  userId?: number;
}

/** 创建扫码 ticket */
export function createQrcodeTicket(): Promise<QrcodeTicketResponse> {
  return request.post('/auth/qrcode/create');
}

/** 轮询检查 ticket 状态 */
export function checkQrcodeTicket(ticket: string): Promise<QrcodeCheckResponse> {
  return request.get('/auth/qrcode/check', { params: { ticket } });
}

/** 获取微信 OAuth 授权 URL（用于二维码内容） */
export interface OAuthUrlResponse {
  oauthUrl: string;
}
export function getQrcodeOAuthUrl(ticket: string, redirect?: string): Promise<OAuthUrlResponse> {
  return request.get('/auth/qrcode/oauth-url', { params: { ticket, redirect } });
}
