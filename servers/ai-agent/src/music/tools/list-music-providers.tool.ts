import { Injectable } from '@nestjs/common';
import { ToolDefinition, ToolContext, ToolResult, ToolSchema } from '@kedouai/agent-core';
import { MusicService } from '../music.service';

/**
 * 列出可用的音乐播放渠道（DB 配置驱动）。
 *
 * Agent 在出「歌曲卡片」之前必须先调它拿到渠道 code —— 跳转目标由配置决定，
 * 不是模型自己猜的平台名，否则换渠道就要改 prompt。
 */
@Injectable()
export class ListMusicProvidersTool implements ToolDefinition {
  readonly name = 'list-music-providers';
  readonly description =
    '列出当前可用的音乐播放渠道（如 QQ音乐），返回 code / name / 入口类型。要出歌曲卡片或引导用户去听歌前必须先调用它，用返回的 code 作为 providerCode。';
  readonly parameters = {};

  constructor(private readonly music: MusicService) {}

  toSchema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: { type: 'object', properties: {}, required: [] },
      },
    };
  }

  async execute(_args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const providers = await this.music.listProviders();
    if (!providers.length) {
      return {
        success: false,
        content: '',
        error: '暂无可用音乐渠道，请直接用文字推荐歌曲，不要生成卡片',
      };
    }
    return { success: true, content: JSON.stringify({ providers }) };
  }
}
