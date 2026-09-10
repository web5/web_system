import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PermissionService, SaveRolePayload } from './permission.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard, RequirePermission } from '@web-system/shared';

/**
 * 权限管理 API（admin 角色权限配置页）
 *   GET  /admin/permissions        权限点全量（按 group 分组）
 *   GET  /admin/roles              角色列表（含权限码）
 *   POST /admin/roles              新建角色
 *   PUT  /admin/roles/:code        更新角色（权限全量覆盖）
 *   DELETE /admin/roles/:code      删除角色
 *   GET  /permissions/my           当前用户权限码（admin 特判，任何登录用户可查）
 */
@ApiTags('Permissions (admin)')
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class PermissionController {
  constructor(private readonly svc: PermissionService) {}

  @Get('admin/permissions')
  @RequirePermission('roles:view')
  @ApiOperation({ summary: '权限点全量（按 group 分组）' })
  listPermissions() {
    return this.svc.listPermissions();
  }

  @Get('admin/roles')
  @RequirePermission('roles:view')
  @ApiOperation({ summary: '角色列表（含权限码）' })
  listRoles() {
    return this.svc.listRoles();
  }

  @Post('admin/roles')
  @RequirePermission('roles:manage')
  @ApiOperation({ summary: '新建角色' })
  createRole(@Body() dto: SaveRolePayload) {
    return this.svc.createRole(dto);
  }

  @Put('admin/roles/:code')
  @RequirePermission('roles:manage')
  @ApiOperation({ summary: '更新角色（权限全量覆盖）' })
  updateRole(@Param('code') code: string, @Body() dto: SaveRolePayload) {
    return this.svc.updateRole(code, dto);
  }

  @Delete('admin/roles/:code')
  @RequirePermission('roles:manage')
  @ApiOperation({ summary: '删除角色（内置/被引用拒绝）' })
  deleteRole(@Param('code') code: string) {
    return this.svc.deleteRole(code);
  }

  @Get('permissions/my')
  @ApiOperation({ summary: '当前登录用户权限码数组' })
  async myPermissions(@Req() req: Request) {
    const user = (req as any).user;
    return this.svc.getMyPermissions(user);
  }

  /**
   * 代码声明与 DB 的权限差异（只读）。
   * 供页面在"加了权限码但没同步"时给出显式提示，而不是只显示一张对不上的权限树。
   */
  @Get('admin/permissions/diff')
  @RequirePermission('roles:view')
  @ApiOperation({ summary: '代码声明与数据库的权限差异' })
  diffPermissions() {
    return this.svc.diff();
  }

  /**
   * 同步权限点（以代码声明为准：`packages/types` 的 PERMISSIONS / ROLE_PERMISSIONS）。
   *
   * 用于「加了新权限码但没重启本服务」的场景——后端鉴权读代码常量、前端菜单读 DB，
   * 不同步就会出现"接口调得通但菜单不出现"。幂等，可重复调用。
   * 注意：会**全量覆盖内置角色的权限**（自定义角色不受影响）。
   * 同步动作会记一条操作日志（`sync_permission`）。
   */
  @Post('admin/permissions/sync')
  @RequirePermission('roles:manage')
  @ApiOperation({ summary: '同步权限点与内置角色权限（幂等；覆盖内置角色）' })
  async syncPermissions(@Req() req: Request) {
    const user = (req as any).user;
    const operator = user?.username || user?.name || user?.sub || 'admin';
    const result = await this.svc.syncAndAudit(String(operator), 'admin 页面');
    return { code: 0, data: result, message: '权限已按代码声明同步' };
  }
}
