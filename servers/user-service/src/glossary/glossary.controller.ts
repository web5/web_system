import {
  Controller,
  Get,
  Post,
  Delete,
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
import { GlossaryService } from './glossary.service';
import { CreateGlossaryDto } from './dto/create-glossary.dto';

/**
 * 生词本 / 收藏（C 端，当前用户维度）。
 * 鉴权：AuthGuard → auth-service verify → req.user.id。
 * 越权防护：所有查询/删除强制带 userId，他人数据按「不存在」处理。
 */
@ApiTags('生词本')
@Controller('glossary')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class GlossaryController {
  constructor(private readonly glossary: GlossaryService) {}

  @Post()
  @ApiOperation({ summary: '收藏一条译文（幂等）' })
  @HttpCode(HttpStatus.OK)
  async collect(@Req() req: Request, @Body() dto: CreateGlossaryDto) {
    const userId = userIdOf(req);
    return this.glossary.collect(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: '我的收藏列表（分页）' })
  async list(
    @Req() req: Request,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
    @Query('keyword') keyword?: string,
  ) {
    const userId = userIdOf(req);
    return this.glossary.list(userId, Number(page), Number(pageSize), keyword);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除一条收藏' })
  @HttpCode(HttpStatus.OK)
  async remove(@Req() req: Request, @Param('id') id: string) {
    const userId = userIdOf(req);
    const numId = Number(id);
    const ok = Number.isInteger(numId) && numId > 0 && (await this.glossary.remove(userId, numId));
    if (!ok) {
      throw new NotFoundException('收藏不存在');
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
