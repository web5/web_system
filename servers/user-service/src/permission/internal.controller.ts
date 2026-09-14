import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { InternalGuard } from '../api-key/internal.guard';
import { PermissionService } from './permission.service';

/**
 * 权限内部接口（服务间调用，`x-internal-key: INTERNAL_API_KEY`）。
 *
 * - `POST /internal/roles/permissions`：按角色码解析权限集合（各服务 PermissionGuard 用）
 * - `POST /internal/permissions/sync`：同步权限点与内置角色权限（发布脚本/流水线用，
 *   替代"必须记得重启 user-service"）
 * - `POST /internal/users/by-permissions`：按权限码反查用户（deploy-console 拉"可审批人"用）
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
  async sync(@Body() dto: { operator?: string; source?: string }) {
    const result = await this.svc.syncAndAudit(
      String(dto?.operator || 'internal').slice(0, 64),
      String(dto?.source || '内部接口').slice(0, 32),
    );
    return { code: 0, data: result, message: '权限已按代码声明同步' };
  }

  /**
   * 按权限码反查用户（AND 语义）。
   * 场景：deploy-console 的流水线审批节点要列出「谁有资格审批」。
   */
  @Post('users/by-permissions')
  @HttpCode(200)
  async usersByPermissions(@Body() dto: { codes?: string[] }) {
    const codes = Array.isArray(dto?.codes) ? dto.codes : [];
    const users = await this.svc.findUsersByPermissions(codes);
    return { code: 0, data: { users }, message: 'ok' };
  }
}
