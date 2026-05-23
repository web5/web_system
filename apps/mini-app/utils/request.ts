/**
 * 网络请求工具 — 封装 wx.request
 * 自动携带 JWT Token，401 时触发重新登录
 */

const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

/** 获取 app 实例 */
function getApp(): IAppOption {
  return getApp<IAppOption>();
}

/** 从 storage 读取 token */
export function getToken(): string {
  return wx.getStorageSync(TOKEN_KEY) || '';
}

/** 从 storage 读取 refreshToken */
export function getRefreshToken(): string {
  return wx.getStorageSync(REFRESH_TOKEN_KEY) || '';
}

/** 保存 token 到 storage 和 globalData */
export function setToken(accessToken: string, refreshToken?: string): void {
  wx.setStorageSync(TOKEN_KEY, accessToken);
  if (refreshToken) {
    wx.setStorageSync(REFRESH_TOKEN_KEY, refreshToken);
  }
  const app = getApp();
  app.globalData.token = accessToken;
}

/** 清除 token */
export function clearToken(): void {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(REFRESH_TOKEN_KEY);
  const app = getApp();
  app.globalData.token = '';
}

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: any;
  header?: Record<string, string>;
  /** 是否静默处理 401（不触发重新登录） */
  silent?: boolean;
}

/** 通用请求方法 */
export function request<T = any>(options: RequestOptions): Promise<T> {
  const app = getApp();
  const baseUrl = app.globalData.apiBase;
  const token = getToken();

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.header,
      },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data as T);
        } else if (res.statusCode === 401) {
          clearToken();
          if (!options.silent) {
            // 触发全局 401 事件
            wx.showToast({ title: '登录已过期，请重新登录', icon: 'none' });
            // 延迟跳转到首页触发重新登录
            setTimeout(() => {
              wx.reLaunch({ url: '/pages/index/index' });
            }, 1500);
          }
          reject(res);
        } else {
          const data = res.data as any;
          const msg = data?.message || `请求失败 (${res.statusCode})`;
          wx.showToast({ title: msg, icon: 'none' });
          reject(res);
        }
      },
      fail(err) {
        wx.showToast({ title: '网络请求失败', icon: 'none' });
        reject(err);
      },
    });
  });
}

/** GET 快捷方法 */
export function get<T = any>(url: string, data?: any): Promise<T> {
  return request<T>({ url, method: 'GET', data });
}

/** POST 快捷方法 */
export function post<T = any>(url: string, data?: any): Promise<T> {
  return request<T>({ url, method: 'POST', data });
}

/** PUT 快捷方法 */
export function put<T = any>(url: string, data?: any): Promise<T> {
  return request<T>({ url, method: 'PUT', data });
}

/** DELETE 快捷方法 */
export function del<T = any>(url: string): Promise<T> {
  return request<T>({ url, method: 'DELETE' });
}
