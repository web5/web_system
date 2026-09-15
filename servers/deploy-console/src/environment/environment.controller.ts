import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  GoneException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { EnvironmentService } from './environment.service';
import { EnvironmentDto } from '../common/dto';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators';

/**
 * 环境管理 —— **环境归属模块（1:N）**。
 *
 * 主入口是模块子资源 `/modules/:key/environments`（增删改查）。
 * 旧全局写接口返回 410（避免同 id 多模块下误写），只读聚合保留一个发布周期。
 * 契约见 specs/module-env-ownership/api-design.md。
 */
@ApiTags('环境管理')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('modules')
export class ModuleEnvironmentController {
  constructor(
    private readonly envService: EnvironmentService,
    private readonly auditService: AuditService,
  ) {}

  @Get(':key/environments')
  @ApiOperation({ summary: '列出某模块的所有环境' })
  list(@Param('key') key: string) {
    return this.envService.list({ moduleKey: key });
  }

  @Post(':key/environments')
  @ApiOperation({ summary: '在该模块下新建环境（支持 copyFrom 复制同模块环境）' })
  async create(
    @Param('key') key: string,
    @Body() dto: EnvironmentDto,
    @CurrentUser() user: any,
  ) {
    const env = await this.envService.create(key, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'env.create',
      env: env.id,
      component: key,
      status: 'success',
      detail: `模块 ${key} 新建环境 ${env.id}(${env.name}) address=${env.address || '-'} serverName=${env.serverName || '-'}`,
    });
    return env;
  }

  @Put(':key/environments/:envId')
  @ApiOperation({ summary: '更新该模块的某环境（地址/服务器组/公网地址）' })
  async update(
    @Param('key') key: string,
    @Param('envId') envId: string,
    @Body() dto: Partial<EnvironmentDto>,
    @CurrentUser() user: any,
  ) {
    const env = await this.envService.update(key, envId, dto);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'env.update',
      env: envId,
      component: key,
      status: 'success',
      detail: `更新环境 ${key}/${envId}: ${JSON.stringify(dto)}`,
    });
    return env;
  }

  @Delete(':key/environments/:envId')
  @ApiOperation({ summary: '删除该模块的某环境（内置不可删；返回关联记录数供二次确认）' })
  async remove(
    @Param('key') key: string,
    @Param('envId') envId: string,
    @CurrentUser() user: any,
  ) {
    const res = await this.envService.remove(key, envId);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'env.delete',
      env: envId,
      component: key,
      status: 'success',
      detail: `删除环境 ${key}/${envId}（关联：${JSON.stringify(res.cascade)}）`,
    });
    return res;
  }
}

/**
 * 旧全局环境接口（兼容期）。
 * 读：跨模块聚合视图（按环境 id 去重，供审计/通知等筛选下拉）。
 * 写：410 —— 环境不再全局唯一，必须走模块子资源。
 */
@ApiTags('环境管理（兼容期）')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('environments')
export class EnvironmentController {
  constructor(private readonly envService: EnvironmentService) {}

  @Get()
  @ApiOperation({ summary: '环境字典（跨模块去重聚合，兼容期只读）' })
  @ApiResponse({ status: 200, description: '按环境 id 去重，含 moduleCount' })
  dict(@Query('moduleKey') moduleKey?: string) {
    if (moduleKey) return this.envService.list({ moduleKey });
    return this.envService.dict();
  }

  @Post()
  @ApiOperation({ summary: '【已废弃】请改用 POST /modules/:key/environments' })
  createDeprecated() {
    throw new GoneException('环境已归属模块，请改用 POST /modules/:key/environments');
  }

  @Put(':id')
  @ApiOperation({ summary: '【已废弃】请改用 PUT /modules/:key/environments/:envId' })
  updateDeprecated() {
    throw new GoneException('环境已归属模块，请改用 PUT /modules/:key/environments/:envId');
  }

  @Delete(':id')
  @ApiOperation({ summary: '【已废弃】请改用 DELETE /modules/:key/environments/:envId' })
  removeDeprecated() {
    throw new GoneException('环境已归属模块，请改用 DELETE /modules/:key/environments/:envId');
  }
}
