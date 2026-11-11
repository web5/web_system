/**
 * 网络请求工具 — 封装 wx.request
 * 自动携带 JWT Token，401 时触发重新登录
 */

import { API_TIMEOUT } from './constants';

const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
/** 用户主动退出的标志位：与「token 过期」区分 —— 此状态下不得自动重新登录 */
const LOGGED_OUT_KEY = 'account_logged_out';

/** 取 wx 全局 app 实例 — 优先 storage 兜底，避开异步栈里 wx.getApp 抛 "not a function" */
function getAppInstance(): IAppOption | null {
  // 1) 优先从 storage 拿（app.ts onLaunch 时写入）
  try {
    const cached = wx.getStorageSync('api_base');
    if (cached) {
      // 复刻一个最小 app 对象（仅供 token 同步使用）
      const tok = wx.getStorageSync('access_token') || '';
      return { globalData: { apiBase: cached, token: tok } } as unknown as IAppOption;
    }
  } catch {}
  // 2) 兜底再尝试 wx.getApp / getApp（带异常兜住）
  try {
    const fn = (wx as any).getApp;
    if (typeof fn === 'function') return fn() as IAppOption;
  } catch {}
  try {
    if (typeof getApp === 'function') return (getApp as any)() as IAppOption;
  } catch {}
  return null;
}

/** 取 apiBase：优先 storage，兜底 wx.getApp，避开反复调用栈溢出风险 */
function getApiBase(): string {
  try {
    const cached = wx.getStorageSync('api_base');
    if (cached) return cached;
  } catch {}
  const app = getAppInstance();
  return app?.globalData?.apiBase || '';
}

/** 从 storage 读取 token */
export function getToken(): string {
  return wx.getStorageSync(TOKEN_KEY) || '';
}

/** 从 storage 读取 refreshToken */
export function getRefreshToken(): string {
  return wx.getStorageSync(REFRESH_TOKEN_KEY) || '';
}

/** 保存 token 到 storage（globalData.token 是冗余同步，已去掉以避免依赖 wx.getApp） */
export function setToken(accessToken: string, refreshToken?: string): void {
  wx.setStorageSync(TOKEN_KEY, accessToken);
  if (refreshToken) {
    wx.setStorageSync(REFRESH_TOKEN_KEY, refreshToken);
  }
}

/** 清除 token */
export function clearToken(): void {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(REFRESH_TOKEN_KEY);
}

