import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { BianbianAdminService, MaterialCreateDto, MaterialUpdateDto } from './bianbian-admin.service';

@ApiTags('变变素材管理（管理员）')
@Controller('admin/bianbian')
export class BianbianAdminController {
  private readonly logger = new Logger(BianbianAdminController.name);

  constructor(private readonly adminService: BianbianAdminService) {}

  // ========== 分类 ==========

  @Get('categories')
  @ApiOperation({ summary: '素材分类列表（含各分类素材数量）' })
  async getCategories() {
    const data = await this.adminService.getCategories();
    return { code: 0, data };
  }

  // ========== 素材 CRUD ==========

  @Get('materials')
  @ApiOperation({ summary: '素材列表' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'keyword', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  async getMaterials(
    @Query('category') category: string,
    @Query('keyword') keyword: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
  ) {
    const data = await this.adminService.getMaterials({
      category,
      keyword,
      page: parseInt(page || '1', 10),
      pageSize: parseInt(pageSize || '200', 10),
    });
    return { code: 0, data };
  }

  @Post('materials')
  @ApiOperation({ summary: '创建素材' })
  async createMaterial(@Body() dto: MaterialCreateDto) {
    const data = await this.adminService.createMaterial(dto);
    return { code: 0, data, message: '素材创建成功' };
  }

  @Put('materials/:id')
  @ApiOperation({ summary: '更新素材' })
  async updateMaterial(@Param('id') id: string, @Body() dto: MaterialUpdateDto) {
    const data = await this.adminService.updateMaterial(id, dto);
    return { code: 0, data, message: '素材更新成功' };
  }

  @Delete('materials/:id')
  @ApiOperation({ summary: '删除素材' })
  async deleteMaterial(@Param('id') id: string) {
    await this.adminService.deleteMaterial(id);
    return { code: 0, message: '素材删除成功' };
  }

  // ========== 批量操作 ==========

  @Put('materials/sort')
  @ApiOperation({ summary: '批量更新素材排序' })
  async batchSort(@Body() dto: { items: Array<{ id: string; sortOrder: number }> }) {
    await this.adminService.batchSort(dto.items);
    return { code: 0, message: '排序更新成功' };
  }

  @Put('materials/batch/toggle')
  @ApiOperation({ summary: '批量启用/禁用素材' })
  async batchToggle(@Body() dto: { ids: string[]; enabled: boolean }) {
    const affected = await this.adminService.batchToggleEnabled(dto.ids, dto.enabled);
    return { code: 0, data: { affected }, message: `已${dto.enabled ? '启用' : '禁用'} ${affected} 个素材` };
  }

  // ========== 初始化 ==========

  @Post('seed')
  @ApiOperation({ summary: '初始化默认素材库（首次运行时调用）' })
  async seed() {
    const count = await this.adminService.seedDefaultMaterials();
    return { code: 0, data: { count }, message: count > 0 ? `已初始化 ${count} 个默认素材` : '素材库已存在，跳过初始化' };
  }
}
