/**
 * 账号绑定：手机号（微信一键获取）/ 邮箱（验证码）+ 冲突合并
 *
 * 口径（requirements-mp-account.md R2/R3，Q15 = c 合并账号）：
 * - 号码/邮箱只能由服务端获取或校验，前端不传号码明文
 * - 冲突（409）时前端必须二次确认，再带 confirmMerge 重发 —— 绝不静默覆盖
 * - 合并成功后服务端重签凭证，前端须 setToken 后再刷新身份
 */
import { get, post, put, setToken, getToken } from '../utils/request';

export type BindSource = 'phone' | 'email';

export interface BindOk {
  conflict: false;
  bound: true;
  /** 与 MergeOk 互斥，供联合类型判别 */
  merged?: false;
  phone?: string;
  email?: string;
  boundAt: string;
  source: BindSource;
}

export interface BindConflict {
  conflict: true;
  /** 与 BindOk / MergeOk 互斥，供联合类型判别 */
  merged?: false;
  bound?: false;
  canMerge: boolean;
  maskedValue: string;
  hint: string;
  source: BindSource;
}

export interface MergeOk {
  conflict: false;
  merged: true;
  bound?: false;
  phone?: string;
  email?: string;
  source: BindSource;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type BindResult = BindOk | BindConflict | MergeOk;

export interface ProfileInfo {
  id: number;
  username: string;
  email?: string;
  nickname?: string;
  phone?: string;
  avatar?: string;
}

/** 后端响应兼容两种形态：信封 { code, data } 或直接返回 user 对象，统一取 user 对象 */
function unwrapProfile(res: unknown): ProfileInfo {
  const obj = res as { data?: unknown } | null;
  if (obj && typeof obj === 'object' && obj.data && typeof obj.data === 'object') {
    return obj.data as ProfileInfo;
  }
  return res as ProfileInfo;
}

/** 当前账号信息（/api/auth/verify 已带黑名单校验） */
export function fetchProfile(): Promise<ProfileInfo> {
  return get<unknown>('/api/auth/verify').then(unwrapProfile);
}

export type UpdateProfilePayload = {
  nickname?: string;
  avatar?: string;
};

/** 更新当前账号资料（昵称/头像）：PUT /api/users/me（user-service UserController，partial update） */
export function updateProfile(payload: UpdateProfilePayload): Promise<ProfileInfo> {
  return put<unknown>('/api/users/me', payload).then(unwrapProfile);
}

/**
 * 昵称是否「未设置」（前端展示层兜底，#8/#9）。
 * 后端 createMpUser 缺省回落会把 nickname 写成 `wx_` + openid 前 10 位的占位；
 * 空串或这类 `wx_` 前缀占位都按「未设置昵称」处理，避免展示乱码。
 */
export function isNicknameUnset(nickname?: string): boolean {
  const n = (nickname || '').trim();
  return !n || n.startsWith('wx_');
}

/** 取 apiBase：优先 storage，兜底 wx.getApp（与 utils/request.ts 同一口径）。
 *  wx.uploadFile 不走 request 封装，需自行取 base。 */
function getUploadBase(): string {
  try {
    const cached = wx.getStorageSync('api_base');
    if (cached) return cached;
  } catch {}
  try {
    const app = getApp<IAppOption>();
    if (app && app.globalData && app.globalData.apiBase) return app.globalData.apiBase;
  } catch {}
  return '';
}

/**
 * 上传头像到 upload-service：POST /api/upload/avatar（multipart，字段名 file，限 2MB）。
 * 鉴权为用户态 JWT（与小程序登录同一 token）。
 * @returns 后端可持久化的相对 URL（形如 /api/uploads/avatars/<filename>）
 */
export function uploadAvatar(filePath: string): Promise<string> {
  const base = getUploadBase();
  if (!base) return Promise.reject(new Error('应用未初始化，请稍后重试或重启小程序'));
  const token = getToken();
  return new Promise<string>((resolve, reject) => {
    wx.uploadFile({
      url: `${base.replace(/\/+$/, '')}/api/upload/avatar`,
      filePath,
      name: 'file',
      header: { Authorization: `Bearer ${token}` },
      success(res) {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(res.data) as { data?: { url?: unknown } };
            const url = parsed?.data?.url;
            if (typeof url === 'string' && url) {
              resolve(url);
              return;
            }
          } catch {
            // 响应非 JSON（网关异常页/代理报错）按上传失败处理
          }
        }
        reject(res);
      },
      fail(err) {
        reject(err);
      },
    });
  });
}

/** 绑定手机号：code 来自 button open-type="getPhoneNumber" 的回调 */
export function bindPhone(code: string, confirmMerge = false): Promise<BindResult> {
  return post<BindResult>('/api/auth/bind-phone', { code, channel: 'wechat', confirmMerge });
}

/** 绑定邮箱：code 为邮箱验证码 */
export function bindEmail(email: string, code: string, confirmMerge = false): Promise<BindResult> {
  return post<BindResult>('/api/auth/bind-email', { email, code, confirmMerge });
}

/** 发送邮箱验证码（限频与 503 由服务端返回，文案直接透出） */
export function sendEmailCode(email: string): Promise<{ message: string }> {
  return post<{ message: string }>('/api/users/email/code', { email });
}

/** 合并成功后落新凭证（sub 已切到目标账号） */
export function applyMergedToken(result: MergeOk): void {
  setToken(result.accessToken, result.refreshToken);
}

/** 冲突错误体识别：Nest 的 409 会 reject 出 res，data 即冲突结构 */
export function readConflict(err: unknown): BindConflict | null {
  const data = (err as { data?: unknown } | null | undefined)?.data;
  if (typeof data === 'object' && data !== null && (data as { conflict?: unknown }).conflict === true) {
    return data as BindConflict;
  }
  return null;
}

/** 服务端错误文案（优先取 message，兼容数组形态） */
export function readMessage(err: unknown, fallback: string): string {
  const m = (err as { data?: { message?: unknown } } | null | undefined)?.data?.message;
  if (Array.isArray(m)) return String(m[0] || fallback);
  if (typeof m === 'string') return m || fallback;
  return fallback;
}
