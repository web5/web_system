import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PipelineVarService, UpsertPipelineVarSpec } from './pipeline-var.service';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';

/**
 * 流水线变量接口。
 *
 * 变量属于某一条流水线：清单按 `?pipelineId=` 过滤；执行时由引擎解析注入节点脚本环境。
 */
@ApiTags('流水线变量')
@ApiBearerAuth()
@Controller('pipeline-vars')
export class PipelineVarController {
  constructor(
    private readonly vars: PipelineVarService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: '某条流水线的变量列表（密钥掩码）' })
  @ApiQuery({ name: 'pipelineId', required: true, type: String })
  async list(@Query('pipelineId') pipelineId: string) {
    if (!pipelineId) throw new BadRequestException('pipelineId 必填');
    return this.vars.list(pipelineId);
  }

  @Post()
  @ApiOperation({ summary: '新增变量' })
  async create(
    @Body() body: UpsertPipelineVarSpec & { pipelineId: string },
    @CurrentUser() user: any,
  ) {
    if (!body?.pipelineId) throw new BadRequestException('pipelineId 必填');
    const v = await this.vars.create(body.pipelineId, body, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-var.create',
      status: 'success',
      detail: `新增流水线变量: ${body.pipelineId} · ${v.key}`,
    });
    return v;
  }

  @Put(':id')
  @ApiOperation({ summary: '编辑变量（密钥留空表示不更新值）' })
  async update(
    @Param('id') id: string,
    @Body() body: Partial<UpsertPipelineVarSpec>,
    @CurrentUser() user: any,
  ) {
    const v = await this.vars.update(id, body, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-var.update',
      status: 'success',
      detail: `编辑流水线变量: ${v.key}`,
    });
    return v;
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除变量' })
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    const r = await this.vars.remove(id);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'pipeline-var.delete',
      status: 'success',
      detail: `删除流水线变量: ${id}`,
    });
    return r;
  }
}
