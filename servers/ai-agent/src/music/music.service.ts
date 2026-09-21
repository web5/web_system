import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MusicProvider } from './music-provider.entity';
import { UserTasteProfile } from './user-taste-profile.entity';

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
/** appid 未真机确认时的占位值 */
const PLACEHOLDER_PREFIX = 'PENDING';

export interface MusicProviderDto {
  code: string;
  name: string;
  appId: string | null;
  entryType: string;
  searchTemplate: string | null;
  icon: string | null;
  /** appid 是否已就绪（未就绪时前端降级为「复制歌名去搜索」） */
  ready: boolean;
}

@Injectable()
export class MusicService {
  private readonly logger = new Logger(MusicService.name);

  constructor(
    @InjectRepository(MusicProvider)
    private readonly providerRepo: Repository<MusicProvider>,
    @InjectRepository(UserTasteProfile)
    private readonly tasteRepo: Repository<UserTasteProfile>,
  ) {}

  /** 已启用渠道（sort 升序），供工具下发给 Agent */
  async listProviders(): Promise<MusicProviderDto[]> {
    const rows = await this.providerRepo.find({
      where: { enabled: true },
      order: { sort: 'ASC', id: 'ASC' },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      appId: r.appId,
      entryType: r.entryType,
      searchTemplate: r.searchTemplate,
      icon: r.icon,
      ready: this.isReady(r),
    }));
  }

  /**
   * 取一个可用渠道：指定 code 优先（须已启用），否则取 sort 最小的已启用渠道。
   * 全部不可用时返回 null → 调用方降级，不抛错。
   */
  async resolveProvider(code?: string): Promise<MusicProvider | null> {
    if (code) {
      const hit = await this.providerRepo.findOne({ where: { code, enabled: true } });
      if (hit) return hit;
      this.logger.warn(`渠道 ${code} 不可用（不存在或已禁用），回退到默认渠道`);
    }
    const [first] = await this.providerRepo.find({
      where: { enabled: true },
      order: { sort: 'ASC', id: 'ASC' },
      take: 1,
    });
    return first ?? null;
  }

  isReady(provider: Pick<MusicProvider, 'appId'>): boolean {
    return !!provider.appId && !provider.appId.startsWith(PLACEHOLDER_PREFIX);
  }

  /** 用歌名渲染定位路径；无模板时返回 null（跳转首页） */
  buildPath(provider: MusicProvider, keyword: string): string | null {
    if (!provider.searchTemplate) return null;
    return provider.searchTemplate.replace('{keyword}', encodeURIComponent(keyword));
  }

  /** 读取口味档案；不存在返回空结构（不落库，避免读操作写库） */
  async getTaste(userId: string, namespace = 'music'): Promise<TasteData> {
    const row = await this.tasteRepo.findOne({ where: { userId, namespace } });
    if (!row || !row.data) return structuredClone(EMPTY_TASTE);
    return this.normalize(row.data);
  }

  /**
   * 合并写入口味档案（增量 merge，去重 + 上限截断）。
   * patch 里未出现的分组保持原值；数组做并集而非覆盖。
   */
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

  /**
   * 移除指定标签（口味页单个标签的 ×）。
   * 与 mergeTaste 反向：只做差集，不新增；未命中的标签静默忽略。
   */
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

  /** 清空某个偏好域（口味页「清空口味记忆」） */
  async clearTaste(userId: string, namespace = 'music'): Promise<TasteData> {
    const row = await this.tasteRepo.findOne({ where: { userId, namespace } });
    const empty = structuredClone(EMPTY_TASTE);
    if (!row) return empty;
    row.data = empty;
    await this.tasteRepo.save(row);
    return empty;
  }

  /** 把口味渲染进 prompt 的文本块；无内容返回 null（不注入空档案） */
  static formatForPrompt(taste: TasteData): string | null {
    const parts: string[] = [];
    const likes: string[] = [];
    if (taste.likes.genres.length) likes.push(`风格：${taste.likes.genres.join('、')}`);
    if (taste.likes.artists.length) likes.push(`歌手：${taste.likes.artists.join('、')}`);
    if (taste.likes.moods.length) likes.push(`场景/情绪：${taste.likes.moods.join('、')}`);
    if (likes.length) parts.push(`喜欢 → ${likes.join('；')}`);

    const dislikes: string[] = [];
    if (taste.dislikes.genres.length) dislikes.push(`风格：${taste.dislikes.genres.join('、')}`);
    if (taste.dislikes.artists.length) dislikes.push(`歌手：${taste.dislikes.artists.join('、')}`);
    if (dislikes.length) parts.push(`不想听 → ${dislikes.join('；')}`);
    if (taste.note) parts.push(`备注：${taste.note}`);

    if (!parts.length) return null;
    return `[用户口味档案]\n${parts.join('\n')}`;
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
