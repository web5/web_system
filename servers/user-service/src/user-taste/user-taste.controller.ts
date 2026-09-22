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
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { UserTasteService } from './user-taste.service';

/**
 * 用户口味档案读写（个人中心「AI 记忆 → 音乐口味」），迁自 ai-agent。
 * 与 AI 侧 save_music_taste 同源同一张表：这里给用户看和改，那边（internal）给 AI 写。
 */
@ApiTags('用户口味')
@Controller('user-taste')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class UserTasteController {
  constructor(private readonly taste: UserTasteService) {}

  @Get(':namespace')
  @ApiOperation({ summary: '读取我的口味档案' })
  async get(@Param('namespace') namespace: string, @Req() req: Request) {
    const userId = userIdOf(req);
    return { namespace, taste: await this.taste.getTaste(userId, namespace) };
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
    const taste = await this.taste.mergeTaste(userId, patch as never, namespace);
    return { namespace, taste };
  }

  @Delete(':namespace/tag')
  @ApiOperation({ summary: '删除口味档案中的指定标签' })
  async removeTag(
    @Param('namespace') namespace: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const userId = userIdOf(req);
    const patch = (body?.taste ?? body ?? {}) as Record<string, unknown>;
    const taste = await this.taste.removeTaste(userId, patch as never, namespace);
    return { namespace, taste };
  }

  @Delete(':namespace')
  @ApiOperation({ summary: '清空我的口味档案' })
  async clear(@Param('namespace') namespace: string, @Req() req: Request) {
    const userId = userIdOf(req);
    return { namespace, taste: await this.taste.clearTaste(userId, namespace) };
  }
}

function userIdOf(req: Request): string {
  const userId = String((req as any).user?.id ?? '');
  if (!userId) throw new HttpException('无法识别用户身份', HttpStatus.UNAUTHORIZED);
  return userId;
}
