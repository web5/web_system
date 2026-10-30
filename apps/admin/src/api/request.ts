import axios from 'axios';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { message } from 'ant-design-vue';
import router from '@/router';
import { useUserStore } from '@/stores/user';
import { API_TIMEOUT } from '@web-system/shared';

// 401 跳转防重入锁
let isRedirecting = false;

/**
 * 公开鉴权接口白名单：这些接口本身的 401 是"凭据错误"，不是"token 过期"
 * 必须跳过跳登录页的逻辑，直接交给上层业务处理
 */
const PUBLIC_AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh'];

function isPublicAuthRequest(config?: InternalAxiosRequestConfig): boolean {
  if (!config?.url) return false;
  const path = config.url.split('?')[0];
  return PUBLIC_AUTH_PATHS.some((p) => path === p || path.endsWith(p));
}

/**
 * 清掉本地残留的登录凭据（磁盘 + pinia 内存）。
 *
 * 为什么要清：公开鉴权接口（登录/注册/刷新）返回 401 时，说明本次凭据交换失败。
 * 但浏览器 localStorage 里可能还躺着**上一个会话**的旧 token。若不清理，
 * 下一次登录请求仍会带上它 → gateway 黑名单 Guard 直接 401「令牌已失效（已登出）」
 * → 用户看到「密码没错却永远登不进去」，且因为该 401 被当作"公开接口凭据错误"
 * 而不会触发跳转，形成死循环。见 fix/auth-stale-token-blocks-login。
 */
function clearStoredAuth(): void {
  try {
    const raw = localStorage.getItem('user-store');
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.token = '';
      parsed.refreshToken = '';
      localStorage.setItem('user-store', JSON.stringify(parsed));
    }
  } catch {
    try {
      localStorage.removeItem('user-store');
    } catch {
      // 静默失败
    }
  }
  // 同步 pinia 内存态：否则 isLoggedIn 仍为 true，界面继续按「已登录」渲染
  try {
    useUserStore().logout();
  } catch {
    // pinia 未激活（极端时序）：磁盘已清，刷新后即为未登录态
  }
}

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

/**
 * 尝试使用 refreshToken 刷新 accessToken
 * 返回新的 token 或 null（刷新失败）
 */
async function tryRefreshToken(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;

  try {
    // 使用裸 axios 实例（不走 interceptors），避免循环依赖
    // 注意：admin 的 base 是 /admin/，必须用完整 /api 路径
    const res = await axios.post('/api/auth/refresh', { refreshToken });
    const data = res.data as any;
    // auth-service 的 refresh 端点直接返回 LoginResponse，无 {code,data} 包装
    if (data?.accessToken) {
      updateStoredTokens(data.accessToken, data.refreshToken || refreshToken);
      return { accessToken: data.accessToken, refreshToken: data.refreshToken || refreshToken };
    }
    return null;
  } catch {
    return null;
  }
}

const request: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: API_TIMEOUT.DEFAULT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    /**
     * 公开鉴权请求（登录/注册/刷新）**不得携带 Authorization**。
     *
     * 这三个接口本身就是「用凭据换凭据」，调用时必然还没有有效 token。
     * 而浏览器 localStorage 里可能残留上一个会话的旧 token（已登出 → 进黑名单），
     * 一旦带上，gateway 的 TokenBlacklistGuard 会在转发前直接拦成
     * 401「令牌已失效（已登出）」，请求根本到不了 auth-service
     * → 表现为「密码正确却永远登不进去」。
     */
    if (!isPublicAuthRequest(config)) {
      const token = getStoredToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
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
    // 后端 TransformInterceptor 统一包成 {code, data, message}，这里 unwrap data
    const body = response.data;
    if (body && typeof body === 'object' && 'code' in body && 'data' in body) {
      // 业务错误（HTTP 200 + code!=0，如 ai-service 的 4030/4000）→ 与 HTTP 4xx/5xx 同样拒绝
      if (body.code !== 0 && body.code !== undefined && body.code !== null) {
        message.error(body.message || '请求失败');
        return Promise.reject(body);
      }
      return body.data;
    }
    return body;
  },
  async (error) => {
    if (error.response) {
      const { status, data } = error.response;

      if (status === 401) {
        // 公开鉴权接口（登录/注册/刷新）→ 凭据错误，不弹"登录已过期"，不跳转
        // 但要顺手清掉本地残留的旧 token：否则下一次登录仍会带上它，被网关黑名单拦死
        if (isPublicAuthRequest(error.config as InternalAxiosRequestConfig)) {
          clearStoredAuth();
          return Promise.reject(error);
        }

        // 尝试用 refreshToken 自动刷新（只尝试一次）
        const config = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
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

          // 必须同时清除 pinia state 和 localStorage，否则路由守卫读到旧 token 会立即跳回首页
          const userStore = useUserStore();
          userStore.logout();

          message.error({ content: '登录已过期，请重新登录', key: 'auth-expired' });
          const currentPath = router.currentRoute.value.fullPath;
          const redirectPath = currentPath !== '/login' ? `?redirect=${encodeURIComponent(currentPath)}` : '';
          router.push(`/login${redirectPath}`);
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
