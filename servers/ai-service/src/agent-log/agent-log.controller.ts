import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AgentLogService } from './agent-log.service';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('Agent Runs (admin)')
@Controller('agent-runs')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class AgentLogController {
  constructor(private readonly log: AgentLogService) {}

  /**
   * 列出所有 agent（聚合）—— 用于 admin "Agents" 左栏
   * GET /api/agent-runs/agents
   */
  @Get('agents')
  @ApiOperation({ summary: '列出所有 agent（聚合，含总数/最近一次/错误数）' })
  async listAgents() {
    return this.log.getAgents();
  }

  /**
   * 列出 agent runs（分页 + 过滤）
   * GET /api/agent-runs?agentId=&userId=&status=&keyword=&startAt=&endAt=&page=&pageSize=
   */
  @Get()
  @ApiOperation({ summary: '分页列出 agent runs' })
  async list(
    @Query('agentId') agentId?: string,
    @Query('userId') userId?: string,
    @Query('status') status?: 'ok' | 'error',
    @Query('conversationId') conversationId?: string,
    @Query('keyword') keyword?: string,
    @Query('startAt') startAt?: string,
    @Query('endAt') endAt?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.log.listRuns({
      agentId,
      userId,
      status,
      conversationId,
      keyword,
      startAt: startAt ? new Date(startAt) : undefined,
      endAt: endAt ? new Date(endAt) : undefined,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  /**
   * 单个 run 详情（含完整原始 systemPrompt / userInput / steps / finalAnswer）
   * GET /api/agent-runs/:id
   */
  @Get(':id')
  @ApiOperation({ summary: '查看某次 run 的完整原始数据' })
  async getOne(@Param('id') id: string) {
    const run = await this.log.getRun(id);
    if (!run) {
      throw new HttpException('Agent run 不存在', HttpStatus.NOT_FOUND);
    }
    return run;
  }
}
