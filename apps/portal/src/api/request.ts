import axiosInstance, { type AxiosResponse } from 'axios';
import { message } from 'ant-design-vue';
import router from '@/router';
import { getStoredToken } from '@/stores/user';

const request = axiosInstance.create({
  baseURL: '/api',
  timeout: 10000,
});

// 401 跳转防重入锁
let isRedirecting = false;

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
          message.error('登录已过期，请重新登录');
          const currentPath = router.currentRoute.value.fullPath;
          const redirectPath = currentPath !== '/login' ? `?redirect=${encodeURIComponent(currentPath)}` : '';
          router.push(`/login${redirectPath}`);
        }
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
