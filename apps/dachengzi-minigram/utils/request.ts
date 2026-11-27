/**
 * 网络请求工具 — 封装 wx.request
 * 自动携带 JWT Token，401 时触发重新登录
 */

import { API_TIMEOUT } from './constants';
import { normalizeMessage } from './error-message';

const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
/** 用户主动退出的标志位：与「token 过期」区分 —— 此状态下不得自动重新登录 */
const LOGGED_OUT_KEY = 'account_logged_out';

/**
 * 「先确保登录」这一步的等待上限（毫秒）。
 *
 * 为什么需要：loginEnsurer → ensureLogin → login() 这条链上的 wx.login 没有超时，
 * 且 loginPromise 是全局单例 —— 一次悬挂会让**本次及此后所有**无 token 请求永久
 * pending（不发请求、不报错、页面永久骨架屏，台账 #8687）。这里包一层硬超时，
 * 超时后按「未登录」处理，让请求走 reject 而非无限挂起。
 *
 * 为什么是 5s：登录链路本身已有 8s（wx.login）+ 10s（登录 POST）两段上限，
 * 请求侧不该等满两段；5s 足够覆盖正常首启登录，超过即视为异常并让上层转异常态。
 */
const LOGIN_ENSURE_TIMEOUT = 5_000;

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

/** 静默重登进行中标志：并发 401 只触发一次重登，避免多个请求同时弹登录墙 */
let isRelogging = false;

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

/**
 * 失败文案提取（纯函数 · 只读）—— 治本 · 51 §4 D1（11-20 用户「合理实现」授权）。
 *
 * 「文案提取与展示分离」：doRequest 三条失败路径（HTTP 非 2xx / ai-agent 错误信封 /
 * fail(err)）与两处本地 throw 都只 reject / throw，不再各自拼文案、各自弹 toast；
 * request() 顶层 catch 作为唯一出口，从这里按错误对象形态推导 rawMessage / fallback。
 *
 * 🔴 全程只读 err，绝不写入任何属性：
 *   - reject 的错误对象形态保持不变（statusCode / message / __unauthorized 原样透出），
 *     上层与既有测试依赖这些字段，禁止包装成 { cause, ... } 之类新结构；
 *   - 旧实现把 __toastShown 写进外部错误对象做去重，冻结 / 不可扩展对象赋值抛
 *     TypeError 被 try/catch 吞掉 → 顶层兜底再弹一次（51 §4 D1 实跑 showToastCount=2）。
 *     不写状态就彻底消除 frozen / Proxy / 不可扩展 / 原始值 err 这一整类反例。
 */
function extractFailureMessage(err: unknown): { rawMessage: unknown; fallback: string } {
  const res = err as { statusCode?: unknown; data?: unknown } | null | undefined;
  const body = res?.data;
  const statusCode = res?.statusCode;
  const isHttp2xx =
    typeof statusCode === 'number' && statusCode >= 200 && statusCode < 300;
  // ai-agent 统一异常过滤器：仅 HTTP 2xx + { code, message, data: null }（code 非 0）。
  // 加 2xx 守卫：避免某个恰好带 code+message 的 4xx body 被误判成信封、拿错 fallback。
  if (isHttp2xx && isAiAgentErrorEnvelope(body)) {
    return { rawMessage: body.message, fallback: `请求失败 (${body.code})` };
  }
  // HTTP 非 2xx（含 304 未变更）：message 可能是 class-validator 数组 / 嵌套对象 / string
  if (typeof statusCode === 'number' && (statusCode < 200 || statusCode >= 300)) {
    const data = body as { message?: unknown } | null | undefined;
    return { rawMessage: data?.message, fallback: `请求失败 (${statusCode})` };
  }
  // fail(err) 网络层错误：基础库给的是普通对象（如 { errMsg }），不是 Error 实例
  if (!(err instanceof Error)) {
    return { rawMessage: undefined, fallback: '网络请求失败' };
  }
  // 本地 throw（url 非法 / 应用未初始化）：无任何 UI 承接，泛化兜底
  return { rawMessage: undefined, fallback: '网络异常，请重试' };
}

