/**
 * 小程序登录服务
 *
 * 流程：
 *   1. wx.login() 获取 code
 *   2. 将 code 发送到后端 /api/auth/miniprogram-login
 *   3. 后端调用微信 jscode2session 获取 openid
 *   4. 后端查找/创建用户，生成 JWT Token 返回
 *   5. 小程序存储 Token，标记登录成功
 */

import { getToken, setToken, clearToken, setLoginEnsurer, isLoggedOut, setLoggedOut, request } from '../utils/request';

const AUTH_API = '/api/auth/miniprogram-login';
const LOGOUT_API = '/api/auth/logout';

/**
 * wx.login 的等待上限（毫秒）。
 *
 * wx.login 是回调式 API，没有 timeout 参数：真机偶发不回调时 Promise 永不 settle，
 * 而 loginPromise 是全局单例（见 ensureLogin）—— 一次悬挂会让该次及此后所有
 * 无 token 请求永久 pending，页面表现为「永停 loading」（台账 #8687）。
 *
 * 为什么是 8s：正常 wx.login 在弱网下也能 1–3s 内回调，8s 足够宽松；
 * 同时要小于请求侧的整体等待容忍（列表请求 10s），避免登录链路比业务请求还慢。
 */
const WX_LOGIN_TIMEOUT = 8_000;

/**
 * 给 Promise 加硬超时：超时即 reject（调用方按普通失败处理，走原有 catch 路径）。
 *
 * 只用于「回调式 API 无超时参数」这类必然有悬挂风险的封装（如 wx.login）。
 * 计时器在 settle 后一律清掉，避免留下悬挂 handle / 迟到的未捕获 rejection。
 */
function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms 未回调）`)), ms);
  });
  return Promise.race([task, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** 检查是否已登录（主动退出态视为未登录） */
export function isLoggedIn(): boolean {
  return !!getToken() && !isLoggedOut();
}

/**
 * 退出登录：服务端作废凭证 + 本地清态。
 *
 * 口径（requirements-mp-account.md R1）：
 * - 服务端失败不阻塞本地退出（本地清态优先）；
 * - 清态后置「主动退出」标志，request 层与 ensureLogin 均据此不再自动重登；
 * - 只清本地态，不动服务端数据（会话 / 生词本重登后自然回来）。
 */
export async function logout(): Promise<void> {
  if (getToken()) {
    try {
      await request({ url: LOGOUT_API, method: 'POST', data: {}, silent: true, timeout: 3000 });
    } catch {
      // 服务端作废失败不阻塞：本地清态已足以让本机退出登录
    }
  }
  clearToken();
  setLoggedOut(true);
  clearLocalAccountState();
}

/** 清内存态与登录相关的本地缓存（不清用户设置项） */
function clearLocalAccountState(): void {
  try {
    wx.removeStorageSync('welcome_recent_cache');
  } catch {}
  try {
    const app = getApp<IAppOption>();
    if (app) {
      app.globalData.userInfo = null;
      app.globalData.token = '';
      app.globalData.refreshToken = '';
    }
  } catch {}
}

/**
 * 小程序登录
 */
export async function login(): Promise<void> {
  try {
    // wx.login 显式 Promise 封装（不依赖基础库 Promise 风格）
    // ⚠️ 必须包超时：真机偶发不回调会让 loginPromise（全局单例）永久悬挂（台账 #8687）
    const loginRes = await withTimeout(
      new Promise<WechatMiniprogram.LoginSuccessCallbackResult>((resolve, reject) => {
        wx.login({
          success: (r) => resolve(r),
          fail: (err) => reject(err),
        });
      }),
      WX_LOGIN_TIMEOUT,
      'wx.login',
    );
    const { code } = loginRes;
    if (!code) {
      throw new Error('wx.login 获取 code 失败');
    }

    // wx.request 不返回 Promise（原生返回 RequestTask），需手动 Promise 封装
    const res = await new Promise<WechatMiniprogram.RequestSuccessCallbackResult>(
      (resolve, reject) => {
        wx.request({
          url: `${getApp<IAppOption>().globalData.apiBase || ''}${AUTH_API}`,
          method: 'POST',
          data: { code, appId: (wx.getAccountInfoSync()?.miniProgram?.appId) || '' },
          timeout: 10000,
          header: {
            // 强制不压缩（gateway 启用 compression，开发者工具对 gzip 响应解析失败）
            'Accept-Encoding': 'identity',
          },
          success: (r) => resolve(r),
          fail: (err) => reject(err),
        });
      },
    );

    if (res.statusCode >= 200 && res.statusCode < 300 && res.data) {
      // user 字段与后端 User 实体对齐（含 username / roles），此前只写了 id/nickname/avatarUrl，
      // 与 globalData.userInfo: IUserInfo 对不上（IUserInfo 要求 username、roles）。
      // 字段名对齐：后端 generateToken 返回的是 avatar（非 avatarUrl），此前取 avatarUrl 会拿不到值。
      const data = res.data as {
        accessToken: string;
        refreshToken: string;
        user: { id: number; username: string; nickname?: string; avatar?: string; roles: string[] };
      };
      setToken(data.accessToken, data.refreshToken);
      // 登录成功即清除「主动退出」标志，恢复可用态
      setLoggedOut(false);
      const app = getApp<IAppOption>();
      app.globalData.userInfo = data.user;
      // 登录成功广播：与 request 层 401 的 auth:expired 完全对称，收口「首启静默登录竞态」——
      // autoLogin/ensureLogin 成功后各页收到即刷新登录态并重拉数据（不再依赖 onShow 同步判态）。
      try {
        app.eventBus?.emit('auth:logged');
      } catch {
        // getApp 不可用（极早期）：页面 onShow 仍会兜底刷新登录态
      }
    } else {
      throw new Error(`登录接口返回异常: ${res.statusCode} ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    console.error('[auth] 登录失败:', err);
    throw err;
  }
}

