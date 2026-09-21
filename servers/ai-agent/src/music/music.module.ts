import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MusicProvider } from './music-provider.entity';
import { UserTasteProfile } from './user-taste-profile.entity';
import { MusicService } from './music.service';
import { UserTasteController } from './user-taste.controller';
import { ListMusicProvidersTool } from './tools/list-music-providers.tool';
import { PresentMusicCardTool } from './tools/present-music-card.tool';
import { SaveMusicTasteTool } from './tools/save-music-taste.tool';

/**
 * 音乐推荐能力（一期：推荐卡片 + 跳转 QQ音乐 + 口味记忆）。
 * 工具在此注册并导出，由 AgentModule 注入 ToolRegistry。
 */
@Module({
  imports: [TypeOrmModule.forFeature([MusicProvider, UserTasteProfile])],
  providers: [MusicService, ListMusicProvidersTool, PresentMusicCardTool, SaveMusicTasteTool],
  controllers: [UserTasteController],
  exports: [MusicService, ListMusicProvidersTool, PresentMusicCardTool, SaveMusicTasteTool],
})
export class MusicModule {}
