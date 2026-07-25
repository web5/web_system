/**
 * 文件上传 — API（Portal 端）
 *
 * 对应 upload-service 服务，通过 Gateway 代理访问：
 *   POST /api/upload/avatar   - 上传头像（≤2MB）
 *   POST /api/upload/drawing   - 上传画板照片（≤10MB）
 *   POST /api/upload/bianbian  - 上传变变照片（≤10MB）
 *   POST /api/upload/general   - 通用上传（≤5MB）
 */
import axios from 'axios';
import { message } from 'ant-design-vue';

/** 上传专用 axios 实例（不预设 Content-Type，由 FormData 自动设定） */
const uploadRequest = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

// 请求拦截器：携带 token
uploadRequest.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器
uploadRequest.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response) {
      const { status, data } = error.response;
      if (status === 401) {
        message.error('登录已过期，请重新登录');
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      } else {
        message.error(data?.message || '上传失败');
      }
    } else {
      message.error('网络错误，请检查网络连接');
    }
    return Promise.reject(error);
  },
);

/** 上传响应 */
export interface UploadResult {
  url: string;
  filename: string;
  size: number;
  mimetype: string;
  category: string;
}

/** 上传分类信息 */
export interface UploadCategoryInfo {
  key: string;
  name: string;
  maxSize: number;
  allowedTypes: string[];
}

/**
 * 上传图片文件
 */
export function uploadImage(
  file: File,
  category: 'avatar' | 'drawing' | 'bianbian' | 'general' = 'general',
): Promise<{ code: number; data: UploadResult }> {
  const formData = new FormData();
  formData.append('file', file);

  return uploadRequest.post(`/upload/${category}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

/**
 * 获取支持的分类及限制信息
 */
export function getUploadCategories(): Promise<{ code: number; data: UploadCategoryInfo[] }> {
  return uploadRequest.get('/upload/categories');
}

export default { uploadImage, getUploadCategories };
