import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PipelineService, SubmitPipelineDto } from './pipeline.service';
import { DeployService } from '../deploy/deploy.service';
import { CurrentUser } from '../common/decorators';

/**
 * 发布流水线控制台接口（走控制台 JWT 鉴权）。
 * MCP 侧等价能力见 /api/mcp/*，两者共用同一个 PipelineService。
 */
@ApiTags('发布流水线')
@ApiBearerAuth()
@Controller('pipelines')
export class PipelineController {
  constructor(
    private readonly pipelineService: PipelineService,
    private readonly deployService: DeployService,
  ) {}

  @Post()
  @ApiOperation({ summary: '提交发布流水线（异步执行，返回 jobId）' })
  async submit(@Body() body: SubmitPipelineDto, @CurrentUser() user: any) {
    if (body.env === 'prod' && (body as any).confirm !== true) {
      throw new BadRequestException('Prod operations require confirm=true');
    }
    return this.pipelineService.submit(body, user?.username);
  }

  @Get()
  @ApiOperation({ summary: '流水线列表' })
  @ApiQuery({ name: 'env', required: false, type: String })
  @ApiQuery({ name: 'moduleKey', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query('env') env?: string,
    @Query('moduleKey') moduleKey?: string,
    @Query('limit') limit?: string,
  ) {
    return this.pipelineService.list(env, moduleKey, limit ? Number(limit) : 20);
  }

  /** 可发布版本（回滚候选）；合入磁盘上未在版本表登记的历史产物，便于按版本发布 */
  @Get('meta/releases')
  @ApiOperation({ summary: '可发布版本列表（含磁盘产物）' })
  @ApiQuery({ name: 'env', required: false, type: String })
  @ApiQuery({ name: 'component', required: false, type: String })
  async releases(@Query('env') env?: string, @Query('component') component?: string) {
    return this.pipelineService.listReleaseCandidates(env, component);
  }

  @Get(':id')
  @ApiOperation({ summary: '流水线详情（状态/阶段/进度/日志）' })
  async get(@Param('id') id: string) {
    return this.pipelineService.get(id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '取消流水线（幂等）' })
  async cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.pipelineService.cancel(id, user?.username);
  }

  @Post(':id/promote')
  @ApiOperation({ summary: '灰度转全量' })
  async promote(@Param('id') id: string, @CurrentUser() user: any) {
    return this.pipelineService.promote(id, user?.username);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: '重试失败的流水线（相同参数重新提交）' })
  async retry(@Param('id') id: string, @CurrentUser() user: any) {
    return this.pipelineService.retry(id, user?.username);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: '审批通过（仅待审批流水线；通过后自动执行）' })
  async approve(
    @Param('id') id: string,
    @Body() body: { comment?: string },
    @CurrentUser() user: any,
  ) {
    return this.pipelineService.approve(id, user?.username, body?.comment);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: '审批拒绝（仅待审批流水线；拒绝必填意见）' })
  async reject(
    @Param('id') id: string,
    @Body() body: { comment?: string },
    @CurrentUser() user: any,
  ) {
    if (!body?.comment?.trim()) {
      throw new BadRequestException('拒绝必须填写审批意见');
    }
    return this.pipelineService.reject(id, user?.username, body.comment);
  }
}
