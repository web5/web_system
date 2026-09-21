import { Injectable } from '@nestjs/common';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema } from '@kedouai/agent-core';
import { MusicService } from '../music.service';

interface IncomingSong {
  title?: string;
  artist?: string;
  reason?: string;
}

/**
 * 产出「歌曲推荐卡片」。
 *
 * 工具本身只负责**构造并校验卡片载荷**，真正的 SSE `card` 事件由
 * AgentController 在收到本工具的 tool_result 时补发（保持引擎不变）。
 * 返回的 JSON 同时是落库内容，历史回看才能还原卡片（而不是退化成文本）。
 */
@Injectable()
export class PresentMusicCardTool implements ToolDefinition {
  readonly name = 'present-music-card';
  readonly description =
    '向用户展示歌曲推荐卡片（1–3 首）。当用户想听歌 / 要推荐音乐时使用：每首给出歌名、歌手和一句贴合用户口味的推荐理由。卡片上的跳转目标由 providerCode 决定；不传则用默认渠道。';
  readonly parameters = {
    songs: {
      type: 'array' as const,
      description: '1–3 首歌曲，每项含 title（歌名，必填）、artist（歌手）、reason（一句推荐理由）',
      required: true,
      items: {
        type: 'object' as const,
        description: '单首歌曲',
        properties: {
          title: { type: 'string' as const, description: '歌名' },
          artist: { type: 'string' as const, description: '歌手' },
          reason: { type: 'string' as const, description: '一句推荐理由（结合用户口味/场景）' },
        },
      },
    },
    providerCode: {
      type: 'string' as const,
      description: '渠道 code，取自 list-music-providers；不传用默认渠道',
      required: false,
    },
    keyword: {
      type: 'string' as const,
      description: '跳转时用于搜索定位的关键词，默认取第一首歌名',
      required: false,
    },
  };

  constructor(private readonly music: MusicService) {}

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: {
            songs: {
              type: 'array',
              description: '1–3 首歌曲',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: '歌名' },
                  artist: { type: 'string', description: '歌手' },
                  reason: { type: 'string', description: '推荐理由' },
                },
              },
            },
            providerCode: { type: 'string', description: '渠道 code' },
            keyword: { type: 'string', description: '搜索关键词' },
          },
          required: ['songs'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const rawSongs = Array.isArray(args.songs) ? (args.songs as IncomingSong[]) : [];
    const songs = rawSongs
      .map((s) => ({
        title: String(s?.title ?? '').trim(),
        artist: String(s?.artist ?? '').trim(),
        reason: String(s?.reason ?? '').trim(),
      }))
      .filter((s) => s.title)
      .slice(0, 3);

    if (!songs.length) {
      return { success: false, content: '', error: 'songs 不能为空，且每首必须有 title' };
    }

    const provider = await this.music.resolveProvider(args.providerCode ? String(args.providerCode) : undefined);
    if (!provider) {
      return {
        success: false,
        content: '',
        error: '没有可用的音乐渠道，请用文字推荐歌曲（不要编造跳转按钮）',
      };
    }

    const keyword = String(args.keyword ?? songs[0].title).trim() || songs[0].title;
    const payload = {
      kind: 'music',
      provider: {
        code: provider.code,
        name: provider.name,
        appId: provider.appId,
        entryType: provider.entryType,
        path: this.music.buildPath(provider, keyword),
        ready: this.music.isReady(provider),
      },
      songs,
      keyword,
    };

    return { success: true, content: JSON.stringify(payload) };
  }
}
