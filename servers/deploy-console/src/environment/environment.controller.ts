import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { EnvironmentService } from './environment.service';
import { EnvironmentDto } from '../common/dto';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators';

@ApiTags('环境管理')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('environments')
export class EnvironmentController {
  constructor(
    private readonly envService: EnvironmentService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: '列出所有环境' })
  async list() {
    return this.envService.list();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个环境' })
  async get(@Param('id') id: string) {
    return this.envService.get(id);
  }

  @Post()
  @ApiOperation({ summary: '创建环境' })
  async create(@Body() dto: EnvironmentDto, @CurrentUser() user: any) {
    const env = await this.envService.create(dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'env.create',
      env: dto.id,
      status: 'success',
      detail: `创建环境 ${dto.id}(${dto.name}) host=${dto.host} ports=${JSON.stringify(dto.ports || {})}`,
    });
    return env;
  }

  @Put(':id')
  @ApiOperation({ summary: '更新环境（端口/SSH 等）' })
  async update(@Param('id') id: string, @Body() dto: Partial<EnvironmentDto>, @CurrentUser() user: any) {
    const env = await this.envService.update(id, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'env.update',
      env: id,
      status: 'success',
      detail: `更新环境 ${id}: ${JSON.stringify(dto)}`,
    });
    return env;
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除环境（内置环境不可删）' })
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    await this.envService.remove(id);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'env.delete',
      env: id,
      status: 'success',
      detail: `删除环境 ${id}`,
    });
    return { id, deleted: true };
  }
}
