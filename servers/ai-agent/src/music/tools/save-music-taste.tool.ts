import { Injectable, Logger } from '@nestjs/common';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema } from '@kedouai/agent-core';
import { MusicService } from '../music.service';

/**
 * 记住用户的音乐口味（用户级、跨会话）。
 *
 * 触发时机：用户明确表达偏好（"我喜欢 jazz"、"来点安静的"）或明确否定
 * （"别推摇滚"）。增量 merge，不整包覆盖 —— 避免一次推荐把历史口味冲掉。
 */
@Injectable()
export class SaveMusicTasteTool implements ToolDefinition {
  private readonly logger = new Logger(SaveMusicTasteTool.name);
  readonly name = 'save-music-taste';
  readonly description =
    '记住用户的音乐口味（跨会话长期记忆）。当用户明确表达喜欢什么风格/歌手/场景，或明确表示不想听什么时调用。增量合并，不会覆盖已有口味。';
  readonly parameters = {
    likes: {
      type: 'object' as const,
      description: '喜欢的标签：genres=风格、artists=歌手、moods=场景/情绪，均为字符串数组',
      required: false,
      properties: {
        genres: { type: 'array' as const, description: '风格，如 ["民谣"]', items: { type: 'string' as const, description: '标签' } },
        artists: { type: 'array' as const, description: '歌手，如 ["周杰伦"]', items: { type: 'string' as const, description: '标签' } },
        moods: { type: 'array' as const, description: '场景/情绪，如 ["安静"]', items: { type: 'string' as const, description: '标签' } },
      },
    },
    dislikes: {
      type: 'object' as const,
      description: '不想听的标签：genres=风格、artists=歌手',
      required: false,
      properties: {
        genres: { type: 'array' as const, description: '不喜欢的风格', items: { type: 'string' as const, description: '标签' } },
        artists: { type: 'array' as const, description: '不喜欢的歌手', items: { type: 'string' as const, description: '标签' } },
      },
    },
    note: {
      type: 'string' as const,
      description: '一句话备注（可选），如「睡前只听纯音乐」',
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
            likes: {
              type: 'object',
              description: '喜欢的标签',
              properties: {
                genres: { type: 'array', items: { type: 'string' } },
                artists: { type: 'array', items: { type: 'string' } },
                moods: { type: 'array', items: { type: 'string' } },
              },
            },
            dislikes: {
              type: 'object',
              description: '不想听的标签',
              properties: {
                genres: { type: 'array', items: { type: 'string' } },
                artists: { type: 'array', items: { type: 'string' } },
              },
            },
            note: { type: 'string', description: '备注' },
          },
          required: [],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const userId = String(ctx?.userId ?? '');
    if (!userId) {
      return { success: false, content: '', error: '缺少 userId，无法写入口味档案' };
    }

    const likes = (args.likes ?? {}) as Record<string, unknown>;
    const dislikes = (args.dislikes ?? {}) as Record<string, unknown>;
    const patch = {
      likes: {
        genres: toStringArray(likes.genres),
        artists: toStringArray(likes.artists),
        moods: toStringArray(likes.moods),
      },
      dislikes: {
        genres: toStringArray(dislikes.genres),
        artists: toStringArray(dislikes.artists),
      },
      note: typeof args.note === 'string' ? args.note.trim() : undefined,
    };

    const hasAny =
      patch.likes.genres.length ||
      patch.likes.artists.length ||
      patch.likes.moods.length ||
      patch.dislikes.genres.length ||
      patch.dislikes.artists.length ||
      patch.note;
    if (!hasAny) {
      return { success: false, content: '', error: '没有可保存的口味标签' };
    }

    const saved = await this.music.mergeTaste(userId, patch);
    this.logger.log(
      `写入用户口味档案: userId=${userId} likes=${[
        ...saved.likes.genres,
        ...saved.likes.artists,
        ...saved.likes.moods,
      ].join('/')} dislikes=${[...saved.dislikes.genres, ...saved.dislikes.artists].join('/')}`,
    );
    return { success: true, content: JSON.stringify({ saved: true, taste: saved }) };
  }
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
}
