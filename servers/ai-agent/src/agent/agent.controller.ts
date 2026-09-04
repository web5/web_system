import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Res,
  Req,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { AgentRunner, AgentRegistry, ClientRegistry, StreamEvent } from '@kedouai/agent-core';
import { AgentRunDto } from './dto/agent-run.dto';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard, RequirePermission } from '@web-system/shared';
import { AgentRunPusher } from './agent-run-pusher';
import { PermissionBroker } from './permission-broker';

@ApiTags('AI Agent')
@Controller('agent')
@UseGuards(AuthGuard)
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly agentRegistry: AgentRegistry,
    private readonly runPusher: AgentRunPusher,
    private readonly clientRegistry: ClientRegistry,
    private readonly permissionBroker: PermissionBroker,
  ) {}

  /** Agent 运行（C 端，SSE 流式，含工具调用过程） */
  @Post('run')
  @ApiOperation({ summary: '运行 Agent（流式 SSE，返回工具调用与最终回答）' })
  async run(@Body() dto: AgentRunDto, @Res() res: Response, @Req() req: Request) {
    await this.handleRun(dto, res, req);
  }

  /**
   * Admin Playground 专用运行端点：要求 agents:debug 权限（消耗真实 LLM token）。
   * C 端用户无此权限，无法绕过权限校验直刷对话。
   */
  @Post('admin-run')
  @UseGuards(PermissionGuard)
  @RequirePermission('agents:debug')
  @ApiOperation({ summary: 'Admin 对话调试运行（需 agents:debug）' })
  async adminRun(@Body() dto: AgentRunDto, @Res() res: Response, @Req() req: Request) {
    await this.handleRun(dto, res, req);
  }

  /** 可用模型列表（Playground 模型下拉用，含可用性状态） */
  @Get('models')
  @UseGuards(PermissionGuard)
  @RequirePermission('agents:debug')
  @ApiOperation({ summary: '列出已注册的可用模型' })
  listModels() {
    return { models: this.clientRegistry.listModels() };
  }

  /**
   * 权限确认：前端弹窗后调用（approve=true 允许 / false 拒绝）。
   * 只用 AuthGuard（登录即可），因为 C 端业务用户也需要确认自己触发的高危操作；
   * 由 PermissionBroker 校验确认者 userId 与发起 run 的用户一致，防止越权替他人确认。
   */
  @Post('permission/:requestId')
  @ApiOperation({ summary: '确认/拒绝 Agent 工具执行的权限请求' })
  async resolvePermission(
    @Param('requestId') requestId: string,
    @Body() body: { approve?: boolean },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    const userId = String(user?.id ?? '');
    if (!userId) {
      throw new HttpException('无法识别用户身份', HttpStatus.UNAUTHORIZED);
    }
    const ok = this.permissionBroker.resolve(requestId, userId, body.approve === true);
    return { ok };
  }

  /** 共用运行逻辑（SSE 流式 + 步骤收集 + 异步落库） */
  private async handleRun(dto: AgentRunDto, res: Response, req: Request): Promise<void> {
    const user = (req as any).user;
    const userId = String(user?.id ?? '');
    this.logger.log(
      `收到 agent/run 请求: agentId=${dto.agentId} userId=${userId} inputLen=${(dto.userInput || '').length}`,
    );
    if (!userId) {
      throw new HttpException('无法识别用户身份', HttpStatus.UNAUTHORIZED);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 收集步骤流水 + 取 agent 定义快照（systemPrompt / tools / model）
    const steps: Array<{ type: string; name?: string; content?: string; step?: number; ts: number }> = [];
    let finalAnswer: string | null = null;
    let errorMessage: string | null = null;
    let conversationIdFromEngine: string | null = null;
    const startedAt = Date.now();

    let agentName: string | null = null;
    let systemPrompt = '';
    let tools: string[] | null = null;
    let model: string | null = null;
    try {
      const def = this.agentRegistry.get(dto.agentId);
      agentName = def?.name ?? null;
      systemPrompt = def?.systemPrompt ?? '';
      tools = def?.tools ?? null;
      model = def?.model ?? null;
    } catch {
      // agentId 找不到时，agent-runner 也会报错
    }

    try {
      // 权限确认器：工具遇到高危操作时，把 permission_request 事件写入 SSE 流并挂起，
      // 等待前端通过 POST /agent/permission/:requestId 确认（60s 超时自动拒绝）
      const confirmHandler = async (message: string): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
          const requestId = this.permissionBroker.register(userId, resolve);
          res.write(
            `data: ${JSON.stringify({ type: 'permission_request', requestId, content: message })}\n\n`,
          );
          setTimeout(() => this.permissionBroker.rejectTimeout(requestId), 60_000);
        });
      };

      const stream = this.agentRunner.stream(
        {
          agentId: dto.agentId,
          userInput: dto.userInput,
          conversationId: dto.conversationId,
          // 调试时可临时覆盖模型（仅本次运行）
          model: dto.model,
        },
        userId,
        confirmHandler,
      );

      for await (const event of stream as AsyncGenerator<StreamEvent>) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        // content_delta 是逐字增量（可能上千条），只透传前端用于逐字渲染，
        // 不落库 steps（避免 agent-runs 表被污染/膨胀）
        if (event.type !== 'content_delta') {
          steps.push({
            type: event.type,
            name: event.name,
            content: event.content,
            step: event.step,
            ts: Date.now(),
          });
        }
        if (event.type === 'final') {
          finalAnswer = event.content ?? '';
          conversationIdFromEngine = event.conversationId ?? null;
        } else if (event.type === 'error') {
          errorMessage = event.content ?? 'unknown error';
        }
      }
    } catch (error) {
      const msg = (error as Error).message || 'Agent 运行失败';
      errorMessage = msg;
      this.logger.error(`Agent run error: ${msg}`);
      const errPayload = JSON.stringify({ type: 'error', content: msg });
      res.write(`data: ${errPayload}\n\n`);
      steps.push({ type: 'error', content: msg, ts: Date.now() });
    }

    res.end();

    // 异步把 run 推送到 ai-service 统一落库（admin 调试用）
    this.runPusher
      .push({
        agentId: dto.agentId,
        agentName,
        userId,
        conversationId: conversationIdFromEngine,
        userInput: dto.userInput,
        systemPrompt,
        tools,
        model,
        steps,
        finalAnswer,
        error: errorMessage,
        status: errorMessage ? 'error' : 'ok',
        durationMs: Date.now() - startedAt,
        source: 'ai-agent',
      })
      .catch(() => {
        /* pusher 内已 warn，不外抛 */
      });
  }
}
