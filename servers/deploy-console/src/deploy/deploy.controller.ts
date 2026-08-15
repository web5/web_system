import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Res,
  Query,
  BadRequestException,
  Sse,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { DeployService } from './deploy.service';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import { BuildDto, DeployDto, RollbackDto } from '../common/dto';

/**
 * 部署管理控制器
 * 提供构建、部署、回滚、任务查询和 SSE 实时进度推送
 */
@ApiTags('部署管理')
@ApiBearerAuth()
@Controller('deploy')
export class DeployController {
  constructor(
    private readonly deployService: DeployService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * 启动本地构建
   */
  @Post('build')
  @ApiOperation({ summary: '启动构建' })
  @ApiResponse({ status: 200, description: '返回任务 ID' })
  async build(@Body() body: BuildDto, @CurrentUser() user: any) {
    const taskId = await this.deployService.startBuild(body.component, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'deploy.build',
      component: body.component,
      status: 'started',
      detail: `启动构建: ${body.component}, 任务ID: ${taskId}`,
    });
    return { taskId, status: 'started', message: `构建已启动: ${body.component}` };
  }

  /**
   * 启动部署
   * prod 环境必须传 confirm=true
   */
  @Post('deploy')
  @ApiOperation({ summary: '启动部署' })
  @ApiResponse({ status: 200, description: '返回任务 ID' })
  @ApiResponse({ status: 400, description: 'prod 操作需要确认' })
  async deploy(@Body() body: DeployDto, @CurrentUser() user: any) {
    if (body.env === 'prod' && body.confirm !== true) {
      throw new BadRequestException('Prod operations require confirm=true');
    }
    const taskId = await this.deployService.startDeploy(body.env, body.component, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'deploy.deploy',
      env: body.env,
      component: body.component,
      status: 'started',
      detail: `启动部署: ${body.env} / ${body.component}, 任务ID: ${taskId}`,
    });
    return { taskId, status: 'started', message: `部署已启动: ${body.env} / ${body.component}` };
  }

  /**
   * 回滚
   * prod 环境必须传 confirm=true
   */
  @Post('rollback')
  @ApiOperation({ summary: '回滚' })
  @ApiResponse({ status: 200, description: '返回任务 ID' })
  @ApiResponse({ status: 400, description: 'prod 操作需要确认' })
  async rollback(@Body() body: RollbackDto, @CurrentUser() user: any) {
    if (body.env === 'prod' && body.confirm !== true) {
      throw new BadRequestException('Prod operations require confirm=true');
    }
    const taskId = await this.deployService.startRollback(body.env, body.tag, user?.username);
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'deploy.rollback',
      env: body.env,
      component: body.tag,
      status: 'started',
      detail: `启动回滚: ${body.env} / ${body.tag}, 任务ID: ${taskId}`,
    });
    return { taskId, status: 'started', message: `回滚已启动: ${body.env} / ${body.tag}` };
  }

  /**
   * 列出所有任务（读 DB）
   */
  @Get('tasks')
  @ApiOperation({ summary: '列出所有部署任务' })
  async listTasks() {
    return this.deployService.listTasks();
  }

  /**
   * 获取单个任务状态
   */
  @Get('task/:id')
  @ApiOperation({ summary: '获取任务详情' })
  @ApiResponse({ status: 404, description: '任务不存在' })
  async getTask(@Param('id') id: string) {
    return this.deployService.getTask(id);
  }

  /**
   * SSE 实时推送部署进度
   */
  @Get('stream/:taskId')
  @ApiOperation({ summary: 'SSE 实时推送部署日志' })
  async streamTask(@Param('taskId') taskId: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      const task = await this.deployService.getTask(taskId);
      for (const log of task.logs) {
        res.write(`data: ${JSON.stringify({ type: 'log', data: log })}\n\n`);
      }
      if (task.status === 'success' || task.status === 'failed' || task.status === 'cancelled') {
        res.write(`data: ${JSON.stringify({ type: 'done', status: task.status, error: task.error })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
    } catch {
      res.write(`data: ${JSON.stringify({ type: 'error', data: '任务不存在' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const emitter = this.deployService.getProgressEmitter();
    const listener = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'done') {
        res.write('data: [DONE]\n\n');
        res.end();
        emitter.off(`task:${taskId}`, listener);
      }
    };
    emitter.on(`task:${taskId}`, listener);
    res.on('close', () => {
      emitter.off(`task:${taskId}`, listener);
    });
  }

  /**
   * 列出发布版本（数据库，供回滚选择）
   */
  @Get('versions')
  @ApiOperation({ summary: '列出发布版本记录' })
  @ApiQuery({ name: 'env', required: false, type: String, description: '环境: dev/prod' })
  @ApiQuery({ name: 'component', required: false, type: String, description: '组件名' })
  @ApiResponse({ status: 200, description: '返回版本列表' })
  async listVersions(@Query('env') env?: string, @Query('component') component?: string) {
    return await this.deployService.listVersions(env, component);
  }

  /**
   * 列出可发布模块（前端发布中心据此渲染，与 deploy.sh 共用 modules.json）
   */
  @Get('modules')
  @ApiOperation({ summary: '列出可发布模块' })
  @ApiResponse({ status: 200, description: '返回模块列表' })
  async listModules() {
    return this.deployService.listModules();
  }

  /**
   * 查询某环境各模块当前版本（「不同环境指定不同版本」展示用）
   */
  @Get('current-versions')
  @ApiOperation({ summary: '查询环境各模块当前版本' })
  @ApiQuery({ name: 'env', required: true, type: String, description: '环境 ID' })
  async currentVersions(@Query('env') env: string) {
    return this.deployService.getCurrentVersions(env);
  }

  /**
   * 列出远程可用快照（保留）
   */
  @Get('releases')
  @ApiOperation({ summary: '列出远程可用发布版本目录' })
  @ApiQuery({ name: 'env', required: true, type: String, description: '环境: dev/prod' })
  @ApiResponse({ status: 200, description: '返回版本列表' })
  async listReleases(@Query('env') env: string) {
    return await this.deployService.listReleases(env);
  }
}
