import {
  Controller,
  Get,
  Delete,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { UserMemoryService } from './user-memory.service';
import { UserMemorySummaryService } from './user-memory-summary.service';

/** 记忆条目内容长度上限（与摘要 500 字口径一致） */
const MEMORY_CONTENT_MAX_CHARS = 500;

/**
 * 用户记忆（C 端，当前用户维度，只读 + 编辑/删除自己的条目 + 自己的摘要）。
 * 鉴权：AuthGuard → auth-service verify → req.user.id。
 *
 * 写能力归属（用户 2026-10-30 拍板）：admin 只读，portal/C 端用户可自己改。
 * 编辑/删除成功后 fire-and-forget 触发摘要重算（失败仅 warn，不影响本操作）。
 */
@ApiTags('用户记忆')
@Controller('user-memory')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class UserMemoryController {
  private readonly logger = new Logger(UserMemoryController.name);

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

  @Patch(':id')
  @ApiOperation({ summary: '编辑我的一条记忆内容（改完自动重算摘要）' })
  async edit(@Req() req: Request, @Param('id') id: string, @Body() body: { content?: string }) {
    const userId = userIdOf(req);
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId <= 0) {
      throw new NotFoundException('记忆不存在');
    }
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) {
      throw new BadRequestException('记忆内容不能为空');
    }
    if (Array.from(content).length > MEMORY_CONTENT_MAX_CHARS) {
      throw new BadRequestException('记忆内容不超过 500 字');
    }
    const result = await this.memory.update(userId, numId, content);
    if (!result.ok) {
      if (result.reason === 'conflict') {
        throw new BadRequestException('已存在相同内容的记忆');
      }
      // 他人条目与不存在同响应（404），不区分以免探测
      throw new NotFoundException('记忆不存在');
    }
    this.triggerRebuild(userId);
    return { success: true, memory: result.row };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除一条记忆（删完自动重算摘要）' })
  @HttpCode(HttpStatus.OK)
  async remove(@Req() req: Request, @Param('id') id: string) {
    const userId = userIdOf(req);
    const numId = Number(id);
    const ok = Number.isInteger(numId) && numId > 0 && (await this.memory.remove(userId, numId));
    if (!ok) {
      throw new NotFoundException('记忆不存在');
    }
    this.triggerRebuild(userId);
    return { success: true };
  }

  /**
   * fire-and-forget 触发摘要重算（与 ai-agent 钩子同款策略）：
   * 编辑/删除明细后摘要若不重算会长期停在旧内容；重算失败仅 warn，不影响本次操作。
   */
  private triggerRebuild(userId: string): void {
    this.summary
      .rebuild(userId)
      .then(() => this.logger.log(`明细变更后摘要重算完成: userId=${userId}`))
      .catch((e: unknown) =>
        this.logger.warn(`明细变更后摘要重算失败（不影响本次操作）: ${(e as Error).message}`),
      );
  }
}

function userIdOf(req: Request): string {
  const userId = String((req as any).user?.id ?? '');
  if (!userId || userId === 'undefined') {
    throw new NotFoundException('无法识别用户身份');
  }
  return userId;
}
