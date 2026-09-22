import { Controller, Post, Get, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ServiceKeyGuard } from './service-key.guard';
import { UserMemoryService } from '../memory/user-memory.service';
import { UserTasteService } from '../user-taste/user-taste.service';
import { UpsertMemoryDto } from './dto/upsert-memory.dto';
import { MergeTasteDto } from './dto/merge-taste.dto';

/**
 * 服务间 internal 接口（仅供 ai-agent 等后端直连调用，不经 gateway）。
 * 鉴权：ServiceKeyGuard 校验 x-service-key（USER_SERVICE_KEY）。
 */
@ApiTags('internal')
@Controller('internal')
@UseGuards(ServiceKeyGuard)
export class InternalController {
  constructor(
    private readonly memory: UserMemoryService,
    private readonly taste: UserTasteService,
  ) {}

  @Post('user-memory/upsert')
  @ApiOperation({ summary: 'AI 异步写入用户记忆（upsert/remove）' })
  async upsertMemory(@Body() dto: UpsertMemoryDto) {
    await this.memory.applyItems(dto.userId, dto.items, dto.sourceConversationId);
    return { success: true };
  }

  @Post('user-taste/merge')
  @ApiOperation({ summary: 'AI 增量写入用户口味（merge）' })
  async mergeTaste(@Body() dto: MergeTasteDto) {
    const namespace = dto.namespace ?? 'music';
    const taste = await this.taste.mergeTaste(dto.userId, dto.patch, namespace);
    return { namespace, taste };
  }

  @Post('user-taste/remove')
  @ApiOperation({ summary: 'AI 移除用户口味标签（差集）' })
  async removeTaste(@Body() dto: MergeTasteDto) {
    const namespace = dto.namespace ?? 'music';
    const taste = await this.taste.removeTaste(dto.userId, dto.patch, namespace);
    return { namespace, taste };
  }

  @Get('user-taste/get')
  @ApiOperation({ summary: 'AI 读取用户口味（注入 prompt 用）' })
  async getTaste(@Query('userId') userId: string, @Query('namespace') namespace?: string) {
    const ns = namespace ?? 'music';
    return { namespace: ns, taste: await this.taste.getTaste(userId, ns) };
  }
}
