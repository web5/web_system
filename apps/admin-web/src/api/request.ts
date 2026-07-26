import axios from 'axios';
import type { AxiosInstance, AxiosResponse } from 'axios';
import { message } from 'ant-design-vue';
import router from '@/router';

// 401 跳转防重入锁
let isRedirecting = false;

/**
 * 从 pinia persist 插件存储的 key 中读取 token（避免与 store 产生循环依赖）
 */
function getStoredToken(): string | null {
  try {
    const raw = localStorage.getItem('user-store');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.token || null;
  } catch {
    return null;
  }
}

const request: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    const token = getStoredToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// 响应拦截器
request.interceptors.response.use(
  (response: AxiosResponse) => {
    return response.data;
  },
  (error) => {
    if (error.response) {
      const { status, data } = error.response;

      if (status === 401) {
        if (!isRedirecting) {
          isRedirecting = true;
          // 清除 pinia persist 存储
          localStorage.removeItem('user-store');
          message.error('登录已过期，请重新登录');
          router.push('/login');
        }
      } else if (status === 403) {
        message.error('无权限访问');
      } else if (status === 404) {
        message.error('请求的资源不存在');
      } else if (status === 500) {
        message.error('服务器错误');
      } else {
        message.error(data?.message || '请求失败');
      }
    } else {
      message.error('网络错误，请检查网络连接');
    }

    return Promise.reject(error);
  },
);

export default request;
