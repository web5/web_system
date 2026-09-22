import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MusicProvider } from './music-provider.entity';
import { MusicService } from './music.service';
import { ListMusicProvidersTool } from './tools/list-music-providers.tool';
import { PresentMusicCardTool } from './tools/present-music-card.tool';
import { SaveMusicTasteTool } from './tools/save-music-taste.tool';

/**
 * 音乐推荐能力（一期：推荐卡片 + 跳转 QQ音乐 + 口味记忆）。
 * 口味档案（user_taste_profiles）已迁到 user-service，本模块只保留渠道（provider）与工具；
 * 工具在此注册并导出，由 AgentModule 注入 ToolRegistry。
 */
@Module({
  imports: [TypeOrmModule.forFeature([MusicProvider])],
  providers: [MusicService, ListMusicProvidersTool, PresentMusicCardTool, SaveMusicTasteTool],
  exports: [MusicService, ListMusicProvidersTool, PresentMusicCardTool, SaveMusicTasteTool],
})
export class MusicModule {}
