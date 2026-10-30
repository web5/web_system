import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard, RequirePermission } from '@web-system/shared';
import { UserMemoryService } from './user-memory.service';
import { UserMemorySummaryService } from './user-memory-summary.service';

/**
 * 用户记忆管理端接口（admin · #8229 批次1 卡1.5）。
 *
 * admin **只读**（用户 2026-10-30 拍板：admin 只支持查看，编辑归 portal/C 端）——
 * 批次1 的 rebuild / 删明细两个写端点已收口删除，写能力统一在 C 端
 * UserMemoryController（本人维度）。
 *
 * 路由口径：挂在 `users` 前缀下（/api/users/:id/memory*），复用网关既有的
 * `/api/users/* → user-service` 通道 —— 网关的 `/api/admin/*` 通配走 system-service，
 * 这里若用 `admin/users` 前缀会被劫持 404（见 gateway proxy.controller.ts 路由表）。
 *
 * 守卫口径（拍板①）：复用 user-service 现有 `users:view` 权限点，不新建权限码；
 * 与 UserController 同款范式：AuthGuard（验身份）→ PermissionGuard（验权限，fail-closed）。
 */
@ApiTags('用户记忆管理')
@Controller('users')
@UseGuards(AuthGuard, PermissionGuard)
@ApiBearerAuth()
export class UserMemoryAdminController {
  constructor(
    private readonly memory: UserMemoryService,
    private readonly summary: UserMemorySummaryService,
  ) {}

  @Get(':id/memory')
  @RequirePermission('users:view')
  @ApiOperation({ summary: '查某用户的记忆摘要 + 明细分页（管理端，只读）' })
  async detail(
    @Param('id') userId: string,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 50,
    @Query('namespace') namespace?: string,
  ) {
    const [summary, memories] = await Promise.all([
      this.summary.get(userId, namespace || 'general'),
      this.memory.list(userId, Number(page) || 1, Number(pageSize) || 50),
    ]);
    return { summary, memories };
  }
}