/**
 * 展示失败提示的**唯一出口** —— 治本 · 51 §4 D1（11-20 用户「合理实现」授权）。
 * - 只在 request() 顶层 catch 调用一次；「非 silent 且失败 ⇒ 有且仅有一条可见 toast」
 *   由「只调用一次」结构性保证，不依赖任何去重标记，也就不需要读 / 写错误对象。
 * - message 经 utils/error-message.ts 的 normalizeMessage 归一化，title 恒为 string。
 *
 * 🔴 契约边界（2026-11-20 lead 选项 2 裁决，依据 V6 门
 *    tests/request-login-timeout.test.ts:111-122，8688 复核人审约束）：
 *    「!token → NOT_LOGGED_IN」是登录态信号，由 login-gate / modal-login 专门 UI 承接，
 *    顶层刻意不调用本函数 —— 页面层与请求层都不弹。判据原则是「是否有其它 UI 通道承接」，
 *    不是「是否 throw」。切勿以「本地 throw 也该弹」为由把它「补」回去：那会与 V6 门 3 条
 *    断言冲突，且并发页面数据拉取会刷屏、与登录墙重复提示。
 *    401 / ai-agent 4010 带 __unauthorized，提示由 handleUnauthorized 负责，同样不进本函数。
 */
function notifyFailure(options: RequestOptions, rawMessage: unknown, fallback: string): void {
  if (options.silent) return;
  wx.showToast({ title: normalizeMessage(rawMessage, fallback), icon: 'none' });
}