/** 是否处于「用户主动退出」状态（区别于 token 过期：此状态不自动重登） */
export function isLoggedOut(): boolean {
  try {
    return wx.getStorageSync(LOGGED_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

/** 设置 / 清除主动退出标志 */
export function setLoggedOut(v: boolean): void {
  try {
    if (v) wx.setStorageSync(LOGGED_OUT_KEY, '1');
    else wx.removeStorageSync(LOGGED_OUT_KEY);
  } catch {}
}

/**
 * 登录确保器：由 services/auth.ts 在模块加载时注入（见 setLoginEnsurer 调用处）。
 * 这里用「注入钩子」而非直接 import auth.ts，是为了打破 request↔auth 的循环依赖：
 * auth.ts import 本文件的 setToken 等，本文件若再 import auth.ts 会成环。
 */
type LoginEnsurer = () => Promise<boolean>;

let loginEnsurer: LoginEnsurer | null = null;

/** 注入登录确保器（services/auth.ts 调用一次） */
export function setLoginEnsurer(fn: LoginEnsurer): void {
  loginEnsurer = fn;
}

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data?: Record<string, unknown>;
  header?: Record<string, string>;
  /** 是否静默处理 401（不触发重新登录） */
  silent?: boolean;
  /** 超时时间（毫秒），默认 API_TIMEOUT.DEFAULT */
  timeout?: number;
}

/**
 * ai-agent 统一异常过滤器会把一切业务异常转成 HTTP 200 + { code, message, data: null } 信封
 * （unified-exception.filter.ts）。仅当 code+message 同时存在且 code 非 0 才视为错误信封，
 * 避免误伤「成功直返」里恰好带 code 字段的正常数据（如某些 agent 的直返结构）。
 */
interface AiAgentErrorEnvelope {
  code: number;
  message?: string;
  data?: unknown;
}

/** 判定响应体是否 ai-agent 错误信封（code 非 0 才算错，code===0 视为正常直返） */
function isAiAgentErrorEnvelope(body: unknown): body is AiAgentErrorEnvelope {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const obj = body as Record<string, unknown>;
  return 'code' in obj && 'message' in obj && typeof obj.code === 'number' && obj.code !== 0;
}

/**
 * 401 / ai-agent 4010 信封共用的「未授权」处理：清 token（防启动竞态误清）+ 提示 / 广播重登。
 * auth-service 的 4xx/5xx 走 HTTP 状态码分支；ai-agent 的 4010 走 HTTP 200 信封分支，二者行为对齐。
 */
function handleUnauthorized(token: string, options: RequestOptions): void {
  // 仅当「本次请求携带的 token」仍等于当前存储的 token 才清除：
  // 防止登录完成前发出的旧请求在登录后返回 401，把刚写入的新 token 误清（启动竞态）。
  if (token && token === getToken()) {
    clearToken();
  }
  if (!options.silent) {
    if (isLoggedOut()) {
      // 已主动退出：不自动重登、不跳欢迎页（欢迎页无登录入口），只提示需要登录
      wx.showToast({ title: '请先登录', icon: 'none' });
    } else {
      wx.showToast({ title: '登录已过期，请重新登录', icon: 'none' });
      // 通知各页弹登录墙（login-gate：静默 wx.login 一键恢复）。
      // 禁 reLaunch 回首页：会清空整个页面栈——用户从任何页进来都被弹回首页，
      // 且此后右滑返回永远回首页（栈已脏，「对话页右滑始终回首页」的元凶）。
      try {
        getApp<IAppOption>().eventBus?.emit('auth:expired');
      } catch {
        // getApp 不可用（极早期）：放弃广播，页面 onShow 仍会兜底刷新登录态
      }
    }
  }
}

/** 通用请求方法 */
export async function request<T = unknown>(options: RequestOptions): Promise<T> {
  // 优先 storage 读 baseUrl（避免 wx.getApp 在异步栈里抛错）
  const baseUrl = getApiBase();
  if (!baseUrl) {
    throw new Error('应用未初始化，请稍后重试或重启小程序');
  }

  // 首次启动时 App.onLaunch 的 autoLogin 是异步的，首屏页面请求可能早于登录完成；
  // 无 token 时先「确保登录」再发请求，避免发出无 token 请求 → 401 → 误触发掉线。
  // ⚠️ 用户已主动退出时不自动重登，否则「退出登录」点了等于没点。
  if (!getToken() && !isLoggedOut() && loginEnsurer) {
    await loginEnsurer();
  }
  const token = getToken();
  if (!token) {
    // 未登录（含主动退出态）：不发无 token 请求，交由上层引导登录
    throw new Error('NOT_LOGGED_IN');
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${options.url}`,
      // wx.request 运行时支持 PATCH，但 @types/wechat-miniprogram 的 method 枚举未收录 PATCH，
      // 此处按运行时能力放宽类型（保留 PATCH 透传）。
      method: (options.method || 'GET') as WechatMiniprogram.RequestOption['method'],
      data: options.data,
      timeout: options.timeout ?? API_TIMEOUT.DEFAULT,
      header: {
        'Content-Type': 'application/json',
        // 强制不压缩：gateway 启用了 compression，但 wx.request 在开发者工具对 gzip 响应解析失败
        // (Failed to load response data)。identity 表示不压缩，gateway 会返回明文。
        'Accept-Encoding': 'identity',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.header,
      },
      success(res) {
        // 成功判据统一 2xx（不只 200）：201 Created / 204 No Content 都是合法成功。
        // 与 services/auth.ts:95 的 `>= 200 && < 300` 同口径；304 Not Modified 属未变更，
        // 业务 body 拿不到，仍走失败分支（不得放宽为「所有 3xx」）。
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const body = res.data as unknown;
          if (isAiAgentErrorEnvelope(body)) {
            if (body.code === 4010) {
              // ai-agent 未授权/缺 token：与 HTTP 401 同口径处理（清 token + 提示/广播重登）
              handleUnauthorized(token, options);
              reject(res);
              return;
            }
            const msg = body.message || `请求失败 (${body.code})`;
            if (!options.silent) wx.showToast({ title: msg, icon: 'none' });
            reject(res);
            return;
          }
          resolve(res.data as T);
        } else if (res.statusCode === 401) {
          handleUnauthorized(token, options);
          reject(res);
        } else {
          const data = res.data as any;
          const msg = data?.message || `请求失败 (${res.statusCode})`;
          if (!options.silent) wx.showToast({ title: msg, icon: 'none' });
          reject(res);
        }
      },
      fail(err) {
        if (!options.silent) wx.showToast({ title: '网络请求失败', icon: 'none' });
        reject(err);
      },
    });
  });
}

/** GET 快捷方法 */
export function get<T = unknown>(url: string, data?: Record<string, unknown>): Promise<T> {
  return request<T>({ url, method: 'GET', data });
}

/** POST 快捷方法 */
export function post<T = unknown>(url: string, data?: Record<string, unknown>): Promise<T> {
  return request<T>({ url, method: 'POST', data });
}

/** PUT 快捷方法 */
export function put<T = unknown>(url: string, data?: Record<string, unknown>): Promise<T> {
  return request<T>({ url, method: 'PUT', data });
}

/** PATCH 快捷方法 */
export function patch<T = unknown>(url: string, data?: Record<string, unknown>): Promise<T> {
  return request<T>({ url, method: 'PATCH', data });
}

/** DELETE 快捷方法 */
export function del<T = unknown>(url: string): Promise<T> {
  return request<T>({ url, method: 'DELETE' });
}
