import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { message } from 'ant-design-vue';

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
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
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
        message.error('登录已过期，请重新登录');
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login';
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
  }
);

export default request;
