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
 * 完全公开、且**绝不能带 Authorization** 的接口。
 *
 * 背景（2026-10-10 事故）：本地残留一个无效/过期的 token 时，请求拦截器仍会
 * 无条件挂上 `Authorization: Bearer <坏 token>`，导致**公开的扫码二维码接口**
 * `/api/auth/qrcode/create` 也被网关判 401 → 二维码生不出来 → 登录页只剩
 * 「二维码已过期 / 刷新二维码」，用户点刷新也没用（token 还在，次次 401）。
 *
 * 这类接口本身就是匿名可用的，带上坏凭据只会把「能自愈的公开链路」一起拖死。
 */
const NO_AUTH_HEADER_PATHS = [
  '/auth/qrcode/create',
  '/auth/qrcode/check',
  '/auth/qrcode/oauth-url',
];

function skipAuthHeader(config?: InternalAxiosRequestConfig): boolean {
  if (!config?.url) return false;
  const path = config.url.split('?')[0];
  return NO_AUTH_HEADER_PATHS.some((p) => path === p || path.endsWith(p));
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
 * 清除本地凭据（401 且刷新失败时调用）。
 *
 * 只清不跳——「清」是根因修复：凭据留在 localStorage 里，下一次进页面仍是
 * 「半登录」僵尸态（左栏显示「加载失败 + 重试」而不是「登录 / 注册」，
 * 二维码接口也仍带着坏 token）。清干净后刷新/重进都能落到正确状态。
 *
 * 同时广播 `auth:expired`，让 pinia store 同步内存态（避免 isLoggedIn 仍为 true）。
 * 这里不能用 import store 的方式（store → request 会形成循环依赖）。
 */
export function clearStoredAuth(): void {
  try {
    const raw = localStorage.getItem('user-store');
    if (raw) {
      const parsed = JSON.parse(raw);
      delete parsed.token;
      delete parsed.refreshToken;
      delete parsed.userInfo;
      localStorage.setItem('user-store', JSON.stringify(parsed));
    }
    // 历史遗留 key（老基座登录页写的）：一并清掉，避免基座守卫仍判「已登录」
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
  } catch {
    // 静默失败
  }
  try {
    window.dispatchEvent(new Event('auth:expired'));
  } catch {
    // 非浏览器环境（SSR / 单测）忽略
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
    if (token && !skipAuthHeader(config)) {
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

/**
 * per-request 静默开关。
 * silent=true 时，失败只走调用方自己的日志，不弹全局错误提示 ——
 * 用于「本地乐观应用 + 后台同步」类调用（如界面偏好上报，失败不回滚也不打扰用户）。
 */
declare module 'axios' {
  export interface AxiosRequestConfig {
    silent?: boolean;
  }
}

/**
 * axios 在 `responseType: 'blob'` 时**不会解析错误响应体**——4xx/5xx 的 JSON body
 * 会原样以 Blob 返回，`data?.message` 恒为 undefined，端侧只能弹「请求失败」，
 * 真实原因（如「TTS 未配置」）被完全吞掉，排障成本极高。
 *
 * 这里把 Blob 错误体读成文本并尝试 JSON 解析后回填，让上层能拿到服务端 message。
 */
async function resolveBlobErrorBody(error: any): Promise<void> {
  const data = error?.response?.data;
  if (!data || typeof Blob === 'undefined' || !(data instanceof Blob)) return;
  try {
    const text = await data.text();
    try {
      error.response.data = JSON.parse(text);
    } catch {
      // 非 JSON（纯文本错误体）：包一层，保证上层 `data?.message` 仍能取到
      error.response.data = { message: text };
    }
  } catch {
    // 读取失败：保持原样，交由上层兜底
  }
}

// 响应拦截器
request.interceptors.response.use(
  (response: AxiosResponse) => {
    // 后端全局 TransformInterceptor 会把响应包成 {code, data, message}；
    // 这里把 data 字段拆出来，调用方就能直接拿到业务数据（如 r.keys）。
    // 未包装的响应（如纯 {keys:[]}）保持原样。
    const body = response.data;
    if (body && typeof body === 'object' && 'code' in body && 'data' in body) {
      return body.data;
    }
    return body;
  },
  async (error) => {
    const config = error.config as InternalAxiosRequestConfig & { _retry?: boolean; silent?: boolean };

    if (error.response) {
      // blob / arraybuffer 响应：先把错误体解析成可读对象，再走下面的提示逻辑
      await resolveBlobErrorBody(error);
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

        // 刷新失败：先清凭据再跳登录。顺序不能反——带着坏 token 跳到登录页，
        // 扫码二维码接口仍会 401，登录页就变成「二维码已过期」的死局。
        if (!isRedirecting) {
          isRedirecting = true;
          // 60 秒后自动解锁，防止永久锁死
          setTimeout(() => { isRedirecting = false; }, 60000);
          clearStoredAuth();
          message.error('登录已过期，请重新登录');
          const currentPath = router.currentRoute.value.fullPath;
          const redirectPath = currentPath !== '/login' ? `?redirect=${encodeURIComponent(currentPath)}` : '';
          router.push(`/login${redirectPath}`);
        }
      } else if (!config.silent) {
        message.error(data?.message || '请求失败');
      }
    } else if (!config.silent) {
      message.error('网络错误，请检查网络连接');
    }

    return Promise.reject(error);
  },
);

export default request;
