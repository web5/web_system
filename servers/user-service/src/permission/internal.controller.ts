import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { InternalGuard } from '../api-key/internal.guard';
import { PermissionService } from './permission.service';

/**
 * 权限内部接口（服务间调用，`x-internal-key: INTERNAL_API_KEY`）。
 *
 * - `POST /internal/roles/permissions`：按角色码解析权限集合（各服务 PermissionGuard 用）
 * - `POST /internal/permissions/sync`：同步权限点与内置角色权限（发布脚本/流水线用，
 *   替代"必须记得重启 user-service"）
 */
@Controller('internal')
@UseGuards(InternalGuard)
export class InternalPermissionController {
  constructor(private readonly svc: PermissionService) {}

  @Post('roles/permissions')
  @HttpCode(200)
  async resolve(@Body() dto: { roles?: string[] }) {
    const permissions = await this.svc.getPermissionsForRoles(dto.roles || []);
    return { permissions };
  }

  @Post('permissions/sync')
  @HttpCode(200)
  async sync() {
    const result = await this.svc.seed();
    return { code: 0, data: result, message: '权限已按代码声明同步' };
  }
}
