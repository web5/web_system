import request from './request';

export interface TransformRequest {
  image: string;
  description?: string;
  style?: string;
  outputSize?: string;
  userId?: string;
}

export interface TransformData {
  id: string;
  aiImage: string;
  status: string;
  processingTimeMs: number;
  remainingToday: number;
}

export interface TransformResponse {
  code: number;
  data: TransformData;
  message: string;
}

/** 变变 AI 变身 — 上传拼接作品，生成 3D 角色 */
export function transformImage(data: TransformRequest): Promise<TransformResponse> {
  return request.post('/bianbian/transform', data);
}

/** 查询用户当日剩余变身次数 */
export function getQuota(userId: string): Promise<{
  code: number;
  data: { used: number; limit: number; remaining: number };
}> {
  return request.get(`/bianbian/quota/${userId}`);
}

/** 获取用户的变身记录列表 */
export function getRecords(params: {
  userId: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  code: number;
  data: { list: Array<{ id: string; originalImage: string; aiImage: string | null; description: string; status: string; createdAt: string }>; total: number; page: number; pageSize: number };
}> {
  return request.get('/bianbian/records', { params });
}

/** 删除一条变身记录 */
export function deleteRecord(id: string, userId: string): Promise<{ code: number; message: string }> {
  return request.delete(`/bianbian/records/${id}`, { params: { userId } });
}
