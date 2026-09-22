import {
  Controller,
  Get,
  Delete,
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

/**
 * 用户记忆（C 端，当前用户维度，只读 + 删除）。
 * 鉴权：AuthGuard → auth-service verify → req.user.id。
 */
@ApiTags('用户记忆')
@Controller('user-memory')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class UserMemoryController {
  constructor(private readonly memory: UserMemoryService) {}

  @Get()
  @ApiOperation({ summary: '我的记忆列表（分页）' })
  async list(
    @Req() req: Request,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 50,
  ) {
    return this.memory.list(userIdOf(req), Number(page), Number(pageSize));
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
