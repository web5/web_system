import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ModuleRegistryService } from './module-registry.service';
import { ModuleDto } from '../common/dto';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators';

@ApiTags('模块管理')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('modules')
export class ModuleRegistryController {
  constructor(
    private readonly moduleService: ModuleRegistryService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: '模块列表' })
  list() {
    return this.moduleService.list();
  }

  @Get(':key')
  @ApiOperation({ summary: '模块详情' })
  get(@Param('key') key: string) {
    return this.moduleService.get(key);
  }

  @Post()
  @ApiOperation({ summary: '创建模块' })
  async create(@Body() dto: ModuleDto, @CurrentUser() user: any) {
    const m = await this.moduleService.create(dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'module.create',
      env: '-',
      component: dto.key,
      status: 'success',
      detail: `创建模块 ${dto.name}(${dto.key}) type=${dto.type}`,
    });
    return m;
  }

  @Put(':key')
  @ApiOperation({ summary: '更新模块' })
  async update(@Param('key') key: string, @Body() dto: Partial<ModuleDto>, @CurrentUser() user: any) {
    const m = await this.moduleService.update(key, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'module.update',
      env: '-',
      component: key,
      status: 'success',
      detail: `更新模块 ${key}: ${JSON.stringify(dto).slice(0, 200)}`,
    });
    return m;
  }

  @Delete(':key')
  @ApiOperation({ summary: '删除模块（内置不可删）' })
  async remove(@Param('key') key: string, @CurrentUser() user: any) {
    await this.moduleService.remove(key);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'module.delete',
      env: '-',
      component: key,
      status: 'success',
      detail: `删除模块 ${key}`,
    });
    return { success: true };
  }
}
