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
 * 公开鉴权接口白名单：这些接口本身的 401 是"凭据错误"，不是"token 过期"
 * 必须跳过自动刷新与跳登录页，直接交给上层业务处理
 */
const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh'];

function isPublicAuthRequest(config?: InternalAxiosRequestConfig): boolean {
  if (!config?.url) return false;
  const path = config.url.split('?')[0];
  return PUBLIC_AUTH_PATHS.some((p) => path === p || path.endsWith(p));
}

/**
 * 从 localStorage 读取 refreshToken（避免与 pinia store 产生循环依赖）
 */
export function getStoredRefreshToken(): string | null {
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
export function updateStoredTokens(accessToken: string, refreshToken: string): void {
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
export async function tryRefreshToken(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;

  try {
    // 使用带 baseURL('/api') 的 request 实例，确保走到网关代理
    const res = await request.post('/auth/refresh', { refreshToken });
    // request 的响应拦截器已返回 response.data，即 LoginResponse 直接值
    const data = res as any;
    if (data?.accessToken) {
      updateStoredTokens(data.accessToken, data.refreshToken || refreshToken);
      return { accessToken: data.accessToken, refreshToken: data.refreshToken || refreshToken };
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
        // 公开鉴权接口（登录/注册/刷新）→ 凭据错误，不弹"登录已过期"，不跳转
        if (isPublicAuthRequest(config)) {
          return Promise.reject(error);
        }

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
