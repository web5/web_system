import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SERVICE_URL_DEFAULTS } from '@web-system/shared';
import { MusicProvider } from './music-provider.entity';

/** 口味数据结构（一期 music；与 user-service 的 user-taste 同结构） */
export interface TasteData {
  likes: { genres: string[]; artists: string[]; moods: string[] };
  dislikes: { genres: string[]; artists: string[] };
  note?: string;
}

export const EMPTY_TASTE: TasteData = {
  likes: { genres: [], artists: [], moods: [] },
  dislikes: { genres: [], artists: [] },
};

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

/**
 * 音乐推荐能力。
 * - provider（渠道）仍本地读 ai-agent 库（music_providers 表）。
 * - 口味（user_taste_profiles）已迁到 user-service，本类通过 internal 接口代理读写。
 *   方法签名不变，故 SaveMusicTasteTool / DbConversationMemory.loadProfile 无需改动。
 */
@Injectable()
export class MusicService {
  private readonly logger = new Logger(MusicService.name);
  private readonly userServiceUrl: string;
  private readonly serviceKey: string;

  constructor(
    @InjectRepository(MusicProvider)
    private readonly providerRepo: Repository<MusicProvider>,
    private readonly configService: ConfigService,
  ) {
    this.userServiceUrl = this.configService.get<string>('USER_SERVICE_URL', SERVICE_URL_DEFAULTS.user);
    this.serviceKey = this.configService.get<string>('USER_SERVICE_KEY', '');
  }

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

  /** 取一个可用渠道：指定 code 优先（须已启用），否则取 sort 最小；全部不可用返回 null */
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

  /** 读取口味档案（经 user-service internal；失败返回空结构，不阻塞） */
  async getTaste(userId: string, namespace = 'music'): Promise<TasteData> {
    try {
      const data = await this.callInternal<{ taste?: TasteData }>(
        `/internal/user-taste/get?userId=${encodeURIComponent(userId)}&namespace=${encodeURIComponent(namespace)}`,
      );
      return data?.taste ?? structuredClone(EMPTY_TASTE);
    } catch (e) {
      this.logger.warn(`读取用户口味失败，返回空结构: ${(e as Error).message}`);
      return structuredClone(EMPTY_TASTE);
    }
  }

  /** 合并写入口味档案（经 user-service internal） */
  async mergeTaste(userId: string, patch: Partial<TasteData>, namespace = 'music'): Promise<TasteData> {
    const data = await this.callInternal<{ taste?: TasteData }>('/internal/user-taste/merge', {
      method: 'POST',
      body: JSON.stringify({ userId, namespace, patch }),
    });
    return data?.taste ?? structuredClone(EMPTY_TASTE);
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

  /** 统一调 user-service internal 接口，解 TransformInterceptor 的 { code, data } 包装 */
  private async callInternal<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.userServiceUrl.replace(/\/$/, '')}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-service-key': this.serviceKey,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`user-service internal ${path} 返回 ${res.status}`);
    }
    const body = (await res.json()) as { code?: number; data?: unknown };
    return (body?.data ?? body) as T;
  }
}
