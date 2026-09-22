/**
 * 用户口味档案（portal ↔ user-service，namespace = music）
 *
 * 与 AI 侧 save_music_taste 同源同一张表：这里给用户「看和改」。
 */
import request from '@/api/request';

export interface TasteData {
  likes: { genres: string[]; artists: string[]; moods: string[] };
  dislikes: { genres: string[]; artists: string[] };
  note?: string;
}

const EMPTY_TASTE: TasteData = {
  likes: { genres: [], artists: [], moods: [] },
  dislikes: { genres: [], artists: [] },
};

const BASE = '/user-taste/music';

/** 深层 Partial：标签增删只传要改的维度，不必凑齐 likes 的 genres/artists/moods */
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** 读取我的音乐口味（失败返回空结构，不阻塞页面） */
export async function getMusicTaste(): Promise<TasteData> {
  try {
    const res = (await request.get(BASE)) as { namespace?: string; taste?: TasteData };
    return res?.taste || EMPTY_TASTE;
  } catch {
    return EMPTY_TASTE;
  }
}

/** 增量补充标签 */
export async function addMusicTaste(patch: DeepPartial<TasteData>): Promise<TasteData> {
  const res = (await request.put(BASE, { taste: patch })) as { taste?: TasteData };
  return res?.taste || EMPTY_TASTE;
}

/** 删除指定标签（语义与补充相反） */
export async function removeMusicTaste(patch: DeepPartial<TasteData>): Promise<TasteData> {
  const res = (await request.delete(`${BASE}/tag`, { data: { taste: patch } })) as { taste?: TasteData };
  return res?.taste || EMPTY_TASTE;
}

/** 清空口味记忆 */
export async function clearMusicTaste(): Promise<TasteData> {
  const res = (await request.delete(BASE)) as { taste?: TasteData };
  return res?.taste || EMPTY_TASTE;
}

/** 我的页摘要：取前 N 个喜欢类标签，无则「未设置」 */
export function tasteSummary(taste: TasteData, limit = 3): string {
  const all = [...(taste?.likes?.genres || []), ...(taste?.likes?.artists || []), ...(taste?.likes?.moods || [])];
  return all.length ? all.slice(0, limit).join(' · ') : '未设置';
}
