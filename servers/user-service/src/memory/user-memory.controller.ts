import {
  Controller,
  Get,
  Delete,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { UserMemoryService } from './user-memory.service';
import { UserMemorySummaryService } from './user-memory-summary.service';

/**
 * 用户记忆（C 端，当前用户维度，只读 + 删除 + 自己的摘要）。
 * 鉴权：AuthGuard → auth-service verify → req.user.id。
 */
@ApiTags('用户记忆')
@Controller('user-memory')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class UserMemoryController {
  constructor(
    private readonly memory: UserMemoryService,
    private readonly summary: UserMemorySummaryService,
  ) {}

  @Get()
  @ApiOperation({ summary: '我的记忆列表（分页）' })
  async list(
    @Req() req: Request,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 50,
  ) {
    return this.memory.list(userIdOf(req), Number(page), Number(pageSize));
  }

  @Get('summary')
  @ApiOperation({ summary: '我的记忆摘要（一用户一条，自动生成）' })
  async mySummary(@Req() req: Request, @Query('namespace') namespace?: string) {
    const row = await this.summary.get(userIdOf(req), namespace || 'general');
    return { summary: row };
  }

  @Post('summary/rebuild')
  @ApiOperation({ summary: '触发重算我的记忆摘要' })
  @HttpCode(HttpStatus.OK)
  async rebuildMySummary(@Req() req: Request, @Body() body: { namespace?: string }) {
    const result = await this.summary.rebuild(userIdOf(req), body?.namespace || 'general');
    return { success: true, changed: result.changed, skipped: result.skipped, summary: result.row };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除一条记忆' })
  @HttpCode(HttpStatus.OK)
  async remove(@Req() req: Request, @Param('id') id: string) {
    const userId = userIdOf(req);
    const numId = Number(id);
    const ok = Number.isInteger(numId) && numId > 0 && (await this.memory.remove(userId, numId));
    if (!ok) {
      throw new NotFoundException('记忆不存在');
    }
    return { success: true };
  }
}

function userIdOf(req: Request): string {
  const userId = String((req as any).user?.id ?? '');
  if (!userId || userId === 'undefined') {
    throw new NotFoundException('无法识别用户身份');
  }
  return userId;
}
