import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { AdminService } from './admin.service';
import { McpModuleEntity } from '../mcp/entities/mcp-module.entity';

/**
 * 模块定义 → 运营后台可见视图（**响应脱敏**）
 *
 * 为什么在 controller 边界做：`auth_config` 是「转发给下游服务用的」运行时配置
 * （token / 账号 / header 名），mcp.service 等内部调用方必须拿得到明文；
 * 而浏览器不需要值，只需要知道「配没配」。所以脱敏属于展示层，不改实体、不改 service。
 *
 * 口径：**整字段摘除 + `auth_configured` 布尔位**，不逐键掩码 `"***"`。
 *   - 逐键掩码看似更"温和"，但会把密钥的真实长度/结构漏出去，且前端一旦把 `"***"`
 *     回传（PUT 时），等于把真密钥写成 `"***"` —— 本 PR 修的正是这类「回写覆盖」事故。
 *   - 键名（`token` / `password` / `header_name`）在运营排障时有价值，保留键名意义不大且
 *     一旦保留就有人想显示值，索性只说「配了 / 没配」。
 */
export function toAdminModuleView(m: McpModuleEntity) {
  const { auth_config, ...rest } = m as McpModuleEntity & { auth_config?: unknown };
  const configured =
    !!auth_config && typeof auth_config === 'object' && Object.keys(auth_config as object).length > 0;
  return { ...rest, auth_configured: configured };
}

/** 模块管理 API（供 mcp-admin 界面调用） */
@Controller('api/modules')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  async list() {
    const modules = await this.adminService.list();
    return { modules: modules.map(toAdminModuleView) };
  }

  @Post()
  async create(@Body() dto: any) {
    const module = await this.adminService.create(dto);
    return { id: module.id, message: '模块已创建' };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: any) {
    await this.adminService.update(Number(id), dto);
    return { id: Number(id), message: '模块已更新' };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.adminService.remove(Number(id));
    return { id: Number(id), message: '模块已删除' };
  }

  @Post(':id/toggle')
  async toggle(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    await this.adminService.toggle(Number(id), !!body.enabled);
    return { id: Number(id), enabled: !!body.enabled };
  }
}

/** 调试验证端点 */
@Controller('api/debug')
export class DebugController {
  constructor(private readonly adminService: AdminService) {}

  @Post()
  async debug(@Body() dto: any) {
    return this.adminService.debug(dto);
  }
}
