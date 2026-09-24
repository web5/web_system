import request from './request';

/** 获取全部系统配置 */
export function getSettings() {
  return request.get('/admin/settings').then((r) => r.data);
}

/** 批量更新系统配置 */
export function updateSettings(data: Record<string, string>) {
  return request.put('/admin/settings', data).then((r) => r.data);
}

/** 发送测试邮件（SMTP 配置验证；后端会重读配置，故应先保存再调用） */
export function sendTestEmail(to?: string) {
  return request.post('/users/email/test', { to }).then((r) => r.data);
}

/** 查询操作日志 */
export function getLogs(params: {
  page?: number;
  pageSize?: number;
  operator?: string;
  type?: string;
  startTime?: string;
  endTime?: string;
}) {
  return request.get('/admin/logs', { params }).then((r) => r.data);
}
