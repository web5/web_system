/**
 * 用户口味档案（小程序 ↔ user-service）
 *
 * 与 AI 侧 save_music_taste 同源同一张表（已迁 user-service）：
 * 这里给用户「看和改」，那边给 AI「读和写」。
 * user-service 有全局 TransformInterceptor，响应统一包 { code, data, message }，故取 res.data。
 */
import { get, put, del, request } from '../utils/request';

export interface TasteData {
  likes: { genres: string[]; artists: string[]; moods: string[] };
  dislikes: { genres: string[]; artists: string[] };
  note?: string;
}

export const EMPTY_TASTE: TasteData = {
  likes: { genres: [], artists: [], moods: [] },
  dislikes: { genres: [], artists: [] },
};

const BASE = '/api/user-taste/music';

interface TasteResp {
  namespace?: string;
  taste?: TasteData;
}

/** user-service 统一响应包装 */
interface Wrapped<T> {
  code: number;
  data: T;
  message?: string;
}

/** 读取我的音乐口味（失败时返回空结构，不阻塞页面） */
export async function getMusicTaste(): Promise<TasteData> {
  try {
    const res = await get<Wrapped<TasteResp>>(BASE);
    return res?.data?.taste || EMPTY_TASTE;
  } catch {
    return EMPTY_TASTE;
  }
}

/** 增量补充标签 */
export async function addMusicTaste(patch: Partial<TasteData>): Promise<TasteData> {
  const res = await put<Wrapped<TasteResp>>(BASE, { taste: patch });
  return res?.data?.taste || EMPTY_TASTE;
}

/** 删除指定标签（结构与补充一致，语义相反；DELETE 带 body 故直接用 request） */
export async function removeMusicTaste(patch: Partial<TasteData>): Promise<TasteData> {
  const res = await request<Wrapped<TasteResp>>({
    url: `${BASE}/tag`,
    method: 'DELETE',
    data: { taste: patch },
  });
  return res?.data?.taste || EMPTY_TASTE;
}

/** 清空口味记忆 */
export async function clearMusicTaste(): Promise<TasteData> {
  const res = await del<Wrapped<TasteResp>>(BASE);
  return res?.data?.taste || EMPTY_TASTE;
}

/** 我的页摘要：取前 3 个喜欢类标签，无则「未设置」 */
export function tasteSummary(taste: TasteData, limit = 3): string {
  const all = [
    ...(taste?.likes?.genres || []),
    ...(taste?.likes?.artists || []),
    ...(taste?.likes?.moods || []),
  ];
  return all.length ? all.slice(0, limit).join(' · ') : '未设置';
}
