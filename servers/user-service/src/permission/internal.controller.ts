import { Controller, Post, Body, UseGuards, HttpCode } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { InternalGuard } from '../api-key/internal.guard';

/**
 * 内部服务间接口（各服务 PermissionGuard 调用，受 InternalGuard 保护）
 * POST /internal/roles/permissions { roles: ['editor'] } → { permissions: [...] }
 */
@Controller('internal/roles')
@UseGuards(InternalGuard)
export class InternalPermissionController {
  constructor(private readonly svc: PermissionService) {}

  @Post('permissions')
  @HttpCode(200)
  async resolve(@Body() dto: { roles?: string[] }) {
    const permissions = await this.svc.getPermissionsForRoles(dto.roles || []);
    return { permissions };
  }
}
