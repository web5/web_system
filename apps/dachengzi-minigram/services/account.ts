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

/** 头像本地缓存 storage key（保存成功后落库，供「我的」页秒显/兜底） */
const AVATAR_STORAGE_KEY = 'kd_profile_avatar';
/** 昵称本地缓存 storage key（保存成功后落库，供「我的」页秒显/兜底） */
const NICKNAME_STORAGE_KEY = 'kd_profile_nickname';

/** 读本地持久化头像路径（读不到返回空串，交由渲染层兜底「橙」占位） */
export function readLocalAvatar(): string {
  try {
    return wx.getStorageSync(AVATAR_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

/** 读本地持久化昵称（读不到返回空串） */
export function readLocalNickname(): string {
  try {
    return wx.getStorageSync(NICKNAME_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

/** 写本地头像缓存（写失败不影响展示，吞掉） */
export function writeLocalAvatar(path: string): void {
  try {
    wx.setStorageSync(AVATAR_STORAGE_KEY, path);
  } catch {}
}

/** 写本地昵称缓存（写失败不影响展示，吞掉） */
export function writeLocalNickname(nickname: string): void {
  try {
    wx.setStorageSync(NICKNAME_STORAGE_KEY, nickname);
  } catch {}
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
 * 头像 URL 兜底：upload-service 返回相对路径（/api/uploads/avatars/<name>），
 * <image src> 直接渲染会被小程序按包内路径解析导致加载失败，须拼上 apiBase。
 * 兼容历史已落库的相对 URL；本机临时路径（wxfile://、http://tmp/…）与完整 URL 原样返回。
 */
export function resolveAvatarUrl(url?: string): string {
  const u = (url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u) || /^wxfile:\/\//i.test(u)) return u;
  if (u.startsWith('/')) {
    const base = getUploadBase();
    return base ? `${base.replace(/\/+$/, '')}${u}` : u;
  }
  return u;
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
        // wx.uploadFile 的 res.data 是**字符串**（与 wx.request 不同，不按 content-type 自动解析）。
        // 直接 reject(res) 会让公共函数 readMessage/readConflict 取 `err.data.message`（对象路径）
        // 永远拿不到 → 恒回落 fallback 文案。故先就地尝试解析一次；非 JSON（网关异常页/代理报错）
        // 则保留原始字符串原样透出，由上层回落 fallback。
        if (typeof res.data === 'string') {
          try {
            (res as unknown as { data: unknown }).data = JSON.parse(res.data);
          } catch {
            // 非 JSON：保留原始字符串
          }
        }
        // 成功判据统一 2xx（不只 200）：upload-service / 网关按 POST 语义返回 201 Created 时
        // 仍是成功。与 services/auth.ts:95 的 `>= 200 && < 300` 同口径。
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const body = res.data as unknown as { data?: { url?: unknown } } | null | undefined;
          const url = body?.data?.url;
          if (typeof url === 'string' && url) {
            resolve(url);
            return;
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

/**
 * 发送邮箱验证码（限频与 503 由服务端返回，错误路径由 request 层 toast+reject，页面 catch 展示）。
 * 成功提示由页面使用固定文案「验证码已发送，请查收」，不依赖后端 message ——
 * user-service 全局信封 { code, data, message: 'success' }，若解包/透出会把英文 success 带上 toast。
 */
export function sendEmailCode(email: string): Promise<void> {
  return post<unknown>('/api/users/email/code', { email }).then(() => undefined);
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
