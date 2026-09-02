import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { McpKeyGuard } from './mcp-key.guard';
import { PipelineService } from '../pipeline/pipeline.service';
import { DeployService } from '../deploy/deploy.service';

/**
 * MCP 发布接口（/api/mcp/*）。
 *
 * 与控制台接口（/api/pipelines/*）的区别：
 *  - 鉴权走 McpKeyGuard（每用户 API Key → ownerId），而非控制台 JWT
 *  - 返回结构对齐任务语义（jobId / status / progress / logs），供 MCP 工具直接映射
 *  - mcp-gateway 是唯一 MCP 端点，这里只是它背后的执行接口
 *
 * 操作人一律取 `req.mcpOperator`（API Key 的 ownerId），保证审计可追溯到人。
 */
@ApiTags('MCP 发布接口')
@Controller('mcp')
@Public()
@UseGuards(McpKeyGuard)
export class McpController {
  /** dev-only mock 任务（验证长任务 T3 双模式用，避免每次真构建） */
  private readonly mockJobs = new Map<
    string,
    { status: string; startedAt: number; seconds: number }
  >();

  constructor(
    private readonly pipelineService: PipelineService,
    private readonly deployService: DeployService,
  ) {}

  private operator(req: any): string {
    return req?.mcpOperator || 'unknown';
  }

  // ── 发布流水线 ──

  @Post('pipeline')
  @ApiOperation({ summary: '提交发布流水线（异步，返回 jobId）' })
  async submitPipeline(@Body() body: any, @Req() req: any) {
    const env = String(body?.env || '');
    if (env === 'prod' && body?.confirm !== true) {
      throw new BadRequestException('Prod operations require confirm=true');
    }
    const result = await this.pipelineService.submit(
      {
        env,
        moduleKey: String(body?.moduleKey || ''),
        mode: body?.mode,
        versionTag: body?.versionTag,
        target: body?.target,
        grayscaleRule: body?.grayscaleRule,
      },
      this.operator(req),
    );
    return { jobId: result.jobId, status: result.status };
  }

  @Get('pipeline/:jobId')
  @ApiOperation({ summary: '查询流水线状态/进度/日志' })
  async getPipeline(@Param('jobId') jobId: string) {
    const p = await this.pipelineService.get(jobId);
    return {
      jobId: p.id,
      env: p.env,
      moduleKey: p.moduleKey,
      versionTag: p.versionTag,
      mode: p.mode,
      status: p.status,
      stage: p.stage,
      progress: p.progress,
      logs: p.logs,
      error: p.error,
      result: p.result,
      operator: p.operator,
      startTime: p.startTime,
      endTime: p.endTime,
    };
  }

  @Post('pipeline/:jobId/cancel')
  @ApiOperation({ summary: '取消流水线（幂等）' })
  async cancelPipeline(@Param('jobId') jobId: string, @Req() req: any) {
    return this.pipelineService.cancel(jobId, this.operator(req));
  }

  @Post('pipeline/:jobId/promote')
  @ApiOperation({ summary: '灰度转全量' })
  async promote(@Param('jobId') jobId: string, @Req() req: any) {
    return this.pipelineService.promote(jobId, this.operator(req));
  }

  // ── 版本 / 回滚（复用既有 DeployService） ──

  @Post('version')
  @ApiOperation({ summary: '发布指定版本（秒级切换，不重新构建）' })
  async publishVersion(@Body() body: any, @Req() req: any) {
    const env = String(body?.env || '');
    const versionTag = String(body?.versionTag || '');
    if (env === 'prod' && body?.confirm !== true) {
      throw new BadRequestException('Prod operations require confirm=true');
    }
    const operator = this.operator(req);
    try {
      const { component } = await this.deployService.startPublishVersion(env, versionTag, operator);
      return { status: 'success', component, versionTag, env };
    } catch (e) {
      // 回退：版本表无记录（历史 deploy.sh 写入的 component 形如 mf:admin）时，
      // 若产物确实存在则直接切指针，保证回滚能力可用。需要调用方传 component。
      const msg = (e as Error).message || '';
      if (msg.includes('版本不存在') && body?.component) {
        return {
          status: 'success',
          ...(await this.pipelineService.switchPointer(
            env,
            String(body.component),
            versionTag,
            operator,
          )),
          fallback: true,
        };
      }
      throw e;
    }
  }

  @Post('rollback')
  @ApiOperation({ summary: '回滚到指定版本' })
  async rollback(@Body() body: any, @Req() req: any) {
    const env = String(body?.env || '');
    if (env === 'prod' && body?.confirm !== true) {
      throw new BadRequestException('Prod operations require confirm=true');
    }
    const taskId = await this.deployService.startRollback(
      env,
      String(body?.versionTag || ''),
      this.operator(req),
      body?.component,
    );
    return { taskId, status: 'started', env, versionTag: body?.versionTag };
  }

  // ── 查询类 ──

  @Get('modules')
  @ApiOperation({ summary: '可发布模块清单' })
  async modules() {
    return this.deployService.listModules();
  }

  @Get('current-versions')
  @ApiOperation({ summary: '某环境各模块当前版本' })
  @ApiQuery({ name: 'env', required: true, type: String })
  async currentVersions(@Query('env') env: string) {
    return this.deployService.getCurrentVersions(env);
  }

  @Get('releases')
  @ApiOperation({ summary: '版本历史（回滚候选，含磁盘上未登记版本表的历史产物）' })
  @ApiQuery({ name: 'env', required: false, type: String })
  @ApiQuery({ name: 'component', required: false, type: String })
  async releases(@Query('env') env?: string, @Query('component') component?: string) {
    // 版本表记录 + 磁盘产物，按 versionTag 去重（与控制台同一实现）
    return this.pipelineService.listReleaseCandidates(env, component);
  }

  // ── dev-only：mock 长任务（验证 T3 双模式，不触发真实构建） ──

  @Post('mock-job')
  @ApiOperation({ summary: '[dev-only] 提交模拟长任务' })
  async submitMockJob(@Body() body: any) {
    this.assertNotProduction();
    const seconds = Math.min(Math.max(Number(body?.seconds ?? 5), 1), 600);
    const jobId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.mockJobs.set(jobId, { status: 'running', startedAt: Date.now(), seconds });
    setTimeout(() => {
      const job = this.mockJobs.get(jobId);
      if (job) job.status = 'succeeded';
    }, seconds * 1000);
    return { jobId, status: 'pending', seconds };
  }

  @Get('mock-job/:jobId')
  @ApiOperation({ summary: '[dev-only] 查询模拟长任务状态' })
  async getMockJob(@Param('jobId') jobId: string) {
    this.assertNotProduction();
    const job = this.mockJobs.get(jobId);
    if (!job) throw new NotFoundException(`mock 任务不存在: ${jobId}`);
    const elapsed = (Date.now() - job.startedAt) / 1000;
    const percent = Math.min(100, Math.round((elapsed / job.seconds) * 100));
    return {
      jobId,
      status: job.status,
      progress: {
        current: percent,
        total: 100,
        message: `模拟任务运行中（${Math.floor(elapsed)}/${job.seconds}s）`,
      },
      result: job.status === 'succeeded' ? { ok: true, elapsedSeconds: job.seconds } : undefined,
    };
  }

  private assertNotProduction(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
  }
}
