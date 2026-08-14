import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { AdminService } from './admin.service';

/** 模块管理 API（供 mcp-admin 界面调用） */
@Controller('api/modules')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  async list() {
    return { modules: await this.adminService.list() };
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