/**
 * 确保已登录（用于需要登录态的页面）。
 *
 * 单例化：并发调用（如 App.onLaunch 的 autoLogin 与首屏页面请求同时触发）只会发一次登录，
 * 避免重复 wx.login 换 code 造成浪费；成功/失败后重置，允许下次重试。
 */
let loginPromise: Promise<boolean> | null = null;

export function ensureLogin(): Promise<boolean> {
  if (isLoggedIn()) return Promise.resolve(true);
  // 用户主动退出：不得自动重登，否则「退出登录」形同无效
  if (isLoggedOut()) return Promise.resolve(false);
  if (!loginPromise) {
    loginPromise = login()
      .then(() => true)
      // 失败/超时都收敛为 false：login() 内部 wx.login 已带 8s 超时，必 reject 到此处
      .catch(() => false)
      .finally(() => {
        // 无论成功、失败还是超时都在这里重置，保证下一次调用会重新发起登录
        // （否则一次悬挂会让单例永久死锁，所有无 token 请求一起永挂 —— 台账 #8687）
        loginPromise = null;
      });
  }
  return loginPromise;
}

/**
 * 登录引导卡用：静默登录（wx.login 无授权弹窗、无验证码），返回是否成功。
 * 页面拿到 true 后自行刷新内容。
 */
export async function loginFromGate(): Promise<boolean> {
  wx.showLoading({ title: '登录中…', mask: true });
  let ok = false;
  try {
    await login();
    ok = true;
  } catch {
    /* 失败统一在 finally 之后提示（hideLoading 会连带收起同层 toast，顺序不能反） */
  } finally {
    // 遮罩必须在**所有**路径收起：原先只在 success/catch 里 hideLoading，
    // login() 悬挂时全屏 loading 就永久驻留（台账 #8687 §3.3）。
    // 悬挂的兜底由 login() 内部的 wx.login 超时（WX_LOGIN_TIMEOUT）保证 —— 它必 settle。
    wx.hideLoading();
  }
  if (!ok) {
    wx.showToast({ title: '登录失败，请重试', icon: 'none' });
  }
  return ok;
}

// 注入到 request 层：request.ts 不直接 import 本文件（会形成 request↔auth 循环依赖），
// 而是通过此钩子让「无 token 的请求」在发出前先走 ensureLogin。
setLoginEnsurer(ensureLogin);
