import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { MusicService } from './music.service';

/**
 * 用户口味档案读写（小程序「我的 → AI 记忆 → 音乐口味」）。
 * 与 Agent 侧的 save_music_taste 同源同一张表：这里给用户看和改，那边给 AI 写。
 */
@ApiTags('用户口味')
@Controller('user-taste')
@UseGuards(AuthGuard)
export class UserTasteController {
  constructor(private readonly music: MusicService) {}

  @Get(':namespace')
  @ApiOperation({ summary: '读取我的口味档案' })
  async get(@Param('namespace') namespace: string, @Req() req: Request) {
    const userId = userIdOf(req);
    return { namespace, taste: await this.music.getTaste(userId, namespace) };
  }

  @Put(':namespace')
  @ApiOperation({ summary: '增量更新我的口味档案' })
  async put(
    @Param('namespace') namespace: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const userId = userIdOf(req);
    const patch = (body?.taste ?? body ?? {}) as Record<string, unknown>;
    const taste = await this.music.mergeTaste(userId, patch as never, namespace);
    return { namespace, taste };
  }

  /** 删除单个标签：口味页 chip 上的 ×（整包覆盖删除不了，只能按值移除） */
  @Delete(':namespace/tag')
  @ApiOperation({ summary: '删除口味档案中的指定标签' })
  async removeTag(
    @Param('namespace') namespace: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const userId = userIdOf(req);
    const patch = (body?.taste ?? body ?? {}) as Record<string, unknown>;
    const taste = await this.music.removeTaste(userId, patch as never, namespace);
    return { namespace, taste };
  }

  @Delete(':namespace')
  @ApiOperation({ summary: '清空我的口味档案' })
  async clear(@Param('namespace') namespace: string, @Req() req: Request) {
    const userId = userIdOf(req);
    return { namespace, taste: await this.music.clearTaste(userId, namespace) };
  }
}

function userIdOf(req: Request): string {
  const userId = String((req as any).user?.id ?? '');
  if (!userId) throw new HttpException('无法识别用户身份', HttpStatus.UNAUTHORIZED);
  return userId;
}
