import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DictService } from './dict.service';
import {
  CreateDictItemDto,
  CreateDictTypeDto,
  ListDictItemsDto,
  ListDictTypesDto,
  ReplaceDictFieldsDto,
  UpdateDictItemDto,
  UpdateDictTypeDto,
} from './dict.dto';
import { RequirePermission } from '../auth/decorators';

/**
 * 字典 / 维表管理。
 * 管理端接口走 `/admin/dict`（gateway `admin/:path(*)` 已通配转发到 system-service，无需改网关）。
 * 服务间消费接口 `/internal/dict/:code` 随 P2（ai-agent 接入）一起开。
 */
@ApiTags('字典管理')
@Controller('admin/dict')
export class DictController {
  constructor(private readonly dictService: DictService) {}

  // ===== 字典类型 =====

  @Get('types')
  @RequirePermission('system:dict:view')
  @ApiOperation({ summary: '列出字典类型（支持 keyword 模糊匹配 code/name）' })
  async listTypes(@Query() query: ListDictTypesDto) {
    return { code: 0, data: await this.dictService.listTypes(query) };
  }

  @Post('types')
  @RequirePermission('system:dict:manage')
  @ApiOperation({ summary: '新建字典类型' })
  async createType(@Body() dto: CreateDictTypeDto) {
    return { code: 0, data: await this.dictService.createType(dto) };
  }

  @Put('types/:id')
  @RequirePermission('system:dict:manage')
  @ApiOperation({ summary: '更新字典类型' })
  async updateType(@Param('id') id: string, @Body() dto: UpdateDictTypeDto) {
    return { code: 0, data: await this.dictService.updateType(id, dto) };
  }

  @Delete('types/:id')
  @RequirePermission('system:dict:manage')
  @ApiOperation({ summary: '删除字典类型（内置字典拒绝；连带删除其字段与全部明细）' })
  async removeType(@Param('id') id: string) {
    return { code: 0, data: await this.dictService.removeType(id) };
  }

  // ===== 字段定义 =====

  @Get('types/:code/fields')
  @RequirePermission('system:dict:view')
  @ApiOperation({ summary: '列出字典的字段定义' })
  async listFields(@Param('code') code: string) {
    return { code: 0, data: await this.dictService.listFields(code) };
  }

  @Put('types/:code/fields')
  @RequirePermission('system:dict:manage')
  @ApiOperation({ summary: '整体覆盖保存字段定义（前端提交最终态）' })
  async replaceFields(@Param('code') code: string, @Body() dto: ReplaceDictFieldsDto) {
    return { code: 0, data: await this.dictService.replaceFields(code, dto.fields) };
  }

  // ===== 字典项 =====

  @Get('types/:code/items')
  @RequirePermission('system:dict:view')
  @ApiOperation({ summary: '分页列出字典明细（keyword / enabled / page / pageSize）' })
  async listItems(@Param('code') code: string, @Query() query: ListDictItemsDto) {
    return { code: 0, data: await this.dictService.listItems(code, query) };
  }

  @Post('items')
  @RequirePermission('system:dict:manage')
  @ApiOperation({ summary: '新增字典项' })
  async createItem(@Body() dto: CreateDictItemDto) {
    return { code: 0, data: await this.dictService.createItem(dto) };
  }

  @Put('items/:id')
  @RequirePermission('system:dict:manage')
  @ApiOperation({ summary: '更新字典项' })
  async updateItem(@Param('id') id: string, @Body() dto: UpdateDictItemDto) {
    return { code: 0, data: await this.dictService.updateItem(id, dto) };
  }

  @Delete('items/:id')
  @RequirePermission('system:dict:manage')
  @ApiOperation({ summary: '删除字典项' })
  async removeItem(@Param('id') id: string) {
    return { code: 0, data: await this.dictService.removeItem(id) };
  }
}
