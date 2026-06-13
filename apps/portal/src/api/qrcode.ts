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

/** 本地开发：模拟扫码确认 */
export function mockConfirmScan(ticket: string): Promise<{ success: boolean }> {
  return request.post('/auth/qrcode/confirm', { ticket, code: 'mock_dev_scan' });
}
