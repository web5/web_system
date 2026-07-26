import axiosInstance, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { message } from 'ant-design-vue';
import router from '@/router';
import { getStoredToken } from '@/stores/user';
import { API_TIMEOUT } from '@web-system/shared';

const request = axiosInstance.create({
  baseURL: '/api',
  timeout: API_TIMEOUT.DEFAULT,
});

// 401 跳转防重入锁
let isRedirecting = false;

/**
 * 从 localStorage 读取 refreshToken（避免与 pinia store 产生循环依赖）
 */
function getStoredRefreshToken(): string | null {
  try {
    const raw = localStorage.getItem('user-store');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.refreshToken || null;
  } catch {
    return null;
  }
}

/**
 * 更新 localStorage 中的 token（pinia persist key 为 'user-store'）
 */
function updateStoredTokens(accessToken: string, refreshToken: string): void {
  try {
    const raw = localStorage.getItem('user-store');
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.token = accessToken;
    parsed.refreshToken = refreshToken;
    localStorage.setItem('user-store', JSON.stringify(parsed));
  } catch {
    // 静默失败
  }
}

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

/**
 * 尝试使用 refreshToken 刷新 accessToken
 * 返回新的 token 或 null（刷新失败）
 */
async function tryRefreshToken(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await axiosInstance.post('/auth/refresh', { refreshToken });
    const data = res.data as any;
    if (data?.code === 200 && data?.data) {
      const { accessToken: newAccess, refreshToken: newRefresh } = data.data;
      if (newAccess) {
        updateStoredTokens(newAccess, newRefresh || refreshToken);
        return { accessToken: newAccess, refreshToken: newRefresh || refreshToken };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// 响应拦截器
request.interceptors.response.use(
  (response: AxiosResponse) => {
    return response.data;
  },
  async (error) => {
    const config = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response) {
      const { status, data } = error.response;

      if (status === 401) {
        // 尝试用 refreshToken 自动刷新（只尝试一次）
        if (!config._retry) {
          config._retry = true;
          const newTokens = await tryRefreshToken();
          if (newTokens) {
            config.headers.Authorization = `Bearer ${newTokens.accessToken}`;
            return request(config);
          }
        }

        // 刷新失败，跳转登录
        if (!isRedirecting) {
          isRedirecting = true;
          // 60 秒后自动解锁，防止永久锁死
          setTimeout(() => { isRedirecting = false; }, 60000);
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