/** 通用请求方法 */
export async function request<T = unknown>(options: RequestOptions): Promise<T> {
  try {
    // 不变量：业务接口一律走 /api 前缀。漏写前缀的 URL 会被网关 SPA 兜底成
    // 200 + shell HTML（2026-11-11 appearance.ts '/users/me' 实测），2xx 判据
    // 会把壳当成功吞掉且静默出错——在此显式失败，把运行时诡异提前为开发期显错。
    if (!options.url.startsWith('/api/')) {
      const err = new Error(`[request] url 必须以 /api/ 开头，收到: ${options.url}`);
      console.error(err.message);
      throw err;
    }
    // 优先 storage 读 baseUrl（避免 wx.getApp 在异步栈里抛错）
    const baseUrl = getApiBase();
    if (!baseUrl) {
      throw new Error('应用未初始化，请稍后重试或重启小程序');
    }

    // 首次启动时 App.onLaunch 的 autoLogin 是异步的，首屏页面请求可能早于登录完成；
    // 无 token 时先「确保登录」再发请求，避免发出无 token 请求 → 401 → 误触发掉线。
    // ⚠️ 用户已主动退出时不自动重登，否则「退出登录」点了等于没点。
    if (!getToken() && !isLoggedOut() && loginEnsurer) {
      // ⚠️ 自动登录必须包硬超时：底层 wx.login 无超时且 loginPromise 是全局单例，
      // 一次悬挂就拖死所有无 token 请求（永停 loading 的根因之一，台账 #8687）。
      // 超时/失败**不在这里抛**，统一落到下面的 `!token` 分支抛 NOT_LOGGED_IN ——
      // 与「本来就没有 token」同口径，上层 `.catch(() => null)` 能正常接住，
      // 页面转异常态而不是变成未捕获 rejection。
      let ensureTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          loginEnsurer(),
          new Promise<never>((_resolve, reject) => {
            ensureTimer = setTimeout(
              () => reject(new Error('NOT_LOGGED_IN')),
              LOGIN_ENSURE_TIMEOUT,
            );
          }),
        ]);
      } catch {
        // 登录失败 / 超时：不再重试，交由下面的 `!token` 分支统一按未登录处理
      } finally {
        // 正常登录成功时也要收掉计时器：否则它会在 5s 后 reject 一个没人 await 的
        // Promise（未捕获 rejection），且留下悬挂 handle。
        if (ensureTimer !== undefined) clearTimeout(ensureTimer);
      }
    }
    const token = getToken();
    if (!token) {
      // 未登录（含主动退出态）：不发无 token 请求，交由上层引导登录
      throw new Error('NOT_LOGGED_IN');
    }

    const doRequest = (tk: string): Promise<T> =>
      new Promise<T>((resolve, reject) => {
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
            ...(tk ? { Authorization: `Bearer ${tk}` } : {}),
            ...options.header,
          },
          success(res) {
            try {
            // 成功判据统一 2xx（不只 200）：201 Created / 204 No Content 都是合法成功。
            // 与 services/auth.ts:95 的 `>= 200 && < 300` 同口径；304 Not Modified 属未变更，
            // 业务 body 拿不到，仍走失败分支（不得放宽为「所有 3xx」）。
            //
            // 🔴 三条失败路径一律只 reject、不弹 toast：提示统一由 request() 顶层 catch
            //    一次出口负责（51 §4 D1 顶层单一出口）。文案由 extractFailureMessage(err)
            //    只读提取，reject 的错误对象形态一字不改 —— 冻结 / 不可扩展 / Proxy /
            //    原始值 err 天然只弹一次，不再有「两处都可能弹」的复杂度。
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const body = res.data as unknown;
              if (isAiAgentErrorEnvelope(body)) {
                if (body.code === 4010) {
                  // ai-agent 未授权/缺 token：标记未授权，交由 request() 统一静默重登重试
                  reject({ ...res, __unauthorized: true });
                  return;
                }
                reject(res);
                return;
              }
              resolve(res.data as T);
            } else if (res.statusCode === 401) {
              // HTTP 401：标记未授权，交由 request() 统一静默重登重试
              reject({ ...res, __unauthorized: true });
            } else {
              reject(res);
            }
            } catch (e) {
              // 🔴 #8949 settle 边界：R1 已把未授权信号改由【本地新建对象】承载、外部 res
              //    只读摊平绝不写入；但外部 res 在【读取阶段】仍可能抛错（Proxy get trap、
              //    畸形 getter），异常发生在 wx 异步回调里无人接，reject/resolve 漏调 ⇒
              //    promise 永久 PENDING。此处把同步异常【原样转 reject(e)，绝不吞】，
              //    保证 promise 必 settle，异常仍由顶层唯一出口感知并恰 1 条 toast。
              //    ⚠️ 这不是「给 Object.assign(res, ...) 兜底」：主修复已彻底不写外部 res，
              //       本边界不承担掩盖写异常的职能（W 方案已否决）。
              reject(e);
            }
          },
          fail(err) {
            reject(err);
          },
        });
      });

    try {
      return await doRequest(token);
    } catch (res) {
      const is401 = (res as any)?.__unauthorized === true;
      // 静默重登：401 且非主动登出、非 silent、有 loginEnsurer、当前无并发重登时，
      // 先确保登录成功，再用新 token 重试一次；仍失败则走 handleUnauthorized。
      if (is401 && !isLoggedOut() && !options.silent && loginEnsurer && !isRelogging) {
        isRelogging = true;
        try {
          const ok = await Promise.race([
            loginEnsurer(),
            new Promise<false>((r) => setTimeout(() => r(false), LOGIN_ENSURE_TIMEOUT)),
          ]);
          if (ok) {
            const nt = getToken();
            if (nt) return await doRequest(nt);
          }
        } finally {
          isRelogging = false;
        }
      }
      if (is401) handleUnauthorized(token, options);
      throw res;
    }
  } catch (err) {
    // 顶层唯一失败提示出口（治本 · 51 §4 D1 / 11-20 用户「合理实现」授权）：
    // - doRequest 三条失败路径（HTTP 非 2xx / ai-agent 非 4010 错误信封 / fail(err)）
    //   只 reject 不弹；url 非法 / 应用未初始化 两处本地 throw 也无 UI 承接 ——
    //   全部在此收敛为**一次** wx.showToast。「有且仅有一条」由「只调用一次」结构性保证，
    //   不再依赖写进错误对象的去重标记：冻结 / 不可扩展 / Proxy / 原始值 err 天然只弹一次
    //   （51 §4 D1 反例：Object.freeze(res) 旧实现 showToastCount=2）。
    // - 文案提取与展示分离：extractFailureMessage(err) 只读推导 rawMessage / fallback，
    //   交给 notifyFailure 归一化后展示；全程不写 err，reject 形态（statusCode / message /
    //   __unauthorized）保持不变，上层与既有测试依赖不变。
    // - 「!token → NOT_LOGGED_IN」是登录态信号，由 login-gate / modal-login 承接，按 V6 门
    //   （tests/request-login-timeout.test.ts:111-122，8688 复核）刻意保持静默 ——
    //   页面层与请求层都不弹。判据原则是「是否有其它 UI 通道承接」，不是「是否 throw」；
    // - 401 / ai-agent 4010 带 __unauthorized，登录态提示由 handleUnauthorized 负责，此处不重复；
    // - silent:true 全程不弹（notifyFailure 内部亦判 silent，登出 auth.ts:61 保持静默）；
    // - 401 重登成功后 return await doRequest(nt) 若第二次失败会冒泡到此处，同样恰 1 条。
    const isNotLoggedIn = err instanceof Error && err.message === 'NOT_LOGGED_IN';
    if (
      !options.silent &&
      !(err as { __unauthorized?: boolean } | null)?.__unauthorized &&
      !isNotLoggedIn
    ) {
      const { rawMessage, fallback } = extractFailureMessage(err);
      notifyFailure(options, rawMessage, fallback);
    }
    throw err;
  }
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
