import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserTasteProfileEntity } from './user-taste-profile.entity';

/** 口味数据结构（一期 music；前端扁平展示，后端按三类存） */
export interface TasteData {
  likes: { genres: string[]; artists: string[]; moods: string[] };
  dislikes: { genres: string[]; artists: string[] };
  note?: string;
}

export const EMPTY_TASTE: TasteData = {
  likes: { genres: [], artists: [], moods: [] },
  dislikes: { genres: [], artists: [] },
};

/** 单类标签上限：防止无限积累污染 prompt */
const TAG_LIMIT = 20;

@Injectable()
export class UserTasteService {
  constructor(
    @InjectRepository(UserTasteProfileEntity)
    private readonly tasteRepo: Repository<UserTasteProfileEntity>,
  ) {}

  /** 读取口味档案；不存在返回空结构（不落库，避免读操作写库） */
  async getTaste(userId: string, namespace = 'music'): Promise<TasteData> {
    const row = await this.tasteRepo.findOne({ where: { userId, namespace } });
    if (!row || !row.data) return structuredClone(EMPTY_TASTE);
    return this.normalize(row.data);
  }

  /** 合并写入口味档案（增量 merge，去重 + 上限截断） */
  async mergeTaste(userId: string, patch: Partial<TasteData>, namespace = 'music'): Promise<TasteData> {
    const current = await this.getTaste(userId, namespace);
    const next: TasteData = {
      likes: {
        genres: mergeList(current.likes.genres, patch.likes?.genres),
        artists: mergeList(current.likes.artists, patch.likes?.artists),
        moods: mergeList(current.likes.moods, patch.likes?.moods),
      },
      dislikes: {
        genres: mergeList(current.dislikes.genres, patch.dislikes?.genres),
        artists: mergeList(current.dislikes.artists, patch.dislikes?.artists),
      },
      note: patch.note ?? current.note,
    };

    let row = await this.tasteRepo.findOne({ where: { userId, namespace } });
    if (!row) {
      row = this.tasteRepo.create({ userId, namespace, data: next });
    } else {
      row.data = next;
    }
    await this.tasteRepo.save(row);
    return next;
  }

  /** 移除指定标签（差集，不新增；未命中的标签静默忽略） */
  async removeTaste(userId: string, patch: Partial<TasteData>, namespace = 'music'): Promise<TasteData> {
    const current = await this.getTaste(userId, namespace);
    const next: TasteData = {
      likes: {
        genres: subtractList(current.likes.genres, patch.likes?.genres),
        artists: subtractList(current.likes.artists, patch.likes?.artists),
        moods: subtractList(current.likes.moods, patch.likes?.moods),
      },
      dislikes: {
        genres: subtractList(current.dislikes.genres, patch.dislikes?.genres),
        artists: subtractList(current.dislikes.artists, patch.dislikes?.artists),
      },
      note: current.note,
    };

    const row = await this.tasteRepo.findOne({ where: { userId, namespace } });
    if (row) {
      row.data = next;
      await this.tasteRepo.save(row);
    }
    return next;
  }

  /** 清空某个偏好域 */
  async clearTaste(userId: string, namespace = 'music'): Promise<TasteData> {
    const row = await this.tasteRepo.findOne({ where: { userId, namespace } });
    const empty = structuredClone(EMPTY_TASTE);
    if (!row) return empty;
    row.data = empty;
    await this.tasteRepo.save(row);
    return empty;
  }

  /** 兜底：脏数据/旧结构也不让下游崩 */
  private normalize(raw: unknown): TasteData {
    const src = (raw ?? {}) as Record<string, any>;
    const likes = (src.likes ?? {}) as Record<string, unknown>;
    const dislikes = (src.dislikes ?? {}) as Record<string, unknown>;
    return {
      likes: {
        genres: toStrArray(likes.genres),
        artists: toStrArray(likes.artists),
        moods: toStrArray(likes.moods),
      },
      dislikes: {
        genres: toStrArray(dislikes.genres),
        artists: toStrArray(dislikes.artists),
      },
      note: typeof src.note === 'string' ? src.note : undefined,
    };
  }
}

function mergeList(current: string[], incoming?: unknown): string[] {
  const add = toStrArray(incoming);
  if (!add.length) return current;
  const merged: string[] = [...current];
  for (const v of add) {
    if (!merged.includes(v)) merged.push(v);
  }
  return merged.slice(0, TAG_LIMIT);
}

function subtractList(current: string[], outgoing?: unknown): string[] {
  const drop = toStrArray(outgoing);
  if (!drop.length) return current;
  return current.filter((v) => !drop.includes(v));
}

function toStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, TAG_LIMIT);
}
