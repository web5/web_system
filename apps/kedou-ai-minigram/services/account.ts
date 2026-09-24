/**
 * 账号绑定：手机号（微信一键获取）/ 邮箱（验证码）+ 冲突合并
 *
 * 口径（requirements-mp-account.md R2/R3，Q15 = c 合并账号）：
 * - 号码/邮箱只能由服务端获取或校验，前端不传号码明文
 * - 冲突（409）时前端必须二次确认，再带 confirmMerge 重发 —— 绝不静默覆盖
 * - 合并成功后服务端重签凭证，前端须 setToken 后再刷新身份
 */
import { get, post, setToken } from '../utils/request';

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

/** 当前账号信息（/api/auth/verify 已带黑名单校验） */
export function fetchProfile(): Promise<ProfileInfo> {
  return get<ProfileInfo>('/api/auth/verify');
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
export function readConflict(err: any): BindConflict | null {
  const data = err?.data;
  if (data && data.conflict === true) return data as BindConflict;
  return null;
}

/** 服务端错误文案（优先取 message，兼容数组形态） */
export function readMessage(err: any, fallback: string): string {
  const m = err?.data?.message;
  if (Array.isArray(m)) return String(m[0] || fallback);
  return String(m || fallback);
}
